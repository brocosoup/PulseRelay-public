const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const passport = require('passport');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');

// Load configuration first
const { loadConfig, validateConfiguration } = require('./config/config');

const logger = require('./utils/logger');
const { initDatabase } = require('./config/database');
const { initRTMPServer, getRTMPServerConfig } = require('./config/rtmp');
const { initAuth } = require('./config/auth');
const { errorHandler } = require('./middleware/errors');
const { sessionErrorHandler } = require('./middleware/auth');
const { getPictureCleanupService } = require('./services/pictureCleanup');

// Import routes
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const dashboardRoutes = require('./routes/dashboard');

class PulseRelayServer {
  constructor() {
    this.app = express();
    this.httpPort = null; // Will be set from config
    this.rtmpPort = null; // Will be set from config  
    this.rtmpServer = null;
  }

  async initialize() {
    try {
      // Load and validate configuration
      loadConfig();
      logger.info('Configuration loaded successfully');

      if (!validateConfiguration()) {
        throw new Error('Configuration validation failed');
      }

      // Set ports from config after loading
      const { getConfig } = require('./config/config');
      const config = getConfig();
      this.httpPort = config.server.port || 3000;
      this.rtmpPort = config.rtmp.port || 1935;

      logger.info(`Server configuration: HTTP port ${this.httpPort}, RTMP port ${this.rtmpPort}`);

      // Initialize database
      await initDatabase();
      logger.info('Database initialized successfully');

      // Initialize RTMP server
      this.rtmpServer = initRTMPServer();
      logger.info(`RTMP server initialized on port ${this.rtmpPort}`);

      // Initialize authentication
      initAuth();
      logger.info('Authentication configured');

      // Setup Express middleware
      this.setupMiddleware();
      
      // Setup routes
      this.setupRoutes();

      // Setup error handling
      this.setupErrorHandling();

      logger.info('PulseRelay server initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize server:', error);
      process.exit(1);
    }
  }

  setupMiddleware() {
    // Get configuration
    const { getConfig } = require('./config/config');
    const config = getConfig();
    
    // Trust proxy when running behind nginx
    this.app.set('trust proxy', 1);

    // Determine allowed streaming sources based on configuration
    const streamingSources = ["'self'", `http://localhost:${config.httpStreaming.port || 4000}`];
    
    // Add custom HTTP streaming URL to CSP if configured
    if (config.httpStreaming && config.httpStreaming.customPlayerUrl) {
      const customUrl = new URL(config.httpStreaming.customPlayerUrl);
      const customOrigin = `${customUrl.protocol}//${customUrl.host}`;
      streamingSources.push(customOrigin);
    }
    
    // Add any additional configured streaming URLs
    if (config.httpStreaming && config.httpStreaming.additionalUrls) {
      streamingSources.push(...config.httpStreaming.additionalUrls);
    }
    
    // Security middleware with proper CSP
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com", "https://unpkg.com"],
          scriptSrc: ["'self'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://static.cloudflareinsights.com", "https://unpkg.com"],
          scriptSrcAttr: ["'none'"], // Block inline event handlers for security
          imgSrc: ["'self'", "data:", "https:"],
          fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
          connectSrc: [...streamingSources, "ws://localhost:4455"], // Allow connections to streaming sources, configured URLs, and OBS WebSocket
          mediaSrc: [...streamingSources, "blob:"], // Allow blob URLs and streaming media
          frameSrc: ["'self'", "https://www.youtube.com", "https://www.youtube-nocookie.com"], // Allow YouTube embeds
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000, // limit each IP to 1000 requests per windowMs (increased from 100)
      message: 'Too many requests from this IP, please try again later.',
    });
    this.app.use('/api/', limiter);

    // CORS
    this.app.use(cors({
      origin: config.security.cors.origin || false,
      credentials: config.security.cors.credentials || false,
      optionsSuccessStatus: 200,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
    }));

    // Body parsing
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Session configuration with error handling
    const sessionStore = new SQLiteStore({
      db: 'sessions.db',
      dir: path.join(__dirname, '../storage')
    });

    // Handle session store errors to prevent uncaught exceptions
    sessionStore.on('error', (error) => {
      logger.error('Session store error:', error);
    });

    // Load secrets
    const { getSecrets } = require('./config/config');
    const secrets = getSecrets();

    this.app.use(session({
      store: sessionStore,
      secret: secrets.session.secret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: config.server.environment === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      },
      name: 'pulserelay.sid', // Custom session name
    }));

    // Session error handling middleware
    this.app.use(sessionErrorHandler);

    // Passport initialization
    this.app.use(passport.initialize());
    this.app.use(passport.session());

    // Static files
    this.app.use(express.static(path.join(__dirname, '../public')));

    // View engine
    this.app.set('view engine', 'ejs');
    this.app.set('views', path.join(__dirname, '../views'));
    
    // Layout configuration
    this.app.use(expressLayouts);
    this.app.set('layout', 'layout');
    this.app.set('layout extractScripts', true);
    this.app.set('layout extractStyles', true);
  }

  setupRoutes() {
    // Authentication routes
    this.app.use('/auth', authRoutes);

    // API routes
    this.app.use('/api', apiRoutes);

    // Dashboard routes
    this.app.use('/', dashboardRoutes);

    // Access denied route
    this.app.get('/access-denied', (req, res) => {
      res.status(403).render('access-denied', { 
        title: 'Access Denied',
        user: null
      });
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        rtmp: this.rtmpServer ? 'running' : 'stopped',
      });
    });
  }

  setupErrorHandling() {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).render('404', { title: 'Page Not Found' });
    });

    // Error handler
    this.app.use(errorHandler);
  }

  async start() {
    try {
      await this.initialize();

      // Initialize Twitch bots for all users with tokens
      await this.initializeTwitchBots();

      // Start RTMP server
      this.rtmpServer.run();
      logger.info(`RTMP server running on port ${this.rtmpPort}`);

      // Start HTTP server with error handling
      const server = this.app.listen(this.httpPort, () => {
        logger.info(`HTTP server running on port ${this.httpPort}`);
        logger.info(`Dashboard available at: http://localhost:${this.httpPort}`);
        logger.info(`RTMP endpoint: rtmp://localhost:${this.rtmpPort}/live/YOUR_STREAM_KEY`);
      });

      // Start picture cleanup service
      const pictureCleanup = getPictureCleanupService();
      pictureCleanup.start();

      // Handle port in use error
      server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          logger.error(`Port ${this.httpPort} is already in use. Please:
1. Stop any processes using port ${this.httpPort}
2. Set a different port using HTTP_PORT environment variable
3. Or modify the port in config.json`);
          
          // Try to suggest an alternative port
          const alternativePort = this.httpPort + 1;
          logger.info(`You can try starting with: HTTP_PORT=${alternativePort} npm start`);
        }
        throw error;
      });

    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  async stop() {
    try {
      // Stop token refresh monitor
      this.stopTokenRefreshMonitor();

      // Stop picture cleanup service
      const pictureCleanup = getPictureCleanupService();
      pictureCleanup.stop();

      if (this.rtmpServer) {
        // Clean up all active sessions before stopping the server
        const rtmpServerConfig = getRTMPServerConfig();
        if (rtmpServerConfig) {
          await rtmpServerConfig.cleanupAllActiveSessions();
        }
        this.rtmpServer.stop();
        logger.info('RTMP server stopped');
      }
      logger.info('PulseRelay server stopped');
    } catch (error) {
      logger.error('Error stopping server:', error);
    }
  }

  async initializeTwitchBots() {
    try {
      const { User } = require('./models/User');
      const { getTwitchBot } = require('./services/twitchBot');
      
      logger.info('Initializing Twitch bots for all users...');
      
      // Get all users with Twitch access tokens
      const users = await User.getAllWithTwitchTokens();
      
      if (!users || users.length === 0) {
        logger.info('No users with Twitch tokens found');
        return;
      }
      
      // Initialize Twitch bot for each user with tokens
      let successCount = 0;
      
      for (const user of users) {
        try {
          const twitchBot = getTwitchBot(user.id); // Get user-specific bot instance
          const channelUsername = user.username || user.display_name || user.login;
          
          // Check if token needs refresh and get fresh token if needed
          let activeUser = user;
          if (user.isTokenExpired()) {
            logger.info(`Refreshing expired Twitch token for: ${channelUsername}`);
            try {
              activeUser = await user.getFreshToken();
            } catch (refreshError) {
              logger.error(`Failed to refresh token for ${channelUsername}:`, refreshError);
              continue; // Skip this user if token refresh fails
            }
          }
          
          if (twitchBot.needsRefresh(channelUsername, activeUser.twitchAccessToken, activeUser.id)) {
            logger.info(`Initializing Twitch bot for: ${channelUsername}`);
            await twitchBot.initializeBot(channelUsername, activeUser.twitchAccessToken, activeUser.id, activeUser);
            successCount++;
          } else {
            logger.debug(`Twitch bot already connected for ${channelUsername}`);
            successCount++;
          }
        } catch (error) {
          logger.error(`Failed to initialize Twitch bot for user ${user.id}:`, error);
          // Continue with other users
        }
      }
      
      logger.info(`Twitch bots initialized: ${successCount}/${users.length} users`);
    } catch (error) {
      logger.error('Error initializing Twitch bots:', error);
      // Don't fail server startup if bot initialization fails
    }

    // Start periodic token refresh check (every 30 minutes)
    this.startTokenRefreshMonitor();
  }

  /**
   * Start periodic token refresh monitor
   */
  startTokenRefreshMonitor() {
    const REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes
    
    this.tokenRefreshInterval = setInterval(async () => {
      try {
        logger.debug('Running periodic token refresh check');
        
        const { User } = require('./models/User');
        const users = await User.getAllWithTwitchTokens();
        
        for (const user of users) {
          try {
            // Skip users without tokens
            if (!user.twitchAccessToken || !user.twitchRefreshToken) {
              continue;
            }
            
            // Check if token will expire soon (within 60 minutes)
            if (user.isTokenExpired(60)) {
              logger.info(`Proactively refreshing token for user: ${user.username}`);
              await user.getFreshToken();
              logger.info(`Token refreshed for user: ${user.username}`);
            }
          } catch (error) {
            logger.error(`Failed to refresh token for user ${user.id}:`, error);
          }
        }
      } catch (error) {
        logger.error('Error in token refresh monitor:', error);
      }
    }, REFRESH_INTERVAL);
    
    logger.info('Token refresh monitor started (30 minute interval)');
  }

  /**
   * Stop periodic token refresh monitor
   */
  stopTokenRefreshMonitor() {
    if (this.tokenRefreshInterval) {
      clearInterval(this.tokenRefreshInterval);
      this.tokenRefreshInterval = null;
      logger.info('Token refresh monitor stopped');
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  if (global.pulseRelayServer) {
    await global.pulseRelayServer.stop();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  if (global.pulseRelayServer) {
    await global.pulseRelayServer.stop();
  }
  process.exit(0);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', { error: error.message, stack: error.stack });
  // Don't exit immediately - let the error handler decide
});

// Start the server
if (require.main === module) {
  const server = new PulseRelayServer();
  global.pulseRelayServer = server;
  server.start().catch(error => {
    logger.error('Failed to start PulseRelay server:', error);
    process.exit(1);
  });
}

module.exports = PulseRelayServer;
