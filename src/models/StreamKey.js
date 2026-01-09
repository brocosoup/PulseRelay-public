const { getDatabase } = require('../config/database');
const { generateStreamKey } = require('../utils/crypto');
const logger = require('../utils/logger');

class StreamKey {
  constructor(data) {
    this.id = data.id;
    this.userId = data.user_id;
    this.streamKey = data.stream_key;
    this.description = data.description;
    this.obsSourceName = data.obs_source_name;
    this.disconnectMessage = data.disconnect_message;
    this.connectMessage = data.connect_message;
    this.isActive = data.is_active;
    this.lastUsedAt = data.last_used_at;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  /**
   * Find stream key by ID
   */
  static async findById(id) {
    try {
      const db = getDatabase();
      const row = await db.get('SELECT * FROM stream_keys WHERE id = ?', [id]);
      return row ? new StreamKey(row) : null;
    } catch (error) {
      logger.error('Error finding stream key by ID:', error);
      throw error;
    }
  }

  /**
   * Find stream key by key value
   */
  static async findByKey(streamKey) {
    try {
      const db = getDatabase();
      const row = await db.get('SELECT * FROM stream_keys WHERE stream_key = ?', [streamKey]);
      return row ? new StreamKey(row) : null;
    } catch (error) {
      logger.error('Error finding stream key by key:', error);
      throw error;
    }
  }

  /**
   * Find active stream key by user ID
   */
  static async findActiveByUserId(userId) {
    try {
      const db = getDatabase();
      const row = await db.get(
        'SELECT * FROM stream_keys WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
      return row ? new StreamKey(row) : null;
    } catch (error) {
      logger.error('Error finding active stream key by user ID:', error);
      throw error;
    }
  }

  /**
   * Find all active stream keys by user ID
   */
  static async findAllActiveByUserId(userId) {
    try {
      const db = getDatabase();
      const rows = await db.all(
        'SELECT * FROM stream_keys WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC',
        [userId]
      );
      return rows.map(row => new StreamKey(row));
    } catch (error) {
      logger.error('Error finding all active stream keys by user ID:', error);
      throw error;
    }
  }

  /**
   * Create new stream key
   */
  static async create(userId, streamKey = null, description = null) {
    try {
      const db = getDatabase();
      const key = streamKey || generateStreamKey();

      const result = await db.run(
        'INSERT INTO stream_keys (user_id, stream_key, description) VALUES (?, ?, ?)',
        [userId, key, description]
      );

      const newStreamKey = await StreamKey.findById(result.id);
      logger.info(`Stream key created for user ID ${userId}: ${key}`);
      return newStreamKey;
    } catch (error) {
      logger.error('Error creating stream key:', error);
      throw error;
    }
  }

  /**
   * Regenerate stream key for user
   */
  static async regenerateForUser(userId) {
    try {
      const newKey = generateStreamKey();
      return await StreamKey.create(userId, newKey);
    } catch (error) {
      logger.error('Error regenerating stream key:', error);
      throw error;
    }
  }

  /**
   * Verify stream key is valid and active
   */
  static async verify(streamKey) {
    try {
      const db = getDatabase();
      const row = await db.get(
        'SELECT * FROM stream_keys WHERE stream_key = ? AND is_active = 1',
        [streamKey]
      );
      return !!row;
    } catch (error) {
      logger.error('Error verifying stream key:', error);
      return false;
    }
  }

  /**
   * Get user associated with stream key
   */
  async getUser() {
    try {
      const db = getDatabase();
      const row = await db.get('SELECT * FROM users WHERE id = ?', [this.userId]);
      return row;
    } catch (error) {
      logger.error('Error getting user for stream key:', error);
      throw error;
    }
  }

  /**
   * Update stream key
   */
  async update(updateData) {
    try {
      const db = getDatabase();
      const fields = [];
      const values = [];

      if (updateData.isActive !== undefined) {
        fields.push('is_active = ?');
        values.push(updateData.isActive ? 1 : 0);
      }

      if (updateData.description !== undefined) {
        fields.push('description = ?');
        values.push(updateData.description);
      }

      if (updateData.obsSourceName !== undefined) {
        fields.push('obs_source_name = ?');
        values.push(updateData.obsSourceName);
      }

      if (updateData.disconnectMessage !== undefined) {
        fields.push('disconnect_message = ?');
        values.push(updateData.disconnectMessage);
      }

      if (updateData.connectMessage !== undefined) {
        fields.push('connect_message = ?');
        values.push(updateData.connectMessage);
      }

      if (updateData.markAsUsed) {
        fields.push('last_used_at = CURRENT_TIMESTAMP');
      }

      if (fields.length === 0) {
        return this;
      }

      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(this.id);

      await db.run(
        `UPDATE stream_keys SET ${fields.join(', ')} WHERE id = ?`,
        values
      );

      // Refresh data
      const updated = await StreamKey.findById(this.id);
      Object.assign(this, updated);

      logger.info(`Stream key updated: ${this.streamKey}`);
      return this;
    } catch (error) {
      logger.error('Error updating stream key:', error);
      throw error;
    }
  }

  /**
   * Mark stream key as used
   */
  async markAsUsed() {
    return await this.update({ markAsUsed: true });
  }

  /**
   * Deactivate stream key
   */
  async deactivate() {
    return await this.update({ isActive: false });
  }

  /**
   * Activate stream key
   */
  async activate() {
    return await this.update({ isActive: true });
  }

  /**
   * Delete stream key
   */
  async delete() {
    try {
      const db = getDatabase();
      await db.run('DELETE FROM stream_keys WHERE id = ?', [this.id]);
      logger.info(`Stream key deleted: ${this.streamKey}`);
    } catch (error) {
      logger.error('Error deleting stream key:', error);
      throw error;
    }
  }

  /**
   * Get stream sessions for this key
   */
  async getSessions(limit = 10) {
    try {
      const db = getDatabase();
      const rows = await db.all(
        'SELECT * FROM stream_sessions WHERE stream_key = ? ORDER BY started_at DESC LIMIT ?',
        [this.streamKey, limit]
      );
      return rows;
    } catch (error) {
      logger.error('Error getting stream sessions:', error);
      throw error;
    }
  }

  /**
   * Get current active session
   */
  async getCurrentSession() {
    try {
      const db = getDatabase();
      const row = await db.get(
        'SELECT * FROM stream_sessions WHERE stream_key = ? AND is_active = 1',
        [this.streamKey]
      );
      return row;
    } catch (error) {
      logger.error('Error getting current session:', error);
      throw error;
    }
  }

  /**
   * Get stream key usage statistics
   */
  async getStats() {
    try {
      const db = getDatabase();
      
      const sessionsCount = await db.get(
        'SELECT COUNT(*) as count FROM stream_sessions WHERE stream_key = ?',
        [this.streamKey]
      );
      
      const totalStreamTime = await db.get(
        `SELECT SUM(
          CASE 
            WHEN ended_at IS NOT NULL 
            THEN (julianday(ended_at) - julianday(started_at)) * 24 * 60 * 60 
            WHEN is_active = 1 AND ended_at IS NULL
            THEN (julianday('now') - julianday(started_at)) * 24 * 60 * 60
            ELSE 0 
          END
        ) as total_seconds FROM stream_sessions WHERE stream_key = ?`,
        [this.streamKey]
      );
      
      const lastSession = await db.get(
        'SELECT * FROM stream_sessions WHERE stream_key = ? ORDER BY started_at DESC LIMIT 1',
        [this.streamKey]
      );
      
      return {
        sessionsCount: sessionsCount.count,
        totalStreamTime: totalStreamTime.total_seconds || 0,
        lastSession: lastSession?.started_at || null,
      };
    } catch (error) {
      logger.error('Error getting stream key stats:', error);
      throw error;
    }
  }

  /**
   * Get all stream keys for a user
   */
  static async getByUserId(userId, includeInactive = false) {
    try {
      const db = getDatabase();
      let query = 'SELECT * FROM stream_keys WHERE user_id = ?';
      const params = [userId];
      
      if (!includeInactive) {
        query += ' AND is_active = 1';
      }
      
      query += ' ORDER BY created_at DESC';
      
      const rows = await db.all(query, params);
      return rows.map(row => new StreamKey(row));
    } catch (error) {
      logger.error('Error getting stream keys by user ID:', error);
      throw error;
    }
  }

  /**
   * Get all stream keys with pagination
   */
  static async getAll(page = 1, limit = 10, includeInactive = false) {
    try {
      const db = getDatabase();
      const offset = (page - 1) * limit;
      
      let query = 'SELECT * FROM stream_keys';
      let countQuery = 'SELECT COUNT(*) as count FROM stream_keys';
      const params = [];
      
      if (!includeInactive) {
        query += ' WHERE is_active = 1';
        countQuery += ' WHERE is_active = 1';
      }
      
      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);
      
      const rows = await db.all(query, params);
      const countResult = await db.get(countQuery);
      const total = countResult.count;
      
      return {
        streamKeys: rows.map(row => new StreamKey(row)),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error('Error getting all stream keys:', error);
      throw error;
    }
  }

  /**
   * Clean up old inactive stream keys
   */
  static async cleanupOldKeys(daysOld = 30) {
    try {
      const db = getDatabase();
      const result = await db.run(
        `DELETE FROM stream_keys 
         WHERE is_active = 0 
         AND created_at < datetime('now', '-${daysOld} days')`,
        []
      );
      
      logger.info(`Cleaned up ${result.changes} old inactive stream keys`);
      return result.changes;
    } catch (error) {
      logger.error('Error cleaning up old stream keys:', error);
      throw error;
    }
  }

  /**
   * Convert to JSON (excluding sensitive data)
   */
  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      streamKey: this.streamKey,
      description: this.description,
      obsSourceName: this.obsSourceName,
      disconnectMessage: this.disconnectMessage,
      connectMessage: this.connectMessage,
      isActive: this.isActive,
      lastUsedAt: this.lastUsedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Convert to safe JSON (masking the stream key)
   */
  toSafeJSON() {
    return {
      id: this.id,
      userId: this.userId,
      streamKey: this.streamKey.substring(0, 8) + '...' + this.streamKey.substring(this.streamKey.length - 4),
      description: this.description,
      obsSourceName: this.obsSourceName,
      disconnectMessage: this.disconnectMessage,
      connectMessage: this.connectMessage,
      isActive: this.isActive,
      lastUsedAt: this.lastUsedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

module.exports = {
  StreamKey,
};
