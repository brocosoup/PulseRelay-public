const express = require('express');
const passport = require('passport');
const { asyncHandler } = require('../middleware/errors');
const { rateLimitSensitive } = require('../middleware/auth');
const { generateJWT } = require('../utils/crypto');
const { getDatabase } = require('../config/database');
const logger = require('../utils/logger');
const { getAuthFailureHandler } = require('../services/authFailureHandler');

const router = express.Router();

/**
 * GET /auth/twitch
 * Initiate Twitch OAuth authentication
 */
router.get('/twitch', (req, res, next) => {
  // Determine redirect destination from query parameter or session
  let redirectDestination = null;
  if (req.query.redirect) {
    const validRedirects = ['/dashboard', '/stream'];
    if (validRedirects.includes(req.query.redirect)) {
      redirectDestination = req.query.redirect;
    }
  } else if (req.session?.redirectTo) {
    redirectDestination = req.session.redirectTo;
  }
  
  // Build the Passport authenticate options
  const passportOptions = { 
    scope: [
      'user:read:email',
      'chat:edit',
      'chat:read',
      'moderator:manage:banned_users',
      'moderator:manage:chat_messages'
    ]
  };
  
  // If we have a redirect destination, pass it via state parameter
  if (redirectDestination) {
    passportOptions.state = Buffer.from(JSON.stringify({ redirect: redirectDestination })).toString('base64');
  }
  
  passport.authenticate('twitch', passportOptions)(req, res, next);
});

/**
 * GET /auth/twitch/callback
 * Twitch OAuth callback
 */
router.get('/twitch/callback', 
  passport.authenticate('twitch', { failureRedirect: '/access-denied' }),
  asyncHandler(async (req, res) => {
    try {
      // Generate JWT token for API access
      const token = generateJWT({
        id: req.user.id,
        username: req.user.username,
        twitchId: req.user.twitch_id,
        role: req.user.role || 'user',
      });

      // Set token in cookie for dashboard access
      const { getConfig } = require('../config/config');
      const config = getConfig();
      
      res.cookie('jwt_token', token, {
        httpOnly: true,
        secure: config.server.environment === 'production',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours,
      });

      // Check for redirect parameter from session, query, or state parameter
      let redirectTo = req.session?.redirectTo || req.query.redirect;
      
      // Check if redirect info was passed via state parameter
      if (req.query.state) {
        try {
          const stateData = JSON.parse(Buffer.from(req.query.state, 'base64').toString());
          if (stateData.redirect) {
            redirectTo = stateData.redirect;
          }
        } catch (error) {
          logger.warn('Failed to decode OAuth state parameter:', error.message);
        }
      }
      
      // Validate redirect path to prevent open redirects
      const validRedirects = ['/dashboard', '/stream'];
      const finalRedirect = validRedirects.includes(redirectTo) ? redirectTo : '/dashboard';
      
      // Clear redirect from session
      if (req.session?.redirectTo) {
        delete req.session.redirectTo;
      }

      // Clear any authentication failures for this user
      const authHandler = getAuthFailureHandler();
      const wasAuthFailed = authHandler.isUserAuthFailed(req.user.id);
      authHandler.clearUserAuthFailure(req.user.id);
      
      if (wasAuthFailed) {
        logger.info(`Cleared auth failure for user: ${req.user.username} (ID: ${req.user.id}) after successful reauthentication`);
      }
      
      // Verify auth failure was cleared
      const stillAuthFailed = authHandler.isUserAuthFailed(req.user.id);
      if (stillAuthFailed) {
        logger.error(`CRITICAL: Auth failure NOT cleared for user: ${req.user.username} (ID: ${req.user.id})`);
      }

      // Redirect to the appropriate page
      res.redirect(finalRedirect);
    } catch (error) {
      logger.error('Authentication callback error:', error);
      res.redirect('/access-denied');
    }
  })
);

/**
 * POST /auth/logout
 * Logout user
 */
router.post('/logout', rateLimitSensitive(), asyncHandler(async (req, res) => {
  try {
    // Log audit event before destroying session
    if (req.user) {
      const db = getDatabase();
      await db.run(
        'INSERT INTO audit_log (user_id, action, resource_type, details) VALUES (?, ?, ?, ?)',
        [
          req.user.id,
          'logout',
          'user',
          JSON.stringify({
            username: req.user.username,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
          })
        ]
      );
      
      // Clean up user's Twitch bot instance
      const { removeTwitchBot } = require('../services/twitchBot');
      removeTwitchBot(req.user.id);
    }

    // Clear JWT cookie first
    res.clearCookie('jwt_token');

    // Use Promise-based logout to avoid callback issues
    await new Promise((resolve, reject) => {
      // Check if session exists before attempting logout
      if (!req.session) {
        return resolve();
      }
      
      req.logout((logoutErr) => {
        if (logoutErr) {
          logger.error('Passport logout error:', logoutErr);
          return reject(logoutErr);
        }
        
        // Only destroy session if it exists and has destroy method
        if (req.session && typeof req.session.destroy === 'function') {
          req.session.destroy((destroyErr) => {
            if (destroyErr) {
              logger.error('Session destroy error:', destroyErr);
            }
            resolve();
          });
        } else {
          resolve();
        }
      });
    });

    // Send response after cleanup is complete
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      res.json({ message: 'Logged out successfully' });
    } else {
      res.redirect('/');
    }

  } catch (error) {
    logger.error('Logout error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Logout failed' });
    }
  }
}));

/**
 * GET /auth/status
 * Get authentication status
 */
router.get('/status', asyncHandler(async (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      authenticated: true,
      user: {
        id: req.user.id,
        username: req.user.username,
        displayName: req.user.display_name,
        profileImageUrl: req.user.profile_image_url,
      },
    });
  } else {
    res.json({
      authenticated: false,
      user: null,
    });
  }
}));

/**
 * POST /auth/token
 * Generate API token for authenticated user
 */
router.post('/token', rateLimitSensitive(), asyncHandler(async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const token = generateJWT({
      id: req.user.id,
      username: req.user.username,
      twitchId: req.user.twitch_id,
    });

    // Log token generation
    const db = getDatabase();
    await db.run(
      'INSERT INTO audit_log (user_id, action, resource_type, details) VALUES (?, ?, ?, ?)',
      [
        req.user.id,
        'token_generated',
        'auth',
        JSON.stringify({
          username: req.user.username,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
        })
      ]
    );

    res.json({
      token,
      expiresIn: '24h',
      tokenType: 'Bearer',
    });
  } catch (error) {
    logger.error('Token generation error:', error);
    res.status(500).json({ error: 'Token generation failed' });
  }
}));

/**
 * POST /auth/refresh
 * Refresh JWT token
 */
router.post('/refresh', rateLimitSensitive(), asyncHandler(async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const token = generateJWT({
      id: req.user.id,
      username: req.user.username,
      twitchId: req.user.twitch_id,
    });

    res.json({
      token,
      expiresIn: '24h',
      tokenType: 'Bearer',
    });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
}));

/**
 * GET /auth/user
 * Get current user information
 */
router.get('/user', asyncHandler(async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const db = getDatabase();
    
    // Get user with additional stats
    const streamKey = await db.get(
      'SELECT stream_key FROM stream_keys WHERE user_id = ? AND is_active = 1',
      [req.user.id]
    );
    
    const destinationsCount = await db.get(
      'SELECT COUNT(*) as count FROM rtmp_destinations WHERE user_id = ? AND is_active = 1',
      [req.user.id]
    );

    const lastSession = await db.get(
      `SELECT ss.* FROM stream_sessions ss 
       JOIN stream_keys sk ON ss.stream_key = sk.stream_key 
       WHERE sk.user_id = ? 
       ORDER BY ss.started_at DESC LIMIT 1`,
      [req.user.id]
    );

    res.json({
      id: req.user.id,
      username: req.user.username,
      displayName: req.user.display_name,
      profileImageUrl: req.user.profile_image_url,
      email: req.user.email,
      createdAt: req.user.created_at,
      hasStreamKey: !!streamKey,
      rtmpDestinations: destinationsCount.count,
      lastSession: lastSession?.started_at || null,
    });
  } catch (error) {
    logger.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user information' });
  }
}));

/**
 * DELETE /auth/account
 * Delete user account and all associated data
 */
router.delete('/account', rateLimitSensitive(15 * 60 * 1000, 1), asyncHandler(async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const db = getDatabase();
    const userId = req.user.id;
    const username = req.user.username || 'unknown';
    
    // Log account deletion
    await db.run(
      'INSERT INTO audit_log (user_id, action, resource_type, details) VALUES (?, ?, ?, ?)',
      [
        userId,
        'account_deleted',
        'user',
        JSON.stringify({
          username: username,
          ip: req.ip,
          userAgent: req.get('User-Agent')
        })
      ]
    );

    // Delete user (cascading will handle related data)
    await db.run('DELETE FROM users WHERE id = ?', [userId]);

    // Clean up user's Twitch bot instance
    const { removeTwitchBot } = require('../services/twitchBot');
    removeTwitchBot(userId);

    logger.info(`Account deleted: ${username} (ID: ${userId})`);

    // Destroy session and logout
    if (req.session) {
      req.session.destroy((err) => {
        if (err) {
          logger.error('Session destroy error during account deletion:', err);
        }
        // Clear cookies
        res.clearCookie('connect.sid');
        res.clearCookie('jwt_token');
        res.json({ message: 'Account deleted successfully' });
      });
    } else {
      res.clearCookie('connect.sid');
      res.clearCookie('jwt_token');
      res.json({ message: 'Account deleted successfully' });
    }
  } catch (error) {
    logger.error('Account deletion error:', error);
    res.status(500).json({ error: 'Account deletion failed' });
  }
}));

module.exports = router;
