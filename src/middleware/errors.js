const logger = require('../utils/logger');

/**
 * Custom error class for application errors
 */
class AppError extends Error {
  constructor(message, statusCode, code, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error types for consistent error handling
 */
const ErrorTypes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RTMP_ERROR: 'RTMP_ERROR',
  STREAM_ERROR: 'STREAM_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
};

/**
 * Create standardized error responses
 */
function createErrorResponse(error, req) {
  const response = {
    error: error.message || 'Internal server error',
    code: error.code || 'INTERNAL_ERROR',
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method,
  };

  // Add details if available
  if (error.details) {
    response.details = error.details;
  }

  // Add stack trace in development
  const { getConfig } = require('../config/config');
  const config = getConfig();
  
  if (config.server.environment === 'development' && error.stack) {
    response.stack = error.stack;
  }

  return response;
}

/**
 * Main error handler middleware
 */
function errorHandler(err, req, res, next) {
  let error = err;

  // Handle different error types
  if (err.name === 'ValidationError') {
    error = new AppError('Validation failed', 400, ErrorTypes.VALIDATION_ERROR, err.details);
  } else if (err.name === 'UnauthorizedError') {
    error = new AppError('Unauthorized', 401, ErrorTypes.AUTHENTICATION_ERROR);
  } else if (err.name === 'ForbiddenError') {
    error = new AppError('Forbidden', 403, ErrorTypes.AUTHORIZATION_ERROR);
  } else if (err.name === 'NotFoundError') {
    error = new AppError('Resource not found', 404, ErrorTypes.NOT_FOUND);
  } else if (err.name === 'ConflictError') {
    error = new AppError('Resource conflict', 409, ErrorTypes.CONFLICT);
  } else if (err.name === 'JsonWebTokenError') {
    error = new AppError('Invalid token', 401, ErrorTypes.AUTHENTICATION_ERROR);
  } else if (err.name === 'TokenExpiredError') {
    error = new AppError('Token expired', 401, ErrorTypes.AUTHENTICATION_ERROR);
  } else if (err.code === 'SQLITE_CONSTRAINT') {
    error = new AppError('Database constraint violation', 409, ErrorTypes.DATABASE_ERROR);
  } else if (err.code === 'ECONNREFUSED') {
    error = new AppError('External service unavailable', 503, ErrorTypes.EXTERNAL_SERVICE_ERROR);
  } else if (err.code === 'ENOTFOUND') {
    error = new AppError('External service not found', 503, ErrorTypes.EXTERNAL_SERVICE_ERROR);
  } else if (err.code === 'ETIMEDOUT') {
    error = new AppError('Request timeout', 504, ErrorTypes.EXTERNAL_SERVICE_ERROR);
  }

  // Set default error properties if not set
  if (!error.statusCode) {
    error.statusCode = 500;
  }
  if (!error.code) {
    error.code = ErrorTypes.INTERNAL_ERROR;
  }

  // Log error
  const logData = {
    error: error.message,
    code: error.code,
    statusCode: error.statusCode,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    body: req.body,
    query: req.query,
    params: req.params,
  };

  if (error.statusCode >= 500) {
    logger.error('Internal server error', logData);
  } else {
    logger.warn('Client error', logData);
  }

  // Send error response
  const response = createErrorResponse(error, req);
  res.status(error.statusCode).json(response);
}

/**
 * 404 handler for unmatched routes
 */
function notFoundHandler(req, res) {
  const error = new AppError('Route not found', 404, ErrorTypes.NOT_FOUND);
  const response = createErrorResponse(error, req);
  
  logger.warn('Route not found', {
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });
  
  res.status(404).json(response);
}

/**
 * Async error handler wrapper
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Error factories for common errors
 */
const errorFactory = {
  validation: (message, details) => 
    new AppError(message, 400, ErrorTypes.VALIDATION_ERROR, details),
  
  authentication: (message = 'Authentication required') => 
    new AppError(message, 401, ErrorTypes.AUTHENTICATION_ERROR),
  
  authorization: (message = 'Access denied') => 
    new AppError(message, 403, ErrorTypes.AUTHORIZATION_ERROR),
  
  notFound: (message = 'Resource not found') => 
    new AppError(message, 404, ErrorTypes.NOT_FOUND),
  
  conflict: (message = 'Resource conflict') => 
    new AppError(message, 409, ErrorTypes.CONFLICT),
  
  rateLimit: (message = 'Rate limit exceeded') => 
    new AppError(message, 429, ErrorTypes.RATE_LIMIT_EXCEEDED),
  
  internal: (message = 'Internal server error') => 
    new AppError(message, 500, ErrorTypes.INTERNAL_ERROR),
  
  rtmp: (message, details) => 
    new AppError(message, 500, ErrorTypes.RTMP_ERROR, details),
  
  stream: (message, details) => 
    new AppError(message, 500, ErrorTypes.STREAM_ERROR, details),
  
  database: (message, details) => 
    new AppError(message, 500, ErrorTypes.DATABASE_ERROR, details),
  
  externalService: (message, details) => 
    new AppError(message, 503, ErrorTypes.EXTERNAL_SERVICE_ERROR, details),
};

/**
 * Global error handlers for uncaught exceptions
 */
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack,
  });
  
  // Graceful shutdown
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', {
    reason: reason?.message || reason,
    stack: reason?.stack,
    promise: promise,
  });
  
  // Graceful shutdown
  process.exit(1);
});

module.exports = {
  AppError,
  ErrorTypes,
  errorHandler,
  notFoundHandler,
  asyncHandler,
  errorFactory,
  createErrorResponse,
};
