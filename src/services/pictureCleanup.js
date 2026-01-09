const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');
const { getDatabase } = require('../config/database');

class PictureCleanupService {
  constructor() {
    this.cleanupTimer = null;
    this.isRunning = false;
    // Run daily at 3 AM
    this.cleanupHour = 3;
    this.cleanupMinute = 0;
    // Keep pictures for 7 days by default
    this.retentionDays = 7;
  }

  /**
   * Start the daily cleanup scheduler
   */
  start() {
    if (this.isRunning) {
      logger.warn('Picture cleanup service already running');
      return;
    }

    this.isRunning = true;
    logger.info(`Picture cleanup service started - runs daily at ${this.cleanupHour}:${String(this.cleanupMinute).padStart(2, '0')}, retention: ${this.retentionDays} days`);
    
    // Schedule next cleanup
    this.scheduleNextCleanup();
    
    // Also run cleanup on startup (to catch any missed cleanups)
    this.runCleanup();
  }

  /**
   * Stop the cleanup scheduler
   */
  stop() {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.isRunning = false;
    logger.info('Picture cleanup service stopped');
  }

  /**
   * Schedule the next cleanup run
   */
  scheduleNextCleanup() {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
    }

    const now = new Date();
    const nextRun = new Date();
    nextRun.setHours(this.cleanupHour, this.cleanupMinute, 0, 0);

    // If the time has already passed today, schedule for tomorrow
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    const msUntilNextRun = nextRun.getTime() - now.getTime();
    const hoursUntil = Math.floor(msUntilNextRun / (1000 * 60 * 60));
    const minutesUntil = Math.floor((msUntilNextRun % (1000 * 60 * 60)) / (1000 * 60));

    logger.info(`Next picture cleanup scheduled in ${hoursUntil}h ${minutesUntil}m at ${nextRun.toISOString()}`);

    this.cleanupTimer = setTimeout(() => {
      this.runCleanup();
      this.scheduleNextCleanup(); // Schedule next run
    }, msUntilNextRun);
  }

  /**
   * Run the cleanup job
   */
  async runCleanup() {
    try {
      logger.info(`Starting daily picture cleanup (removing pictures older than ${this.retentionDays} days)`);
      
      const db = getDatabase();
      
      // Get old pictures
      const oldPictures = await db.all(
        `SELECT * FROM overlay_pictures 
         WHERE datetime(created_at, '+${this.retentionDays} days') <= datetime('now')`
      );

      if (oldPictures.length === 0) {
        logger.info('Daily picture cleanup: No old pictures to delete');
        return;
      }

      logger.info(`Daily picture cleanup: Found ${oldPictures.length} pictures older than ${this.retentionDays} days`);

      let deletedCount = 0;
      let failedCount = 0;

      for (const picture of oldPictures) {
        try {
          // Delete file from filesystem
          const filepath = path.join(__dirname, '../../public', picture.filepath);
          await fs.unlink(filepath);
          deletedCount++;
          logger.debug(`Deleted old picture file: ${filepath}`);
        } catch (err) {
          failedCount++;
          logger.warn(`Failed to delete picture file ${picture.filepath}:`, err.message);
        }
      }

      // Delete from database (even if file deletion failed)
      const result = await db.run(
        `DELETE FROM overlay_pictures 
         WHERE datetime(created_at, '+${this.retentionDays} days') <= datetime('now')`
      );

      logger.info(`Daily picture cleanup complete: ${deletedCount} files deleted, ${failedCount} failed, ${result.changes} database records removed`);

    } catch (error) {
      logger.error('Error during daily picture cleanup:', error);
    }
  }
}

// Singleton instance
let pictureCleanupService = null;

function getPictureCleanupService() {
  if (!pictureCleanupService) {
    pictureCleanupService = new PictureCleanupService();
  }
  return pictureCleanupService;
}

module.exports = { getPictureCleanupService };
