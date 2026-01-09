const NodeMediaServer = require('node-media-server');
const { getDatabase } = require('./database');
const { getConfig } = require('./config');
const logger = require('../utils/logger');
const { testPatternService } = require('../services/testPattern');
const { RestreamService } = require('../services/restream');
const { getTwitchBot } = require('../services/twitchBot');
const { StreamKey } = require('../models/StreamKey');

class RTMPServerConfig {
  constructor() {
    this.sessions = new Map(); // Track active sessions
    this.connectionAttempts = new Map(); // Track connection attempts by IP
    this.testPatternService = testPatternService; // Use singleton instance
    this.restreamService = new RestreamService();
    this.connectionMonitor = null; // For connection monitoring
    
    // Load configuration
    const config = getConfig();
    this.staleConnectionThreshold = config.rtmp.connectionMonitoring?.staleConnectionThreshold || 30000;
    this.monitorInterval = config.rtmp.connectionMonitoring?.monitorInterval || 15000;
    
    // Connection rate limiting configuration
    // Higher limit for streaming use cases - exponential backoff handles spam
    this.maxConnectionsPerIP = config.rtmp.maxConnectionsPerIP || 240;
    this.connectionWindowMs = config.rtmp.connectionWindowMs || 60000; // 1 minute
    
    // NMS stats configuration
    const httpPort = config.server.port || 3000;
    const httpStreamingPort = config.httpStreaming?.port || (httpPort + 1000);
    this.nmsStatsPort = httpPort + 1000; // Correctly calculate stats port
    this.nmsStatsHost = config.server.host || '127.0.0.1';
    
    // Debug logging for production troubleshooting
    logger.info(`RTMP Config Debug - httpPort: ${httpPort}, httpStreamingPort: ${httpStreamingPort}, nmsStatsPort: ${this.nmsStatsPort}, nmsStatsHost: ${this.nmsStatsHost}`);
    
    // Clean up old connection attempts periodically
    setInterval(() => this.cleanupConnectionAttempts(), this.connectionWindowMs);
  }

  getConfig() {
    const config = getConfig();
    const rtmpConfig = config.rtmp;
    
    return {
      rtmp: {
        port: rtmpConfig.port || 1935,
        chunk_size: rtmpConfig.chunkSize || 60000,
        gop_cache: rtmpConfig.gop || true, // Enable GOP cache for HTTP-FLV
        ping: rtmpConfig.ping || 30,
        ping_timeout: rtmpConfig.pingTimeout || 60,
        // Bind to all interfaces to allow external IP connections
        host: config.server.host || '0.0.0.0',
      },
      http: {
        port: config.httpStreaming?.port || ((config.server.port || 3000) + 1000), // HTTP port for FLV streaming
        allow_origin: '*',
        mediaroot: './media',
        // Also bind HTTP interface to all IPs for media playback
        host: config.server.host || '0.0.0.0',
      },
      // Disable built-in authentication since we handle it in event handlers
      auth: {
        play: false,
        publish: false,
      },
      // Set log type: 0 = none, 1 = error, 2 = normal (default), 3 = debug, 4 = ffdebug
      logType: 1, // Only show errors
    };
  }

  createServer() {
    const config = this.getConfig();
    logger.info(`Creating NMS with config: RTMP port ${config.rtmp.port}, HTTP port ${config.http.port}`);
    
    const nms = new NodeMediaServer(config);

    // Set up event handlers
    logger.info('Setting up RTMP event handlers...');
    this.setupEventHandlers(nms);

    // Start connection monitoring
    logger.info('Starting connection monitoring...');
    this.startConnectionMonitoring(nms);

    logger.info('NMS server created successfully');
    return nms;
  }

  setupEventHandlers(nms) {
    logger.info('📡 Setting up RTMP event handlers...');
    
    // Pre-connect handler
    nms.on('preConnect', (id, args) => {
      // Get IP address from the connection - try to get it from NMS session first
      const nmsSession = nms.getSession(id);
      const sessionIp = nmsSession?.socket?.remoteAddress || args.ip || 'unknown';
      
      // Don't rate limit here - we don't know if it's a publisher or viewer yet
      // Publishers should NEVER be rate limited
      // Rate limiting is handled in prePlay for viewers only
      
      logger.rtmp.connect(id, args.streamKey || 'unknown', sessionIp);
    });

    // Post-connect handler
    nms.on('postConnect', (id, args) => {
      logger.debug(`📡 postConnect event for session ${id}`);
      // Get the actual session from NodeMediaServer to access peer info
      const nmsSession = nms.getSession(id);
      // Try multiple methods to extract IP - socket.remoteAddress is most reliable
      const sessionIp = nmsSession?.socket?.remoteAddress || 
                       nmsSession?.ip || 
                       nmsSession?.peer?.address || 
                       args.ip || 
                       'unknown';
      
      this.sessions.set(id, {
        id,
        streamKey: args.streamKey,
        ip: sessionIp,
        connectTime: new Date(),
        lastActivity: new Date(), // Track last activity
        isPublisher: false,
        isPlayer: false,
      });
      
      // Add socket event listeners to detect abrupt disconnections
      if (nmsSession?.socket) {
        // Set socket timeout to detect dead connections (90 seconds)
        nmsSession.socket.setTimeout(90000);
        
        // Listen for socket close event
        nmsSession.socket.once('close', () => {
          logger.debug(`Socket closed for session ${id}`);
          // Clean up session if it still exists
          const session = this.sessions.get(id);
          if (session) {
            logger.debug(`Cleaning up session ${id} due to socket close`);
            this.endSessionRecord(id).catch(err => logger.error('Error ending session on socket close:', err));
            this.sessions.delete(id);
          }
        });
        
        // Listen for socket error event
        nmsSession.socket.once('error', (err) => {
          logger.warn(`Socket error for session ${id}:`, err.message);
        });
        
        // Listen for socket timeout
        nmsSession.socket.once('timeout', () => {
          logger.warn(`Socket timeout for session ${id}`);
          const session = this.sessions.get(id);
          if (session) {
            logger.info(`Force disconnecting timed out session ${id}`);
            try {
              nmsSession.socket.destroy();
            } catch (e) {
              logger.error('Error destroying timed out socket:', e);
            }
          }
        });
      }
      
      logger.debug(`📡 Session ${id} added to tracking from IP ${sessionIp}`);
    });

    // Pre-publish handler - Authentication
    nms.on('prePublish', async (id, streamPath, args) => {
      logger.debug(`📢 prePublish triggered for session ${id}, streamPath: ${streamPath}`);
      const streamKey = this.extractStreamKey(streamPath);
      
      if (!streamKey) {
        logger.rtmp.error(id, 'unknown', new Error('No stream key provided'));
        return this.rejectConnection(nms, id);
      }

      try {
        // Verify stream key
        logger.debug(`🔑 Verifying stream key for session ${id}: ${streamKey?.substring(0,8)}...`);
        const isValid = await this.verifyStreamKey(streamKey);
        if (!isValid) {
          logger.rtmp.error(id, streamKey, new Error('Invalid stream key'));
          return this.rejectConnection(nms, id);
        }

        logger.debug(`✅ Stream key verified for session ${id}`);

        // Clean up any old database publisher sessions for this stream key first
        try {
          const { getDatabase } = require('./database');
          const db = getDatabase();
          await db.run(
            'UPDATE stream_sessions SET is_active = 0, ended_at = CURRENT_TIMESTAMP WHERE stream_key = ? AND is_publisher = 1 AND is_active = 1',
            [streamKey]
          );
          logger.debug(`🧹 Cleaned up old publisher sessions for stream ${streamKey}`);
        } catch (dbError) {
          logger.error('Database cleanup error:', dbError);
        }

        // Check if there's already an active publisher for this stream
        const existingPublisher = this.hasActivePublisher(streamKey);
        if (existingPublisher) {
          // Get IP address for logging
          const nmsSession = nms.getSession(id);
          const sessionIp = nmsSession?.ip || nmsSession?.peer?.address || args.ip || 'unknown';
          
          logger.info(`🔄 TAKEOVER INITIATED: New publisher ${id} from ${sessionIp} taking over stream ${streamKey}`);
          // Kill all existing sessions (publishers and subscribers) for this stream
          await this.killAllSessionsForStream(nms, streamKey, id);
          logger.info(`✅ TAKEOVER COMPLETE: Stream ${streamKey} is now controlled by publisher ${id}`);
        }

        // Update session (create if it doesn't exist)
        let session = this.sessions.get(id);
        if (!session) {
          // Create session if it doesn't exist (timing issue with postConnect)
          // Get the actual session from NodeMediaServer to access peer info
          const nmsSession = nms.getSession(id);
          const sessionIp = nmsSession?.ip || nmsSession?.peer?.address || args.ip || 'unknown';
          
          session = {
            id,
            streamKey: streamKey,
            ip: sessionIp,
            connectTime: new Date(),
            lastActivity: new Date(),
            isPublisher: false,
            isPlayer: false,
          };
          logger.info(`Created missing session for ${id} in prePublish handler`);
        }
        
        // Update session with publisher info
        session.streamKey = streamKey;
        session.isPublisher = true;
        session.lastActivity = new Date(); // Update activity time
        session.dataPackets = 0; // Track data packets
        session.lastDataPacket = new Date(); // Track last data packet
        this.sessions.set(id, session);
        
        // Create database record for the session (only if not already created)
        if (!session.dbRecordCreated) {
          await this.createSessionRecord(id, streamKey, session.ip);
          session.dbRecordCreated = true; // Mark as created to prevent duplicates
        }

        logger.rtmp.publish(id, streamKey, session.ip);
        logger.debug(`🎥 NEW PUBLISHER: ${id} (${streamKey?.substring(0,8)}...) from ${session.ip} - bitrate monitoring started`);
        
        // Clear viewer retry tracking AND rate limiting for this stream so viewers can reconnect immediately
        if (this.viewerRetryTracking) {
          let clearedCount = 0;
          const clearedIPs = new Set(); // Track IPs to clear from rate limiting
          
          for (const [key, info] of this.viewerRetryTracking.entries()) {
            if (key.endsWith(`-${streamKey}`)) {
              // Extract IP from the key format: "ip-streamKey"
              const ip = key.substring(0, key.lastIndexOf('-'));
              clearedIPs.add(ip);
              this.viewerRetryTracking.delete(key);
              clearedCount++;
            }
          }
          
          // Clear rate limiting counters for IPs that were waiting for this stream
          for (const ip of clearedIPs) {
            this.connectionAttempts.delete(ip);
          }
          
          if (clearedCount > 0) {
            logger.debug(`Cleared retry backoff and rate limiting for ${clearedCount} viewer(s) waiting for stream ${streamKey?.substring(0,8)}...`);
          }
        }
        
        // Stop test pattern if running, but only if this is NOT the test pattern itself
        // Test pattern connects from localhost, external publishers from other IPs
        const isTestPattern = session.ip === '127.0.0.1' || 
                             session.ip === '::ffff:127.0.0.1' || 
                             session.ip === '::1' || 
                             session.ip === 'localhost';
        
        if (!isTestPattern) {
          logger.debug(`External publisher detected from ${session.ip}, stopping test pattern`);
          await this.testPatternService.stopTestPattern(streamKey);
        } else {
          logger.info(`Test pattern publisher detected from ${session.ip}, keeping test pattern running`);
        }
        
      } catch (error) {
        logger.rtmp.error(id, streamKey, error);
        return this.rejectConnection(nms, id);
      }
    });

    // Post-publish handler
    nms.on('postPublish', async (id, streamPath, args) => {
      const streamKey = this.extractStreamKey(streamPath);
      
      // Give prePublish handler time to complete (race condition fix)
      // Wait up to 1 second for the session to be properly set up
      let session = this.sessions.get(id);
      let attempts = 0;
      const maxAttempts = 10; // 1 second total wait (100ms * 10)
      
      while ((!session || !session.isPublisher) && attempts < maxAttempts) {
        logger.debug(`Waiting for session ${id} to be set up as publisher (attempt ${attempts + 1}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms
        session = this.sessions.get(id);
        attempts++;
      }
      
      // Verify this is a valid, active session before processing
      if (!session || !session.isPublisher) {
        logger.warn(`Ignoring postPublish for invalid session ${id} after ${attempts} attempts`);
        return;
      }
      
      // Log the postPublish event
      logger.debug(`postPublish event for session ${id} (${streamKey})`);
      
      // Initialize session data structures for real-time tracking
      session.dataFlowHistory = [];
      session.bitrateHistory = [];
      session.lastBytesRead = 0;
      session.lastInBytes = 0;
      this.sessions.set(id, session);
      
      // Log all available metadata for debugging (but don't use for calculation)
      if (args) {
        logger.debug(`Stream metadata for ${id}:`, JSON.stringify(args, null, 2));
      }
      
      try {
        // Save stream settings for test pattern fallback
        await this.saveStreamSettings(streamKey, args);
        
        // Send connect message to Twitch chat if configured
        logger.debug(`🔔 Publisher connected (postPublish) - sending connect message for stream key: ${streamKey?.substring(0,8)}...`);
        await this.sendConnectMessage(streamKey);
        
        // Start restreaming to external destinations
        await this.restreamService.startRestream(streamKey, streamPath);
        
        // Log stream start
        logger.stream.started(streamKey, args);
        
      } catch (error) {
        logger.rtmp.error(id, streamKey, error);
      }
    });

    // Add data packet tracking handler
    nms.on('postPlay', async (id, streamPath, args) => {
      const streamKey = this.extractStreamKey(streamPath);
      
      // Give prePlay handler time to complete (race condition fix)
      // Wait up to 1 second for the session to be properly set up
      let session = this.sessions.get(id);
      let attempts = 0;
      const maxAttempts = 10; // 1 second total wait (100ms * 10)
      
      while ((!session || !session.isPlayer) && attempts < maxAttempts) {
        logger.debug(`Waiting for session ${id} to be set up as player (attempt ${attempts + 1}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms
        session = this.sessions.get(id);
        attempts++;
      }
      
      // Verify this is a valid, active session before processing
      if (!session || !session.isPlayer) {
        logger.warn(`Ignoring postPlay for invalid session ${id} after ${attempts} attempts`);
        return;
      }
      
      // Log the postPlay event
      logger.debug(`postPlay event for session ${id} (${streamKey})`);
      
      // Update session activity for viewer
      this.updateSessionDataActivity(id, args.length || 512); // Default to 512 bytes for viewers
    });

    // Pre-play handler - Authentication
    nms.on('prePlay', async (id, streamPath, args) => {
      const streamKey = this.extractStreamKey(streamPath);
      
      if (!streamKey) {
        logger.rtmp.error(id, 'unknown', new Error('No stream key provided'));
        return this.rejectConnection(nms, id);
      }

      // Rate limiting for VIEWERS only (publishers are never rate limited)
      const nmsSession = nms.getSession(id);
      const sessionIp = nmsSession?.socket?.remoteAddress || nmsSession?.ip || args.ip || 'unknown';
      
      // Record this viewer connection attempt
      this.recordConnectionAttempt(sessionIp);
      
      // Check if this viewer IP is rate limited
      if (this.isRateLimited(sessionIp)) {
        logger.warn(`🚫 Rate limited viewer connection from ${sessionIp} - session ${id} rejected`);
        return this.rejectConnection(nms, id);
      }

      try {
        // Verify stream key
        const isValid = await this.verifyStreamKey(streamKey);
        if (!isValid) {
          logger.rtmp.error(id, streamKey, new Error('Invalid stream key'));
          return this.rejectConnection(nms, id);
        }

        // Check if there's an active publisher for this stream
        const hasActivePublisher = this.hasActivePublisher(streamKey);
        if (!hasActivePublisher) {
          // Get session IP for better logging
          const nmsSession = nms.getSession(id);
          const sessionIp = nmsSession?.socket?.remoteAddress || nmsSession?.ip || args.ip || 'unknown';
          
          logger.debug(`Viewer attempt from ${sessionIp} rejected - no active publisher for stream ${streamKey?.substring(0,8)}...`);
          
          // Track failed viewer attempts per IP to implement exponential backoff
          if (!this.viewerRetryTracking) {
            this.viewerRetryTracking = new Map();
          }
          
          const retryKey = `${sessionIp}-${streamKey}`;
          const retryInfo = this.viewerRetryTracking.get(retryKey) || { count: 0, lastAttempt: 0 };
          const now = Date.now();
          
          // Exponential backoff: require waiting longer between retries
          // For streaming: 0s, 1s, 2s, 4s, 5s max (much faster than 60s for live use)
          const minWaitMs = Math.min(1000 * Math.pow(2, retryInfo.count), 5000); // Max 5s
          const timeSinceLastAttempt = now - retryInfo.lastAttempt;
          
          if (timeSinceLastAttempt < minWaitMs) {
            // Still in backoff period - don't log error, just silently reject
            return this.rejectConnection(nms, id);
          }
          
          // Update retry tracking
          this.viewerRetryTracking.set(retryKey, {
            count: retryInfo.count + 1,
            lastAttempt: now
          });
          
          // Cleanup old retry tracking entries (older than 5 minutes)
          for (const [key, info] of this.viewerRetryTracking.entries()) {
            if (now - info.lastAttempt > 300000) {
              this.viewerRetryTracking.delete(key);
            }
          }
          
          logger.rtmp.error(id, streamKey, new Error('No active stream available for playback'));
          return this.rejectConnection(nms, id);
        }
        
        // Clear retry tracking for this viewer if stream is now available
        if (this.viewerRetryTracking) {
          const nmsSession = nms.getSession(id);
          const sessionIp = nmsSession?.socket?.remoteAddress || nmsSession?.ip || args.ip || 'unknown';
          const retryKey = `${sessionIp}-${streamKey}`;
          this.viewerRetryTracking.delete(retryKey);
        }

        // Update session (create if it doesn't exist)
        let session = this.sessions.get(id);
        if (!session) {
          // Create session if it doesn't exist (timing issue with postConnect)
          const nmsSession = nms.getSession(id);
          const sessionIp = nmsSession?.ip || nmsSession?.peer?.address || args.ip || 'unknown';
          
          session = {
            id,
            streamKey: streamKey,
            ip: sessionIp,
            connectTime: new Date(),
            lastActivity: new Date(),
            isPublisher: false,
            isPlayer: false,
          };
          logger.info(`Created missing session for ${id} in prePlay handler`);
        }
        
        // Update session with player info
        session.streamKey = streamKey;
        session.isPlayer = true;
        session.lastActivity = new Date();
        session.dataPackets = 0; // Track data packets
        session.lastDataPacket = new Date(); // Track last data packet
        this.sessions.set(id, session);
        
        // Create database record for the viewer session
        await this.createSessionRecord(id, streamKey, session.ip, false);

        logger.rtmp.play(id, streamKey, session.ip);
        
      } catch (error) {
        logger.rtmp.error(id, streamKey, error);
        return this.rejectConnection(nms, id);
      }
    });

    // Done-publish handler
    nms.on('donePublish', async (id, streamPath, args) => {
      const streamKey = this.extractStreamKey(streamPath);
      
      // Get the session data
      const session = this.sessions.get(id);
      if (!session) {
        logger.warn(`No session found for donePublish ${id}`);
        return;
      }
      
      // Only process if this was a valid publisher session
      if (!session.isPublisher) {
        logger.warn(`Ignoring donePublish for non-publisher session ${id}`);
        return;
      }
      
      try {
        // Validate stream key before proceeding
        if (!streamKey || streamKey === 'YOUR_STREAM_KEY') {
          logger.warn(`Invalid stream key '${streamKey}' in donePublish handler, skipping test pattern start`);
          return;
        }
        
        // Verify stream key exists in database
        const isValidStreamKey = await this.verifyStreamKey(streamKey);
        if (!isValidStreamKey) {
          logger.warn(`Stream key '${streamKey}' not found in database, skipping test pattern start`);
          return;
        }
        
        // Stop restreaming
        await this.restreamService.stopRestream(streamKey);
        
        // Send disconnect message to Twitch chat if configured
        logger.debug(`🔔 Publisher stopped (donePublish) - sending disconnect message for stream key: ${streamKey?.substring(0,8)}...`);
        await this.sendDisconnectMessage(streamKey, 'stream stopped');
        
        // Disconnect all viewers for this stream since publisher is gone
        await this.disconnectAllViewersForStream(nms, streamKey, id);
        
        // Note: Test pattern is now manually controlled only
        // No automatic fallback when publisher disconnects
        
        // End database session record
        await this.endSessionRecord(id);
        
        // Remove session from active sessions
        this.sessions.delete(id);
        
        // Log final bitrate statistics
        const finalAverageBitrate = this.calculateAverageBitrate(session);
        const finalPeakBitrate = this.calculatePeakBitrate(session);
        const sessionDuration = Math.round((Date.now() - session.connectTime) / 1000);
        
        if (finalAverageBitrate > 0) {
          logger.debug(`📊 PUBLISHER FINAL STATS ${id} (${streamKey?.substring(0,8)}...):`);
          logger.debug(`   Duration: ${sessionDuration}s | Average: ${this.formatBitrate(finalAverageBitrate)} | Peak: ${this.formatBitrate(finalPeakBitrate)}`);
        }
        
        // Log stream stop
        logger.stream.stopped(streamKey, 'publisher_disconnected');
        
      } catch (error) {
        logger.rtmp.error(id, streamKey, error);
      }
    });

    // Done-play handler
    nms.on('donePlay', async (id, streamPath, args) => {
      const streamKey = this.extractStreamKey(streamPath);
      
      // Get the session data
      const session = this.sessions.get(id);
      if (!session) {
        logger.warn(`No session found for donePlay ${id}`);
        return;
      }
      
      // Only process if this was a valid player session
      if (!session.isPlayer) {
        logger.debug(`Ignoring donePlay for non-player session ${id}`);
        return;
      }
      
      try {
        // End database session record
        await this.endSessionRecord(id);
        
        // Remove session from active sessions
        this.sessions.delete(id);
        
        // Log viewer disconnect
        logger.rtmp.disconnect(id, streamKey, 'viewer_disconnected');
        
      } catch (error) {
        logger.rtmp.error(id, streamKey, error);
      }
    });

    // Post-disconnect handler
    nms.on('postDisconnect', async (id, args) => {
      logger.info(`📡 postDisconnect event for session ${id}`);
      const session = this.sessions.get(id);
      if (session) {
        logger.info(`📡 Found session ${id} for disconnect: ${session.isPublisher ? 'publisher' : session.isPlayer ? 'player' : 'unknown'}`);
        logger.rtmp.disconnect(id, session.streamKey, 'client_disconnected');
        
        // End database session record
        await this.endSessionRecord(id);
        
        this.sessions.delete(id);
        logger.info(`📡 Session ${id} removed from tracking`);
      } else {
        logger.info(`📡 No session found for disconnect ${id}`);
      }
    });

    // Error handler
    nms.on('error', (error) => {
      logger.error('RTMP Server Error:', error);
    });

    // NodeMediaServer v2.7.4 doesn't provide continuous data events
    // Instead, we'll use a different approach to track active streams
    
    // Start periodic activity monitoring for active sessions
    this.startActiveSessionMonitoring(nms);

    // In your preClose event handler
    nms.on('preClose', (id, args) => {
      const session = this.sessions.get(id);
      if (session) {
        logger.info(`Session closing: ${id}, removing from sessions map`);
        this.sessions.delete(id);
      }
    });
  }

  startActiveSessionMonitoring(nms) {
    logger.info('📊 Starting active session monitoring (5-second intervals)');
    // Monitor active sessions every 5 seconds using real NMS stats
    this.activeSessionMonitor = setInterval(async () => {
      let activePublishers = 0;
      let activeViewers = 0;
      
      logger.debug(`📊 Monitoring ${this.sessions.size} tracked sessions`);
      
      for (const [sessionId, session] of this.sessions.entries()) {
        if (session.isPublisher) {
          logger.debug(`📊 Checking publisher session ${sessionId}`);
          // Check if the NodeMediaServer session is still active
          const nmsSession = nms.getSession(sessionId);
          if (nmsSession && this.isNMSSessionActive(nmsSession)) {
            // Get real bitrate from NMS stats API
            const realBitrate = await this.getRealBitrateFromNMS(sessionId);
            
            // Always update activity when session is active, regardless of bitrate
            const now = new Date();
            session.lastActivity = now;
            session.lastDataPacket = now;
            
            if (realBitrate > 0) {
              // Initialize bitrate tracking if not exists
              if (!session.bitrateHistory) {
                session.bitrateHistory = [];
                session.startTime = session.startTime || now;
              }
              
              // Store real bitrate from NMS
              session.bitrateHistory.push({ timestamp: now, bitrate: realBitrate });
              session.lastCalculatedBitrate = realBitrate;
              
              // Keep only last 60 measurements (5 minutes with 5s intervals)
              if (session.bitrateHistory.length > 60) {
                session.bitrateHistory.shift();
              }
            }
            
            this.sessions.set(sessionId, session);
            activePublishers++;
            
            // Log bitrate information every 30 seconds (every 6th check)
            if (!session.lastBitrateLog || (Date.now() - session.lastBitrateLog) > 30000) {
              const currentBitrate = realBitrate || 0;
              const averageBitrate = this.calculateAverageBitrate(session);
              const connectionAge = Math.round((Date.now() - session.connectTime) / 1000);
              
              if (currentBitrate > 0 || averageBitrate > 0) {
                logger.debug(`📊 PUBLISHER ${sessionId} (${session.streamKey?.substring(0,8)}...) from ${session.ip}:`);
                logger.debug(`   Current: ${this.formatBitrate(currentBitrate)} | Average: ${this.formatBitrate(averageBitrate)} | Age: ${connectionAge}s [NMS Stats]`);
              } else {
                logger.debug(`📊 PUBLISHER ${sessionId} (${session.streamKey?.substring(0,8)}...) from ${session.ip}: Connected, waiting for stream data`);
              }
              
              session.lastBitrateLog = Date.now();
              this.sessions.set(sessionId, session);
            }
          } else {
            // NMS session is not active or doesn't exist - publisher has disconnected
            logger.warn(`Publisher session ${sessionId} detected as inactive (socket closed/destroyed)`);
            
            // Trigger immediate cleanup
            const timeSinceConnect = (Date.now() - session.connectTime.getTime()) / 1000;
            logger.info(`Cleaning up inactive publisher session ${sessionId} (${session.streamKey?.substring(0,8)}..., connected for ${Math.round(timeSinceConnect)}s)`);
            
            try {
              // Stop restreaming
              if (session.streamKey) {
                await this.restreamService.stopRestream(session.streamKey);
                await this.sendDisconnectMessage(session.streamKey, 'connection lost');
              }
              
              // End database session
              await this.endSessionRecord(sessionId);
              
              // Remove from tracking
              this.sessions.delete(sessionId);
              
              logger.stream.stopped(session.streamKey, 'publisher_socket_closed');
            } catch (cleanupError) {
              logger.error(`Error during inactive publisher cleanup for ${sessionId}:`, cleanupError);
            }
          }
        } else if (session.isPlayer) {
          // Check if the viewer session is still active
          const nmsSession = nms.getSession(sessionId);
          if (nmsSession && this.isNMSSessionActive(nmsSession)) {
            // Update viewer activity
            session.lastActivity = new Date();
            this.sessions.set(sessionId, session);
            activeViewers++;
          }
        }
      }
      
      // Log summary every minute (every 12th check)
      if (!this.lastSummaryLog || (Date.now() - this.lastSummaryLog) > 60000) {
        if (activePublishers > 0 || activeViewers > 0) {
          logger.debug(`📈 ACTIVE STREAMS: ${activePublishers} publishers, ${activeViewers} viewers`);
          this.lastSummaryLog = Date.now();
        }
      }
    }, 5000); // Check every 5 seconds
    
    logger.info(`Active session monitoring started using NMS Stats API at http://${this.nmsStatsHost}:${this.nmsStatsPort}/api/streams`);
  }

  isNMSSessionActive(nmsSession) {
    // Check various indicators that the NodeMediaServer session is actively streaming
    if (!nmsSession) return false;
    
    // Check socket state - most reliable indicator
    if (!nmsSession.socket) return false;
    
    // Check if socket is destroyed
    if (nmsSession.socket.destroyed) {
      return false;
    }
    
    // Check readyState - can be 'open', 'readOnly', 'writeOnly', or undefined
    const readyState = nmsSession.socket.readyState;
    if (readyState === 'readOnly' || readyState === 'writeOnly') {
      // Half-closed connection - client or server closing
      return false;
    }
    
    // Check if socket is readable AND writable (not ended)
    if (!nmsSession.socket.readable || !nmsSession.socket.writable) {
      return false;
    }
    
    // For publishers, check if they are actively publishing
    if (nmsSession.isPublishing === true) {
      return true;
    }
    
    // For viewers, check if they are actively playing
    if (nmsSession.isPlaying === true) {
      return true;
    }
    
    // Check if session is actively connected (fallback)
    if (nmsSession.isConnected === true) {
      return true;
    }
    
    // Check if session is in "started" state (NodeMediaServer specific)
    if (nmsSession.isStarted === true) {
      return true;
    }
    
    // If no clear active state is found, return false
    return false;
  }

  // Method to fetch real statistics from NodeMediaServer stats API
  async fetchNMSStats() {
    try {
      const http = require('http');
      const statsUrl = `http://${this.nmsStatsHost}:${this.nmsStatsPort}/api/streams`;
      logger.debug(`📊 Fetching NMS stats from ${statsUrl}`);
      
      return new Promise((resolve, reject) => {
        const req = http.get(statsUrl, (res) => {
          let data = '';
          
          res.on('data', (chunk) => {
            data += chunk;
          });
          
          res.on('end', () => {
            try {
              const stats = JSON.parse(data);
              logger.debug(`📊 NMS stats response:`, stats);
              resolve(stats);
            } catch (parseError) {
              logger.warn(`Error parsing NMS stats JSON from ${statsUrl}:`, parseError);
              resolve(null);
            }
          });
        });
        
        req.on('error', (error) => {
          logger.warn(`Error fetching NMS stats from ${statsUrl}:`, error.message);
          resolve(null);
        });
        
        req.setTimeout(5000, () => {
          req.abort();
          logger.warn(`NMS stats request timeout for ${statsUrl}`);
          resolve(null);
        });
      });
    } catch (error) {
      logger.warn('Error in fetchNMSStats:', error);
      return null;
    }
  }

  // Method to get real bitrate from NMS stats for a specific session
  async getRealBitrateFromNMS(sessionId) {
    try {
      const stats = await this.fetchNMSStats();
      if (!stats || !stats.live) {
        return 0;
      }
      
      // Get our tracked session
      const session = this.sessions.get(sessionId);
      if (!session) {
        return 0;
      }
      
      // Find the stream data by stream key since clientId might be different
      let streamData = null;
      for (const [streamKey, data] of Object.entries(stats.live)) {
        if (streamKey === session.streamKey && data.publisher) {
          streamData = data;
          break;
        }
      }
      
      if (streamData && streamData.publisher) {
        const pub = streamData.publisher;
        const currentTime = Date.now();
        const currentBytes = pub.bytes || 0;
        
        // Initialize tracking if first time
        if (!session.lastBytesCheck) {
          session.lastBytesCheck = {
            bytes: currentBytes,
            timestamp: currentTime
          };
          return 0; // First measurement, return 0
        }
        
        // Calculate bitrate from bytes difference over time interval (not cumulative)
        const timeDiff = currentTime - session.lastBytesCheck.timestamp;
        const bytesDiff = currentBytes - session.lastBytesCheck.bytes;
        
        if (timeDiff >= 2000 && bytesDiff > 0) { // At least 2 seconds difference for stability
          // Calculate instantaneous bits per second based on this interval
          const bitsPerSecond = (bytesDiff * 8) / (timeDiff / 1000);
          
          // Update tracking for next calculation
          session.lastBytesCheck = {
            bytes: currentBytes,
            timestamp: currentTime
          };
          
          return Math.round(bitsPerSecond);
        } else if (timeDiff > 0) {
          // Update timestamp and bytes for next calculation, but don't calculate yet
          session.lastBytesCheck = {
            bytes: currentBytes,
            timestamp: currentTime
          };
        }
      }
      
      return 0;
    } catch (error) {
      logger.warn('Error getting real bitrate from NMS:', error);
      return 0;
    }
  }

  stopActiveSessionMonitoring() {
    if (this.activeSessionMonitor) {
      clearInterval(this.activeSessionMonitor);
      this.activeSessionMonitor = null;
      logger.info('Active session monitoring stopped');
    }
  }

  startConnectionMonitoring(nms) {
    const config = getConfig();
    
    // Only start monitoring if enabled in config
    if (!config.rtmp.connectionMonitoring?.enabled) {
      logger.info('Connection monitoring disabled in configuration');
      return;
    }
    
    // Monitor connections at configured interval using enhanced quality monitoring
    this.connectionMonitor = setInterval(async () => {
      await this.monitorConnectionsWithQuality();
    }, this.monitorInterval); // Use configured interval (default: 20 seconds)
    
    logger.info(`Enhanced connection monitoring with quality assessment started (threshold: ${this.staleConnectionThreshold}ms, interval: ${this.monitorInterval}ms)`);
  }

  async handleStalePublisherDisconnect(sessionId, session) {
    try {
        logger.info(`Cleaning up stale publisher session: ${sessionId}`);
        
        const streamKey = session.streamKey;
      
        // Stop restreaming
        await this.restreamService.stopRestream(streamKey);
        
        // End database session record
        await this.endSessionRecord(sessionId);
        
        // Add this before and after deletion
        logger.debug(`Sessions before delete: ${this.sessions.size}`);
        this.sessions.delete(sessionId);
        logger.debug(`Sessions after delete: ${this.sessions.size}, deleted: ${!this.sessions.has(sessionId)}`);
        
        // Log the forced disconnection
        logger.stream.stopped(streamKey, 'stale_connection_detected');
        logger.rtmp.disconnect(sessionId, streamKey, 'stale_connection_forced');
        
      } catch (error) {
        logger.error('Error handling stale publisher disconnect:', error);
      }
  }

  stopConnectionMonitoring() {
    if (this.connectionMonitor) {
      clearInterval(this.connectionMonitor);
      this.connectionMonitor = null;
    }
  }

  updateSessionActivity(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
      session.lastDataPacket = new Date();
      session.dataPackets = (session.dataPackets || 0) + 1;
      this.sessions.set(sessionId, session);
    }
  }

  // New method to update activity based on actual data flow
  updateSessionDataActivity(sessionId, bytesReceived = 0) {
    const session = this.sessions.get(sessionId);
    if (session) {
      const now = new Date();
      session.lastDataPacket = now;
      session.lastActivity = now;
      session.dataPackets = (session.dataPackets || 0) + 1;
      session.bytesReceived = (session.bytesReceived || 0) + bytesReceived;
      
      // Track data flow rate for better activity detection
      if (!session.dataFlowHistory) {
        session.dataFlowHistory = [];
      }
      
      // Keep last 30 data points for better bitrate calculation (2.5 minutes with 5s intervals)
      session.dataFlowHistory.push({ timestamp: now, bytes: bytesReceived });
      if (session.dataFlowHistory.length > 30) {
        session.dataFlowHistory.shift();
      }
      
      // Initialize bitrate tracking if not exists
      if (!session.bitrateHistory) {
        session.bitrateHistory = [];
        session.startTime = session.startTime || now;
      }
      
      // Calculate current bitrate (bits per second)
      const currentBitrate = this.calculateCurrentBitrate(session);
      if (currentBitrate > 0) {
        session.bitrateHistory.push({ timestamp: now, bitrate: currentBitrate });
        // Keep only last 60 measurements (5 minutes with 5s intervals)
        if (session.bitrateHistory.length > 60) {
          session.bitrateHistory.shift();
        }
      }
      
      this.sessions.set(sessionId, session);
    } else {
      // Attempted to update activity for non-existent session
    }
  }

  // Add a method to calculate data flow rate for better activity detection
  calculateDataFlowRate(session) {
    if (!session.dataFlowHistory || session.dataFlowHistory.length < 2) {
      return 0;
    }
    
    const now = new Date();
    const recent = session.dataFlowHistory.filter(entry => 
      now - entry.timestamp < 30000 // Last 30 seconds
    );
    
    if (recent.length < 2) {
      return 0;
    }
    
    const totalBytes = recent.reduce((sum, entry) => sum + entry.bytes, 0);
    const timeSpan = (recent[recent.length - 1].timestamp - recent[0].timestamp) / 1000;
    
    return timeSpan > 0 ? totalBytes / timeSpan : 0; // bytes per second
  }

  // Calculate current bitrate using real NMS data
  calculateCurrentBitrate(session) {
    // Return the last real bitrate from NMS stats
    return session.lastCalculatedBitrate || 0;
  }

  // Calculate average bitrate over the session lifetime
  calculateAverageBitrate(session) {
    if (!session.bitrateHistory || session.bitrateHistory.length === 0) {
      return 0;
    }
    
    // Calculate average from bitrate history
    const totalBitrate = session.bitrateHistory.reduce((sum, entry) => sum + entry.bitrate, 0);
    return totalBitrate / session.bitrateHistory.length;
  }

  // Calculate peak bitrate
  calculatePeakBitrate(session) {
    if (!session.bitrateHistory || session.bitrateHistory.length === 0) {
      return 0;
    }
    
    return Math.max(...session.bitrateHistory.map(entry => entry.bitrate));
  }

  // Format bitrate for display
  formatBitrate(bitrate) {
    if (bitrate < 1000) {
      return `${Math.round(bitrate)} bps`;
    } else if (bitrate < 1000000) {
      return `${Math.round(bitrate / 1000)} kbps`;
    } else {
      return `${Math.round(bitrate / 1000000)} Mbps`;
    }
  }

  // Enhanced activity detection based on NMS session state and activity
  isSessionActivelyStreaming(session) {
    const now = new Date();
    const timeSinceLastData = now - (session.lastDataPacket || session.lastActivity);
    
    // Much more lenient timing since we're using NMS stats API now
    if (timeSinceLastData > 120000) { // 2 minutes without any activity
      return false;
    }
    
    if (session.isPublisher) {
      // For publishers, if we've updated activity recently, consider them active
      if (timeSinceLastData < 30000) { // Within 30 seconds
        return true;
      }
      
      // Check if we have recent bitrate data
      if (session.bitrateHistory && session.bitrateHistory.length > 0) {
        const lastBitrateEntry = session.bitrateHistory[session.bitrateHistory.length - 1];
        const timeSinceLastBitrate = now - lastBitrateEntry.timestamp;
        if (timeSinceLastBitrate < 60000) { // Bitrate data within last minute
          return true;
        }
      }
      
      // If we have any recent activity, consider active
      return timeSinceLastData < 60000; // 1 minute for publishers
    } else {
      // Viewers just need to be connected and receiving data
      return timeSinceLastData < 90000; // 1.5 minutes for viewers
    }
  }

  // Add a method to update activity for all active publishers
  updateActivePublishersActivity() {
    let updatedCount = 0;
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.isPublisher) {
        // Only update if the session is relatively recent to avoid keeping truly stale connections alive
        const timeSinceConnect = now - session.connectTime;
        if (timeSinceConnect < (this.staleConnectionThreshold * 3)) { // 3 minutes max
          session.lastActivity = now;
          this.sessions.set(sessionId, session);
          updatedCount++;
        }
      }
    }
    
    if (updatedCount > 0) {
      logger.debug(`Updated activity for ${updatedCount} active publisher(s)`);
    }
  }

  // Add a method to update activity for all active viewers
  updateActiveViewersActivity() {
    const now = new Date();
    let updatedCount = 0;
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.isPlayer) {
        // Only update if the session is relatively recent to avoid keeping truly stale connections alive
        const timeSinceConnect = now - session.connectTime;
        if (timeSinceConnect < (this.staleConnectionThreshold * 3)) { // 3 minutes max
          session.lastActivity = now;
          this.sessions.set(sessionId, session);
          updatedCount++;
        }
      }
    }
    
    if (updatedCount > 0) {
      logger.debug(`Updated activity for ${updatedCount} active viewer(s)`);
    }
  }

  // Enhanced bitrate quality monitoring with automatic disconnection
  assessStreamQuality(session) {
    if (!session.isPublisher || !session.bitrateHistory || session.bitrateHistory.length === 0) {
      return {
        status: 'unknown',
        action: 'none',
        message: 'No bitrate data available'
      };
    }

    const config = getConfig();
    const qualityConfig = config.rtmp.qualityMonitoring || {};
    
    // Use configurable thresholds with fallbacks
    const CRITICAL_LOW = qualityConfig.criticalLowBitrate || 500000;      // 0.5 Mbps
    const POOR_QUALITY = qualityConfig.poorQualityBitrate || 1000000;     // 1 Mbps
    const TARGET_MIN = qualityConfig.productionTargetMin || 3000000;      // 3 Mbps
    const TARGET_MAX = qualityConfig.productionTargetMax || 12000000;     // 12 Mbps
    const GRACE_PERIOD = qualityConfig.gracePeriodMs || 120000;           // 2 minutes
    const DISCONNECT_ENABLED = qualityConfig.disconnectOnCritical !== false;

    const now = new Date();
    const recentHistory = session.bitrateHistory.filter(entry => 
      now - entry.timestamp < 60000 // Last minute of data
    );

    if (recentHistory.length === 0) {
      return {
        status: 'stale',
        action: 'monitor',
        message: 'No recent bitrate data'
      };
    }

    // Calculate current and average bitrates
    const currentBitrate = recentHistory[recentHistory.length - 1]?.bitrate || 0;
    const averageBitrate = recentHistory.reduce((sum, entry) => sum + entry.bitrate, 0) / recentHistory.length;
    
    // Quality assessment
    if (currentBitrate < CRITICAL_LOW && averageBitrate < CRITICAL_LOW && DISCONNECT_ENABLED) {
      // Critically low - disconnect after grace period
      const lowQualityStart = session.lowQualityStart || now;
      const lowQualityDuration = now - lowQualityStart;
      
      if (!session.lowQualityStart) {
        session.lowQualityStart = now;
        this.sessions.set(session.id, session);
      }
      
      if (lowQualityDuration > GRACE_PERIOD) {
        return {
          status: 'critical',
          action: 'disconnect',
          message: `Disconnecting due to critically low bitrate (${this.formatBitrate(currentBitrate)}) for over ${Math.round(GRACE_PERIOD / 1000)}s`,
          currentBitrate,
          averageBitrate
        };
      }
      
      return {
        status: 'critical',
        action: 'warn',
        message: `Critical bitrate warning: ${this.formatBitrate(currentBitrate)} (grace period: ${Math.round((GRACE_PERIOD - lowQualityDuration) / 1000)}s remaining)`,
        currentBitrate,
        averageBitrate
      };
    }
    
    // Clear low quality timer if bitrate improves
    if (session.lowQualityStart && currentBitrate >= POOR_QUALITY) {
      delete session.lowQualityStart;
      this.sessions.set(session.id, session);
    }
    
    if (currentBitrate < POOR_QUALITY) {
      return {
        status: 'poor',
        action: 'warn',
        message: `Poor stream quality: ${this.formatBitrate(currentBitrate)} - Consider increasing bitrate`,
        currentBitrate,
        averageBitrate
      };
    }
    
    if (currentBitrate < TARGET_MIN) {
      return {
        status: 'below-target',
        action: 'monitor',
        message: `Below production target: ${this.formatBitrate(currentBitrate)} - Target: ${this.formatBitrate(TARGET_MIN)}+`,
        currentBitrate,
        averageBitrate
      };
    }
    
    if (currentBitrate <= TARGET_MAX) {
      return {
        status: 'excellent',
        action: 'none',
        message: `Excellent production quality: ${this.formatBitrate(currentBitrate)}`,
        currentBitrate,
        averageBitrate
      };
    }
    
    return {
      status: 'high',
      action: 'monitor',
      message: `High bitrate: ${this.formatBitrate(currentBitrate)} - Monitor bandwidth usage`,
      currentBitrate,
      averageBitrate
    };
  }

  // Enhanced connection monitoring with quality assessment
  async monitorConnectionsWithQuality() {
    if (this.sessions.size === 0) {
      return;
    }

    const now = new Date();
    const qualityIssues = [];
    const disconnectedSessions = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      try {
        // Standard activity check
        const isActivelyStreaming = this.isSessionActivelyStreaming(session);
        const timeSinceLastActivity = now - (session.lastActivity || session.connectTime);
        
        if (session.isPublisher) {
          // Quality assessment for publishers
          const qualityAssessment = this.assessStreamQuality(session);
          
          logger.debug(`Quality assessment for session ${sessionId}: status=${qualityAssessment.status}, action=${qualityAssessment.action}, bitrate=${qualityAssessment.currentBitrate}`);
          
          // Handle critical quality issues with disconnection
          if (qualityAssessment.action === 'disconnect') {
            logger.warn(`Quality-based disconnect for session ${sessionId}: ${qualityAssessment.message}`);
            
            try {
              // Send disconnect message before cleanup
              if (session.streamKey) {
                logger.info(`🔔 Quality disconnect detected - sending disconnect message for stream key: ${session.streamKey?.substring(0,8)}...`);
                logger.info(`Session data: streamKey type=${typeof session.streamKey}, value=${session.streamKey?.substring(0,8)}...`);
                await this.sendDisconnectMessage(session.streamKey, 'low bitrate detected');
                logger.info(`✅ sendDisconnectMessage completed without throwing`);
              } else {
                logger.error(`❌ No streamKey in session object for quality disconnect`);
              }
              
              // Gracefully terminate the session
              if (this.nms && this.nms.sessions && this.nms.sessions.has(sessionId)) {
                const nmsSession = this.nms.sessions.get(sessionId);
                if (nmsSession && nmsSession.socket) {
                  nmsSession.socket.end();
                }
              }
              
              // Remove from our tracking
              this.sessions.delete(sessionId);
              disconnectedSessions.push({
                sessionId,
                reason: 'quality',
                message: qualityAssessment.message,
                bitrate: qualityAssessment.currentBitrate
              });
              
            } catch (disconnectError) {
              logger.error(`❌ Error during quality disconnect for session ${sessionId}:`, disconnectError);
              logger.error(`Disconnect error stack:`, disconnectError.stack);
            }
            
            continue;
          }
          
          // Track quality warnings
          if (qualityAssessment.action === 'warn') {
            qualityIssues.push({
              sessionId,
              streamKey: session.streamKey,
              status: qualityAssessment.status,
              message: qualityAssessment.message,
              bitrate: qualityAssessment.currentBitrate
            });
          }
        }
        
        // Standard stale connection detection
        if (!isActivelyStreaming && timeSinceLastActivity > this.staleConnectionThreshold) {
          const sessionType = session.isPublisher ? 'publisher' : 'viewer';
          logger.info(`Removing stale ${sessionType} session ${sessionId} (inactive for ${Math.round(timeSinceLastActivity / 1000)}s)`);
          
          try {
            // Send disconnect message for publishers before cleanup
            if (session.isPublisher && session.streamKey) {
              logger.info(`🔔 Stale publisher detected - sending disconnect message for stream key: ${session.streamKey?.substring(0,8)}...`);
              await this.sendDisconnectMessage(session.streamKey, 'connection lost');
            } else if (session.isPublisher && !session.streamKey) {
              logger.warn(`⚠️ Stale publisher detected but no streamKey set on session ${sessionId}`);
            } else {
              logger.debug(`Session ${sessionId} is not a publisher, skipping disconnect message`);
            }
            
            // Gracefully terminate the session
            if (this.nms && this.nms.sessions && this.nms.sessions.has(sessionId)) {
              const nmsSession = this.nms.sessions.get(sessionId);
              if (nmsSession && nmsSession.socket) {
                nmsSession.socket.end();
              }
            }
            
            // Remove from our tracking
            this.sessions.delete(sessionId);
            disconnectedSessions.push({
              sessionId,
              reason: 'stale',
              message: `Inactive ${sessionType} for ${Math.round(timeSinceLastActivity / 1000)}s`,
              type: sessionType
            });
            
          } catch (disconnectError) {
            logger.error(`Error disconnecting stale session ${sessionId}:`, disconnectError);
          }
        }
        
      } catch (error) {
        logger.error(`Error monitoring session ${sessionId}:`, error);
      }
    }

    // Log quality issues summary
    if (qualityIssues.length > 0) {
      logger.warn(`Quality monitoring - ${qualityIssues.length} publisher(s) with quality issues:`, 
        qualityIssues.map(issue => `${issue.streamKey}: ${issue.message}`).join(', '));
    }

    // Log disconnection summary
    if (disconnectedSessions.length > 0) {
      logger.info(`Connection monitoring - Disconnected ${disconnectedSessions.length} session(s):`, 
        disconnectedSessions.map(d => `${d.sessionId} (${d.reason})`).join(', '));
    }

    logger.debug(`Connection monitoring completed - Active sessions: ${this.sessions.size}, Quality issues: ${qualityIssues.length}, Disconnected: ${disconnectedSessions.length}`);
  }

  extractStreamKey(streamPath) {
    // Extract stream key from path like "/live/streamkey"
    logger.debug(`Extracting stream key from path: ${streamPath}`);
    const match = streamPath.match(/^\/live\/(.+)$/);
    const streamKey = match ? match[1] : null;
    
    if (!streamKey) {
      logger.warn(`Could not extract stream key from path: ${streamPath}`);
    } else {
      logger.debug(`Extracted stream key: ${streamKey}`);
    }
    
    return streamKey;
  }

  async verifyStreamKey(streamKey) {
    try {
      const db = getDatabase();
      const result = await db.get(
        'SELECT id FROM stream_keys WHERE stream_key = ? AND is_active = 1',
        [streamKey]
      );
      
      if (result) {
        // Mark the stream key as used
        await db.run(
          'UPDATE stream_keys SET last_used_at = CURRENT_TIMESTAMP WHERE stream_key = ?',
          [streamKey]
        );
      }
      
      return !!result;
    } catch (error) {
      logger.error('Stream key verification error:', error);
      return false;
    }
  }

  async sendDisconnectMessage(streamKey, reason = 'stream ended') {
    try {
      logger.debug(`sendDisconnectMessage called for stream key: ${streamKey?.substring(0,8)}... with reason: ${reason}`);
      
      // Get the stream key from database
      const streamKeyObj = await StreamKey.findByKey(streamKey);
      if (!streamKeyObj) {
        logger.warn(`Stream key object not found in database: ${streamKey?.substring(0,8)}...`);
        return;
      }
      
      if (!streamKeyObj.disconnectMessage) {
        logger.debug(`No disconnect message configured for stream key: ${streamKey?.substring(0,8)}...`);
        return;
      }
      
      logger.debug(`Disconnect message configured: "${streamKeyObj.disconnectMessage}"`);

      // Get the user for this stream key
      const user = await streamKeyObj.getUser();
      if (!user) {
        logger.error(`User not found for stream key: ${streamKey?.substring(0,8)}...`);
        return;
      }
      
      logger.debug(`User found: ${user.username}`);

      // Replace {reason} placeholder with actual reason
      const message = streamKeyObj.disconnectMessage.replace(/{reason}/g, reason);
      logger.debug(`Message after replacement: "${message}"`);

      // Get the user-specific Twitch bot instance
      const twitchBot = getTwitchBot(user.id);
      
      // Check if bot is ready
      if (!twitchBot.isReady()) {
        logger.warn(`Twitch bot not ready - cannot send disconnect message for user: ${user.username}`);
        return;
      }
      
      logger.debug(`Twitch bot is ready, sending message to ${user.username}'s channel`);

      // Send the disconnect message to the user's channel
      await twitchBot.sendCommand(user.username, message);
      logger.debug(`✅ Disconnect message sent to ${user.username}'s channel: ${message}`);
      
    } catch (error) {
      logger.error('Failed to send disconnect message:', error);
    }
  }

  async sendConnectMessage(streamKey) {
    try {
      logger.debug(`sendConnectMessage called for stream key: ${streamKey?.substring(0,8)}...`);
      
      // Get the stream key from database
      const streamKeyObj = await StreamKey.findByKey(streamKey);
      if (!streamKeyObj) {
        logger.warn(`Stream key object not found in database: ${streamKey?.substring(0,8)}...`);
        return;
      }
      
      if (!streamKeyObj.connectMessage) {
        logger.debug(`No connect message configured for stream key: ${streamKey?.substring(0,8)}...`);
        return;
      }
      
      logger.debug(`Connect message configured: "${streamKeyObj.connectMessage}"`);

      // Get the user for this stream key
      const user = await streamKeyObj.getUser();
      if (!user) {
        logger.error(`User not found for stream key: ${streamKey?.substring(0,8)}...`);
        return;
      }
      
      logger.debug(`User found: ${user.username}`);

      // Get the Twitch bot instance for this user
      const twitchBot = getTwitchBot(user.id);
      
      // Check if bot is ready
      if (!twitchBot.isReady()) {
        logger.warn(`Twitch bot not ready - cannot send connect message for user: ${user.username}`);
        return;
      }
      
      logger.debug(`Twitch bot is ready, sending message to ${user.username}'s channel`);

      // Send the connect message to the user's channel
      await twitchBot.sendCommand(user.username, streamKeyObj.connectMessage);
      logger.debug(`✅ Connect message sent to ${user.username}'s channel: ${streamKeyObj.connectMessage}`);
      
    } catch (error) {
      logger.error('Failed to send connect message:', error);
    }
  }

  async saveStreamSettings(streamKey, args) {
    try {
      const db = getDatabase();
      
      // Validate stream key exists in database before saving settings
      const streamKeyExists = await this.verifyStreamKey(streamKey);
      if (!streamKeyExists) {
        logger.warn(`Cannot save stream settings: stream key '${streamKey}' not found in database`);
        return;
      }
      
      // Extract stream settings from args
      const settings = {
        width: args.width || 1280,
        height: args.height || 720,
        fps: args.fps || 30,
        bitrate: args.videoBitrate || 2000,
        audioBitrate: args.audioBitrate || 128,
        codec: args.videoCodec || 'h264',
        audioCodec: args.audioCodec || 'aac',
        timestamp: new Date().toISOString(),
      };

      // Save publisher settings to stream_settings table
      await db.run(
        `INSERT OR REPLACE INTO stream_settings (stream_key, settings_type, settings, updated_at) 
         VALUES (?, ?, ?, datetime('now', 'utc') || 'Z')`,
        [streamKey, 'publisher', JSON.stringify(settings)]
      );
      
      logger.debug(`Stream settings saved for ${streamKey}:`, settings);
    } catch (error) {
      logger.error('Error saving stream settings:', error);
    }
  }

  rejectConnection(nms, id) {
    // Force disconnect the connection with multiple approaches
    const session = nms.getSession(id);
    if (session) {
      try {
        // Try multiple disconnect methods for stronger disconnection
        if (typeof session.close === 'function') {
          session.close();
        } else if (typeof session.destroy === 'function') {
          session.destroy();
        } else {
          session.reject();
        }
        
        // Also try to close the underlying socket if available
        if (session.socket && typeof session.socket.destroy === 'function') {
          session.socket.destroy();
        }
        
        logger.debug(`Force disconnected session ${id} using available methods`);
      } catch (error) {
        logger.error(`Error force disconnecting session ${id}:`, error);
        // Fallback to basic reject
        try {
          session.reject();
        } catch (fallbackError) {
          logger.error(`Fallback reject also failed for session ${id}:`, fallbackError);
        }
      }
    }
  }

  async createSessionRecord(sessionId, streamKey, ipAddress, isPublisher = true) {
    try {
      const { getDatabase } = require('./database');
      const db = getDatabase();
      
      await db.run(
        `INSERT INTO stream_sessions (session_id, stream_key, ip_address, is_publisher, is_active, started_at)
         VALUES (?, ?, ?, ?, 1, datetime('now', 'utc') || 'Z')`,
        [sessionId, streamKey, ipAddress, isPublisher ? 1 : 0]
      );
      
      logger.debug(`Database session record created: ${sessionId} for ${streamKey} (${isPublisher ? 'publisher' : 'viewer'})`);
    } catch (error) {
      logger.error('Error creating session record:', error);
    }
  }

  async endSessionRecord(sessionId) {
    try {
      const { getDatabase } = require('./database');
      const db = getDatabase();
      
      await db.run(
        `UPDATE stream_sessions 
         SET ended_at = datetime('now', 'utc') || 'Z', is_active = 0 
         WHERE session_id = ? AND is_active = 1`,
        [sessionId]
      );
      
      logger.debug(`Database session record ended: ${sessionId}`);
    } catch (error) {
      logger.error('Error ending session record:', error);
    }
  }

  async cleanupAllActiveSessions() {
    try {
      const { getDatabase } = require('./database');
      const db = getDatabase();
      
      // End all active sessions in the database
      const result = await db.run(
        `UPDATE stream_sessions 
         SET ended_at = datetime('now', 'utc') || 'Z', is_active = 0 
         WHERE is_active = 1`,
        []
      );
      
      logger.info(`🧹 Cleanup: Ended ${result.changes || 0} active database sessions during shutdown`);
      
      // Clear in-memory session tracking  
      const sessionCount = this.sessions.size;
      this.sessions.clear();
      logger.info(`🧹 Cleanup: Cleared ${sessionCount} in-memory session records`);
      
    } catch (error) {
      logger.error('Error during session cleanup:', error);
    }
  }

  async disconnectAllViewersForStream(nms, streamKey, excludePublisherId = null) {
    try {
      // Find all viewer sessions for this stream key
      const viewersToDisconnect = Array.from(this.sessions.values()).filter(session => 
        session.streamKey === streamKey && 
        session.isPlayer === true && 
        !session.isPublisher &&
        session.id !== excludePublisherId
      );

      if (viewersToDisconnect.length === 0) {
        logger.info(`📺 No viewers to disconnect for stream ${streamKey}`);
        return;
      }

      logger.debug(`📺 DISCONNECTING ${viewersToDisconnect.length} viewers for stream ${streamKey} (publisher gone):`);
      
      // Log details of viewers being disconnected
      viewersToDisconnect.forEach(session => {
        logger.debug(`  - VIEWER ${session.id} from ${session.ip} (connected ${Math.round((Date.now() - session.connectTime) / 1000)}s ago)`);
      });

      // Disconnect each viewer
      for (const session of viewersToDisconnect) {
        try {
          // Force disconnect the viewer session
          this.rejectConnection(nms, session.id);
          
          // Remove from our sessions map
          this.sessions.delete(session.id);
          
          // End database record
          await this.endSessionRecord(session.id);
          
          logger.debug(`📺 Disconnected viewer ${session.id} from ${session.ip}`);
        } catch (error) {
          logger.error(`❌ Error disconnecting viewer ${session.id}:`, error);
        }
      }

      logger.debug(`✅ VIEWER CLEANUP COMPLETE: All ${viewersToDisconnect.length} viewers disconnected for stream ${streamKey}`);
      
    } catch (error) {
      logger.error('Error disconnecting viewers:', error);
    }
  }

  getActiveSessions() {
    return Array.from(this.sessions.values());
  }

  getSessionByStreamKey(streamKey) {
    return Array.from(this.sessions.values()).find(session => 
      session.streamKey === streamKey
    );
  }

  hasActivePublisher(streamKey) {
    return Array.from(this.sessions.values()).some(session => 
      session.streamKey === streamKey && session.isPublisher === true
    );
  }

  async killAllSessionsForStream(nms, streamKey, excludeId = null) {
    try {
      // Find all sessions for this stream key
      const sessionsToKill = Array.from(this.sessions.values()).filter(session => 
        session.streamKey === streamKey && session.id !== excludeId
      );

      if (sessionsToKill.length === 0) {
        logger.info(`No existing sessions to kill for stream ${streamKey}`);
        return;
      }

      logger.info(`💀 KILLING ${sessionsToKill.length} existing sessions for stream ${streamKey}:`);
      
      // Log details of sessions being killed
      sessionsToKill.forEach(session => {
        const sessionType = session.isPublisher ? 'PUBLISHER' : 'SUBSCRIBER';
        logger.info(`  - ${sessionType} ${session.id} from ${session.ip} (connected ${Math.round((Date.now() - session.connectTime) / 1000)}s ago)`);
      });

      // Kill each session
      for (const session of sessionsToKill) {
        const sessionType = session.isPublisher ? 'publisher' : 'subscriber';
        
        try {
          // Force disconnect the session
          this.rejectConnection(nms, session.id);
          
          // Remove from our sessions map
          this.sessions.delete(session.id);
          
          // End database record
          await this.endSessionRecord(session.id);
          
          logger.info(`💀 Killed ${sessionType} session ${session.id} from ${session.ip}`);
        } catch (error) {
          logger.error(`❌ Error killing session ${session.id}:`, error);
        }
      }

      // Stop any active restreaming for this stream key
      try {
        await this.restreamService.stopRestream(streamKey);
        logger.info(`🛑 Stopped restreaming for taken over stream ${streamKey}`);
      } catch (error) {
        logger.error(`❌ Error stopping restreaming for stream ${streamKey}:`, error);
      }

      logger.info(`✅ TAKEOVER CLEANUP COMPLETE: All existing sessions killed for stream ${streamKey}`);
    } catch (error) {
      logger.error(`❌ TAKEOVER FAILED for stream ${streamKey}:`, error);
    }
  }

  getViewerCount(streamKey = null) {
    const sessions = Array.from(this.sessions.values());
    if (streamKey) {
      // Get viewers for a specific stream
      return sessions.filter(session => 
        session.streamKey === streamKey && session.isPlayer === true
      ).length;
    } else {
      // Get total viewers across all streams
      return sessions.filter(session => session.isPlayer === true).length;
    }
  }

  getHealthStatus() {
    const now = new Date();
    return {
      status: 'healthy',
      activeSessions: this.sessions.size,
      connectionMonitoring: {
        enabled: !!this.connectionMonitor,
        staleConnectionThreshold: this.staleConnectionThreshold,
        monitorInterval: this.monitorInterval
      },
      sessionsDetails: this.getActiveSessions().map(session => ({
        id: session.id,
        streamKey: session.streamKey ? session.streamKey.substring(0, 8) + '...' : 'unknown',
        isPublisher: session.isPublisher,
        isPlayer: session.isPlayer,
        connectTime: session.connectTime,
        lastActivity: session.lastActivity,
        lastDataPacket: session.lastDataPacket,
        timeSinceActivity: now - session.lastActivity,
        timeSinceDataPacket: session.lastDataPacket ? now - session.lastDataPacket : now - session.lastActivity,
        dataPackets: session.dataPackets || 0,
        bytesReceived: session.bytesReceived || 0,
        dataFlowRate: this.calculateDataFlowRate(session),
        currentBitrate: this.calculateCurrentBitrate(session),
        averageBitrate: this.calculateAverageBitrate(session),
        peakBitrate: this.calculatePeakBitrate(session),
        currentBitrateFormatted: this.formatBitrate(this.calculateCurrentBitrate(session)),
        averageBitrateFormatted: this.formatBitrate(this.calculateAverageBitrate(session)),
        peakBitrateFormatted: this.formatBitrate(this.calculatePeakBitrate(session)),
        isActivelyStreaming: this.isSessionActivelyStreaming(session),
        ip: session.ip
      }))
    };
  }

  /**
   * Check if IP address should be rate limited
   */
  isRateLimited(ip) {
    // Always allow localhost connections (test pattern, development)
    if (ip === '127.0.0.1' || ip === '::ffff:127.0.0.1' || ip === '::1' || ip === 'localhost') {
      return false;
    }
    
    const now = Date.now();
    const attempts = this.connectionAttempts.get(ip) || [];
    
    // Remove old attempts outside the window
    const recentAttempts = attempts.filter(timestamp => now - timestamp < this.connectionWindowMs);
    
    return recentAttempts.length >= this.maxConnectionsPerIP;
  }

  /**
   * Record a connection attempt from an IP
   */
  recordConnectionAttempt(ip) {
    // Don't track localhost
    if (ip === '127.0.0.1' || ip === '::ffff:127.0.0.1' || ip === '::1' || ip === 'localhost') {
      return;
    }
    
    const now = Date.now();
    const attempts = this.connectionAttempts.get(ip) || [];
    attempts.push(now);
    this.connectionAttempts.set(ip, attempts);
    
    // Only log if this IP is actually hitting the rate limit (not at 80%)
    if (attempts.length >= this.maxConnectionsPerIP) {
      logger.warn(`IP ${ip} has been rate limited after ${attempts.length} connection attempts in the last minute`);
    }
  }

  /**
   * Clean up old connection attempts to prevent memory leaks
   */
  cleanupConnectionAttempts() {
    const now = Date.now();
    for (const [ip, attempts] of this.connectionAttempts.entries()) {
      const recentAttempts = attempts.filter(timestamp => now - timestamp < this.connectionWindowMs);
      if (recentAttempts.length === 0) {
        this.connectionAttempts.delete(ip);
      } else {
        this.connectionAttempts.set(ip, recentAttempts);
      }
    }
    
    // Log cleanup stats every 10 minutes
    if (Date.now() % (10 * 60 * 1000) < this.connectionWindowMs) {
      logger.debug(`Connection tracking cleanup: ${this.connectionAttempts.size} IPs being tracked`);
    }
  }

  destroy() {
    this.stopConnectionMonitoring();
    this.stopActiveSessionMonitoring();
    this.sessions.clear();
  }
}

// Global RTMP server instance
let rtmpServerConfig = null;

function initRTMPServer() {
  if (!rtmpServerConfig) {
    rtmpServerConfig = new RTMPServerConfig();
  }
  return rtmpServerConfig.createServer();
}

function getRTMPServerConfig() {
  return rtmpServerConfig;
}

module.exports = {
  initRTMPServer,
  getRTMPServerConfig,
  RTMPServerConfig,
};