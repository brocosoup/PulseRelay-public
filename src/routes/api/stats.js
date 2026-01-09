const express = require('express');
const { asyncHandler } = require('../../middleware/errors');
const logger = require('../../utils/logger');
const { getRTMPServerConfig } = require('../../config/rtmp');

const router = express.Router();

/**
 * GET /api/stats/ping
 * Simple keepalive endpoint for maintaining session in background
 */
router.get('/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

/**
 * GET /api/stats/overview
 * Get user statistics overview
 */
router.get('/overview', asyncHandler(async (req, res) => {
  const { User } = require('../../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const stats = await user.getStats();
    const streamKey = await user.getStreamKey();
    const allStreamKeys = await user.getStreamKeys();
    
    // Get additional stats from database
    const { getDatabase } = require('../../config/database');
    const db = getDatabase();
    
    const totalStreamTime = await db.get(
      `SELECT SUM(
        CASE 
          WHEN ss.ended_at IS NOT NULL 
          THEN (julianday(ss.ended_at) - julianday(ss.started_at)) * 24 * 60 * 60 
          WHEN ss.is_active = 1 AND ss.ended_at IS NULL
          THEN (julianday('now') - julianday(ss.started_at)) * 24 * 60 * 60
          ELSE 0 
        END
      ) as total_seconds 
      FROM stream_sessions ss 
      JOIN stream_keys sk ON ss.stream_key = sk.stream_key 
      WHERE sk.user_id = ? AND ss.is_publisher = 1`,
      [req.user.id]
    );
    
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const monthlyStats = await db.get(
      `SELECT 
        COUNT(*) as sessions,
        SUM(
          CASE 
            WHEN ss.ended_at IS NOT NULL 
            THEN (julianday(ss.ended_at) - julianday(ss.started_at)) * 24 * 60 * 60 
            WHEN ss.is_active = 1 AND ss.ended_at IS NULL
            THEN (julianday('now') - julianday(ss.started_at)) * 24 * 60 * 60
            ELSE 0 
          END
        ) as total_seconds
      FROM stream_sessions ss 
      JOIN stream_keys sk ON ss.stream_key = sk.stream_key 
      WHERE sk.user_id = ? AND ss.started_at LIKE ? AND ss.is_publisher = 1`,
      [req.user.id, `${currentMonth}%`]
    );
    
    // Calculate active streams and total viewers for this user only
    const rtmpConfig = getRTMPServerConfig();
    let activeStreams = 0;
    let totalViewers = 0;
    
    if (rtmpConfig && allStreamKeys.length > 0) {
      // Check each stream key to count active publishers
      allStreamKeys.forEach(key => {
        const keyString = key.streamKey || key.stream_key;
        if (rtmpConfig.hasActivePublisher(keyString)) {
          activeStreams++;
        }
        // Add viewers for this stream key
        totalViewers += rtmpConfig.getViewerCount(keyString);
      });
    }
    
    res.json({
      success: true,
      overview: {
        ...stats,
        hasStreamKey: !!streamKey,
        totalStreamTime: totalStreamTime?.total_seconds || 0,
        activeStreams: activeStreams,
        totalViewers: totalViewers,
        monthlyStats: {
          sessions: monthlyStats?.sessions || 0,
          streamTime: monthlyStats?.total_seconds || 0,
        },
      },
    });
  } catch (error) {
    logger.error('Get stats overview error:', error);
    res.status(500).json({ error: 'Failed to get stats overview' });
  }
}));

/**
 * GET /api/stats/sessions
 * Get session statistics
 */
router.get('/sessions', asyncHandler(async (req, res) => {
  const { User } = require('../../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { getDatabase } = require('../../config/database');
    const db = getDatabase();
    
    // Get session statistics by day for the last 30 days
    const dailyStats = await db.all(
      `SELECT 
        DATE(ss.started_at) as date,
        COUNT(*) as sessions,
        SUM(
          CASE 
            WHEN ss.ended_at IS NOT NULL 
            THEN (julianday(ss.ended_at) - julianday(ss.started_at)) * 24 * 60 * 60 
            ELSE 0 
          END
        ) as total_seconds
      FROM stream_sessions ss 
      JOIN stream_keys sk ON ss.stream_key = sk.stream_key 
      WHERE sk.user_id = ? AND ss.started_at >= DATE('now', '-30 days')
      GROUP BY DATE(ss.started_at)
      ORDER BY date ASC`,
      [req.user.id]
    );
    
    // Get average session duration
    const avgDuration = await db.get(
      `SELECT AVG(
        CASE 
          WHEN ss.ended_at IS NOT NULL 
          THEN (julianday(ss.ended_at) - julianday(ss.started_at)) * 24 * 60 * 60 
          ELSE 0 
        END
      ) as avg_seconds
      FROM stream_sessions ss 
      JOIN stream_keys sk ON ss.stream_key = sk.stream_key 
      WHERE sk.user_id = ? AND ss.ended_at IS NOT NULL`,
      [req.user.id]
    );
    
    res.json({
      sessions: {
        dailyStats,
        averageDuration: avgDuration.avg_seconds || 0,
      },
    });
  } catch (error) {
    logger.error('Get session stats error:', error);
    res.status(500).json({ error: 'Failed to get session statistics' });
  }
}));

/**
 * GET /api/stats/restreams
 * Get restream statistics
 */
router.get('/restreams', asyncHandler(async (req, res) => {
  const { RTMPDestination } = require('../../models/RTMPDestination');
  
  try {
    const destinations = await RTMPDestination.findByUserId(req.user.id);
    
    // Get restream status
    const { RestreamService } = require('../../services/restream');
    const { User } = require('../../models/User');
    const restreamService = new RestreamService();
    const user = await User.findById(req.user.id);
    const streamKey = await user.getStreamKey();
    
    let activeRestreams = [];
    if (streamKey) {
      activeRestreams = restreamService.getActiveRestreams(streamKey);
    }
    
    // Group destinations by provider
    const providerStats = {};
    destinations.forEach(dest => {
      let provider = 'Other';
      if (dest.rtmpUrl.includes('twitch.tv')) provider = 'Twitch';
      else if (dest.rtmpUrl.includes('youtube.com')) provider = 'YouTube';
      else if (dest.rtmpUrl.includes('facebook.com')) provider = 'Facebook';
      else if (dest.rtmpUrl.includes('tiktok.com')) provider = 'TikTok';
      
      if (!providerStats[provider]) {
        providerStats[provider] = { total: 0, active: 0 };
      }
      providerStats[provider].total++;
      if (dest.isActive) providerStats[provider].active++;
    });
    
    res.json({
      restreams: {
        totalDestinations: destinations.length,
        activeDestinations: destinations.filter(d => d.isActive).length,
        activeRestreams: activeRestreams.length,
        providerStats,
        destinations: destinations.map(dest => ({
          id: dest.id,
          name: dest.name,
          provider: dest.rtmpUrl.includes('twitch.tv') ? 'Twitch' : 
                   dest.rtmpUrl.includes('youtube.com') ? 'YouTube' :
                   dest.rtmpUrl.includes('facebook.com') ? 'Facebook' : 'Other',
          isActive: dest.isActive,
          createdAt: dest.createdAt,
        })),
      },
    });
  } catch (error) {
    logger.error('Get restream stats error:', error);
    res.status(500).json({ error: 'Failed to get restream statistics' });
  }
}));

/**
 * GET /api/stats/sessions/recent
 * Get recent individual session records
 */
router.get('/sessions/recent', asyncHandler(async (req, res) => {
  const { User } = require('../../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const limit = parseInt(req.query.limit) || 5;
    const sessions = await user.getRecentStreamActivity(limit);
    
    // Debug logging
    logger.info('Recent activity query result:', {
      userId: user.id,
      eventsCount: sessions.length,
      events: sessions.map(s => ({
        id: s.id,
        event_type: s.event_type,
        stream_key: s.stream_key?.substring(0, 8) + '...',
        event_time: s.event_time,
        is_active: s.is_active
      }))
    });
    
    res.json({
      success: true,
      sessions: sessions // Keep the same field name for compatibility
    });
  } catch (error) {
    logger.error('Get recent sessions error:', error);
    res.status(500).json({ error: 'Failed to get recent sessions' });
  }
}));

/**
 * GET /api/stats/activity
 * Get recent activity events (simplified version)
 */
router.get('/activity', asyncHandler(async (req, res) => {
  const { User } = require('../../models/User');
  
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50); // Max 50 events
    const offset = parseInt(req.query.offset) || 0;
    
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get recent activity from sessions (simplified)
    const sessions = await user.getRecentStreamActivity(limit + offset);
    const events = sessions.slice(offset, offset + limit).map(session => ({
      id: session.id,
      type: session.is_active ? 'stream_start' : 'stream_end',
      timestamp: session.started_at || session.ended_at,
      description: session.is_active ? 'Stream started' : 'Stream ended',
      details: session.stream_settings ? JSON.parse(session.stream_settings) : {}
    }));
    
    res.json({
      success: true,
      events: events,
      hasMore: sessions.length > offset + limit,
      total: sessions.length
    });
    
  } catch (error) {
    logger.error('Get activity error:', error);
    res.status(500).json({ error: 'Failed to get activity' });
  }
}));

/**
 * DELETE /api/stats/activity
 * Clear recent activity events
 */
router.delete('/activity', asyncHandler(async (req, res) => {
  const { User } = require('../../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Clear user's activity/session history
    await user.clearStreamActivity();
    
    res.json({
      success: true,
      message: 'Activity cleared successfully'
    });
    
  } catch (error) {
    logger.error('Clear activity error:', error);
    res.status(500).json({ error: 'Failed to clear activity' });
  }
}));

/**
 * GET /api/stats/activity/detailed
 * Get detailed activity events including stream start/end, viewer join/leave
 */
router.get('/activity/detailed', asyncHandler(async (req, res) => {
  const { User } = require('../../models/User');
  
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50); // Max 50 events
    const offset = parseInt(req.query.offset) || 0;
    
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { getDatabase } = require('../../config/database');
    const db = getDatabase();
    
    // Get stream session events (start/end)
    const sessionEvents = await db.all(`
      SELECT 
        CASE 
          WHEN ss.is_publisher = 1 THEN 'stream_started'
          ELSE 'viewer_joined'
        END as event_type,
        ss.session_id,
        datetime(ss.started_at, 'utc') || 'Z' as timestamp,
        NULL as duration
      FROM stream_sessions ss
      JOIN stream_keys sk ON ss.stream_key = sk.stream_key
      WHERE sk.user_id = ?
      
      UNION ALL
      
      SELECT 
        CASE 
          WHEN ss.is_publisher = 1 THEN 'stream_ended'
          ELSE 'viewer_left'
        END as event_type,
        ss.session_id,
        datetime(ss.ended_at, 'utc') || 'Z' as timestamp,
        CASE 
          WHEN ss.is_publisher = 1 THEN CAST((julianday(ss.ended_at) - julianday(ss.started_at)) * 86400 AS INTEGER)
          ELSE NULL
          END as duration
      FROM stream_sessions ss
      JOIN stream_keys sk ON ss.stream_key = sk.stream_key
      WHERE sk.user_id = ? AND ss.ended_at IS NOT NULL
      
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
      `, [user.id, user.id, limit + 1, offset]);
      
      events = sessionEvents.slice(0, limit);
      hasMore = sessionEvents.length > limit;
    
    // Add human-readable messages to events
    events.forEach(event => {
      const time = new Date(event.timestamp).toLocaleTimeString();
      
      switch (event.event_type) {
        case 'broadcaster_started':
          event.message = `${time} - Broadcaster started streaming`;
          event.icon = '🟢';
          break;
        case 'broadcaster_stopped':
          const duration = event.duration ? ` (${Math.round(event.duration / 60)} min)` : '';
          event.message = `${time} - Broadcaster stopped streaming${duration}`;
          event.icon = '🔴';
          break;
        case 'stream_started':
          event.message = `${time} - Broadcaster started streaming`;
          event.icon = '🟢';
          break;
        case 'stream_ended':
          const endDuration = event.duration ? ` (${Math.round(event.duration / 60)} min)` : '';
          event.message = `${time} - Broadcaster stopped streaming${endDuration}`;
          event.icon = '🔴';
          break;
        case 'viewer_joined':
          event.message = `${time} - Viewer connected to stream`;
          event.icon = '👁️';
          break;
        case 'viewer_disconnected':
          event.message = `${time} - Viewer left stream`;
          event.icon = '👋';
          break;
        case 'rtmp_error':
          // Clean up the error message to make it user-friendly
          let errorMsg = event.error_message || 'Unknown error';
          if (errorMsg.includes('No active stream available for playback')) {
            errorMsg = 'Stream playback failed - no active stream';
          } else if (errorMsg.includes('Connection')) {
            errorMsg = 'Connection error occurred';
          } else if (errorMsg.includes('Authentication')) {
            errorMsg = 'Stream authentication failed';
          } else if (errorMsg.length > 50) {
            errorMsg = errorMsg.substring(0, 50) + '...';
          }
          event.message = `${time} - ${errorMsg}`;
          event.icon = '⚠️';
          break;
        default:
          event.message = `${time} - ${event.event_type}`;
          event.icon = '📊';
      }
    });

    logger.info('Detailed activity query result:', {
      userId: req.user?.id || 'mock',
      eventCount: events.length,
      hasMore,
      limit,
      offset
    });
    
    res.json({
      success: true,
      events,
      hasMore,
      totalCount: events.length
    });
  } catch (error) {
    logger.error('Get detailed activity error:', error);
    res.status(500).json({ error: 'Failed to get detailed activity' });
  }
}));

/**
 * DELETE /api/stats/activity/clear
 * Clear all activity records for the authenticated user
 */
router.delete('/activity/clear', asyncHandler(async (req, res) => {
  const { User } = require('../../models/User');
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { getDatabase } = require('../../config/database');
    const db = getDatabase();
    
    // Delete all stream sessions for this user
    const result = await db.run(`
      DELETE FROM stream_sessions 
      WHERE stream_key IN (
        SELECT stream_key FROM stream_keys WHERE user_id = ?
      )
    `, [user.id]);
    
    const deletedCount = result.changes || 0;
    
    logger.info('Activity cleared for user:', {
      userId: user.id,
      deletedCount: deletedCount
    });
    
    res.json({
      success: true,
      message: `Cleared ${deletedCount} activity records`,
      deletedCount: deletedCount
    });
  } catch (error) {
    logger.error('Clear activity error:', error);
    res.status(500).json({ error: 'Failed to clear activity' });
  }
}));

/**
 * GET /api/stats/connections
 * Get real-time connection monitoring status for current user only
 */
router.get('/connections', asyncHandler(async (req, res) => {
  try {
    const { User } = require('../../models/User');
    const rtmpConfig = getRTMPServerConfig();
    
    if (!rtmpConfig) {
      return res.status(503).json({ error: 'RTMP server not available' });
    }
    
    // Get user's stream keys
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userStreamKeys = await user.getStreamKeys();
    const userStreamKeySet = new Set(userStreamKeys.map(k => k.streamKey || k.stream_key));
    
    const healthStatus = rtmpConfig.getHealthStatus();
    const now = new Date();
    
    // Filter connections to only include user's streams
    const allConnections = healthStatus.sessionsDetails.map(session => ({
      id: session.id,
      streamKey: session.streamKey,
      type: session.isPublisher ? 'publisher' : 'viewer',
      isPublisher: session.isPublisher,
      isPlayer: session.isPlayer,
      ip: session.ip,
      connectTime: session.connectTime,
      lastActivity: session.lastActivity,
      timeSinceActivity: session.timeSinceActivity,
      dataPackets: session.dataPackets,
      bytesReceived: session.bytesReceived,
      connectionAge: now - new Date(session.connectTime),
      isStale: session.timeSinceActivity > 30000, // 30 seconds
      status: session.timeSinceActivity > 30000 ? 'stale' : 'active',
      // Add bitrate information
      currentBitrate: session.currentBitrate || 0,
      averageBitrate: session.averageBitrate || 0,
      peakBitrate: session.peakBitrate || 0,
      currentBitrateFormatted: session.currentBitrateFormatted || '0 bps',
      averageBitrateFormatted: session.averageBitrateFormatted || '0 bps',
      peakBitrateFormatted: session.peakBitrateFormatted || '0 bps',
      dataFlowRate: session.dataFlowRate || 0,
      isActivelyStreaming: session.isActivelyStreaming || false
    }));
    
    // Filter to only user's stream keys
    const connections = allConnections.filter(c => userStreamKeySet.has(c.streamKey));
    
    // Summary stats (only for user's streams)
    const summary = {
      totalConnections: connections.length,
      activePublishers: connections.filter(c => c.isPublisher && !c.isStale).length,
      activeViewers: connections.filter(c => c.isPlayer && !c.isStale).length,
      staleConnections: connections.filter(c => c.isStale).length,
      connectionMonitoring: healthStatus.connectionMonitoring
    };
    
    res.json({
      success: true,
      timestamp: now.toISOString(),
      summary,
      connections: connections.sort((a, b) => b.connectTime - a.connectTime) // Sort by newest first
    });
    
  } catch (error) {
    logger.error('Get connections error:', error);
    res.status(500).json({ error: 'Failed to get connection status' });
  }
}));

/**
 * POST /api/stats/connections/:id/disconnect
 * Force disconnect a specific connection
 */
router.post('/connections/:id/disconnect', asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const rtmpConfig = getRTMPServerConfig();
    
    if (!rtmpConfig) {
      return res.status(503).json({ error: 'RTMP server not available' });
    }
    
    const session = rtmpConfig.sessions.get(id);
    if (!session) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    
    // Force disconnect the session
    await rtmpConfig.handleStalePublisherDisconnect(id, session);
    
    res.json({
      success: true,
      message: `Connection ${id} disconnected successfully`
    });
    
  } catch (error) {
    logger.error('Force disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect connection' });
  }
}));

module.exports = router;
