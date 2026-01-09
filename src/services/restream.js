const ffmpeg = require('fluent-ffmpeg');
const { getDatabase } = require('../config/database');
const logger = require('../utils/logger');

class RestreamService {
  constructor() {
    this.activeRestreams = new Map(); // Track active restream processes
    this.retryAttempts = new Map(); // Track retry attempts for failed restreams
    this.maxRetries = 3;
    this.retryDelay = 5000; // 5 seconds
  }

  /**
   * Start restreaming to external RTMP destinations
   */
  async startRestream(streamKey, inputStreamPath) {
    try {
      const db = getDatabase();
      
      // Get user's RTMP destinations
      const destinations = await db.all(
        `SELECT rd.* FROM rtmp_destinations rd 
         JOIN stream_keys sk ON rd.user_id = sk.user_id 
         WHERE sk.stream_key = ? AND rd.is_active = 1`,
        [streamKey]
      );

      if (destinations.length === 0) {
        logger.debug(`No active RTMP destinations for stream key: ${streamKey}`);
        return;
      }

      logger.info(`Starting restream for ${streamKey} to ${destinations.length} destinations`);

      // Start restream for each destination
      for (const destination of destinations) {
        await this.startDestinationRestream(streamKey, inputStreamPath, destination);
      }

    } catch (error) {
      logger.error(`Failed to start restream for ${streamKey}:`, error);
    }
  }

  /**
   * Start restream to a specific destination
   */
  async startDestinationRestream(streamKey, inputStreamPath, destination) {
    try {
      const restreamKey = `${streamKey}-${destination.id}`;
      
      // Check if restream is already running
      if (this.activeRestreams.has(restreamKey)) {
        logger.warn(`Restream already running for ${restreamKey}`);
        return;
      }

      const { getConfig } = require('../config/config');
      const config = getConfig();
      const inputUrl = `rtmp://localhost:${config.rtmp.port || 1935}${inputStreamPath}`;
      const outputUrl = `${destination.rtmp_url}/${destination.stream_key}`;

      logger.info(`Starting restream: ${inputUrl} -> ${outputUrl}`);

      // Create FFmpeg command for restreaming
      const command = ffmpeg(inputUrl)
        .inputOptions([
          '-re', // Read input at native frame rate
          '-fflags +genpts', // Generate presentation timestamps
        ])
        .outputOptions([
          '-c copy', // Copy streams without re-encoding
          '-f flv', // FLV format for RTMP
          '-flvflags no_duration_filesize', // Optimize for streaming
          '-avoid_negative_ts make_zero', // Handle negative timestamps
        ])
        .output(outputUrl)
        .on('start', (commandLine) => {
          logger.info(`Restream started for ${destination.name}: ${commandLine}`);
          logger.stream.restream(streamKey, destination.name, 'started');
        })
        .on('progress', (progress) => {
          // Log progress every 30 seconds
          if (Math.floor(progress.timemark) % 30 === 0) {
            logger.debug(`Restream progress for ${destination.name}: ${progress.timemark}`);
          }
        })
        .on('error', (err) => {
          logger.error(`Restream error for ${destination.name}:`, err);
          logger.stream.restream(streamKey, destination.name, 'error');
          
          // Clean up
          this.activeRestreams.delete(restreamKey);
          
          // Retry logic
          this.handleRestreamError(streamKey, inputStreamPath, destination, err);
        })
        .on('end', () => {
          logger.info(`Restream ended for ${destination.name}`);
          logger.stream.restream(streamKey, destination.name, 'stopped');
          this.activeRestreams.delete(restreamKey);
        });

      // Start the restream
      command.run();

      // Store the command reference
      this.activeRestreams.set(restreamKey, {
        command,
        destination,
        streamKey,
        inputStreamPath,
        startTime: new Date(),
      });

    } catch (error) {
      logger.error(`Failed to start destination restream for ${destination.name}:`, error);
    }
  }

  /**
   * Handle restream errors with retry logic
   */
  async handleRestreamError(streamKey, inputStreamPath, destination, error) {
    const restreamKey = `${streamKey}-${destination.id}`;
    const attempts = this.retryAttempts.get(restreamKey) || 0;

    if (attempts < this.maxRetries) {
      this.retryAttempts.set(restreamKey, attempts + 1);
      
      logger.warn(`Retrying restream for ${destination.name} (attempt ${attempts + 1}/${this.maxRetries})`);
      
      // Wait before retry
      setTimeout(() => {
        this.startDestinationRestream(streamKey, inputStreamPath, destination);
      }, this.retryDelay * Math.pow(2, attempts)); // Exponential backoff
      
    } else {
      logger.error(`Max retries exceeded for restream to ${destination.name}`);
      this.retryAttempts.delete(restreamKey);
      
      // Update destination status in database
      try {
        const db = getDatabase();
        await db.run(
          'INSERT INTO audit_log (action, resource_type, resource_id, details) VALUES (?, ?, ?, ?)',
          [
            'restream_failed',
            'rtmp_destination',
            destination.id,
            JSON.stringify({
              streamKey,
              destinationName: destination.name,
              error: error.message,
              maxRetriesExceeded: true,
            })
          ]
        );
      } catch (dbError) {
        logger.error('Failed to log restream failure:', dbError);
      }
    }
  }

  /**
   * Stop restreaming for a stream key
   */
  async stopRestream(streamKey) {
    try {
      const restreamKeys = Array.from(this.activeRestreams.keys()).filter(key => 
        key.startsWith(streamKey + '-')
      );

      if (restreamKeys.length === 0) {
        logger.debug(`No active restreams for stream key: ${streamKey}`);
        return;
      }

      logger.info(`Stopping ${restreamKeys.length} restreams for stream key: ${streamKey}`);

      // Stop all restreams for this stream key
      for (const restreamKey of restreamKeys) {
        await this.stopDestinationRestream(restreamKey);
      }

      // Clear retry attempts
      for (const restreamKey of restreamKeys) {
        this.retryAttempts.delete(restreamKey);
      }

    } catch (error) {
      logger.error(`Failed to stop restream for ${streamKey}:`, error);
    }
  }

  /**
   * Stop restream to a specific destination
   */
  async stopDestinationRestream(restreamKey) {
    try {
      const restream = this.activeRestreams.get(restreamKey);
      if (!restream) {
        logger.debug(`No active restream for key: ${restreamKey}`);
        return;
      }

      logger.info(`Stopping restream for ${restream.destination.name}`);

      // Kill the FFmpeg process
      if (restream.command) {
        restream.command.kill('SIGTERM');
      }

      // Remove from active restreams
      this.activeRestreams.delete(restreamKey);

    } catch (error) {
      logger.error(`Failed to stop destination restream for ${restreamKey}:`, error);
    }
  }

  /**
   * Get active restreams for a stream key
   */
  getActiveRestreams(streamKey) {
    const restreams = [];
    
    for (const [key, restream] of this.activeRestreams) {
      if (restream.streamKey === streamKey) {
        restreams.push({
          destination: restream.destination,
          startTime: restream.startTime,
          duration: Date.now() - restream.startTime.getTime(),
        });
      }
    }
    
    return restreams;
  }

  /**
   * Get all active restreams
   */
  getAllActiveRestreams() {
    const restreams = [];
    
    for (const [key, restream] of this.activeRestreams) {
      restreams.push({
        streamKey: restream.streamKey,
        destination: restream.destination,
        startTime: restream.startTime,
        duration: Date.now() - restream.startTime.getTime(),
      });
    }
    
    return restreams;
  }

  /**
   * Check if restream is running for a stream key
   */
  isRestreamRunning(streamKey) {
    return Array.from(this.activeRestreams.keys()).some(key => 
      key.startsWith(streamKey + '-')
    );
  }

  /**
   * Test RTMP destination connectivity
   */
  async testDestination(destination) {
    return new Promise((resolve, reject) => {
      const testUrl = `${destination.rtmp_url}/${destination.stream_key}`;
      
      // Create a test stream with a short duration
      const command = ffmpeg()
        .input('testsrc2=duration=5:size=320x240:rate=1')
        .inputFormat('lavfi')
        .input('sine=frequency=1000:duration=5')
        .inputFormat('lavfi')
        .videoCodec('libx264')
        .audioCodec('aac')
        .videoBitrate(100)
        .audioBitrate(64)
        .format('flv')
        .output(testUrl)
        .on('start', () => {
          logger.info(`Testing RTMP destination: ${destination.name}`);
        })
        .on('end', () => {
          logger.info(`RTMP destination test successful: ${destination.name}`);
          resolve({ success: true, destination: destination.name });
        })
        .on('error', (err) => {
          logger.error(`RTMP destination test failed: ${destination.name}`, err);
          resolve({ success: false, destination: destination.name, error: err.message });
        });

      // Set timeout for the test
      setTimeout(() => {
        command.kill('SIGTERM');
        resolve({ success: false, destination: destination.name, error: 'Test timeout' });
      }, 30000); // 30 seconds timeout

      command.run();
    });
  }

  /**
   * Stop all restreams
   */
  async stopAllRestreams() {
    logger.info('Stopping all restreams...');
    
    const promises = [];
    for (const restreamKey of this.activeRestreams.keys()) {
      promises.push(this.stopDestinationRestream(restreamKey));
    }

    await Promise.all(promises);
    
    // Clear retry attempts
    this.retryAttempts.clear();
    
    logger.info('All restreams stopped');
  }

  /**
   * Get restream statistics
   */
  getRestreamStats() {
    const stats = {
      activeRestreams: this.activeRestreams.size,
      retryAttempts: this.retryAttempts.size,
      restreams: this.getAllActiveRestreams(),
    };

    return stats;
  }

  /**
   * Health check for restream service
   */
  getHealthStatus() {
    return {
      service: 'restream',
      status: 'healthy',
      activeRestreams: this.activeRestreams.size,
      retryAttempts: this.retryAttempts.size,
      stats: this.getRestreamStats(),
    };
  }
}

module.exports = {
  RestreamService,
};
