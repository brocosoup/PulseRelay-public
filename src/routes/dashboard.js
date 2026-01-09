const express = require('express');
const { requireAuth, requireOverlayAuth, optionalAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errors');
const { getRtmpServerUrl, getRtmpUrl, getHttpPlayerStreamUrl } = require('../config/config');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /
 * Home page
 */
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  // If authenticated, redirect to dashboard
  if (req.isAuthenticated()) {
    return res.redirect('/dashboard');
  }
  
  const error = req.query.error;
  let errorMessage = null;
  
  if (error === 'auth_failed') {
    errorMessage = 'Authentication failed. Please try again.';
  } else if (error === 'callback_error') {
    errorMessage = 'Authentication callback error. Please try again.';
  }
  
  res.render('index', {
    title: 'PulseRelay - RTMP Live Streaming Service',
    user: null,
    error: errorMessage,
    scripts: ['/js/index.js']
  });
}));

/**
 * GET /dashboard
 * User dashboard
 */
router.get('/dashboard', requireAuth, asyncHandler(async (req, res) => {
  const { User } = require('../models/User');
  const { RTMPDestination } = require('../models/RTMPDestination');
  
  try {
    // Get authenticated user
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.redirect('/');
    }
    
    // Get user data
    const streamKey = await user.getOrCreateStreamKey();
    const streamKeys = await user.getStreamKeys(true); // Include inactive keys
    const destinations = await RTMPDestination.findByUserId(req.user.id);
    const recentSessions = await user.getStreamSessions(5);
    
    // Get stream status
    const { getRTMPServerConfig } = require('../config/rtmp');
    const rtmpConfig = getRTMPServerConfig();
    const session = rtmpConfig ? rtmpConfig.getSessionByStreamKey(streamKey) : null;
    
    // Check if there's actually an active publisher (not just any session)
    const hasActivePublisher = rtmpConfig ? rtmpConfig.hasActivePublisher(streamKey) : false;
    
    // Get test pattern status
    const { TestPatternService } = require('../services/testPattern');
    const testPatternService = new TestPatternService();
    const isTestPatternRunning = testPatternService.isTestPatternRunning(streamKey);
    
    // Get user stats
    const userStats = await user.getStats();
    
    // Build HTTP server URL for overlays
    const hostname = req.get('host') || 'localhost:3000';
    const protocol = req.protocol || 'http';
    const serverUrl = `${protocol}://${hostname}`;
    
    // Check if APK exists
    const path = require('path');
    const fs = require('fs');
    const apkPath = path.join(__dirname, '../../dist/app-release.apk');
    const apkExists = fs.existsSync(apkPath);
    
    res.render('dashboard', {
      title: 'Dashboard - PulseRelay',
      user,
      streamKey,
      streamKeys: streamKeys.map(key => {
        const safeData = key.toSafeJSON ? key.toSafeJSON() : key;
        // Add the full stream key for functionality (copy, video player)
        safeData.fullStreamKey = key.streamKey || key.stream_key;
        return safeData;
      }),
      rtmpUrl: getRtmpServerUrl(req), // Server URL without stream key
      serverUrl, // HTTP server URL for overlays
      isLive: hasActivePublisher, // Use the more accurate publisher check
      isTestPatternRunning,
      destinations,
      recentSessions,
      stats: userStats,
      apkExists,
      scripts: ['/js/dashboard.js']
    });
  } catch (error) {
    logger.error('Dashboard error:', error);
    res.render('error', {
      title: 'Error - PulseRelay',
      error: 'Failed to load dashboard',
      scripts: ['/js/error.js']
    });
  }
}));

/**
 * GET /stream
 * Stream management page
 */
router.get('/stream', requireAuth, asyncHandler(async (req, res) => {
  const { User } = require('../models/User');
  
  try {
    // Get authenticated user
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.redirect('/');
    }
    
    const streamKey = await user.getOrCreateStreamKey();
    const sessions = await user.getStreamSessions(10);
    
    // Get stream status
    const { getRTMPServerConfig } = require('../config/rtmp');
    const rtmpConfig = getRTMPServerConfig();
    const session = rtmpConfig ? rtmpConfig.getSessionByStreamKey(streamKey) : null;
    
    // Get test pattern settings
    const { TestPatternService } = require('../services/testPattern');
    const testPatternService = new TestPatternService();
    const testPatternSettings = await testPatternService.getTestPatternSettings(streamKey);
    const isTestPatternRunning = testPatternService.isTestPatternRunning(streamKey);
    
    res.render('stream', {
      title: 'Stream Management - PulseRelay',
      user,
      streamKey,
      rtmpUrl: getRtmpServerUrl(req), // Server URL without stream key
      playUrl: getRtmpUrl(req, streamKey), // Complete URL for internal use
      isLive: !!session?.isPublisher,
      session,
      sessions,
      testPatternSettings,
      isTestPatternRunning,
      scripts: ['/js/stream.js']
    });
  } catch (error) {
    logger.error('Stream page error:', error);
    res.render('error', {
      title: 'Error - PulseRelay',
      error: 'Failed to load stream management page',
      scripts: ['/js/error.js']
    });
  }
}));

/**
 * GET /destinations
 * RTMP destinations management page
 */
router.get('/destinations', requireAuth, asyncHandler(async (req, res) => {
  const { User } = require('../models/User');
  const { RTMPDestination } = require('../models/RTMPDestination');
  
  try {
    // Get authenticated user
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.redirect('/');
    }
    
    const destinations = await RTMPDestination.findByUserId(req.user.id, true);
    const streamKey = await user.getStreamKey();
    
    // Get restream status
    const { RestreamService } = require('../services/restream');
    const restreamService = new RestreamService();
    let activeRestreams = [];
    
    if (streamKey) {
      activeRestreams = restreamService.getActiveRestreams(streamKey);
    }
    
    res.render('destinations', {
      title: 'RTMP Destinations - PulseRelay',
      user,
      destinations,
      activeRestreams,
      hasStreamKey: !!streamKey,
    });
  } catch (error) {
    logger.error('Destinations page error:', error);
    res.render('error', {
      title: 'Error - PulseRelay',
      error: 'Failed to load destinations page',
      scripts: ['/js/error.js']
    });
  }
}));

/**
 * GET /stats
 * Statistics page
 */
router.get('/stats', requireAuth, asyncHandler(async (req, res) => {
  const { User } = require('../models/User');
  const { RTMPDestination } = require('../models/RTMPDestination');
  
  try {
    // Get authenticated user
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.redirect('/');
    }
    
    const userStats = await user.getStats();
    const destinations = await RTMPDestination.findByUserId(req.user.id);
    const sessions = await user.getStreamSessions(20);
    
    // Get detailed statistics from database
    const { getDatabase } = require('../config/database');
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
      WHERE sk.user_id = ?`,
      [req.user.id]
    );
    
    res.render('stats', {
      title: 'Statistics - PulseRelay',
      user,
      stats: {
        ...userStats,
        totalStreamTime: totalStreamTime.total_seconds || 0,
      },
      destinations,
      sessions,
    });
  } catch (error) {
    logger.error('Stats page error:', error);
    res.render('error', {
      title: 'Error - PulseRelay',
      error: 'Failed to load statistics page',
      scripts: ['/js/error.js']
    });
  }
}));

/**
 * GET /help
 * Help page
 */
router.get('/help', optionalAuth, asyncHandler(async (req, res) => {
  res.render('help', {
    title: 'Help - PulseRelay',
    user: req.user || null,
  });
}));

/**
 * GET /about
 * About page
 */
router.get('/about', optionalAuth, asyncHandler(async (req, res) => {
  res.render('about', {
    title: 'About - PulseRelay',
    user: req.user || null,
  });
}));

/**
 * GET /map-overlay
 * Map overlay for OBS browser source (requires overlay token in URL)
 */
router.get('/map-overlay', requireOverlayAuth, asyncHandler(async (req, res) => {
  try {
    res.render('map-overlay', {
      title: 'Location Map Overlay - PulseRelay',
      user: req.user,
      layout: false
    });
  } catch (error) {
    logger.error('Error loading map overlay:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load map overlay'
    });
  }
}));

/**
 * GET /telemetry-overlay
 * Telemetry overlay for OBS browser source (requires overlay token in URL)
 */
router.get('/telemetry-overlay', requireOverlayAuth, asyncHandler(async (req, res) => {
  try {
    res.render('telemetry-overlay', {
      title: 'Telemetry Overlay - PulseRelay',
      user: req.user,
      layout: false
    });
  } catch (error) {
    logger.error('Error loading telemetry overlay:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load telemetry overlay'
    });
  }
}));

/**
 * GET /picture-overlay
 * Picture overlay for OBS browser source (requires overlay token in URL)
 */
router.get('/picture-overlay', requireOverlayAuth, asyncHandler(async (req, res) => {
  try {
    res.render('picture-overlay', {
      title: 'Picture Overlay - PulseRelay',
      user: req.user,
      layout: false
    });
  } catch (error) {
    logger.error('Error loading picture overlay:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load picture overlay'
    });
  }
}));

/**
 * GET /music-overlay
 * Music player overlay for OBS browser source (requires overlay token in URL)
 */
router.get('/music-overlay', requireOverlayAuth, asyncHandler(async (req, res) => {
  try {
    res.render('music-overlay', {
      title: 'Music Player Overlay - PulseRelay',
      user: req.user,
      token: req.query.token,
      layout: false
    });
  } catch (error) {
    logger.error('Error loading music overlay:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load music overlay'
    });
  }
}));

/**
 * GET /now-playing-overlay
 * Now playing overlay for OBS browser source (requires overlay token in URL)
 */
router.get('/now-playing-overlay', requireOverlayAuth, asyncHandler(async (req, res) => {
  try {
    res.render('now-playing-overlay', {
      title: 'Now Playing Overlay - PulseRelay',
      user: req.user,
      token: req.query.token,
      layout: false
    });
  } catch (error) {
    logger.error('Error loading now playing overlay:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load now playing overlay'
    });
  }
}));

/**
 * GET /stream-status-overlay
 * Stream status overlay for OBS browser source (requires overlay token in URL)
 */
router.get('/stream-status-overlay', requireOverlayAuth, asyncHandler(async (req, res) => {
  try {
    res.render('stream-status-overlay', {
      title: 'Stream Status Overlay - PulseRelay',
      user: req.user,
      layout: false
    });
  } catch (error) {
    logger.error('Error loading stream status overlay:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load stream status overlay'
    });
  }
}));

/**
 * GET /stream/overlay
 * Redirect for legacy compatibility
 */
router.get('/stream/overlay', (req, res) => {
  res.redirect('/map-overlay');
});

/**
 * GET /download/app
 * Download Android APK
 */
router.get('/download/app', requireAuth, asyncHandler(async (req, res) => {
  const path = require('path');
  const fs = require('fs');
  
  const apkPath = path.join(__dirname, '../../dist/app-release.apk');
  
  // Check if APK exists
  if (!fs.existsSync(apkPath)) {
    logger.warn(`User ${req.user.username} attempted to download APK but file not found`);
    return res.redirect('/dashboard');
  }
  
  // Get file stats for size
  const stats = fs.statSync(apkPath);
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  
  logger.info(`User ${req.user.username} downloading APK (${fileSizeMB} MB)`);
  
  // Send file with proper filename
  res.download(apkPath, 'PulseRelay.apk', (err) => {
    if (err) {
      logger.error('APK download error:', err);
    }
  });
}));

module.exports = router;
