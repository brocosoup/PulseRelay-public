const passport = require('passport');
const OAuth2Strategy = require('passport-oauth2');
const axios = require('axios');
const { getDatabase } = require('./database');
const { get: getConfig, getSecret } = require('./config');
const logger = require('../utils/logger');
const whitelist = require('../utils/whitelist');

function initAuth() {
  // Check if no-auth dev mode is enabled
  if (process.env.NO_AUTH_DEV_MODE === 'true' || getConfig('devMode.noAuth') === true) {
    logger.warn('NO-AUTH development mode enabled - skipping Twitch OAuth setup');
    
    // Set up minimal passport serialization for dev mode
    passport.serializeUser((user, done) => {
      done(null, user.id);
    });

    passport.deserializeUser((id, done) => {
      // Return mock user for development
      const mockUser = getConfig('devMode.mockUser') || {
        id: 1,
        username: 'devuser',
        display_name: 'Development User',
        twitch_id: 'dev123456',
        email: 'dev@pulserelay.local',
        profile_image_url: 'https://via.placeholder.com/150',
        role: 'user'
      };
      done(null, mockUser);
    });
    
    return;
  }

  // Check if Twitch OAuth is configured
  const clientId = getSecret('twitch.clientId') || process.env.TWITCH_CLIENT_ID;
  const clientSecret = getSecret('twitch.clientSecret') || process.env.TWITCH_CLIENT_SECRET;
  const callbackURL = getSecret('twitch.redirectUri') || process.env.TWITCH_CALLBACK_URL;

  logger.debug('Twitch OAuth configuration loaded:', {
    clientId: clientId ? 'configured' : 'missing',
    clientSecret: clientSecret ? 'configured' : 'missing',
    redirectUri: callbackURL || 'missing',
    source: {
      clientId: getSecret('twitch.clientId') ? 'config' : 'env',
      clientSecret: getSecret('twitch.clientSecret') ? 'config' : 'env',
      redirectUri: getSecret('twitch.redirectUri') ? 'config' : 'env'
    }
  });

  if (!clientId || !clientSecret || !callbackURL) {
    logger.error('Twitch OAuth configuration missing!');
    logger.error('Please configure twitch.clientId, twitch.clientSecret, and twitch.redirectUri in your secret.json file');
    logger.error('Current config values:', {
      clientId: clientId ? 'configured' : 'missing',
      clientSecret: clientSecret ? 'configured' : 'missing', 
      redirectUri: callbackURL ? callbackURL : 'missing'
    });
    throw new Error('Twitch OAuth configuration is required');
  }

  // Custom Twitch OAuth Strategy using OAuth2
  passport.use('twitch', new OAuth2Strategy({
    authorizationURL: 'https://id.twitch.tv/oauth2/authorize?force_verify=true',
    tokenURL: 'https://id.twitch.tv/oauth2/token',
    clientID: clientId,
    clientSecret: clientSecret,
    callbackURL: callbackURL,
    scope: [
      'user:read:email',
      'chat:edit',
      'chat:read',
      'moderator:manage:banned_users',  // Required for timeout/ban actions
      'moderator:manage:chat_messages'  // Required for delete message actions
    ]
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      // Fetch user profile from Twitch API
      const response = await axios.get('https://api.twitch.tv/helix/users', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Client-Id': clientId
        }
      });

      if (!response.data || !response.data.data || response.data.data.length === 0) {
        throw new Error('No user data received from Twitch API');
      }

      const twitchUser = response.data.data[0];
      const userProfile = {
        id: twitchUser.id,
        login: twitchUser.login,
        display_name: twitchUser.display_name,
        email: twitchUser.email,
        profile_image_url: twitchUser.profile_image_url
      };

      logger.info('Twitch OAuth callback received', { 
        profileId: userProfile.id,
        username: userProfile.login
      });

      // Check if user is allowed by whitelist
      const whitelistCheck = whitelist.isUserAllowed(userProfile);
      if (!whitelistCheck.allowed) {
        logger.warn('User login rejected by whitelist', {
          username: userProfile.login,
          twitch_id: userProfile.id,
          reason: whitelistCheck.reason
        });
        
        // Return false to trigger failureRedirect instead of throwing an error
        return done(null, false, { message: 'Access denied: Your Twitch account is not authorized to access this server.' });
      }
      
      const db = getDatabase();
      
      // Check if user exists
      let user = await db.get(
        'SELECT * FROM users WHERE twitch_id = ?',
        [userProfile.id]
      );

      if (user) {
        // Calculate token expiry (Twitch tokens typically expire in 4 hours = 14400 seconds)
        const expiresAt = new Date(Date.now() + (4 * 60 * 60 * 1000)); // 4 hours from now
        
        // Update existing user (including role from whitelist and tokens)
        await db.run(
          `UPDATE users SET 
           username = ?, 
           display_name = ?, 
           profile_image_url = ?, 
           email = ?,
           role = ?,
           twitch_access_token = ?,
           twitch_refresh_token = ?,
           twitch_token_expires_at = ?,
           updated_at = CURRENT_TIMESTAMP 
           WHERE twitch_id = ?`,
          [
            userProfile.login,
            userProfile.display_name,
            userProfile.profile_image_url,
            userProfile.email,
            whitelistCheck.role || 'user',
            accessToken,
            refreshToken,
            expiresAt.toISOString(),
            userProfile.id
          ]
        );
        
        // Fetch updated user
        user = await db.get(
          'SELECT * FROM users WHERE twitch_id = ?',
          [userProfile.id]
        );
        
        logger.info(`User ${userProfile.login} logged in`);
      } else {
        // Calculate token expiry (Twitch tokens typically expire in 4 hours = 14400 seconds)
        const expiresAt = new Date(Date.now() + (4 * 60 * 60 * 1000)); // 4 hours from now
        
        // Create new user (including role from whitelist and tokens)
        const result = await db.run(
          `INSERT INTO users (twitch_id, username, display_name, profile_image_url, email, role, twitch_access_token, twitch_refresh_token, twitch_token_expires_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userProfile.id,
            userProfile.login,
            userProfile.display_name,
            userProfile.profile_image_url,
            userProfile.email,
            whitelistCheck.role || 'user',
            accessToken,
            refreshToken,
            expiresAt.toISOString()
          ]
        );

        user = await db.get(
          'SELECT * FROM users WHERE id = ?',
          [result.lastID]
        );
        
        if (!user) {
          // If lastID doesn't work, try to find by twitch_id
          user = await db.get(
            'SELECT * FROM users WHERE twitch_id = ?',
            [userProfile.id]
          );
        }
        
        logger.info(`New user ${userProfile.login} registered`);
      }

      // Only log audit event if we have a valid user
      if (user && user.id) {
        // Log audit event
        await db.run(
          `INSERT INTO audit_log (user_id, action, resource_type, details) 
           VALUES (?, ?, ?, ?)`,
          [
            user.id,
            'login',
            'user',
            JSON.stringify({
              twitch_id: userProfile.id,
              username: userProfile.login,
              login_method: 'twitch_oauth'
            })
          ]
        );
      }

      return done(null, user);
    } catch (error) {
      logger.error('Authentication error details:', {
        message: error.message,
        stack: error.stack,
        accessToken: accessToken ? 'present' : 'missing'
      });
      return done(error, null);
    }
  }));

  // Serialize user for session
  passport.serializeUser((user, done) => {
    try {
      done(null, user.id);
    } catch (error) {
      logger.error('User serialization error:', error);
      done(error, null);
    }
  });

  // Deserialize user from session
  passport.deserializeUser(async (id, done) => {
    try {
      if (!id) {
        return done(new Error('No user ID in session'), null);
      }

      const db = getDatabase();
      const user = await db.get(
        'SELECT * FROM users WHERE id = ?',
        [id]
      );
      
      if (user) {
        done(null, user);
      } else {
        logger.warn(`User not found for ID: ${id} - clearing session`);
        done(null, null);
      }
    } catch (error) {
      logger.error('User deserialization error:', error);
      done(error, null);
    }
  });
}

module.exports = {
  initAuth,
};
