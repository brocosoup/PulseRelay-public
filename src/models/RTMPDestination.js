const { getDatabase } = require('../config/database');
const logger = require('../utils/logger');

class RTMPDestination {
  constructor(data) {
    this.id = data.id;
    this.userId = data.user_id;
    this.name = data.name;
    this.rtmpUrl = data.rtmp_url;
    this.streamKey = data.stream_key;
    this.isActive = data.is_active;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  /**
   * Find RTMP destination by ID
   */
  static async findById(id) {
    try {
      const db = getDatabase();
      const row = await db.get('SELECT * FROM rtmp_destinations WHERE id = ?', [id]);
      return row ? new RTMPDestination(row) : null;
    } catch (error) {
      logger.error('Error finding RTMP destination by ID:', error);
      throw error;
    }
  }

  /**
   * Find RTMP destinations by user ID
   */
  static async findByUserId(userId, includeInactive = false) {
    try {
      const db = getDatabase();
      let query = 'SELECT * FROM rtmp_destinations WHERE user_id = ?';
      const params = [userId];
      
      if (!includeInactive) {
        query += ' AND is_active = 1';
      }
      
      query += ' ORDER BY created_at DESC';
      
      const rows = await db.all(query, params);
      return rows.map(row => new RTMPDestination(row));
    } catch (error) {
      logger.error('Error finding RTMP destinations by user ID:', error);
      throw error;
    }
  }

  /**
   * Create new RTMP destination
   */
  static async create(destinationData) {
    try {
      const db = getDatabase();
      const result = await db.run(
        `INSERT INTO rtmp_destinations (user_id, name, rtmp_url, stream_key, is_active) 
         VALUES (?, ?, ?, ?, ?)`,
        [
          destinationData.userId,
          destinationData.name,
          destinationData.rtmpUrl,
          destinationData.streamKey,
          destinationData.isActive !== undefined ? destinationData.isActive : true,
        ]
      );

      const destination = await RTMPDestination.findById(result.id);
      logger.info(`RTMP destination created: ${destination.name} (ID: ${destination.id})`);
      return destination;
    } catch (error) {
      logger.error('Error creating RTMP destination:', error);
      throw error;
    }
  }

  /**
   * Update RTMP destination
   */
  async update(updateData) {
    try {
      const db = getDatabase();
      const fields = [];
      const values = [];

      if (updateData.name !== undefined) {
        fields.push('name = ?');
        values.push(updateData.name);
      }
      if (updateData.rtmpUrl !== undefined) {
        fields.push('rtmp_url = ?');
        values.push(updateData.rtmpUrl);
      }
      if (updateData.streamKey !== undefined) {
        fields.push('stream_key = ?');
        values.push(updateData.streamKey);
      }
      if (updateData.isActive !== undefined) {
        fields.push('is_active = ?');
        values.push(updateData.isActive ? 1 : 0);
      }

      if (fields.length === 0) {
        return this;
      }

      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(this.id);

      await db.run(
        `UPDATE rtmp_destinations SET ${fields.join(', ')} WHERE id = ?`,
        values
      );

      // Refresh data
      const updated = await RTMPDestination.findById(this.id);
      Object.assign(this, updated);

      logger.info(`RTMP destination updated: ${this.name} (ID: ${this.id})`);
      return this;
    } catch (error) {
      logger.error('Error updating RTMP destination:', error);
      throw error;
    }
  }

  /**
   * Delete RTMP destination
   */
  async delete() {
    try {
      const db = getDatabase();
      await db.run('DELETE FROM rtmp_destinations WHERE id = ?', [this.id]);
      logger.info(`RTMP destination deleted: ${this.name} (ID: ${this.id})`);
    } catch (error) {
      logger.error('Error deleting RTMP destination:', error);
      throw error;
    }
  }

  /**
   * Activate RTMP destination
   */
  async activate() {
    return await this.update({ isActive: true });
  }

  /**
   * Deactivate RTMP destination
   */
  async deactivate() {
    return await this.update({ isActive: false });
  }

  /**
   * Get user associated with this destination
   */
  async getUser() {
    try {
      const db = getDatabase();
      const row = await db.get('SELECT * FROM users WHERE id = ?', [this.userId]);
      return row;
    } catch (error) {
      logger.error('Error getting user for RTMP destination:', error);
      throw error;
    }
  }

  /**
   * Test connection to RTMP destination
   */
  async testConnection() {
    try {
      const { RestreamService } = require('../services/restream');
      const restreamService = new RestreamService();
      
      const result = await restreamService.testDestination({
        name: this.name,
        rtmp_url: this.rtmpUrl,
        stream_key: this.streamKey,
      });
      
      logger.info(`RTMP destination test result for ${this.name}:`, result);
      return result;
    } catch (error) {
      logger.error(`Error testing RTMP destination ${this.name}:`, error);
      return {
        success: false,
        destination: this.name,
        error: error.message,
      };
    }
  }

  /**
   * Get all RTMP destinations with pagination
   */
  static async getAll(page = 1, limit = 10, includeInactive = false) {
    try {
      const db = getDatabase();
      const offset = (page - 1) * limit;
      
      let query = 'SELECT * FROM rtmp_destinations';
      let countQuery = 'SELECT COUNT(*) as count FROM rtmp_destinations';
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
        destinations: rows.map(row => new RTMPDestination(row)),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error('Error getting all RTMP destinations:', error);
      throw error;
    }
  }

  /**
   * Search RTMP destinations
   */
  static async search(query, page = 1, limit = 10) {
    try {
      const db = getDatabase();
      const offset = (page - 1) * limit;
      const searchTerm = `%${query}%`;
      
      const rows = await db.all(
        `SELECT * FROM rtmp_destinations 
         WHERE name LIKE ? OR rtmp_url LIKE ?
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [searchTerm, searchTerm, limit, offset]
      );
      
      const countResult = await db.get(
        `SELECT COUNT(*) as count FROM rtmp_destinations 
         WHERE name LIKE ? OR rtmp_url LIKE ?`,
        [searchTerm, searchTerm]
      );
      const total = countResult.count;
      
      return {
        destinations: rows.map(row => new RTMPDestination(row)),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error('Error searching RTMP destinations:', error);
      throw error;
    }
  }

  /**
   * Get RTMP destination statistics
   */
  static async getStats() {
    try {
      const db = getDatabase();
      
      const totalCount = await db.get(
        'SELECT COUNT(*) as count FROM rtmp_destinations'
      );
      
      const activeCount = await db.get(
        'SELECT COUNT(*) as count FROM rtmp_destinations WHERE is_active = 1'
      );
      
      const userCount = await db.get(
        'SELECT COUNT(DISTINCT user_id) as count FROM rtmp_destinations'
      );
      
      const popularDestinations = await db.all(
        `SELECT rtmp_url, COUNT(*) as count 
         FROM rtmp_destinations 
         GROUP BY rtmp_url 
         ORDER BY count DESC 
         LIMIT 5`
      );
      
      return {
        total: totalCount.count,
        active: activeCount.count,
        inactive: totalCount.count - activeCount.count,
        uniqueUsers: userCount.count,
        popularDestinations: popularDestinations,
      };
    } catch (error) {
      logger.error('Error getting RTMP destination stats:', error);
      throw error;
    }
  }

  /**
   * Validate RTMP URL format
   */
  static validateRtmpUrl(url) {
    const rtmpPattern = /^rtmps?:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?(?:\/[^\s]*)?$/;
    return rtmpPattern.test(url);
  }

  /**
   * Extract hostname from RTMP URL
   */
  static extractHostname(url) {
    try {
      const match = url.match(/^rtmps?:\/\/([a-zA-Z0-9.-]+)(?::[0-9]+)?/);
      return match ? match[1] : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get popular RTMP providers
   */
  static async getPopularProviders(limit = 10) {
    try {
      const db = getDatabase();
      const rows = await db.all(
        `SELECT 
           CASE 
             WHEN rtmp_url LIKE '%twitch.tv%' THEN 'Twitch'
             WHEN rtmp_url LIKE '%youtube.com%' THEN 'YouTube'
             WHEN rtmp_url LIKE '%facebook.com%' THEN 'Facebook'
             WHEN rtmp_url LIKE '%tiktok.com%' THEN 'TikTok'
             ELSE 'Other'
           END as provider,
           COUNT(*) as count
         FROM rtmp_destinations 
         WHERE is_active = 1
         GROUP BY provider
         ORDER BY count DESC
         LIMIT ?`,
        [limit]
      );
      
      return rows;
    } catch (error) {
      logger.error('Error getting popular RTMP providers:', error);
      throw error;
    }
  }

  /**
   * Bulk update destinations
   */
  static async bulkUpdate(destinationIds, updateData) {
    try {
      const db = getDatabase();
      const fields = [];
      const values = [];

      if (updateData.isActive !== undefined) {
        fields.push('is_active = ?');
        values.push(updateData.isActive ? 1 : 0);
      }

      if (fields.length === 0) {
        return 0;
      }

      fields.push('updated_at = CURRENT_TIMESTAMP');
      
      const placeholders = destinationIds.map(() => '?').join(',');
      const result = await db.run(
        `UPDATE rtmp_destinations SET ${fields.join(', ')} WHERE id IN (${placeholders})`,
        [...values, ...destinationIds]
      );

      logger.info(`Bulk updated ${result.changes} RTMP destinations`);
      return result.changes;
    } catch (error) {
      logger.error('Error bulk updating RTMP destinations:', error);
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
      name: this.name,
      rtmpUrl: this.rtmpUrl,
      streamKey: this.streamKey,
      isActive: this.isActive,
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
      name: this.name,
      rtmpUrl: this.rtmpUrl,
      streamKey: this.streamKey.substring(0, 8) + '...' + this.streamKey.substring(this.streamKey.length - 4),
      isActive: this.isActive,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

module.exports = {
  RTMPDestination,
};
