const fs = require('fs');
const path = require('path');

// Safe logger that falls back to console to avoid circular dependency issues
let _logger;
function safeLog(level, ...args) {
  try {
    if (!_logger) {
      _logger = require('../utils/logger');
    }
    if (_logger && typeof _logger[level] === 'function') {
      _logger[level](...args);
    } else {
      console[level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log'](...args);
    }
  } catch (error) {
    // Fallback to console if logger fails
    console[level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log'](...args);
  }
}

// Configuration loader for PulseRelay
class ConfigLoader {
  constructor() {
    this.config = {};
    this.secrets = {};
    this.loaded = false;
  }

  loadConfig() {
    if (this.loaded) return;

    try {
      // Load main configuration
      const configPath = path.join(process.cwd(), 'config.json');
      if (fs.existsSync(configPath)) {
        this.config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        safeLog('info', 'Main configuration loaded successfully');
      } else {
        safeLog('warn', 'config.json not found, using defaults');
        this.config = this.getDefaultConfig();
      }

      // Load secrets
      const secretsPath = path.join(process.cwd(), 'secret.json');
      if (fs.existsSync(secretsPath)) {
        this.secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
        safeLog('info', 'Secrets configuration loaded successfully');
        
        // Validate critical secrets are not using dangerous defaults
        this.validateSecretSecurity();
      } else {
        safeLog('error', '🚨 CRITICAL SECURITY WARNING: secret.json not found!');
        safeLog('error', '📝 Please copy secret.json.template to secret.json and configure it.');
        safeLog('error', '⚠️  Using auto-generated secrets temporarily. This is NOT suitable for production!');
        this.secrets = this.getDefaultSecrets();
      }

      // Set environment variables from configuration
      this.setEnvironmentVariables();
      this.loaded = true;

    } catch (error) {
      safeLog('error', 'Failed to load configuration:', error);
      throw new Error('Configuration loading failed');
    }
  }

  getDefaultConfig() {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0'
      },
      rtmp: {
        port: 1935,
        chunkSize: 60000,
        gop: 30,
        ping: 30,
        pingTimeout: 60,
        customServerUrl: null,
        maxConnectionsPerIP: 10,
        connectionWindowMs: 60000
      },
      database: {
        type: 'sqlite',
        path: './storage/database.sqlite'
      },
      logging: {
        level: 'info',
        file: './logs/app.log',
        maxSize: '10m',
        maxFiles: 5
      },
      testPattern: {
        enabled: true,
        preserveLastPublisherSettings: true,
        defaultSettings: {
          resolution: '1920x1080',
          fps: 30,
          bitrate: 2500,
          type: 'colorbars',
          text: 'PulseRelay Test Pattern'
        }
      },
      restreaming: {
        enabled: true,
        maxDestinations: 5,
        retryAttempts: 3,
        retryDelay: 5000
      },
      security: {
        rateLimit: {
          windowMs: 900000,
          max: 100
        },
        cors: {
          origin: ['http://localhost:3000'],
          credentials: true
        }
      },
      features: {
        registration: true,
        guestAccess: false,
        recording: false,
        analytics: true
      },
      devMode: {
        noAuth: false,
        mockUser: {
          id: 1,
          username: 'devuser',
          display_name: 'Development User',
          twitch_id: 'dev123456',
          email: 'dev@pulserelay.local',
          profile_image_url: 'https://via.placeholder.com/150',
          role: 'user',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      }
    };
  }

  getDefaultSecrets() {
    // Generate secure random secrets as defaults, but warn about them
    const crypto = require('crypto');
    
    return {
      jwtSecret: crypto.randomBytes(64).toString('hex'),
      encryptionKey: crypto.randomBytes(32).toString('hex'),
      twitch: {
        clientId: '',
        clientSecret: '',
        redirectUri: 'http://localhost:3000/auth/twitch/callback'
      },
      database: {
        encryptionKey: crypto.randomBytes(32).toString('hex')
      },
      session: {
        secret: crypto.randomBytes(64).toString('hex')
      },
      smtp: {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
          user: '',
          pass: ''
        }
      },
      webhooks: {
        discord: {
          enabled: false,
          url: ''
        },
        slack: {
          enabled: false,
          url: ''
        }
      }
    };
  }

  validateSecretSecurity() {
    const logger = require('../utils/logger');
    const warnings = [];
    
    // Check for dangerous default values
    const dangerousDefaults = [
      'default-jwt-secret-change-this',
      'default-encryption-key-change-this',
      'default-session-secret-change-this',
      'default-db-encryption-key',
      'your-jwt-secret-here-change-this-to-a-secure-random-string',
      'your-encryption-key-here-change-this-to-a-secure-random-string',
      'your-session-secret-here-change-this-to-a-secure-random-string'
    ];
    
    if (dangerousDefaults.includes(this.secrets.jwtSecret)) {
      warnings.push('JWT secret is using a default/template value');
    }
    
    if (dangerousDefaults.includes(this.secrets.encryptionKey)) {
      warnings.push('Encryption key is using a default/template value');
    }
    
    if (dangerousDefaults.includes(this.secrets.session?.secret)) {
      warnings.push('Session secret is using a default/template value');
    }
    
    // Check secret length and complexity
    if (this.secrets.jwtSecret && this.secrets.jwtSecret.length < 32) {
      warnings.push('JWT secret is too short (should be at least 32 characters)');
    }
    
    if (this.secrets.encryptionKey && this.secrets.encryptionKey.length < 32) {
      warnings.push('Encryption key is too short (should be at least 32 characters)');
    }
    
    // In production, fail if critical secrets are missing or insecure
    if (process.env.NODE_ENV === 'production' && warnings.length > 0) {
      safeLog('error', '🚨 CRITICAL SECURITY ERROR: Insecure secrets detected in production:');
      warnings.forEach(warning => safeLog('error', `   ❌ ${warning}`));
      safeLog('error', '❌ Application cannot start with insecure secrets in production');
      safeLog('error', '📝 Please update your secret.json file with secure, random values');
      process.exit(1);
    }
    
    // In development, warn about insecure secrets
    if (warnings.length > 0) {
      safeLog('warn', '⚠️  Security warnings detected:');
      warnings.forEach(warning => safeLog('warn', `   ⚠️  ${warning}`));
      safeLog('warn', '📝 Consider updating your secret.json file with secure, random values');
    }
  }

  setEnvironmentVariables() {
    // Server configuration
    process.env.HTTP_PORT = process.env.HTTP_PORT || this.config.server.port.toString();
    process.env.RTMP_PORT = process.env.RTMP_PORT || this.config.rtmp.port.toString();
    process.env.NODE_ENV = process.env.NODE_ENV || 'development';

    // Database configuration
    process.env.DATABASE_PATH = process.env.DATABASE_PATH || this.config.database.path;

    // Logging configuration
    process.env.LOG_LEVEL = process.env.LOG_LEVEL || this.config.logging.level;

    // Security secrets
    process.env.JWT_SECRET = process.env.JWT_SECRET || this.secrets.jwtSecret;
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || this.secrets.encryptionKey;
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || this.secrets.session.secret;

    // Twitch OAuth
    process.env.TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || this.secrets.twitch.clientId;
    process.env.TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || this.secrets.twitch.clientSecret;
    process.env.TWITCH_CALLBACK_URL = process.env.TWITCH_CALLBACK_URL || this.secrets.twitch.redirectUri;

    // Authentication configuration
    process.env.NO_AUTH_DEV_MODE = process.env.NO_AUTH_DEV_MODE || this.config.devMode?.noAuth?.toString() || 'false';

    // Test pattern configuration
    process.env.TEST_PATTERN_ENABLED = process.env.TEST_PATTERN_ENABLED || this.config.testPattern?.enabled?.toString() || 'true';
    process.env.TEST_PATTERN_TEXT = process.env.TEST_PATTERN_TEXT || this.config.testPattern?.defaultSettings?.text || 'PulseRelay Test Pattern';

    // Restreaming configuration
    process.env.RESTREAMING_ENABLED = process.env.RESTREAMING_ENABLED || this.config.restreaming?.enabled?.toString() || 'true';

    // SMTP configuration
    process.env.SMTP_HOST = process.env.SMTP_HOST || this.secrets.smtp.host;
    process.env.SMTP_PORT = process.env.SMTP_PORT || this.secrets.smtp.port.toString();
    process.env.SMTP_USER = process.env.SMTP_USER || this.secrets.smtp.auth.user;
    process.env.SMTP_PASS = process.env.SMTP_PASS || this.secrets.smtp.auth.pass;
  }

  validateConfiguration() {
    const errors = [];

    // Skip validation in no-auth dev mode
    if (this.config.devMode?.noAuth === true) {
      safeLog('warn', 'Running in NO-AUTH development mode - authentication disabled!');
      return true;
    }

    // Validate Twitch OAuth configuration
    if (!this.secrets.twitch.clientId || this.secrets.twitch.clientId === 'your_twitch_client_id') {
      errors.push('Twitch Client ID is not configured');
    }

    if (!this.secrets.twitch.clientSecret || this.secrets.twitch.clientSecret === 'your_twitch_client_secret') {
      errors.push('Twitch Client Secret is not configured');
    }

    // Validate JWT secret
    if (!this.secrets.jwtSecret || this.secrets.jwtSecret.includes('change-this')) {
      errors.push('JWT Secret is not configured (still using default)');
    }

    // Validate encryption key
    if (!this.secrets.encryptionKey || this.secrets.encryptionKey.includes('change-this')) {
      errors.push('Encryption Key is not configured (still using default)');
    }

    // Validate session secret
    if (!this.secrets.session.secret || this.secrets.session.secret.includes('change-this')) {
      errors.push('Session Secret is not configured (still using default)');
    }

    if (errors.length > 0) {
      safeLog('error', 'Configuration validation failed:');
      errors.forEach(error => safeLog('error', `  - ${error}`));
      safeLog('error', 'Please edit secret.json with your actual configuration values.');
      return false;
    }

    return true;
  }

  get(key) {
    if (!this.loaded) {
      this.loadConfig();
    }

    const keys = key.split('.');
    let value = this.config;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return undefined;
      }
    }

    return value;
  }

  getSecret(key) {
    if (!this.loaded) {
      this.loadConfig();
    }

    const keys = key.split('.');
    let value = this.secrets;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return undefined;
      }
    }

    return value;
  }

  getConfig() {
    if (!this.loaded) {
      this.loadConfig();
    }
    return this.config;
  }

  getSecrets() {
    if (!this.loaded) {
      this.loadConfig();
    }
    return this.secrets;
  }
}

/**
 * Get dynamic RTMP server URL based on request hostname
 */
function getRtmpServerUrl(req) {
  // Check if a custom server URL is configured
  const customUrl = configLoader.get('rtmp.customServerUrl');
  if (customUrl) {
    return customUrl;
  }
  
  // Fallback to dynamic URL based on request hostname
  const hostname = req.get('host') || 'localhost:3000';
  const rtmpHostname = hostname.split(':')[0]; // Remove port from hostname
  const rtmpPort = configLoader.get('rtmp.port') || 1935;
  return `rtmp://${rtmpHostname}:${rtmpPort}/live`;
}

/**
 * Get complete RTMP URL with stream key
 */
function getRtmpUrl(req, streamKey) {
  const serverUrl = getRtmpServerUrl(req);
  return `${serverUrl}/${streamKey}`;
}

/**
 * Get HTTP FLV player base URL
 */
function getHttpPlayerUrl(req) {
  // Check if a custom player URL is configured
  const customUrl = configLoader.get('httpStreaming.customPlayerUrl');
  if (customUrl) {
    return customUrl;
  }
  
  // Fallback to dynamic URL based on request hostname
  const hostname = req.get('host') || 'localhost:3000';
  const httpHostname = hostname.split(':')[0]; // Remove port from hostname
  const httpPort = configLoader.get('httpStreaming.port') || 4000;
  return `http://${httpHostname}:${httpPort}/live`;
}

/**
 * Get complete HTTP FLV player URL with stream key
 */
function getHttpPlayerStreamUrl(req, streamKey) {
  const baseUrl = getHttpPlayerUrl(req);
  return `${baseUrl}/${streamKey}.flv`;
}

// Export singleton instance
const configLoader = new ConfigLoader();

module.exports = {
  configLoader,
  loadConfig: () => configLoader.loadConfig(),
  validateConfiguration: () => configLoader.validateConfiguration(),
  get: (key) => configLoader.get(key),
  getSecret: (key) => configLoader.getSecret(key),
  getConfig: () => configLoader.getConfig(),
  getSecrets: () => configLoader.getSecrets(),
  getRtmpServerUrl,
  getRtmpUrl,
  getHttpPlayerUrl,
  getHttpPlayerStreamUrl
};
