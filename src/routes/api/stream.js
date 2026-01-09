const express = require('express');
const { asyncHandler } = require('../../middleware/errors');
const { validateStreamKeyRegenerate, validateStreamStatus } = require('../../middleware/validation');
const { rateLimitSensitive } = require('../../middleware/auth');
const { getRtmpServerUrl, getRtmpUrl, getHttpPlayerStreamUrl } = require('../../config/config');
const logger = require('../../utils/logger');

const router = express.Router();

/**
 * GET /api/stream/key
 * Get user's stream key (primary/most recent)
 */
router.get('/key', asyncHandler(async (req, res) => {
  const { User } = require('../../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const streamKey = await user.getOrCreateStreamKey();
    
    res.json({
      streamKey,
      rtmpUrl: getRtmpServerUrl(req), // Server URL without stream key
      playUrl: getRtmpUrl(req, streamKey), // Complete URL for internal use
    });
  } catch (error) {
    logger.error('Get stream key error:', error);
    res.status(500).json({ error: 'Failed to get stream key' });
  }
}));

/**
 * GET /api/stream/keys
 * Get all user's stream keys
 */
router.get('/keys', asyncHandler(async (req, res) => {
  const { User } = require('../../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const includeInactive = req.query.includeInactive === 'true';
    const streamKeys = await user.getStreamKeys(includeInactive);
    
    res.json({
      streamKeys: streamKeys.map(key => key.toSafeJSON()),
      rtmpUrl: getRtmpServerUrl(req),
    });
  } catch (error) {
    logger.error('Get stream keys error:', error);
    res.status(500).json({ error: 'Failed to get stream keys' });
  }
}));

/**
 * POST /api/stream/keys
 * Create a new stream key
 */
router.post('/keys', asyncHandler(async (req, res) => {
  const { User } = require('../../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { description, obsSourceName, connectMessage, disconnectMessage } = req.body;
    
    // Limit to 10 active stream keys per user
    const existingKeys = await user.getStreamKeys(false);
    if (existingKeys.length >= 10) {
      return res.status(400).json({ 
        error: 'Maximum number of stream keys reached (10). Please deactivate some keys first.' 
      });
    }
    
    const streamKey = await user.createStreamKey(description);
    
    // Update additional fields if provided
    if (obsSourceName || connectMessage || disconnectMessage) {
      await streamKey.update({ 
        obsSourceName: obsSourceName || null,
        connectMessage: connectMessage || null,
        disconnectMessage: disconnectMessage || null
      });
    }
    
    // Log the creation
    const { getDatabase } = require('../../config/database');
    const db = getDatabase();
    await db.run(
      'INSERT INTO audit_log (user_id, action, resource_type, details) VALUES (?, ?, ?, ?)',
      [
        req.user.id,
        'stream_key_created',
        'stream_key',
        JSON.stringify({
          username: req.user.username,
          description: description,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
        })
      ]
    );
    
    logger.info(`New stream key created for user: ${req.user.username}`);
    
    res.json({
      message: 'Stream key created successfully',
      streamKey,
      rtmpUrl: getRtmpServerUrl(req),
    });
  } catch (error) {
    logger.error('Create stream key error:', error);
    res.status(500).json({ error: 'Failed to create stream key' });
  }
}));

/**
 * PUT /api/stream/keys/:keyId
 * Update a stream key (description, active status)
 */
router.put('/keys/:keyId', asyncHandler(async (req, res) => {
  const { StreamKey } = require('../../models/StreamKey');
  const { User } = require('../../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const streamKey = await StreamKey.findById(req.params.keyId);
    if (!streamKey || streamKey.userId !== req.user.id) {
      return res.status(404).json({ error: 'Stream key not found' });
    }
    
    const { description, isActive, obsSourceName, connectMessage, disconnectMessage } = req.body;
    const updateData = {};
    
    if (description !== undefined) {
      updateData.description = description;
    }
    
    if (isActive !== undefined) {
      updateData.isActive = isActive;
    }
    
    if (obsSourceName !== undefined) {
      updateData.obsSourceName = obsSourceName;
    }
    
    if (connectMessage !== undefined) {
      updateData.connectMessage = connectMessage;
    }
    
    if (disconnectMessage !== undefined) {
      updateData.disconnectMessage = disconnectMessage;
    }
    
    await streamKey.update(updateData);
    
    res.json({
      message: 'Stream key updated successfully',
      streamKey: streamKey.toSafeJSON(),
    });
  } catch (error) {
    logger.error('Update stream key error:', error);
    res.status(500).json({ error: 'Failed to update stream key' });
  }
}));

/**
 * DELETE /api/stream/keys/:keyId
 * Delete a stream key
 */
router.delete('/keys/:keyId', asyncHandler(async (req, res) => {
  const { StreamKey } = require('../../models/StreamKey');
  const { User } = require('../../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const streamKey = await StreamKey.findById(req.params.keyId);
    if (!streamKey || streamKey.userId !== req.user.id) {
      return res.status(404).json({ error: 'Stream key not found' });
    }
    
    // Ensure user keeps at least one stream key
    const userKeys = await user.getStreamKeys(true); // Include inactive keys
    if (userKeys.length <= 1) {
      return res.status(400).json({ error: 'Cannot delete your last stream key' });
    }
    
    await streamKey.delete();
    
    // Log the deletion
    const { getDatabase } = require('../../config/database');
    const db = getDatabase();
    await db.run(
      'INSERT INTO audit_log (user_id, action, resource_type, details) VALUES (?, ?, ?, ?)',
      [
        req.user.id,
        'stream_key_deleted',
        'stream_key',
        JSON.stringify({
          username: req.user.username,
          streamKeyId: streamKey.id,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
        })
      ]
    );
    
    res.json({ message: 'Stream key deleted successfully' });
  } catch (error) {
    logger.error('Delete stream key error:', error);
    res.status(500).json({ error: 'Failed to delete stream key' });
  }
}));

/**
 * POST /api/stream/key/regenerate
 * Regenerate user's stream key
 */
router.post('/key/regenerate', 
  rateLimitSensitive(15 * 60 * 1000, 3), // 3 attempts per 15 minutes
  validateStreamKeyRegenerate,
  asyncHandler(async (req, res) => {
    const { User } = require('../../models/User');
    
    try {
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const streamKey = await user.generateStreamKey();
      
      // Log the regeneration
      const { getDatabase } = require('../../config/database');
      const db = getDatabase();
      await db.run(
        'INSERT INTO audit_log (user_id, action, resource_type, details) VALUES (?, ?, ?, ?)',
        [
          req.user.id,
          'stream_key_regenerated',
          'stream_key',
          JSON.stringify({
            username: req.user.username,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
          })
        ]
      );
      
      logger.info(`Stream key regenerated for user: ${req.user.username}`);
      
      res.json({
        streamKey,
        rtmpUrl: getRtmpServerUrl(req), // Server URL without stream key
        playUrl: getRtmpUrl(req, streamKey), // Complete URL for internal use
        message: 'Stream key regenerated successfully',
      });
    } catch (error) {
      logger.error('Regenerate stream key error:', error);
      res.status(500).json({ error: 'Failed to regenerate stream key' });
    }
  })
);

/**
 * GET /api/stream/status
 * Get stream status
 */
router.get('/status', validateStreamStatus, asyncHandler(async (req, res) => {
  const { User } = require('../../models/User');
  const { getRTMPServerConfig } = require('../../config/rtmp');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const streamKey = await user.getStreamKey();
    if (!streamKey) {
      return res.json({
        isLive: false,
        streamKey: null,
        message: 'No stream key found',
      });
    }
    
    logger.debug(`🔍 Stream status check for user ${req.user.id} with stream key ${streamKey?.substring(0,8)}...`);
    
    const rtmpConfig = getRTMPServerConfig();
    const session = rtmpConfig ? rtmpConfig.getSessionByStreamKey(streamKey) : null;
    
    // Check if there's actually an active publisher (more accurate than just checking session)
    const hasActivePublisher = rtmpConfig ? rtmpConfig.hasActivePublisher(streamKey) : false;
    
    logger.debug(`🔍 Session found: ${!!session}, hasActivePublisher: ${hasActivePublisher}`);
    if (session) {
      logger.debug(`🔍 Session details: id=${session.id}, isPublisher=${session.isPublisher}, ip=${session.ip}`);
    }
    
    // Get current session from database
    const { getDatabase } = require('../../config/database');
    const db = getDatabase();
    const currentSession = await db.get(
      'SELECT * FROM stream_sessions WHERE stream_key = ? AND is_active = 1',
      [streamKey]
    );
    
    logger.debug(`🔍 Database session found: ${!!currentSession}`);
    if (currentSession) {
      logger.debug(`🔍 DB session: ${currentSession.session_id}, is_publisher=${currentSession.is_publisher}`);
    }
    
    // Get test pattern status
    const { TestPatternService } = require('../../services/testPattern');
    const testPatternService = new TestPatternService();
    const isTestPatternRunning = testPatternService.isTestPatternRunning(streamKey);
    const testPatternError = testPatternService.getAndClearError(streamKey);
    
    // Get restream status
    const { RestreamService } = require('../../services/restream');
    const restreamService = new RestreamService();
    const activeRestreams = restreamService.getActiveRestreams(streamKey);
    
    res.json({
      isLive: hasActivePublisher,
      streamKey,
      session: session ? {
        id: session.id,
        startTime: session.connectTime,
        isPublisher: session.isPublisher,
        isPlayer: session.isPlayer,
        ip: session.ip,
      } : null,
      currentSession,
      testPattern: {
        isRunning: isTestPatternRunning,
        error: testPatternError
      },
      restreams: {
        active: activeRestreams.length,
        destinations: activeRestreams,
      },
      // Debug info
      debug: {
        hasActivePublisher,
        sessionFound: !!session,
        dbSessionFound: !!currentSession,
        streamKeyShort: streamKey?.substring(0,8) + '...'
      }
    });
  } catch (error) {
    logger.error('Get stream status error:', error);
    res.status(500).json({ error: 'Failed to get stream status' });
  }
}));

/**
 * GET /api/stream/sessions
 * Get stream sessions
 */
router.get('/sessions', asyncHandler(async (req, res) => {
  const { User } = require('../../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const sessions = await user.getStreamSessions(limit);
    
    res.json({ sessions });
  } catch (error) {
    logger.error('Get stream sessions error:', error);
    res.status(500).json({ error: 'Failed to get stream sessions' });
  }
}));

/**
 * GET /api/stream/live
 * Get active live streams for the current user only
 */
router.get('/live', asyncHandler(async (req, res) => {
  const { getDatabase } = require('../../config/database');
  const { getRTMPServerConfig } = require('../../config/rtmp');
  
  try {
    const db = getDatabase();
    const rtmpConfig = getRTMPServerConfig();
    
    // Get only the current user's active sessions from database
    const activeSessions = await db.all(`
      SELECT DISTINCT
        ss.id,
        ss.stream_key,
        ss.session_id,
        ss.started_at,
        u.username,
        u.display_name,
        u.profile_image_url
      FROM stream_sessions ss
      JOIN stream_keys sk ON ss.stream_key = sk.stream_key
      JOIN users u ON sk.user_id = u.id
      WHERE ss.is_active = 1 AND ss.is_publisher = 1 AND sk.user_id = ?
      ORDER BY ss.started_at DESC
    `, [req.user.id]);
    
    // Filter to only sessions that are actually live on RTMP server
    const liveStreams = [];
    
    for (const session of activeSessions) {
      const hasActivePublisher = rtmpConfig ? rtmpConfig.hasActivePublisher(session.stream_key) : false;
      if (hasActivePublisher) {
        const startTime = new Date(session.started_at);
        const duration = Math.floor((Date.now() - startTime.getTime()) / 1000);
        
        liveStreams.push({
          streamKey: session.stream_key,
          sessionId: session.session_id,
          username: session.username,
          displayName: session.display_name || session.username,
          profileImage: session.profile_image_url,
          startTime: session.started_at,
          duration: duration,
          playUrl: getHttpPlayerStreamUrl(req, session.stream_key)
        });
      }
    }
    
    res.json({
      success: true,
      streams: liveStreams,
      count: liveStreams.length
    });
  } catch (error) {
    logger.error('Get live streams error:', error);
    res.status(500).json({ error: 'Failed to get live streams' });
  }
}));

/**
 * GET /api/stream/settings
 * Get stream settings
 */
router.get('/settings', asyncHandler(async (req, res) => {
  const { User } = require('../../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const streamKey = await user.getStreamKey();
    if (!streamKey) {
      return res.status(404).json({ error: 'No stream key found' });
    }
    
    const { getDatabase } = require('../../config/database');
    const db = getDatabase();
    
    // Get test pattern settings
    const testPatternSettings = await db.get(
      'SELECT settings FROM test_pattern_settings WHERE stream_key = ?',
      [streamKey]
    );
    
    // Get last publisher settings (from stream_settings table where publisher settings are stored)
    const publisherSettings = await db.get(
      'SELECT settings FROM stream_settings WHERE stream_key = ? AND settings_type = ?',
      [streamKey, 'publisher']
    );
    
    res.json({
      streamKey,
      testPattern: testPatternSettings ? JSON.parse(testPatternSettings.settings) : null,
      publisherSettings: publisherSettings ? JSON.parse(publisherSettings.settings) : null,
    });
  } catch (error) {
    logger.error('Get stream settings error:', error);
    res.status(500).json({ error: 'Failed to get stream settings' });
  }
}));

/**
 * PUT /api/stream/settings
 * Update stream settings
 */
router.put('/settings', asyncHandler(async (req, res) => {
  const { User } = require('../../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const streamKey = await user.getStreamKey();
    if (!streamKey) {
      return res.status(404).json({ error: 'No stream key found' });
    }
    
    const { testPattern } = req.body;
    
    if (testPattern) {
      const { TestPatternService } = require('../../services/testPattern');
      const testPatternService = new TestPatternService();
      
      const updatedSettings = await testPatternService.updateTestPatternSettings(
        streamKey,
        testPattern
      );
      
      res.json({
        message: 'Stream settings updated successfully',
        testPattern: updatedSettings,
      });
    } else {
      res.json({ message: 'No settings to update' });
    }
  } catch (error) {
    logger.error('Update stream settings error:', error);
    res.status(500).json({ error: 'Failed to update stream settings' });
  }
}));

/**
 * POST /api/stream/test-pattern/start
 * Start test pattern manually
 */
router.post('/test-pattern/start', asyncHandler(async (req, res) => {
  const { User } = require('../../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const streamKey = await user.getStreamKey();
    if (!streamKey) {
      return res.status(404).json({ error: 'No stream key found' });
    }
    
    const { testPatternService } = require('../../services/testPattern');
    
    await testPatternService.startTestPattern(streamKey);
    
    res.json({ message: 'Test pattern started successfully' });
  } catch (error) {
    logger.error('Start test pattern error:', error);
    res.status(500).json({ error: 'Failed to start test pattern' });
  }
}));

/**
 * POST /api/stream/test-pattern/stop
 * Stop test pattern manually
 */
router.post('/test-pattern/stop', asyncHandler(async (req, res) => {
  const { User } = require('../../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const streamKey = await user.getStreamKey();
    if (!streamKey) {
      return res.status(404).json({ error: 'No stream key found' });
    }
    
    const { testPatternService } = require('../../services/testPattern');
    
    await testPatternService.stopTestPattern(streamKey);
    
    res.json({ message: 'Test pattern stopped successfully' });
  } catch (error) {
    logger.error('Stop test pattern error:', error);
    res.status(500).json({ error: 'Failed to stop test pattern' });
  }
}));

/**
 * GET /api/stream/test-pattern/status
 * Get test pattern status
 */
router.get('/test-pattern/status', asyncHandler(async (req, res) => {
  const { User } = require('../../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const streamKey = await user.getStreamKey();
    if (!streamKey) {
      return res.status(404).json({ error: 'No stream key found' });
    }
    
    const { testPatternService } = require('../../services/testPattern');
    
    const isRunning = testPatternService.isTestPatternRunning(streamKey);
    const settings = await testPatternService.getTestPatternSettings(streamKey);
    
    res.json({
      isRunning,
      settings,
    });
  } catch (error) {
    logger.error('Get test pattern status error:', error);
    res.status(500).json({ error: 'Failed to get test pattern status' });
  }
}));

/**
 * POST /api/stream/test-pattern/settings
 * Save test pattern settings
 */
router.post('/test-pattern/settings', asyncHandler(async (req, res) => {
  const { User } = require('../../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const streamKey = await user.getStreamKey();
    if (!streamKey) {
      return res.status(404).json({ error: 'No stream key found' });
    }
    
    const { TestPatternService } = require('../../services/testPattern');
    const testPatternService = new TestPatternService();
    
    // Validate and sanitize settings
    const {
      patternType = 'colorbars',
      width = 1280,
      height = 720,
      fps = 30,
      bitrate = 2000,
      audioBitrate = 128,
      text = 'PulseRelay Test Pattern',
      preserveSettings = true
    } = req.body;
    
    const settings = {
      patternType,
      width: parseInt(width),
      height: parseInt(height),
      fps: parseInt(fps),
      bitrate: parseInt(bitrate),
      audioBitrate: parseInt(audioBitrate),
      text: text.substring(0, 100), // Limit text length
      preserveSettings: Boolean(preserveSettings),
      codec: 'libx264',
      audioCodec: 'aac'
    };
    
    await testPatternService.saveTestPatternSettings(streamKey, settings);
    
    res.json({ 
      message: 'Test pattern settings saved successfully',
      settings 
    });
  } catch (error) {
    logger.error('Save test pattern settings error:', error);
    res.status(500).json({ error: 'Failed to save test pattern settings' });
  }
}));

/**
 * GET /api/stream/player-config
 * Get player URL configuration
 */
router.get('/player-config', asyncHandler(async (req, res) => {
  const { getHttpPlayerUrl } = require('../../config/config');
  
  try {
    res.json({
      success: true,
      playerBaseUrl: getHttpPlayerUrl(req)
    });
  } catch (error) {
    logger.error('Get player config error:', error);
    res.status(500).json({ error: 'Failed to get player configuration' });
  }
}));

module.exports = router;
