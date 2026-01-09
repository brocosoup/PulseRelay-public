const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}] ${message}`;
    
    // Add extra metadata if present
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    
    return log;
  })
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Get configuration
let logLevel = 'info';
let environment = 'development';

try {
  const { getConfig } = require('../config/config');
  const config = getConfig();
  logLevel = config.logging?.level || 'info';
  environment = config.server?.environment || 'development';
} catch (error) {
  // Config not loaded yet, use defaults
}

// Create the logger
const logger = winston.createLogger({
  level: logLevel,
  format: fileFormat,
  transports: [
    // File transport for all logs
    new winston.transports.File({
      filename: path.join(logsDir, 'pulserelay.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true,
    }),
    
    // Separate file for error logs
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 3,
      tailable: true,
    }),
  ],
});

// Add console transport for development
if (environment !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat,
  }));
}

// Add request logging helper
logger.logRequest = (req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logData = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
    };
    
    if (res.statusCode >= 400) {
      logger.warn('HTTP Request', logData);
    } else {
      logger.info('HTTP Request', logData);
    }
  });
  
  next();
};

// Add RTMP logging helpers
logger.rtmp = {
  connect: (sessionId, streamKey, ip) => {
    logger.debug('RTMP Connect', {
      sessionId,
      streamKey,
      ip,
      event: 'connect',
    });
  },
  
  publish: (sessionId, streamKey, ip) => {
    logger.debug('RTMP Publish', {
      sessionId,
      streamKey,
      ip,
      event: 'publish',
    });
  },
  
  play: (sessionId, streamKey, ip) => {
    logger.debug('RTMP Play', {
      sessionId,
      streamKey,
      ip,
      event: 'play',
    });
  },
  
  disconnect: (sessionId, streamKey, reason) => {
    logger.info('RTMP Disconnect', {
      sessionId,
      streamKey,
      reason,
      event: 'disconnect',
    });
  },
  
  error: (sessionId, streamKey, error) => {
    logger.error('RTMP Error', {
      sessionId,
      streamKey,
      error: error.message,
      stack: error.stack,
      event: 'error',
    });
  },
};

// Add stream logging helpers
logger.stream = {
  started: (streamKey, settings) => {
    logger.debug('Stream Started', {
      streamKey,
      settings,
      event: 'stream_started',
    });
  },
  
  stopped: (streamKey, reason) => {
    logger.debug('Stream Stopped', {
      streamKey,
      reason,
      event: 'stream_stopped',
    });
  },
  
  testPatternStarted: (streamKey, settings) => {
    logger.info('Test Pattern Started', {
      streamKey,
      settings,
      event: 'test_pattern_started',
    });
  },
  
  testPatternStopped: (streamKey) => {
    logger.info('Test Pattern Stopped', {
      streamKey,
      event: 'test_pattern_stopped',
    });
  },
  
  restream: (streamKey, destination, status) => {
    logger.info('Restream Update', {
      streamKey,
      destination,
      status,
      event: 'restream',
    });
  },
};

module.exports = logger;
