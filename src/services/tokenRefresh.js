const axios = require('axios');
const { getConfig, getSecrets } = require('../config/config');
const { getDatabase } = require('../config/database');
const logger = require('../utils/logger');

class TokenRefreshService {
  constructor() {
    const secrets = getSecrets();
    this.clientId = secrets.twitch.clientId;
    this.clientSecret = secrets.twitch.clientSecret;
  }

  /**
   * Check if a token is expired or will expire soon
   * @param {string} expiresAt - ISO string of expiry date
   * @param {number} bufferMinutes - Minutes before expiry to consider expired (default: 5)
   * @returns {boolean}
   */
  isTokenExpired(expiresAt, bufferMinutes = 5) {
    if (!expiresAt) {
      return true; // No expiry date means we should refresh
    }
    
    const expiryDate = new Date(expiresAt);
    const bufferTime = bufferMinutes * 60 * 1000; // Convert to milliseconds
    const expiryWithBuffer = new Date(expiryDate.getTime() - bufferTime);
    
    return Date.now() >= expiryWithBuffer.getTime();
  }

  /**
   * Refresh a Twitch access token using the refresh token
   * @param {string} refreshToken - The refresh token
   * @returns {Object} - New token data
   */
  async refreshTwitchToken(refreshToken) {
    try {
      logger.info('Attempting to refresh Twitch token');
      
      // Twitch requires URL-encoded form data, not JSON
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret
      });
      
      const response = await axios.post('https://id.twitch.tv/oauth2/token', params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const tokenData = response.data;
      
      // Calculate new expiry time
      const expiresIn = tokenData.expires_in || 14400; // Default to 4 hours if not provided
      const expiresAt = new Date(Date.now() + (expiresIn * 1000));
      
      logger.info('Twitch token refreshed successfully', {
        expiresIn: expiresIn,
        expiresAt: expiresAt.toISOString()
      });
      
      return {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || refreshToken, // Use new refresh token if provided
        expiresAt: expiresAt.toISOString()
      };
      
    } catch (error) {
      logger.error('Failed to refresh Twitch token:', {
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      
      // If refresh token is invalid, we need to re-authenticate
      if (error.response?.status === 400 || error.response?.status === 401) {
        throw new Error('REFRESH_TOKEN_INVALID');
      }
      
      throw error;
    }
  }

  /**
   * Refresh token for a specific user and update database
   * @param {Object} user - User object with tokens
   * @returns {Object} - Updated user data with new tokens
   */
  async refreshUserToken(user) {
    try {
      if (!user.twitchRefreshToken) {
        throw new Error('No refresh token available for user');
      }

      // Get fresh token data
      const tokenData = await this.refreshTwitchToken(user.twitchRefreshToken);
      
      // Update user in database
      const db = getDatabase();
      await db.run(
        `UPDATE users SET 
         twitch_access_token = ?,
         twitch_refresh_token = ?,
         twitch_token_expires_at = ?,
         updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [
          tokenData.accessToken,
          tokenData.refreshToken,
          tokenData.expiresAt,
          user.id
        ]
      );
      
      logger.info(`Token refreshed for user: ${user.username}`, {
        userId: user.id,
        expiresAt: tokenData.expiresAt
      });
      
      // Return updated user data
      return {
        ...user,
        twitchAccessToken: tokenData.accessToken,
        twitchRefreshToken: tokenData.refreshToken,
        twitchTokenExpiresAt: tokenData.expiresAt
      };
      
    } catch (error) {
      logger.error(`Failed to refresh token for user ${user.username}:`, error);
      
      // If refresh token is invalid, invalidate all tokens
      if (error.message === 'REFRESH_TOKEN_INVALID') {
        await this.invalidateUserTokens(user.id);
        throw new Error('Refresh token invalid. User must re-authenticate.');
      }
      
      throw error;
    }
  }

  /**
   * Invalidate all tokens for a user
   * @param {number} userId - User ID
   */
  async invalidateUserTokens(userId) {
    try {
      const db = getDatabase();
      await db.run(
        `UPDATE users SET 
         twitch_access_token = NULL,
         twitch_refresh_token = NULL,
         twitch_token_expires_at = NULL,
         updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [userId]
      );
      
      logger.info(`Invalidated all tokens for user ID: ${userId}`);
      
    } catch (error) {
      logger.error(`Failed to invalidate tokens for user ID ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Check if user needs token refresh and do it automatically
   * @param {Object} user - User object
   * @returns {Object} - User object with refreshed tokens if needed
   */
  async ensureValidToken(user) {
    try {
      // If user doesn't have a refresh token (older user), just return as-is
      if (!user.twitchRefreshToken) {
        logger.debug(`User ${user.username} has no refresh token - skipping auto-refresh (older user)`);
        return user;
      }
      
      // Check if token needs refresh
      if (!user.twitchAccessToken || this.isTokenExpired(user.twitchTokenExpiresAt)) {
        logger.info(`Token expired or missing for user ${user.username}, attempting refresh`);
        
        // Refresh the token
        const updatedUser = await this.refreshUserToken(user);
        return updatedUser;
      }
      
      // Token is still valid
      return user;
      
    } catch (error) {
      logger.error(`Failed to ensure valid token for user ${user.username}:`, error);
      throw error;
    }
  }
}

// Singleton instance
let tokenRefreshService = null;

/**
 * Get the token refresh service instance
 * @returns {TokenRefreshService}
 */
function getTokenRefreshService() {
  if (!tokenRefreshService) {
    tokenRefreshService = new TokenRefreshService();
  }
  return tokenRefreshService;
}

module.exports = {
  TokenRefreshService,
  getTokenRefreshService
};
