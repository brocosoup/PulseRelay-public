const jwt = require('jsonwebtoken');
const { getDatabase } = require('../config/database');
const { get: getConfig } = require('../config/config');
const logger = require('../utils/logger');
const { getAuthFailureHandler } = require('../services/authFailureHandler');

// Development mode helpers removed for security

/**
 * Middleware to ensure user is authenticated via session
 */
function requireAuth(req, res, next) {
  // Check if no-auth dev mode is enabled
  if (getConfig('devMode.noAuth') === true) {
    // Inject mock user for development
    const mockUser = getConfig('devMode.mockUser') || {
      id: 1,
      username: 'devuser',
      display_name: 'Development User',
      twitch_id: 'dev123456',
      email: 'dev@pulserelay.local',
      profile_image_url: 'https://via.placeholder.com/150',
      role: 'user'
    };
    req.user = mockUser;
    return next();
  }

  if (req.isAuthenticated()) {
    // Check if user has authentication failures
    const authHandler = getAuthFailureHandler();
    if (authHandler.isUserAuthFailed(req.user.id)) {
      logger.warn(`Auth failure detected for user: ${req.user.username} (ID: ${req.user.id}) - forcing logout`);
      
      // Force logout
      req.logout((err) => {
        if (err) {
          logger.error('Error during forced logout:', err);
        }
        
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(401).json({
            error: 'Authentication expired',
            code: 'TOKEN_EXPIRED'
          });
        }
        
        res.redirect('/auth/twitch');
      });
      return;
    }
    
    logger.debug(`User ${req.user.username} (ID: ${req.user.id}) passed auth check`);
    return next();
  }
  
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({
      error: 'Authentication required',
      code: 'UNAUTHORIZED'
    });
  }
  
  // Store the current page in session to redirect back after authentication
  const currentPath = req.originalUrl || req.path;
  const validRedirects = ['/dashboard', '/mobile', '/stream'];
  
  // Only store valid redirect paths to prevent open redirects
  if (validRedirects.includes(currentPath)) {
    req.session.redirectTo = currentPath;
  }
  
  res.redirect('/auth/twitch');
}

/**
 * Middleware to ensure user is authenticated via JWT token
 */
function requireJWT(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '') || 
                req.query.token || 
                req.body.token;

  if (!token) {
    return res.status(401).json({
      error: 'Access token required',
      code: 'TOKEN_REQUIRED'
    });
  }

  try {
    const { getSecrets } = require('../config/config');
    const secrets = getSecrets();
    const decoded = jwt.verify(token, secrets.jwtSecret);
    req.user = decoded;
    next();
  } catch (error) {
    logger.warn('Invalid JWT token:', error.message);
    return res.status(401).json({
      error: 'Invalid or expired token',
      code: 'TOKEN_INVALID'
    });
  }
}

/**
 * Middleware to ensure user is authenticated via either session or JWT
 */
function requireAuthOrJWT(req, res, next) {
  // Check if no-auth dev mode is enabled
  if (getConfig('devMode.noAuth') === true) {
    // Inject mock user for development
    const mockUser = getConfig('devMode.mockUser') || {
      id: 1,
      username: 'devuser',
      display_name: 'Development User',
      twitch_id: 'dev123456',
      email: 'dev@pulserelay.local',
      profile_image_url: 'https://via.placeholder.com/150',
      role: 'user'
    };
    req.user = mockUser;
    return next();
  }

  if (req.isAuthenticated()) {
    return next();
  }
  
  return requireJWT(req, res, next);
}

/**
 * Middleware to optionally authenticate user
 */
function optionalAuth(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  
  const token = req.header('Authorization')?.replace('Bearer ', '') || 
                req.query.token || 
                req.body.token;

  if (token) {
    try {
      const { getSecrets } = require('../config/config');
      const secrets = getSecrets();
      const decoded = jwt.verify(token, secrets.jwtSecret);
      req.user = decoded;
    } catch (error) {
      // Token is invalid, but we don't reject the request
      logger.warn('Invalid JWT token in optional auth:', error.message);
    }
  }
  
  next();
}

/**
 * Middleware to ensure user owns the resource
 */
function requireOwnership(resourceKey = 'id') {
  return async (req, res, next) => {
    try {
      const db = getDatabase();
      const resourceId = req.params[resourceKey];
      const userId = req.user.id;

      // Check if user owns the resource
      const resource = await db.get(
        'SELECT user_id FROM stream_keys WHERE id = ? OR stream_key = ?',
        [resourceId, resourceId]
      );

      if (!resource || resource.user_id !== userId) {
        return res.status(403).json({
          error: 'Access denied',
          code: 'FORBIDDEN'
        });
      }

      next();
    } catch (error) {
      logger.error('Ownership check error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  };
}

/**
 * Middleware to ensure user has admin privileges
 */
function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  
  return res.status(403).json({
    error: 'Admin access required',
    code: 'ADMIN_REQUIRED'
  });
}

/**
 * Middleware to log authentication attempts
 */
function logAuth(req, res, next) {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logData = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id || null,
      username: req.user?.username || null,
    };
    
    if (res.statusCode === 401 || res.statusCode === 403) {
      logger.warn('Authentication failed', logData);
    } else if (req.user) {
      logger.info('Authenticated request', logData);
    }
  });
  
  next();
}

/**
 * Middleware to validate API key
 */
function requireApiKey(req, res, next) {
  const apiKey = req.header('X-API-Key') || req.query.apikey;
  
  if (!apiKey) {
    return res.status(401).json({
      error: 'API key required',
      code: 'API_KEY_REQUIRED'
    });
  }
  
  // Validate API key format
  if (!/^[a-f0-9]{128}$/.test(apiKey)) {
    return res.status(401).json({
      error: 'Invalid API key format',
      code: 'API_KEY_INVALID'
    });
  }
  
  // TODO: Implement API key validation against database
  // For now, just check if it's the admin key
  if (apiKey === process.env.ADMIN_API_KEY) {
    req.user = { role: 'admin', apiKey: true };
    return next();
  }
  
  return res.status(401).json({
    error: 'Invalid API key',
    code: 'API_KEY_INVALID'
  });
}

/**
 * Middleware to ensure RTMP stream key is valid
 */
function requireValidStreamKey(req, res, next) {
  const streamKey = req.params.streamKey || req.body.streamKey || req.query.streamKey;
  
  if (!streamKey) {
    return res.status(400).json({
      error: 'Stream key required',
      code: 'STREAM_KEY_REQUIRED'
    });
  }
  
  // Validate stream key format
  if (!/^[A-Za-z0-9]{32}$/.test(streamKey)) {
    return res.status(400).json({
      error: 'Invalid stream key format',
      code: 'STREAM_KEY_INVALID'
    });
  }
  
  req.streamKey = streamKey;
  next();
}

/**
 * Middleware to rate limit sensitive operations
 */
function rateLimitSensitive(windowMs = 15 * 60 * 1000, max = 5) {
  const attempts = new Map();
  
  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    if (!attempts.has(key)) {
      attempts.set(key, []);
    }
    
    const userAttempts = attempts.get(key);
    
    // Remove old attempts
    const validAttempts = userAttempts.filter(time => now - time < windowMs);
    
    if (validAttempts.length >= max) {
      return res.status(429).json({
        error: 'Too many requests',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }
    
    validAttempts.push(now);
    attempts.set(key, validAttempts);
    
    next();
  };
}

/**
 * Middleware to handle session errors gracefully
 */
function sessionErrorHandler(req, res, next) {
  // Add error handling to session methods to prevent uncaught exceptions
  if (req.session) {
    const originalDestroy = req.session.destroy;
    const originalRegenerate = req.session.regenerate;
    
    // Wrap destroy method with error handling
    req.session.destroy = function(callback) {
      try {
        if (typeof originalDestroy === 'function') {
          originalDestroy.call(this, (err) => {
            if (callback && typeof callback === 'function') {
              callback(err);
            }
          });
        } else if (callback && typeof callback === 'function') {
          callback(null);
        }
      } catch (error) {
        logger.error('Session destroy error:', error);
        if (callback && typeof callback === 'function') {
          callback(error);
        }
      }
    };
    
    // Wrap regenerate method with error handling
    req.session.regenerate = function(callback) {
      try {
        if (typeof originalRegenerate === 'function') {
          originalRegenerate.call(this, (err) => {
            if (callback && typeof callback === 'function') {
              callback(err);
            }
          });
        } else if (callback && typeof callback === 'function') {
          callback(null);
        }
      } catch (error) {
        logger.error('Session regenerate error:', error);
        if (callback && typeof callback === 'function') {
          callback(error);
        }
      }
    };
  }
  
  next();
}

/**
 * Middleware to authenticate overlay requests via token in URL
 * Overlays use long-lived tokens passed as query parameter
 */
async function requireOverlayAuth(req, res, next) {
  // Check if no-auth dev mode is enabled
  if (getConfig('devMode.noAuth') === true) {
    const mockUser = getConfig('devMode.mockUser') || {
      id: 1,
      username: 'devuser',
      display_name: 'Development User',
      twitch_id: 'dev123456',
      email: 'dev@pulserelay.local',
      profile_image_url: 'https://via.placeholder.com/150',
      role: 'user'
    };
    req.user = mockUser;
    return next();
  }

  // Check for overlay token in query params
  const overlayToken = req.query.token;
  
  if (!overlayToken) {
    // Check if user is authenticated via session
    if (req.isAuthenticated()) {
      // Redirect to dashboard with message to generate token
      return res.status(401).render('error', {
        title: 'Overlay Token Required',
        message: 'Please generate an overlay token from your dashboard first. Go to Dashboard → API Tokens → Generate Overlay Token.',
        statusCode: 401,
        user: req.user,
        showBackButton: true,
        backUrl: '/dashboard'
      });
    }
    
    return res.status(401).render('error', {
      title: 'Authentication Required',
      message: 'Overlay token required. Please generate a token from your dashboard.',
      statusCode: 401
    });
  }

  try {
    const db = getDatabase();
    
    // Look up token in database
    const tokenRecord = await db.get(
      `SELECT ot.*, u.id as user_id, u.username, u.display_name, u.twitch_id, u.email, u.role 
       FROM overlay_tokens ot
       JOIN users u ON ot.user_id = u.id
       WHERE ot.token = ?`,
      [overlayToken]
    );

    if (!tokenRecord) {
      return res.status(401).render('error', {
        title: 'Invalid Token',
        message: 'Invalid or revoked overlay token. Please generate a new token from your dashboard.',
        statusCode: 401
      });
    }

    // Update last used timestamp
    await db.run(
      'UPDATE overlay_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE token = ?',
      [overlayToken]
    );

    // Set user object from token
    req.user = {
      id: tokenRecord.user_id,
      username: tokenRecord.username,
      display_name: tokenRecord.display_name,
      twitch_id: tokenRecord.twitch_id,
      email: tokenRecord.email,
      role: tokenRecord.role
    };

    logger.debug(`Overlay auth successful for user ${req.user.username}`);
    next();
  } catch (error) {
    logger.error('Overlay auth error:', error);
    return res.status(500).render('error', {
      title: 'Authentication Error',
      message: 'Failed to authenticate overlay token.',
      statusCode: 500
    });
  }
}

module.exports = {
  requireAuth,
  requireJWT,
  requireAuthOrJWT,
  requireOverlayAuth,
  optionalAuth,
  requireOwnership,
  requireAdmin,
  logAuth,
  requireApiKey,
  requireValidStreamKey,
  rateLimitSensitive,
  sessionErrorHandler,
};
