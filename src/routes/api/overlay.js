const express = require('express');
const { requireOverlayAuth } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/errors');
const logger = require('../../utils/logger');
const { getDatabase } = require('../../config/database');

const router = express.Router();

// Apply overlay authentication to all routes
router.use(requireOverlayAuth);

/**
 * GET /api/overlay/location/current
 * Get current location data for overlay display
 */
router.get('/location/current', asyncHandler(async (req, res) => {
  try {
    const db = getDatabase();
    const userId = req.user.id;

    // Get user's location sharing settings
    const settings = await db.get(
      'SELECT * FROM location_sharing WHERE user_id = ?',
      [userId]
    );

    if (!settings || !settings.enabled) {
      return res.json({
        success: true,
        enabled: false,
        location: null
      });
    }

    // Get most recent location data
    const location = await db.get(
      `SELECT * FROM location_data 
       WHERE user_id = ? 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [userId]
    );

    if (!location) {
      return res.json({
        success: true,
        enabled: true,
        location: null
      });
    }

    // Check if data is stale (older than auto_disable_after threshold)
    const now = new Date();
    const locationTime = new Date(location.created_at);
    const ageSeconds = (now - locationTime) / 1000;
    const isStale = ageSeconds > (settings.auto_disable_after || 3600);

    if (isStale) {
      return res.json({
        success: true,
        enabled: true,
        stale: true,
        location: null
      });
    }

    res.json({
      success: true,
      enabled: true,
      location: {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        altitude: location.altitude,
        speed: location.speed,
        bearing: location.heading,
        timestamp: location.created_at,
        provider: location.provider,
        gpsQuality: location.gps_quality,
        gsmSignal: location.gsm_signal,
        batteryLevel: location.battery_level
      }
    });
  } catch (error) {
    logger.error('Overlay get current location error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get location data'
    });
  }
}));

/**
 * GET /api/overlay/stream/status
 * Get stream key status for overlay display
 */
router.get('/stream/status', asyncHandler(async (req, res) => {
  try {
    const { User } = require('../../models/User');
    const { StreamKey } = require('../../models/StreamKey');
    const { getRTMPServerConfig } = require('../../config/rtmp');
    const userId = req.user.id;

    // Get user's stream key objects
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get OBS WebSocket password (decrypted)
    const obsWebsocketPassword = await User.getOBSWebSocketPassword(userId);

    const streamKeys = await StreamKey.findAllActiveByUserId(userId);
    if (!streamKeys || streamKeys.length === 0) {
      return res.json({
        success: true,
        streamKeys: [],
        obsWebsocketPassword: obsWebsocketPassword || null
      });
    }

    // Check if each stream is currently active
    const rtmpConfig = getRTMPServerConfig();
    const streamStatuses = streamKeys.map(streamKeyObj => ({
      id: streamKeyObj.id,
      description: streamKeyObj.description,
      obsSourceName: streamKeyObj.obsSourceName,
      isLive: rtmpConfig ? rtmpConfig.hasActivePublisher(streamKeyObj.streamKey) : false
    }));

    res.json({
      success: true,
      streamKeys: streamStatuses,
      obsWebsocketPassword: obsWebsocketPassword || null
    });
  } catch (error) {
    logger.error('Overlay get stream status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get stream status'
    });
  }
}));

/**
 * GET /api/overlay/pictures
 * Get active pictures/videos for overlay display
 */
router.get('/pictures', asyncHandler(async (req, res) => {
  try {
    const db = getDatabase();
    const userId = req.user.id;
    
    // Get media created in the last 30 seconds (for queue management) - ONLY for this user
    const pictures = await db.all(
      `SELECT id, user_id, filename, filepath, media_type, created_at 
       FROM overlay_pictures 
       WHERE user_id = ? AND datetime(created_at, '+30 seconds') > datetime('now')
       ORDER BY created_at DESC`,
      [userId]
    );
    
    // Get queue version for clear detection
    const queueVersion = await db.get(
      'SELECT version FROM queue_version WHERE user_id = ?',
      [userId]
    );

    res.json({
      success: true,
      queueVersion: queueVersion?.version || null,
      pictures: pictures.map(pic => ({
        id: pic.id,
        userId: pic.user_id,
        filename: pic.filename,
        url: pic.filepath,
        mediaType: pic.media_type || 'image',
        createdAt: pic.created_at
      }))
    });
  } catch (error) {
    logger.error('Overlay get pictures error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get pictures'
    });
  }
}));

module.exports = router;
