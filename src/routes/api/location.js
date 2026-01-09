const express = require('express');
const { asyncHandler } = require('../../middleware/errors');
const { validateLocationSettings, validateLocationUpdate } = require('../../middleware/validation');
const logger = require('../../utils/logger');
const { getDatabase } = require('../../config/database');

const router = express.Router();

/**
 * GET /api/location/settings
 * Get user's location sharing settings
 */
router.get('/settings', asyncHandler(async (req, res) => {
  try {
    const db = getDatabase();
    
    let settings = await db.get(
      'SELECT * FROM location_sharing WHERE user_id = ?',
      [req.user.id]
    );

    // Create default settings if none exist
    if (!settings) {
      await db.run(
        `INSERT INTO location_sharing (user_id, enabled, location_mode, accuracy_threshold, update_interval, auto_disable_after) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [req.user.id, 0, 'gps', 5000, 30, 3600]
      );

      settings = await db.get(
        'SELECT * FROM location_sharing WHERE user_id = ?',
        [req.user.id]
      );
    }

    const responseSettings = {
      enabled: Boolean(settings.enabled),
      locationMode: settings.location_mode || 'gps',
      accuracyThreshold: settings.accuracy_threshold,
      updateInterval: settings.update_interval,
      autoDisableAfter: settings.auto_disable_after,
      fixedLatitude: settings.fixed_latitude,
      fixedLongitude: settings.fixed_longitude,
      fixedLocationName: settings.fixed_name
    };

    res.json({
      success: true,
      settings: responseSettings
    });
  } catch (error) {
    logger.error('Get location settings error:', error);
    res.status(500).json({ error: 'Failed to get location settings' });
  }
}));

/**
 * PUT /api/location/settings
 * Update user's location sharing settings
 */
router.put('/settings', validateLocationSettings, asyncHandler(async (req, res) => {
  try {
    const db = getDatabase();
    const { 
      enabled, 
      locationMode, 
      accuracyThreshold, 
      updateInterval, 
      autoDisableAfter,
      fixedLatitude,
      fixedLongitude,
      fixedLocationName
    } = req.body;

    // Update or insert settings using ON CONFLICT for user_id
    await db.run(
      `INSERT INTO location_sharing 
       (user_id, enabled, location_mode, accuracy_threshold, update_interval, auto_disable_after,
        fixed_latitude, fixed_longitude, fixed_name, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
        enabled = excluded.enabled,
        location_mode = excluded.location_mode,
        accuracy_threshold = excluded.accuracy_threshold,
        update_interval = excluded.update_interval,
        auto_disable_after = excluded.auto_disable_after,
        fixed_latitude = excluded.fixed_latitude,
        fixed_longitude = excluded.fixed_longitude,
        fixed_name = excluded.fixed_name,
        updated_at = CURRENT_TIMESTAMP`,
      [
        req.user.id,
        enabled ? 1 : 0,
        locationMode || 'gps',
        accuracyThreshold || 100,
        updateInterval || 30,
        autoDisableAfter !== undefined ? autoDisableAfter : 3600,
        locationMode === 'fixed' ? fixedLatitude : null,
        locationMode === 'fixed' ? fixedLongitude : null,
        locationMode === 'fixed' ? (fixedLocationName || null) : null
      ]
    );

    // If location sharing is disabled, clear all location data
    if (!enabled) {
      await db.run(
        'DELETE FROM location_data WHERE user_id = ?',
        [req.user.id]
      );
      logger.info(`Location data cleared for user ${req.user.username} (location disabled)`);
    }

    // Log the change
    await db.run(
      'INSERT INTO audit_log (user_id, action, resource_type, details) VALUES (?, ?, ?, ?)',
      [
        req.user.id,
        'location_settings_updated',
        'location',
        JSON.stringify({
          enabled,
          locationMode,
          accuracyThreshold,
          updateInterval,
          autoDisableAfter,
          fixedLocation: locationMode === 'fixed' ? {
            latitude: fixedLatitude,
            longitude: fixedLongitude,
            name: fixedLocationName
          } : null,
          dataCleared: !enabled,
          ip: req.ip,
          userAgent: req.get('User-Agent')
        })
      ]
    );

    logger.debug(`Location settings updated for user ${req.user.username}:`, {
      enabled,
      locationMode,
      accuracyThreshold,
      updateInterval,
      autoDisableAfter,
      hasFixedLocation: locationMode === 'fixed'
    });

    res.json({
      success: true,
      message: 'Location settings updated successfully'
    });
  } catch (error) {
    logger.error('Update location settings error:', error);
    res.status(500).json({ error: 'Failed to update location settings' });
  }
}));

/**
 * POST /api/location/update
 * Update user's current location
 */
router.post('/update', validateLocationUpdate, asyncHandler(async (req, res) => {
  try {
    const db = getDatabase();
    
    // Log incoming location data for debugging
    logger.debug(`Location update received from user ${req.user.username} (${req.user.id}):`, {
      latitude: req.body.latitude,
      longitude: req.body.longitude,
      accuracy: req.body.accuracy,
      altitude: req.body.altitude,
      altitudeAccuracy: req.body.altitudeAccuracy,
      heading: req.body.heading,
      speed: req.body.speed,
      hasToken: !!req.headers.authorization,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });
    
    // Check if location sharing is enabled
    const settings = await db.get(
      'SELECT enabled, accuracy_threshold FROM location_sharing WHERE user_id = ?',
      [req.user.id]
    );

    if (!settings || !settings.enabled) {
      logger.warn(`Location update rejected - sharing disabled for user ${req.user.username}`);
      return res.status(403).json({ error: 'Location sharing is not enabled' });
    }

    const {
      latitude,
      longitude,
      accuracy,
      altitude,
      altitudeAccuracy,
      heading,
      speed,
      gpsQuality,
      gsmSignal
    } = req.body;

    // Validate received data integrity
    if (!latitude || !longitude) {
      logger.error(`Invalid location data received from user ${req.user.username}:`, req.body);
      return res.status(400).json({ error: 'Missing required latitude or longitude' });
    }

    // Log accuracy warning but don't block (let dashboard show warning instead)
    if (accuracy && accuracy > settings.accuracy_threshold) {
      logger.warn(`Location accuracy (${accuracy}m) exceeds threshold (${settings.accuracy_threshold}m) for user ${req.user.username}`);
    }

    // Log if receiving unexpected field names (common mistake: bearing vs heading)
    if (req.body.bearing !== undefined) {
      logger.warn(`Received deprecated 'bearing' field from user ${req.user.username} - should use 'heading'`);
    }

    // Insert location data
    await db.run(
      `INSERT INTO location_data 
       (user_id, latitude, longitude, accuracy, altitude, altitude_accuracy, heading, speed, gps_quality, gsm_signal) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        latitude,
        longitude,
        accuracy !== null && accuracy !== undefined ? accuracy : null,
        altitude !== null && altitude !== undefined ? altitude : null,
        altitudeAccuracy !== null && altitudeAccuracy !== undefined ? altitudeAccuracy : null,
        heading !== null && heading !== undefined ? heading : null,
        speed !== null && speed !== undefined ? speed : null,
        gpsQuality !== undefined ? gpsQuality : null,
        gsmSignal !== undefined ? gsmSignal : null
      ]
    );

    logger.debug(`Location stored successfully for user ${req.user.username}: ${latitude}, ${longitude}`);

    // Clean up old location data (keep only last 24 hours)
    await db.run(
      `DELETE FROM location_data 
       WHERE user_id = ? AND created_at < datetime('now', '-24 hours')`,
      [req.user.id]
    );

    res.json({
      success: true,
      message: 'Location updated successfully'
    });
  } catch (error) {
    logger.error(`Update location error for user ${req.user?.username || 'unknown'}:`, {
      error: error.message,
      stack: error.stack,
      body: req.body
    });
    res.status(500).json({ error: 'Failed to update location' });
  }
}));

/**
 * GET /api/location/current
 * Get user's current location data
 */
router.get('/current', asyncHandler(async (req, res) => {
  try {
    // Prevent caching of location data
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store'
    });
    
    const db = getDatabase();
    
    // Check location sharing settings
    const settings = await db.get(
      `SELECT enabled, location_mode, fixed_latitude, fixed_longitude, fixed_name, auto_disable_after
       FROM location_sharing WHERE user_id = ?`,
      [req.user.id]
    );

    if (!settings) {
      return res.json({
        success: true,
        enabled: false,
        location: null
      });
    }

    // Check if auto-disable should trigger (only for GPS mode)
    // Note: This only affects the CURRENT request - marks data as stale but doesn't disable the setting
    if (settings.enabled && settings.location_mode === 'gps' && settings.auto_disable_after > 0) {
      const lastLocation = await db.get(
        `SELECT created_at FROM location_data 
         WHERE user_id = ? 
         ORDER BY created_at DESC 
         LIMIT 1`,
        [req.user.id]
      );

      // Only check staleness if we have at least one location update
      // If no location data exists, don't mark as stale - user just hasn't started tracking yet
      if (lastLocation) {
        const lastUpdateTime = new Date(lastLocation.created_at).getTime();
        const currentTime = Date.now();
        const timeSinceUpdate = (currentTime - lastUpdateTime) / 1000; // in seconds

        if (timeSinceUpdate > settings.auto_disable_after) {
          // Data is stale - location updates stopped
          logger.info(`Location data stale for user ${req.user.id}: ${Math.round(timeSinceUpdate)}s since last update (threshold: ${settings.auto_disable_after}s)`);

          return res.json({
            success: true,
            enabled: true, // Setting is still enabled
            location: null,
            stale: true,
            reason: `No location updates for ${Math.round(timeSinceUpdate / 60)} minutes`
          });
        }
      }
      // If no lastLocation exists, continue to return the latest location (or null) without stale flag
    }

    if (!settings.enabled) {
      return res.json({
        success: true,
        enabled: false,
        location: null
      });
    }

    let locationData = null;

    // Always get the latest location from location_data table
    // This works for both GPS and fixed modes since both send updates to this table
    const location = await db.get(
      `SELECT latitude, longitude, accuracy, altitude, altitude_accuracy, heading, speed, gps_quality, gsm_signal, created_at
       FROM location_data 
       WHERE user_id = ? 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [req.user.id]
    );

    if (location) {
      locationData = {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        altitude: location.altitude,
        altitudeAccuracy: location.altitude_accuracy,
        heading: location.heading,
        speed: location.speed,
        gpsQuality: location.gps_quality,
        gsmSignal: location.gsm_signal,
        timestamp: location.created_at,
        source: settings.location_mode,
        name: settings.location_mode === 'fixed' ? settings.fixed_name : null
      };
    }

    res.json({
      success: true,
      enabled: true,
      location: locationData
    });
  } catch (error) {
    logger.error('Get current location error:', error);
    res.status(500).json({ error: 'Failed to get current location' });
  }
}));

/**
 * GET /api/location/history
 * Get user's location history
 */
router.get('/history', asyncHandler(async (req, res) => {
  try {
    const db = getDatabase();
    
    // Check if location sharing is enabled
    const settings = await db.get(
      'SELECT enabled FROM location_sharing WHERE user_id = ?',
      [req.user.id]
    );

    if (!settings || !settings.enabled) {
      return res.json({
        success: true,
        enabled: false,
        history: []
      });
    }

    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const offset = parseInt(req.query.offset) || 0;

    const history = await db.all(
      `SELECT latitude, longitude, accuracy, altitude, altitude_accuracy, heading, speed, created_at
       FROM location_data 
       WHERE user_id = ? 
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`,
      [req.user.id, limit, offset]
    );

    const formattedHistory = history.map(item => ({
      latitude: item.latitude,
      longitude: item.longitude,
      accuracy: item.accuracy,
      altitude: item.altitude,
      altitudeAccuracy: item.altitude_accuracy,
      heading: item.heading,
      speed: item.speed,
      timestamp: item.created_at
    }));

    res.json({
      success: true,
      enabled: true,
      history: formattedHistory
    });
  } catch (error) {
    logger.error('Get location history error:', error);
    res.status(500).json({ error: 'Failed to get location history' });
  }
}));

/**
 * DELETE /api/location/data
 * Clear all user location data
 */
router.delete('/data', asyncHandler(async (req, res) => {
  try {
    const db = getDatabase();
    
    await db.run(
      'DELETE FROM location_data WHERE user_id = ?',
      [req.user.id]
    );

    // Log the action
    await db.run(
      'INSERT INTO audit_log (user_id, action, resource_type, details) VALUES (?, ?, ?, ?)',
      [
        req.user.id,
        'location_data_cleared',
        'location',
        JSON.stringify({
          ip: req.ip,
          userAgent: req.get('User-Agent')
        })
      ]
    );

    logger.info(`Location data cleared for user ${req.user.username}`);

    res.json({
      success: true,
      message: 'Location data cleared successfully'
    });
  } catch (error) {
    logger.error('Clear location data error:', error);
    res.status(500).json({ error: 'Failed to clear location data' });
  }
}));

module.exports = router;