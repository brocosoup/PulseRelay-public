const express = require('express');
const { requireAuthOrJWT } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errors');
const { validatePagination } = require('../middleware/validation');
const logger = require('../utils/logger');

const router = express.Router();

// Import API route modules
const streamRoutes = require('./api/stream');
const rtmpRoutes = require('./api/rtmp');
const statsRoutes = require('./api/stats');
const webhookRoutes = require('./api/webhooks');
const twitchRoutes = require('./api/twitch');
const locationRoutes = require('./api/location');
const tokenRoutes = require('./api/token');
const picturesRoutes = require('./api/pictures');
const overlayRoutes = require('./api/overlay');
const musicRoutes = require('./api/music');

// Mount overlay routes BEFORE auth middleware (they use their own auth)
router.use('/overlay', overlayRoutes);
router.use('/music', musicRoutes);

// Apply authentication middleware to all API routes
router.use(requireAuthOrJWT);

// Mount API route modules
router.use('/stream', streamRoutes);
router.use('/rtmp', rtmpRoutes);
router.use('/stats', statsRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/twitch', twitchRoutes);
router.use('/location', locationRoutes);
router.use('/token', tokenRoutes);
router.use('/pictures', picturesRoutes);

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/health', asyncHandler(async (req, res) => {
  try {
    const { getRTMPServerConfig } = require('../config/rtmp');
    const { TestPatternService } = require('../services/testPattern');
    const { RestreamService } = require('../services/restream');
    
    const rtmpConfig = getRTMPServerConfig();
    const testPatternService = new TestPatternService();
    const restreamService = new RestreamService();
    
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        rtmp: rtmpConfig ? rtmpConfig.getHealthStatus() : { status: 'not_initialized' },
        testPattern: testPatternService.getHealthStatus(),
        restream: restreamService.getHealthStatus(),
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: require('../../../package.json').version || '1.0.0',
    };
    
    res.json(health);
  } catch (error) {
    logger.error('Health check error:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}));

/**
 * GET /api/user/profile
 * Get current user profile
 */
router.get('/user/profile', asyncHandler(async (req, res) => {
  const { User } = require('../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const stats = await user.getStats();
    const streamKey = await user.getStreamKey();
    
    res.json({
      user: user.toJSON(),
      stats,
      hasStreamKey: !!streamKey,
    });
  } catch (error) {
    logger.error('Get user profile error:', error);
    res.status(500).json({ error: 'Failed to get user profile' });
  }
}));

/**
 * PUT /api/user/profile
 * Update user profile
 */
router.put('/user/profile', asyncHandler(async (req, res) => {
  const { User } = require('../models/User');
  const { validateUserProfile } = require('../middleware/validation');
  
  try {
    // Validate input
    validateUserProfile(req, res, async () => {
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const updatedUser = await user.update(req.body);
      res.json({ user: updatedUser.toJSON() });
    });
  } catch (error) {
    logger.error('Update user profile error:', error);
    res.status(500).json({ error: 'Failed to update user profile' });
  }
}));

/**
 * GET /api/user/tts-settings
 * Get user's TTS OpenAI settings
 */
router.get('/user/tts-settings', asyncHandler(async (req, res) => {
  const { User } = require('../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      ttsOpenaiEnabled: user.ttsOpenaiEnabled
    });
  } catch (error) {
    logger.error('Get TTS settings error:', error);
    res.status(500).json({ error: 'Failed to get TTS settings' });
  }
}));

/**
 * PUT /api/user/tts-settings
 * Update user's TTS OpenAI settings
 */
router.put('/user/tts-settings', asyncHandler(async (req, res) => {
  const { User } = require('../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { ttsOpenaiEnabled } = req.body;
    
    if (typeof ttsOpenaiEnabled !== 'boolean') {
      return res.status(400).json({ error: 'ttsOpenaiEnabled must be a boolean' });
    }
    
    const updatedUser = await user.update({ ttsOpenaiEnabled });
    
    logger.info(`User ${user.username} updated TTS OpenAI setting to ${ttsOpenaiEnabled}`);
    
    res.json({
      ttsOpenaiEnabled: updatedUser.ttsOpenaiEnabled,
      message: 'TTS settings updated successfully'
    });
  } catch (error) {
    logger.error('Update TTS settings error:', error);
    res.status(500).json({ error: 'Failed to update TTS settings' });
  }
}));

/**
 * PUT /api/user/obs-websocket-password
 * Update user's OBS WebSocket password
 */
router.put('/user/obs-websocket-password', asyncHandler(async (req, res) => {
  const { User } = require('../models/User');
  
  try {
    const { password } = req.body;
    
    await User.updateOBSWebSocketPassword(req.user.id, password || null);
    
    logger.info(`User ${req.user.username} updated OBS WebSocket password`);
    
    res.json({
      success: true,
      message: 'OBS WebSocket password updated successfully'
    });
  } catch (error) {
    logger.error('Update OBS WebSocket password error:', error);
    res.status(500).json({ error: 'Failed to update OBS WebSocket password' });
  }
}));

/**
 * GET /api/user/tts-ignored-users
 * Get user's TTS ignored users list
 */
router.get('/user/tts-ignored-users', asyncHandler(async (req, res) => {
  const { User } = require('../models/User');
  
  try {
    const ignoredUsers = await User.getTTSIgnoredUsers(req.user.id);
    
    res.json({
      ignoredUsers: ignoredUsers
    });
  } catch (error) {
    logger.error('Get TTS ignored users error:', error);
    res.status(500).json({ error: 'Failed to get TTS ignored users' });
  }
}));

/**
 * PUT /api/user/tts-ignored-users
 * Update user's TTS ignored users list
 */
router.put('/user/tts-ignored-users', asyncHandler(async (req, res) => {
  const { User } = require('../models/User');
  
  try {
    const { ignoredUsers } = req.body;
    
    if (!Array.isArray(ignoredUsers)) {
      return res.status(400).json({ error: 'ignoredUsers must be an array' });
    }
    
    // Validate all entries are strings
    if (!ignoredUsers.every(user => typeof user === 'string')) {
      return res.status(400).json({ error: 'All ignored users must be strings' });
    }
    
    await User.updateTTSIgnoredUsers(req.user.id, ignoredUsers);
    
    logger.info(`User ${req.user.username} updated TTS ignored users:`, ignoredUsers);
    
    res.json({
      ignoredUsers: ignoredUsers,
      message: 'TTS ignored users updated successfully'
    });
  } catch (error) {
    logger.error('Update TTS ignored users error:', error);
    res.status(500).json({ error: 'Failed to update TTS ignored users' });
  }
}));

/**
 * GET /api/user/channels
 * Get additional channels to join
 */
router.get('/user/channels', asyncHandler(async (req, res) => {
  const { User } = require('../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      success: true,
      username: user.username,
      channels: user.additionalChannels || []
    });
  } catch (error) {
    logger.error('Get channels error:', error);
    res.status(500).json({ error: 'Failed to get channels' });
  }
}));

/**
 * PUT /api/user/channels
 * Update additional channels to join
 */
router.put('/user/channels', asyncHandler(async (req, res) => {
  const { User } = require('../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { channels } = req.body;
    
    if (!Array.isArray(channels)) {
      return res.status(400).json({ error: 'channels must be an array' });
    }
    
    // Validate channel names (lowercase alphanumeric + underscore)
    const validChannels = channels.filter(ch => /^[a-z0-9_]+$/.test(ch.toLowerCase()));
    
    const updatedUser = await user.update({ additionalChannels: validChannels });
    
    logger.info(`User ${user.username} updated additional channels: ${validChannels.join(', ')}`);
    
    // Trigger bot refresh in background - don't block the response
    setImmediate(async () => {
      try {
        const { getTwitchBot } = require('../services/twitchBot');
        const { User } = require('../models/User');
        const bot = getTwitchBot(user.id);
        
        // Get fresh user object from database
        const freshUser = await User.findById(user.id);
        if (!freshUser) {
          logger.error('Failed to refresh bot: User not found');
          return;
        }
        
        // Force disconnect to ensure channel list is refreshed
        logger.info(`Disconnecting bot for channel refresh...`);
        await bot.disconnect();
        
        // Small delay to ensure clean disconnect
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Reinitialize with fresh user data
        logger.info(`Reinitializing bot with channels: ${freshUser.username}, ${freshUser.additionalChannels.join(', ')}`);
        await bot.initializeBot(freshUser.username, freshUser.twitchAccessToken, freshUser.id, freshUser);
        logger.info('Bot refreshed with new channel list');
      } catch (err) {
        logger.error('Failed to refresh bot with new channels:', err);
      }
    });
    
    res.json({
      channels: updatedUser.additionalChannels,
      message: 'Channels updated successfully'
    });
  } catch (error) {
    logger.error('Update channels error:', error);
    res.status(500).json({ error: 'Failed to update channels' });
  }
}));

/**
 * GET /api/user/aliases
 * Get username aliases for TTS
 */
router.get('/user/aliases', asyncHandler(async (req, res) => {
  const db = require('../config/database').getDatabase();
  
  try {
    const rows = await db.all(
      'SELECT twitch_username, alias FROM username_aliases WHERE user_id = ?',
      [req.user.id]
    );
    
    const aliases = {};
    rows.forEach(row => {
      aliases[row.twitch_username] = row.alias;
    });
    
    res.json({ aliases });
  } catch (error) {
    logger.error('Get aliases error:', error);
    res.status(500).json({ error: 'Failed to get aliases' });
  }
}));

/**
 * PUT /api/user/aliases/:username
 * Set or update alias for a username
 */
router.put('/user/aliases/:username', asyncHandler(async (req, res) => {
  const db = require('../config/database').getDatabase();
  const { username } = req.params;
  const { alias } = req.body;
  
  if (!username || !alias) {
    return res.status(400).json({ error: 'Username and alias required' });
  }
  
  try {
    await db.run(
      `INSERT INTO username_aliases (user_id, twitch_username, alias, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, twitch_username) 
       DO UPDATE SET alias = ?, updated_at = CURRENT_TIMESTAMP`,
      [req.user.id, username.toLowerCase(), alias, alias]
    );
    
    logger.info(`User ${req.user.id} set alias for ${username}: ${alias}`);
    
    res.json({ success: true, username, alias });
  } catch (error) {
    logger.error('Set alias error:', error);
    res.status(500).json({ error: 'Failed to set alias' });
  }
}));

/**
 * DELETE /api/user/aliases/:username
 * Remove alias for a username
 */
router.delete('/user/aliases/:username', asyncHandler(async (req, res) => {
  const db = require('../config/database').getDatabase();
  const { username } = req.params;
  
  try {
    await db.run(
      'DELETE FROM username_aliases WHERE user_id = ? AND twitch_username = ?',
      [req.user.id, username.toLowerCase()]
    );
    
    logger.info(`User ${req.user.id} removed alias for ${username}`);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete alias error:', error);
    res.status(500).json({ error: 'Failed to delete alias' });
  }
}));

/**
 * GET /api/user/sessions
 * Get user's stream sessions
 */
router.get('/user/sessions', validatePagination, asyncHandler(async (req, res) => {
  const { User } = require('../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const sessions = await user.getStreamSessions(req.query.limit || 10, req.query.offset || 0);
    
    res.json({
      sessions,
      total: sessions.length,
      limit: parseInt(req.query.limit) || 10,
      offset: parseInt(req.query.offset) || 0
    });
  } catch (error) {
    logger.error('Get user sessions error:', error);
    res.status(500).json({ error: 'Failed to get user sessions' });
  }
}));

/**
 * GET /api/user/audit
 * Get user's audit log
 */
router.get('/user/audit', validatePagination, asyncHandler(async (req, res) => {
  const { User } = require('../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const auditLog = await user.getAuditLog(req.query.limit);
    res.json({ auditLog });
  } catch (error) {
    logger.error('Get user audit log error:', error);
    res.status(500).json({ error: 'Failed to get user audit log' });
  }
}));

/**
 * GET /api/system/info
 * Get system information
 */
router.get('/system/info', asyncHandler(async (req, res) => {
  try {
    const { getDatabase } = require('../config/database');
    const db = getDatabase();
    
    // Get system stats
    const userCount = await db.get('SELECT COUNT(*) as count FROM users');
    const streamKeyCount = await db.get('SELECT COUNT(*) as count FROM stream_keys WHERE is_active = 1');
    const destinationCount = await db.get('SELECT COUNT(*) as count FROM rtmp_destinations WHERE is_active = 1');
    const sessionCount = await db.get('SELECT COUNT(*) as count FROM stream_sessions WHERE is_active = 1');
    
    const systemInfo = {
      users: userCount.count,
      activeStreamKeys: streamKeyCount.count,
      activeDestinations: destinationCount.count,
      activeSessions: sessionCount.count,
      rtmpPort: config.rtmp.port || 1935,
      httpPort: config.server.port || 3000,
      version: require('../../../package.json').version || '1.0.0',
      nodeVersion: process.version,
      uptime: process.uptime(),
    };
    
    res.json(systemInfo);
  } catch (error) {
    logger.error('Get system info error:', error);
    res.status(500).json({ error: 'Failed to get system information' });
  }
}));

/**
 * GET /api/search
 * Search across user's resources
 */
router.get('/search', asyncHandler(async (req, res) => {
  const { query } = req.query;
  
  if (!query || query.length < 2) {
    return res.status(400).json({ error: 'Search query must be at least 2 characters' });
  }
  
  try {
    const { getDatabase } = require('../config/database');
    const db = getDatabase();
    
    // Search RTMP destinations
    const destinations = await db.all(
      `SELECT * FROM rtmp_destinations 
       WHERE user_id = ? AND (name LIKE ? OR rtmp_url LIKE ?) 
       ORDER BY created_at DESC LIMIT 10`,
      [req.user.id, `%${query}%`, `%${query}%`]
    );
    
    // Search stream sessions
    const sessions = await db.all(
      `SELECT ss.* FROM stream_sessions ss 
       JOIN stream_keys sk ON ss.stream_key = sk.stream_key 
       WHERE sk.user_id = ? AND ss.session_id LIKE ?
       ORDER BY ss.started_at DESC LIMIT 10`,
      [req.user.id, `%${query}%`]
    );
    
    res.json({
      query,
      results: {
        destinations,
        sessions,
      },
    });
  } catch (error) {
    logger.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
}));

/**
 * POST /api/feedback
 * Submit user feedback
 */
router.post('/feedback', asyncHandler(async (req, res) => {
  const { type, message, rating } = req.body;
  
  if (!type || !message) {
    return res.status(400).json({ error: 'Type and message are required' });
  }
  
  try {
    const { getDatabase } = require('../config/database');
    const db = getDatabase();
    
    // Store feedback in audit log
    await db.run(
      'INSERT INTO audit_log (user_id, action, resource_type, details) VALUES (?, ?, ?, ?)',
      [
        req.user.id,
        'feedback_submitted',
        'system',
        JSON.stringify({
          type,
          message,
          rating,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
        })
      ]
    );
    
    logger.info(`Feedback submitted by ${req.user.username}:`, { type, message, rating });
    res.json({ message: 'Feedback submitted successfully' });
  } catch (error) {
    logger.error('Feedback submission error:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
}));

module.exports = router;
