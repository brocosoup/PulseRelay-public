const express = require('express');
const { asyncHandler } = require('../../middleware/errors');
const { validateRtmpDestination, validateUpdateRtmpDestination, validatePagination } = require('../../middleware/validation');
const { rateLimitSensitive } = require('../../middleware/auth');
const logger = require('../../utils/logger');

const router = express.Router();

/**
 * GET /api/rtmp/destinations
 * Get user's RTMP destinations
 */
router.get('/destinations', validatePagination, asyncHandler(async (req, res) => {
  const { RTMPDestination } = require('../../models/RTMPDestination');
  
  try {
    const destinations = await RTMPDestination.findByUserId(
      req.user.id,
      req.query.include_inactive === 'true'
    );
    
    res.json({
      destinations: destinations.map(dest => dest.toSafeJSON()),
      count: destinations.length,
    });
  } catch (error) {
    logger.error('Get RTMP destinations error:', error);
    res.status(500).json({ error: 'Failed to get RTMP destinations' });
  }
}));

/**
 * POST /api/rtmp/destinations
 * Create new RTMP destination
 */
router.post('/destinations', 
  rateLimitSensitive(15 * 60 * 1000, 10), // 10 creations per 15 minutes
  validateRtmpDestination,
  asyncHandler(async (req, res) => {
    const { RTMPDestination } = require('../../models/RTMPDestination');
    
    try {
      // Validate RTMP URL format
      if (!RTMPDestination.validateRtmpUrl(req.body.rtmp_url)) {
        return res.status(400).json({ error: 'Invalid RTMP URL format' });
      }
      
      // Check if user already has a destination with the same name
      const existingDestinations = await RTMPDestination.findByUserId(req.user.id);
      const nameExists = existingDestinations.some(dest => 
        dest.name.toLowerCase() === req.body.name.toLowerCase()
      );
      
      if (nameExists) {
        return res.status(409).json({ error: 'Destination with this name already exists' });
      }
      
      const destination = await RTMPDestination.create({
        userId: req.user.id,
        name: req.body.name,
        rtmpUrl: req.body.rtmp_url,
        streamKey: req.body.stream_key,
        isActive: req.body.is_active,
      });
      
      // Log the creation
      const { getDatabase } = require('../../config/database');
      const db = getDatabase();
      await db.run(
        'INSERT INTO audit_log (user_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          req.user.id,
          'rtmp_destination_created',
          'rtmp_destination',
          destination.id,
          JSON.stringify({
            name: destination.name,
            hostname: RTMPDestination.extractHostname(destination.rtmpUrl),
            ip: req.ip,
            userAgent: req.get('User-Agent'),
          })
        ]
      );
      
      logger.info(`RTMP destination created: ${destination.name} by ${req.user.username}`);
      
      res.status(201).json({
        destination: destination.toSafeJSON(),
        message: 'RTMP destination created successfully',
      });
    } catch (error) {
      logger.error('Create RTMP destination error:', error);
      res.status(500).json({ error: 'Failed to create RTMP destination' });
    }
  })
);

/**
 * GET /api/rtmp/destinations/:id
 * Get specific RTMP destination
 */
router.get('/destinations/:id', asyncHandler(async (req, res) => {
  const { RTMPDestination } = require('../../models/RTMPDestination');
  
  try {
    const destination = await RTMPDestination.findById(req.params.id);
    
    if (!destination) {
      return res.status(404).json({ error: 'RTMP destination not found' });
    }
    
    // Check ownership
    if (destination.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    res.json({ destination: destination.toSafeJSON() });
  } catch (error) {
    logger.error('Get RTMP destination error:', error);
    res.status(500).json({ error: 'Failed to get RTMP destination' });
  }
}));

/**
 * PUT /api/rtmp/destinations/:id
 * Update RTMP destination
 */
router.put('/destinations/:id', 
  validateUpdateRtmpDestination,
  asyncHandler(async (req, res) => {
    const { RTMPDestination } = require('../../models/RTMPDestination');
    
    try {
      const destination = await RTMPDestination.findById(req.params.id);
      
      if (!destination) {
        return res.status(404).json({ error: 'RTMP destination not found' });
      }
      
      // Check ownership
      if (destination.userId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      // Validate RTMP URL format if provided
      if (req.body.rtmp_url && !RTMPDestination.validateRtmpUrl(req.body.rtmp_url)) {
        return res.status(400).json({ error: 'Invalid RTMP URL format' });
      }
      
      // Check name uniqueness if changing name
      if (req.body.name && req.body.name !== destination.name) {
        const existingDestinations = await RTMPDestination.findByUserId(req.user.id);
        const nameExists = existingDestinations.some(dest => 
          dest.id !== destination.id && 
          dest.name.toLowerCase() === req.body.name.toLowerCase()
        );
        
        if (nameExists) {
          return res.status(409).json({ error: 'Destination with this name already exists' });
        }
      }
      
      const updatedDestination = await destination.update(req.body);
      
      // Log the update
      const { getDatabase } = require('../../config/database');
      const db = getDatabase();
      await db.run(
        'INSERT INTO audit_log (user_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          req.user.id,
          'rtmp_destination_updated',
          'rtmp_destination',
          destination.id,
          JSON.stringify({
            name: updatedDestination.name,
            changes: req.body,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
          })
        ]
      );
      
      logger.info(`RTMP destination updated: ${updatedDestination.name} by ${req.user.username}`);
      
      res.json({
        destination: updatedDestination.toSafeJSON(),
        message: 'RTMP destination updated successfully',
      });
    } catch (error) {
      logger.error('Update RTMP destination error:', error);
      res.status(500).json({ error: 'Failed to update RTMP destination' });
    }
  })
);

/**
 * DELETE /api/rtmp/destinations/:id
 * Delete RTMP destination
 */
router.delete('/destinations/:id', asyncHandler(async (req, res) => {
  const { RTMPDestination } = require('../../models/RTMPDestination');
  
  try {
    const destination = await RTMPDestination.findById(req.params.id);
    
    if (!destination) {
      return res.status(404).json({ error: 'RTMP destination not found' });
    }
    
    // Check ownership
    if (destination.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Stop any active restreams to this destination
    const { RestreamService } = require('../../services/restream');
    const restreamService = new RestreamService();
    const { User } = require('../../models/User');
    const user = await User.findById(req.user.id);
    const streamKey = await user.getStreamKey();
    
    if (streamKey) {
      const restreamKey = `${streamKey}-${destination.id}`;
      await restreamService.stopDestinationRestream(restreamKey);
    }
    
    await destination.delete();
    
    // Log the deletion
    const { getDatabase } = require('../../config/database');
    const db = getDatabase();
    await db.run(
      'INSERT INTO audit_log (user_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
      [
        req.user.id,
        'rtmp_destination_deleted',
        'rtmp_destination',
        destination.id,
        JSON.stringify({
          name: destination.name,
          hostname: RTMPDestination.extractHostname(destination.rtmpUrl),
          ip: req.ip,
          userAgent: req.get('User-Agent'),
        })
      ]
    );
    
    logger.info(`RTMP destination deleted: ${destination.name} by ${req.user.username}`);
    
    res.json({ message: 'RTMP destination deleted successfully' });
  } catch (error) {
    logger.error('Delete RTMP destination error:', error);
    res.status(500).json({ error: 'Failed to delete RTMP destination' });
  }
}));

/**
 * POST /api/rtmp/destinations/:id/test
 * Test RTMP destination connection
 */
router.post('/destinations/:id/test', 
  rateLimitSensitive(5 * 60 * 1000, 5), // 5 tests per 5 minutes
  asyncHandler(async (req, res) => {
    const { RTMPDestination } = require('../../models/RTMPDestination');
    
    try {
      const destination = await RTMPDestination.findById(req.params.id);
      
      if (!destination) {
        return res.status(404).json({ error: 'RTMP destination not found' });
      }
      
      // Check ownership
      if (destination.userId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const result = await destination.testConnection();
      
      // Log the test
      const { getDatabase } = require('../../config/database');
      const db = getDatabase();
      await db.run(
        'INSERT INTO audit_log (user_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
        [
          req.user.id,
          'rtmp_destination_tested',
          'rtmp_destination',
          destination.id,
          JSON.stringify({
            name: destination.name,
            result: result.success,
            error: result.error,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
          })
        ]
      );
      
      logger.info(`RTMP destination tested: ${destination.name} by ${req.user.username} - ${result.success ? 'SUCCESS' : 'FAILED'}`);
      
      res.json({
        result,
        message: result.success ? 'Connection test successful' : 'Connection test failed',
      });
    } catch (error) {
      logger.error('Test RTMP destination error:', error);
      res.status(500).json({ error: 'Failed to test RTMP destination' });
    }
  })
);

/**
 * POST /api/rtmp/destinations/:id/toggle
 * Toggle RTMP destination active status
 */
router.post('/destinations/:id/toggle', asyncHandler(async (req, res) => {
  const { RTMPDestination } = require('../../models/RTMPDestination');
  
  try {
    const destination = await RTMPDestination.findById(req.params.id);
    
    if (!destination) {
      return res.status(404).json({ error: 'RTMP destination not found' });
    }
    
    // Check ownership
    if (destination.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const updatedDestination = await destination.update({ 
      isActive: !destination.isActive 
    });
    
    // Log the toggle
    const { getDatabase } = require('../../config/database');
    const db = getDatabase();
    await db.run(
      'INSERT INTO audit_log (user_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)',
      [
        req.user.id,
        'rtmp_destination_toggled',
        'rtmp_destination',
        destination.id,
        JSON.stringify({
          name: destination.name,
          newStatus: updatedDestination.isActive,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
        })
      ]
    );
    
    logger.info(`RTMP destination toggled: ${destination.name} by ${req.user.username} - ${updatedDestination.isActive ? 'ACTIVATED' : 'DEACTIVATED'}`);
    
    res.json({
      destination: updatedDestination.toSafeJSON(),
      message: `RTMP destination ${updatedDestination.isActive ? 'activated' : 'deactivated'}`,
    });
  } catch (error) {
    logger.error('Toggle RTMP destination error:', error);
    res.status(500).json({ error: 'Failed to toggle RTMP destination' });
  }
}));

/**
 * GET /api/rtmp/restreams
 * Get active restreams for user
 */
router.get('/restreams', asyncHandler(async (req, res) => {
  const { User } = require('../../models/User');
  const { RestreamService } = require('../../services/restream');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const streamKey = await user.getStreamKey();
    if (!streamKey) {
      return res.json({
        restreams: [],
        count: 0,
      });
    }
    
    const restreamService = new RestreamService();
    const restreams = restreamService.getActiveRestreams(streamKey);
    
    res.json({
      restreams,
      count: restreams.length,
    });
  } catch (error) {
    logger.error('Get restreams error:', error);
    res.status(500).json({ error: 'Failed to get restreams' });
  }
}));

/**
 * GET /api/rtmp/providers
 * Get popular RTMP providers
 */
router.get('/providers', asyncHandler(async (req, res) => {
  const { RTMPDestination } = require('../../models/RTMPDestination');
  
  try {
    const providers = await RTMPDestination.getPopularProviders();
    
    res.json({
      providers,
      predefined: [
        {
          name: 'Twitch',
          rtmpUrl: 'rtmp://live.twitch.tv/app',
          instructions: 'Get your stream key from Twitch Creator Dashboard',
        },
        {
          name: 'YouTube',
          rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
          instructions: 'Get your stream key from YouTube Studio',
        },
        {
          name: 'Facebook',
          rtmpUrl: 'rtmps://live-api-s.facebook.com:443/rtmp',
          instructions: 'Get your stream key from Facebook Live Producer',
        },
      ],
    });
  } catch (error) {
    logger.error('Get RTMP providers error:', error);
    res.status(500).json({ error: 'Failed to get RTMP providers' });
  }
}));

module.exports = router;
