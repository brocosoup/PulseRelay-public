const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { getDatabase } = require('../config/database');
const logger = require('../utils/logger');

class TestPatternService {
  constructor() {
    // Singleton pattern - ensure only one instance exists
    if (TestPatternService.instance) {
      return TestPatternService.instance;
    }
    
    this.activePatterns = new Map(); // Track active test patterns
    this.errorStates = new Map(); // Track error states per stream key
    this.defaultSettings = {
      patternType: 'colorbars',
      width: 1280,
      height: 720,
      fps: 30,
      bitrate: 2000,
      audioBitrate: 128,
      codec: 'libx264',
      audioCodec: 'aac',
      text: 'PulseRelay - No Signal',
      backgroundColor: '#1a1a1a',
      textColor: '#ffffff',
      fontPath: this.findSystemFont(),
    };
    
    TestPatternService.instance = this;
  }

  /**
   * Find system font path
   */
  findSystemFont() {
    const possiblePaths = [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/TTF/DejaVuSans.ttf',
      '/System/Library/Fonts/Arial.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    ];

    for (const fontPath of possiblePaths) {
      if (fs.existsSync(fontPath)) {
        return fontPath;
      }
    }

    // Fallback to default font
    return null;
  }

  /**
   * Generate FFmpeg input based on pattern type
   */
  generatePatternInput(settings) {
    const { patternType, width, height, fps, backgroundColor } = settings;

    switch (patternType) {
      case 'colorbars':
        return `smptebars=size=${width}x${height}:rate=${fps}`;
      
      case 'checkerboard':
        return `testsrc=size=${width}x${height}:rate=${fps}`;
      
      case 'gradient':
        return `gradients=size=${width}x${height}:rate=${fps}`;
      
      case 'noise':
        return `testsrc2=size=${width}x${height}:rate=${fps}`;
      
      default:
        // Fallback to solid color
        return `color=${backgroundColor}:size=${width}x${height}:rate=${fps}`;
    }
  }

  /**
   * Get test pattern settings for a stream key
   */
  async getTestPatternSettings(streamKey) {
    try {
      // Validate stream key
      if (!streamKey || streamKey === 'YOUR_STREAM_KEY' || typeof streamKey !== 'string') {
        logger.warn(`Invalid stream key provided to getTestPatternSettings: '${streamKey}', using default settings`);
        return this.defaultSettings;
      }
      
      const db = getDatabase();
      const result = await db.get(
        'SELECT settings FROM test_pattern_settings WHERE stream_key = ?',
        [streamKey]
      );

      if (result) {
        return { ...this.defaultSettings, ...JSON.parse(result.settings) };
      }

      return this.defaultSettings;
    } catch (error) {
      logger.error('Error getting test pattern settings:', error);
      return this.defaultSettings;
    }
  }

  /**
   * Save test pattern settings
   */
  async saveTestPatternSettings(streamKey, settings) {
    try {
      const db = getDatabase();
      await db.run(
        `INSERT OR REPLACE INTO test_pattern_settings (stream_key, settings, updated_at) 
         VALUES (?, ?, CURRENT_TIMESTAMP)`,
        [streamKey, JSON.stringify(settings)]
      );
    } catch (error) {
      logger.error('Error saving test pattern settings:', error);
    }
  }

  /**
   * Generate test pattern using FFmpeg
   */
  async startTestPattern(streamKey) {
    try {
      // Validate stream key
      if (!streamKey || streamKey === 'YOUR_STREAM_KEY' || typeof streamKey !== 'string') {
        logger.warn(`Invalid stream key provided to startTestPattern: '${streamKey}'`);
        return;
      }
      
      // Check if test pattern is already running
      if (this.activePatterns.has(streamKey)) {
        logger.warn(`Test pattern already running for stream key: ${streamKey}`);
        return;
      }

      // Check if test pattern is enabled
      const { getConfig } = require('../config/config');
      const config = getConfig();
      
      if (!config.testPattern?.enabled) {
        logger.info(`Test pattern disabled for stream key: ${streamKey}`);
        return;
      }

      const settings = await this.getTestPatternSettings(streamKey);
      const rtmpUrl = `rtmp://localhost:${config.rtmp.port || 1935}/live/${streamKey}`;

      // Clear any previous error state when starting
      this.clearError(streamKey);

      logger.info(`Starting test pattern for stream key: ${streamKey}`, { patternType: settings.patternType });

      // Generate the appropriate test pattern input based on pattern type
      const patternInput = this.generatePatternInput(settings);

      // Create FFmpeg command
      const command = ffmpeg()
        .input(patternInput)
        .inputFormat('lavfi')
        .input('anullsrc=channel_layout=stereo:sample_rate=44100')
        .inputFormat('lavfi')
        .videoCodec(settings.codec)
        .audioCodec(settings.audioCodec)
        .videoBitrate(settings.bitrate)
        .audioBitrate(settings.audioBitrate)
        .fps(settings.fps)
        .size(`${settings.width}x${settings.height}`)
        .format('flv')
        .output(rtmpUrl);

      // Add text overlay
      if (settings.text) {
        let textFilter = `drawtext=text='${settings.text}':fontcolor=${settings.textColor}:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2`;
        
        if (settings.fontPath) {
          textFilter += `:fontfile=${settings.fontPath}`;
        }

        // Add timestamp
        textFilter += `,drawtext=text='%{localtime}':fontcolor=${settings.textColor}:fontsize=24:x=(w-text_w)/2:y=h-50`;
        
        if (settings.fontPath) {
          textFilter += `:fontfile=${settings.fontPath}`;
        }

        command.videoFilters(textFilter);
      }

      // Error handling
      command.on('error', (err) => {
        // Check if this is a normal termination (SIGTERM or SIGKILL)
        if (err.message && (err.message.includes('received signal 15') || err.message.includes('received signal 9') || err.message.includes('Exiting normally'))) {
          logger.info(`Test pattern terminated normally for ${streamKey}: ${err.message}`);
          this.errorStates.delete(streamKey); // Clear any previous error state
        } else {
          logger.error(`Test pattern error for ${streamKey}:`, err);
          // Store error state for this stream key
          this.errorStates.set(streamKey, {
            error: err.message || 'Unknown FFmpeg error',
            timestamp: new Date().toISOString(),
            type: 'ffmpeg_error'
          });
        }
        
        const pattern = this.activePatterns.get(streamKey);
        if (pattern && pattern.forceKillTimeout) {
          clearTimeout(pattern.forceKillTimeout);
        }
        this.activePatterns.delete(streamKey);
      });

      command.on('start', (commandLine) => {
        logger.info(`Test pattern started for ${streamKey}: ${commandLine}`);
      });

      command.on('end', () => {
        logger.info(`Test pattern ended naturally for ${streamKey}`);
        const pattern = this.activePatterns.get(streamKey);
        if (pattern && pattern.forceKillTimeout) {
          clearTimeout(pattern.forceKillTimeout);
        }
        this.activePatterns.delete(streamKey);
      });

      // Add additional debugging for process signals
      command.on('stderr', (stderrLine) => {
        logger.debug(`Test pattern stderr for ${streamKey}: ${stderrLine}`);
      });

      command.on('stdout', (stdoutLine) => {
        logger.debug(`Test pattern stdout for ${streamKey}: ${stdoutLine}`);
      });

      // Start the command
      command.run();

      // Store the command reference
      this.activePatterns.set(streamKey, {
        command,
        settings,
        startTime: new Date(),
      });

      logger.stream.testPatternStarted(streamKey, settings);

    } catch (error) {
      logger.error(`Failed to start test pattern for ${streamKey}:`, error);
      this.activePatterns.delete(streamKey);
    }
  }

  /**
   * Stop test pattern
   */
  async stopTestPattern(streamKey) {
    try {
      const pattern = this.activePatterns.get(streamKey);
      if (!pattern) {
        logger.debug(`No active test pattern for stream key: ${streamKey}`);
        return;
      }

      logger.info(`Stopping test pattern for stream key: ${streamKey}`);

      // Kill the FFmpeg process with timeout and fallback
      if (pattern.command) {
        try {
          // First attempt: graceful termination
          pattern.command.kill('SIGTERM');
          
          // Set a timeout to force kill if graceful termination fails
          const forceKillTimeout = setTimeout(() => {
            if (this.activePatterns.has(streamKey)) {
              logger.warn(`Force killing test pattern for ${streamKey} - graceful termination failed`);
              try {
                pattern.command.kill('SIGKILL');
              } catch (forceKillError) {
                logger.error(`Failed to force kill test pattern for ${streamKey}:`, forceKillError);
              }
              // Force remove from active patterns
              this.activePatterns.delete(streamKey);
            }
          }, 5000); // 5 second timeout
          
          // Store the timeout reference so we can clear it if the process ends naturally
          pattern.forceKillTimeout = forceKillTimeout;
          
        } catch (killError) {
          logger.error(`Error killing test pattern command for ${streamKey}:`, killError);
          // Force remove from active patterns even if kill failed
          this.activePatterns.delete(streamKey);
        }
      }

      // Remove from active patterns (will be removed again by timeout if needed, but that's ok)
      const removedPattern = this.activePatterns.get(streamKey);
      if (removedPattern && removedPattern.forceKillTimeout) {
        clearTimeout(removedPattern.forceKillTimeout);
      }
      this.activePatterns.delete(streamKey);

      logger.stream.testPatternStopped(streamKey);

    } catch (error) {
      logger.error(`Failed to stop test pattern for ${streamKey}:`, error);
      // Force cleanup on any error
      this.activePatterns.delete(streamKey);
    }
  }

  /**
   * Check if test pattern is running
   */
  isTestPatternRunning(streamKey) {
    return this.activePatterns.has(streamKey);
  }

  /**
   * Get all active test patterns
   */
  getActiveTestPatterns() {
    const patterns = [];
    for (const [streamKey, pattern] of this.activePatterns) {
      patterns.push({
        streamKey,
        settings: pattern.settings,
        startTime: pattern.startTime,
        duration: Date.now() - pattern.startTime.getTime(),
      });
    }
    return patterns;
  }

  /**
   * Stop all test patterns
   */
  async stopAllTestPatterns() {
    logger.info('Stopping all test patterns...');
    
    const promises = [];
    for (const streamKey of this.activePatterns.keys()) {
      promises.push(this.stopTestPattern(streamKey));
    }

    await Promise.all(promises);
    logger.info('All test patterns stopped');
  }

  /**
   * Update test pattern settings
   */
  async updateTestPatternSettings(streamKey, newSettings) {
    try {
      const currentSettings = await this.getTestPatternSettings(streamKey);
      const updatedSettings = { ...currentSettings, ...newSettings };

      // Save updated settings
      await this.saveTestPatternSettings(streamKey, updatedSettings);

      // Restart test pattern if it's currently running
      if (this.isTestPatternRunning(streamKey)) {
        await this.stopTestPattern(streamKey);
        await this.startTestPattern(streamKey);
      }

      logger.info(`Test pattern settings updated for ${streamKey}`);
      return updatedSettings;

    } catch (error) {
      logger.error(`Failed to update test pattern settings for ${streamKey}:`, error);
      throw error;
    }
  }

  /**
   * Generate test pattern thumbnail
   */
  async generateThumbnail(streamKey, outputPath) {
    try {
      const settings = await this.getTestPatternSettings(streamKey);
      const patternInput = this.generatePatternInput(settings);
      
      return new Promise((resolve, reject) => {
        const command = ffmpeg()
          .input(patternInput)
          .inputFormat('lavfi')
          .frames(1)
          .size(`${settings.width}x${settings.height}`)
          .format('image2')
          .output(outputPath);

        // Add text overlay
        if (settings.text) {
          let textFilter = `drawtext=text='${settings.text}':fontcolor=${settings.textColor}:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2`;
          
          if (settings.fontPath) {
            textFilter += `:fontfile=${settings.fontPath}`;
          }

          command.videoFilters(textFilter);
        }

        command.on('error', reject);
        command.on('end', resolve);
        command.run();
      });

    } catch (error) {
      logger.error(`Failed to generate thumbnail for ${streamKey}:`, error);
      throw error;
    }
  }

  /**
   * Get and clear error state for a stream key
   */
  getAndClearError(streamKey) {
    const error = this.errorStates.get(streamKey);
    if (error) {
      this.errorStates.delete(streamKey);
      return error;
    }
    return null;
  }

  /**
   * Check if there's an error for a stream key
   */
  hasError(streamKey) {
    return this.errorStates.has(streamKey);
  }

  /**
   * Clear error state for a stream key
   */
  clearError(streamKey) {
    this.errorStates.delete(streamKey);
  }

  /**
   * Health check for test pattern service
   */
  getHealthStatus() {
    return {
      service: 'test-pattern',
      status: 'healthy',
      activePatterns: this.activePatterns.size,
      patterns: this.getActiveTestPatterns(),
      defaultSettings: this.defaultSettings,
    };
  }
}

// Singleton instance
const testPatternServiceInstance = new TestPatternService();

module.exports = {
  TestPatternService,
  testPatternService: testPatternServiceInstance,
};
