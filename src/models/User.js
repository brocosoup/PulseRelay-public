const { getDatabase } = require('../config/database');
const { generateStreamKey } = require('../utils/crypto');
const logger = require('../utils/logger');

class User {
  constructor(data) {
    this.id = data.id;
    this.twitchId = data.twitch_id;
    this.username = data.username;
    this.displayName = data.display_name;
    this.profileImageUrl = data.profile_image_url;
    this.email = data.email;
    this.twitchAccessToken = data.twitch_access_token;
    this.twitchRefreshToken = data.twitch_refresh_token;
    this.twitchTokenExpiresAt = data.twitch_token_expires_at;
    this.ttsOpenaiEnabled = data.tts_openai_enabled !== undefined ? Boolean(data.tts_openai_enabled) : true;
    this.additionalChannels = data.additional_channels ? JSON.parse(data.additional_channels) : [];
    this.obsWebsocketPassword = data.obs_websocket_password || null;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  /**
   * Find user by ID
   */
  static async findById(id) {
    try {
      const db = getDatabase();
      const row = await db.get('SELECT * FROM users WHERE id = ?', [id]);
      return row ? new User(row) : null;
    } catch (error) {
      logger.error('Error finding user by ID:', error);
      throw error;
    }
  }

  /**
   * Find user by Twitch ID
   */
  static async findByTwitchId(twitchId) {
    try {
      const db = getDatabase();
      const row = await db.get('SELECT * FROM users WHERE twitch_id = ?', [twitchId]);
      return row ? new User(row) : null;
    } catch (error) {
      logger.error('Error finding user by Twitch ID:', error);
      throw error;
    }
  }

  /**
   * Find user by username
   */
  static async findByUsername(username) {
    try {
      const db = getDatabase();
      const row = await db.get('SELECT * FROM users WHERE username = ?', [username]);
      return row ? new User(row) : null;
    } catch (error) {
      logger.error('Error finding user by username:', error);
      throw error;
    }
  }

  /**
   * Get all users with valid Twitch access tokens
   */
  static async getAllWithTwitchTokens() {
    try {
      const db = getDatabase();
      const rows = await db.all('SELECT * FROM users WHERE twitch_access_token IS NOT NULL');
      return rows ? rows.map(row => new User(row)) : [];
    } catch (error) {
      logger.error('Error getting users with Twitch tokens:', error);
      throw error;
    }
  }

  /**
   * Create new user
   */
  static async create(userData) {
    try {
      const db = getDatabase();
      const result = await db.run(
        `INSERT INTO users (twitch_id, username, display_name, profile_image_url, email) 
         VALUES (?, ?, ?, ?, ?)`,
        [
          userData.twitchId,
          userData.username,
          userData.displayName,
          userData.profileImageUrl,
          userData.email,
        ]
      );

      const user = await User.findById(result.id);
      logger.info(`User created: ${user.username} (ID: ${user.id})`);
      return user;
    } catch (error) {
      logger.error('Error creating user:', error);
      throw error;
    }
  }

  /**
   * Invalidate the user's Twitch access token
   */
  async invalidateTwitchToken() {
    try {
      const db = getDatabase();
      await db.run(
        'UPDATE users SET twitch_access_token = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [this.id]
      );
      
      // Clear from current instance
      this.twitchAccessToken = null;
      
      logger.warn(`Twitch access token invalidated for user: ${this.username} (ID: ${this.id})`);
    } catch (error) {
      logger.error('Error invalidating Twitch token:', error);
      throw error;
    }
  }

  /**
   * Check if user's Twitch token is expired or will expire soon
   * @param {number} bufferMinutes - Minutes before expiry to consider expired (default: 5)
   * @returns {boolean}
   */
  isTokenExpired(bufferMinutes = 5) {
    if (!this.twitchTokenExpiresAt) {
      return true; // No expiry date means we should refresh
    }
    
    const expiryDate = new Date(this.twitchTokenExpiresAt);
    const bufferTime = bufferMinutes * 60 * 1000; // Convert to milliseconds
    const expiryWithBuffer = new Date(expiryDate.getTime() - bufferTime);
    
    return Date.now() >= expiryWithBuffer.getTime();
  }

  /**
   * Get fresh Twitch token (refresh if needed)
   * @returns {Object} User object with valid token
   */
  async getFreshToken() {
    try {
      const { getTokenRefreshService } = require('../services/tokenRefresh');
      const tokenService = getTokenRefreshService();
      
      const updatedUser = await tokenService.ensureValidToken(this);
      
      // Update current instance with fresh data
      this.twitchAccessToken = updatedUser.twitchAccessToken;
      this.twitchRefreshToken = updatedUser.twitchRefreshToken;
      this.twitchTokenExpiresAt = updatedUser.twitchTokenExpiresAt;
      
      return updatedUser;
    } catch (error) {
      logger.error(`Failed to get fresh token for user ${this.username}:`, error);
      throw error;
    }
  }

  /**
   * Update user
   */
  async update(updateData) {
    try {
      const db = getDatabase();
      const fields = [];
      const values = [];

      // Build dynamic update query
      if (updateData.username !== undefined) {
        fields.push('username = ?');
        values.push(updateData.username);
      }
      if (updateData.displayName !== undefined) {
        fields.push('display_name = ?');
        values.push(updateData.displayName);
      }
      if (updateData.profileImageUrl !== undefined) {
        fields.push('profile_image_url = ?');
        values.push(updateData.profileImageUrl);
      }
      if (updateData.email !== undefined) {
        fields.push('email = ?');
        values.push(updateData.email);
      }
      if (updateData.ttsOpenaiEnabled !== undefined) {
        fields.push('tts_openai_enabled = ?');
        values.push(updateData.ttsOpenaiEnabled ? 1 : 0);
      }
      if (updateData.additionalChannels !== undefined) {
        fields.push('additional_channels = ?');
        values.push(JSON.stringify(updateData.additionalChannels));
      }

      if (fields.length === 0) {
        return this;
      }

      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(this.id);

      await db.run(
        `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
        values
      );

      // Refresh user data
      const updated = await User.findById(this.id);
      Object.assign(this, updated);

      logger.info(`User updated: ${this.username} (ID: ${this.id})`);
      return this;
    } catch (error) {
      logger.error('Error updating user:', error);
      throw error;
    }
  }

  /**
   * Delete user and all associated data
   */
  async delete() {
    try {
      const db = getDatabase();
      
      // Delete user (cascading will handle related data)
      await db.run('DELETE FROM users WHERE id = ?', [this.id]);
      
      logger.info(`User deleted: ${this.username} (ID: ${this.id})`);
    } catch (error) {
      logger.error('Error deleting user:', error);
      throw error;
    }
  }

  /**
   * Get user's stream key (most recent active one)
   */
  async getStreamKey() {
    try {
      const { StreamKey } = require('./StreamKey');
      const streamKeyObj = await StreamKey.findActiveByUserId(this.id);
      return streamKeyObj ? streamKeyObj.streamKey : null;
    } catch (error) {
      logger.error('Error getting user stream key:', error);
      throw error;
    }
  }

  /**
   * Get all user's stream keys
   */
  async getStreamKeys(includeInactive = false) {
    try {
      const { StreamKey } = require('./StreamKey');
      return await StreamKey.getByUserId(this.id, includeInactive);
    } catch (error) {
      logger.error('Error getting user stream keys:', error);
      throw error;
    }
  }

  /**
   * Get or create user's stream key
   */
  async getOrCreateStreamKey() {
    try {
      let streamKey = await this.getStreamKey();
      
      if (!streamKey) {
        streamKey = await this.generateStreamKey();
      }
      
      return streamKey;
    } catch (error) {
      logger.error('Error getting or creating stream key:', error);
      throw error;
    }
  }

  /**
   * Generate new stream key for user
   */
  async generateStreamKey(description = null) {
    try {
      const { StreamKey } = require('./StreamKey');
      const streamKeyObj = await StreamKey.create(this.id, null, description);
      
      logger.info(`Stream key generated for user: ${this.username}`);
      return streamKeyObj.streamKey;
    } catch (error) {
      logger.error('Error generating stream key:', error);
      throw error;
    }
  }

  /**
   * Create new stream key for user with description
   */
  async createStreamKey(description = null) {
    return await this.generateStreamKey(description);
  }

  /**
   * Get user's RTMP destinations
   */
  async getRtmpDestinations() {
    try {
      const db = getDatabase();
      const rows = await db.all(
        'SELECT * FROM rtmp_destinations WHERE user_id = ? ORDER BY created_at DESC',
        [this.id]
      );
      return rows;
    } catch (error) {
      logger.error('Error getting RTMP destinations:', error);
      throw error;
    }
  }

  /**
   * Get user's stream sessions (completed only)
   */
  async getStreamSessions(limit = 10) {
    try {
      const db = getDatabase();
      const rows = await db.all(
        `SELECT ss.* FROM stream_sessions ss 
         JOIN stream_keys sk ON ss.stream_key = sk.stream_key 
         WHERE sk.user_id = ? AND ss.ended_at IS NOT NULL
         ORDER BY ss.ended_at DESC 
         LIMIT ?`,
        [this.id, limit]
      );
      return rows;
    } catch (error) {
      logger.error('Error getting stream sessions:', error);
      throw error;
    }
  }

  /**
   * Get user's recent stream activity (start and end events)
   */
  async getRecentStreamActivity(limit = 10) {
    try {
      const db = getDatabase();
      const rows = await db.all(
        `SELECT 
           ss.id,
           ss.stream_key,
           ss.session_id,
           ss.started_at,
           ss.ended_at,
           ss.is_active,
           'start' as event_type,
           ss.started_at as event_time
         FROM stream_sessions ss 
         JOIN stream_keys sk ON ss.stream_key = sk.stream_key 
         WHERE sk.user_id = ?
         
         UNION ALL
         
         SELECT 
           ss.id,
           ss.stream_key,
           ss.session_id,
           ss.started_at,
           ss.ended_at,
           ss.is_active,
           'end' as event_type,
           ss.ended_at as event_time
         FROM stream_sessions ss 
         JOIN stream_keys sk ON ss.stream_key = sk.stream_key 
         WHERE sk.user_id = ? AND ss.ended_at IS NOT NULL
         
         ORDER BY event_time DESC 
         LIMIT ?`,
        [this.id, this.id, limit]
      );
      return rows;
    } catch (error) {
      logger.error('Error getting recent stream activity:', error);
      throw error;
    }
  }

  /**
   * Get user's audit log
   */
  async getAuditLog(limit = 20) {
    try {
      const db = getDatabase();
      const rows = await db.all(
        'SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
        [this.id, limit]
      );
      return rows;
    } catch (error) {
      logger.error('Error getting audit log:', error);
      throw error;
    }
  }

  /**
   * Get all users with pagination
   */
  static async getAll(page = 1, limit = 10) {
    try {
      const db = getDatabase();
      const offset = (page - 1) * limit;
      
      const rows = await db.all(
        'SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [limit, offset]
      );
      
      const countResult = await db.get('SELECT COUNT(*) as count FROM users');
      const total = countResult.count;
      
      return {
        users: rows.map(row => new User(row)),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error('Error getting all users:', error);
      throw error;
    }
  }

  /**
   * Search users
   */
  static async search(query, page = 1, limit = 10) {
    try {
      const db = getDatabase();
      const offset = (page - 1) * limit;
      const searchTerm = `%${query}%`;
      
      const rows = await db.all(
        `SELECT * FROM users 
         WHERE username LIKE ? OR display_name LIKE ? OR email LIKE ?
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [searchTerm, searchTerm, searchTerm, limit, offset]
      );
      
      const countResult = await db.get(
        `SELECT COUNT(*) as count FROM users 
         WHERE username LIKE ? OR display_name LIKE ? OR email LIKE ?`,
        [searchTerm, searchTerm, searchTerm]
      );
      const total = countResult.count;
      
      return {
        users: rows.map(row => new User(row)),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error('Error searching users:', error);
      throw error;
    }
  }

  /**
   * Get user statistics
   */
  async getStats() {
    try {
      const db = getDatabase();
      
      const streamSessionsCount = await db.get(
        `SELECT COUNT(*) as count FROM stream_sessions ss 
         JOIN stream_keys sk ON ss.stream_key = sk.stream_key 
         WHERE sk.user_id = ?`,
        [this.id]
      );
      
      const rtmpDestinationsCount = await db.get(
        'SELECT COUNT(*) as count FROM rtmp_destinations WHERE user_id = ?',
        [this.id]
      );
      
      const lastSession = await db.get(
        `SELECT ss.* FROM stream_sessions ss 
         JOIN stream_keys sk ON ss.stream_key = sk.stream_key 
         WHERE sk.user_id = ? 
         ORDER BY ss.started_at DESC LIMIT 1`,
        [this.id]
      );
      
      return {
        streamSessions: streamSessionsCount.count,
        rtmpDestinations: rtmpDestinationsCount.count,
        lastSession: lastSession?.started_at || null,
      };
    } catch (error) {
      logger.error('Error getting user stats:', error);
      throw error;
    }
  }

  /**
   * Clear user's stream activity history
   */
  async clearStreamActivity() {
    try {
      const db = getDatabase();
      
      // Clear stream sessions for this user's stream keys
      await db.run(
        `DELETE FROM stream_sessions 
         WHERE stream_key IN (
           SELECT stream_key FROM stream_keys WHERE user_id = ?
         )`,
        [this.id]
      );
      
      // Clear audit log entries for this user
      await db.run(
        'DELETE FROM audit_log WHERE user_id = ?',
        [this.id]
      );
      
      logger.info(`Cleared stream activity for user ${this.username}`);
      return true;
    } catch (error) {
      logger.error('Error clearing stream activity:', error);
      throw error;
    }
  }

  /**
   * Update OBS WebSocket password
   */
  static async updateOBSWebSocketPassword(userId, password) {
    try {
      const db = getDatabase();
      const { encryptData } = require('../utils/crypto');
      const encryptedPassword = password ? encryptData(password) : null;
      
      await db.run(
        'UPDATE users SET obs_websocket_password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [encryptedPassword, userId]
      );
      return true;
    } catch (error) {
      logger.error('Error updating OBS WebSocket password:', error);
      throw error;
    }
  }

  /**
   * Get decrypted OBS WebSocket password
   */
  static async getOBSWebSocketPassword(userId) {
    try {
      const db = getDatabase();
      const row = await db.get('SELECT obs_websocket_password FROM users WHERE id = ?', [userId]);
      
      if (!row || !row.obs_websocket_password) {
        return null;
      }
      
      const { decryptData } = require('../utils/crypto');
      return decryptData(row.obs_websocket_password);
    } catch (error) {
      logger.error('Error getting OBS WebSocket password:', error);
      return null;
    }
  }

  /**
   * Update TTS ignored users list
   */
  static async updateTTSIgnoredUsers(userId, ignoredUsers) {
    try {
      const db = getDatabase();
      const ignoredUsersJson = JSON.stringify(ignoredUsers || []);
      
      await db.run(
        'UPDATE users SET tts_ignored_users = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [ignoredUsersJson, userId]
      );
      return true;
    } catch (error) {
      logger.error('Error updating TTS ignored users:', error);
      throw error;
    }
  }

  /**
   * Get TTS ignored users list
   */
  static async getTTSIgnoredUsers(userId) {
    try {
      const db = getDatabase();
      const row = await db.get('SELECT tts_ignored_users FROM users WHERE id = ?', [userId]);
      
      if (!row || !row.tts_ignored_users) {
        return [];
      }
      
      return JSON.parse(row.tts_ignored_users);
    } catch (error) {
      logger.error('Error getting TTS ignored users:', error);
      return [];
    }
  }

  /**
   * Convert to JSON (excluding sensitive data)
   */
  toJSON() {
    return {
      id: this.id,
      twitchId: this.twitchId,
      username: this.username,
      displayName: this.displayName,
      profileImageUrl: this.profileImageUrl,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

module.exports = {
  User,
};
