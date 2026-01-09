const Joi = require('joi');
const logger = require('../utils/logger');

/**
 * Generic validation middleware factory
 */
function validate(schema, property = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context.value,
      }));

      logger.warn('Validation error:', {
        url: req.originalUrl,
        method: req.method,
        errors,
        ip: req.ip,
      });

      return res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors,
      });
    }

    // Replace the property with the validated value
    req[property] = value;
    next();
  };
}

// Schema definitions
const schemas = {
  // RTMP destination schemas
  rtmpDestination: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    rtmp_url: Joi.string().uri().required(),
    stream_key: Joi.string().min(1).max(200).required(),
    is_active: Joi.boolean().optional(),
  }),

  updateRtmpDestination: Joi.object({
    name: Joi.string().min(1).max(100).optional(),
    rtmp_url: Joi.string().uri().optional(),
    stream_key: Joi.string().min(1).max(200).optional(),
    is_active: Joi.boolean().optional(),
  }),

  // Stream key schemas
  streamKeyRegenerate: Joi.object({
    confirm: Joi.boolean().valid(true).required(),
  }),

  // Test pattern schemas
  testPatternSettings: Joi.object({
    text: Joi.string().min(1).max(200).optional(),
    bitrate: Joi.number().integer().min(100).max(10000).optional(),
    resolution: Joi.string().pattern(/^\d+x\d+$/).optional(),
    framerate: Joi.number().integer().min(1).max(120).optional(),
    background_color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional(),
    text_color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional(),
  }),

  // System settings schemas
  systemSettings: Joi.object({
    rtmp_port: Joi.number().integer().min(1024).max(65535).optional(),
    http_port: Joi.number().integer().min(1024).max(65535).optional(),
    max_connections: Joi.number().integer().min(1).max(1000).optional(),
    test_pattern_enabled: Joi.boolean().optional(),
    log_level: Joi.string().valid('error', 'warn', 'info', 'debug').optional(),
  }),

  // User profile schemas
  userProfile: Joi.object({
    display_name: Joi.string().min(1).max(100).optional(),
    email: Joi.string().email().optional(),
  }),

  // Query parameter schemas
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    sort: Joi.string().valid('created_at', 'updated_at', 'name').default('created_at'),
    order: Joi.string().valid('asc', 'desc').default('desc'),
  }),

  // Stream status query
  streamStatus: Joi.object({
    include_inactive: Joi.boolean().default(false),
  }),

  // API key schemas
  apiKey: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    permissions: Joi.array().items(
      Joi.string().valid('read', 'write', 'admin')
    ).default(['read']),
    expires_at: Joi.date().greater('now').optional(),
  }),

  // Webhook schemas
  webhook: Joi.object({
    url: Joi.string().uri().required(),
    events: Joi.array().items(
      Joi.string().valid(
        'stream.started',
        'stream.stopped',
        'stream.error',
        'restream.started',
        'restream.stopped',
        'restream.error'
      )
    ).min(1).required(),
    secret: Joi.string().min(8).max(200).optional(),
    is_active: Joi.boolean().default(true),
  }),

  // Authentication schemas
  login: Joi.object({
    username: Joi.string().alphanum().min(3).max(30).required(),
    password: Joi.string().min(6).max(128).required(),
  }),

  // Stream configuration schemas
  streamConfig: Joi.object({
    title: Joi.string().min(1).max(200).optional(),
    description: Joi.string().max(1000).optional(),
    category: Joi.string().max(100).optional(),
    tags: Joi.array().items(Joi.string().max(50)).max(10).optional(),
    thumbnail_url: Joi.string().uri().optional(),
    is_private: Joi.boolean().default(false),
    recording_enabled: Joi.boolean().default(false),
    chat_enabled: Joi.boolean().default(true),
  }),

  // Location sharing schemas
  locationSettings: Joi.object({
    enabled: Joi.boolean().required(),
    locationMode: Joi.string().valid('gps', 'fixed').default('gps'),
    accuracyThreshold: Joi.number().integer().min(1).max(10000).default(5000),
    updateInterval: Joi.number().integer().min(1).max(300).optional(),
    autoDisableAfter: Joi.number().integer().min(0).max(86400).optional(),
    fixedLatitude: Joi.number().min(-90).max(90).optional().allow(null),
    fixedLongitude: Joi.number().min(-180).max(180).optional().allow(null),
    fixedLocationName: Joi.string().max(255).optional().allow('', null),
  }).custom((value, helpers) => {
    // Custom validation: if locationMode is 'fixed' and enabled is true, require coordinates
    if (value.enabled && value.locationMode === 'fixed') {
      if (value.fixedLatitude === null || value.fixedLatitude === undefined) {
        return helpers.error('any.required', { label: 'fixedLatitude' });
      }
      if (value.fixedLongitude === null || value.fixedLongitude === undefined) {
        return helpers.error('any.required', { label: 'fixedLongitude' });
      }
    }
    return value;
  }),

  locationUpdate: Joi.object({
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required(),
    accuracy: Joi.number().min(0).max(10000).optional().allow(null),
    altitude: Joi.number().optional().allow(null),
    altitudeAccuracy: Joi.number().min(0).optional().allow(null),
    heading: Joi.number().min(0).max(360).optional().allow(null),
    speed: Joi.number().min(0).optional().allow(null),
    gpsQuality: Joi.number().integer().min(0).max(100).optional().allow(null),
    gsmSignal: Joi.number().integer().min(0).max(100).optional().allow(null),
  }),
};

// Pre-built validation middleware
const validateRtmpDestination = validate(schemas.rtmpDestination);
const validateUpdateRtmpDestination = validate(schemas.updateRtmpDestination);
const validateStreamKeyRegenerate = validate(schemas.streamKeyRegenerate);
const validateTestPatternSettings = validate(schemas.testPatternSettings);
const validateSystemSettings = validate(schemas.systemSettings);
const validateUserProfile = validate(schemas.userProfile);
const validatePagination = validate(schemas.pagination, 'query');
const validateStreamStatus = validate(schemas.streamStatus, 'query');
const validateApiKey = validate(schemas.apiKey);
const validateWebhook = validate(schemas.webhook);
const validateLogin = validate(schemas.login);
const validateStreamConfig = validate(schemas.streamConfig);
const validateLocationSettings = validate(schemas.locationSettings);
const validateLocationUpdate = validate(schemas.locationUpdate);

/**
 * Validate URL parameters
 */
function validateParams(schema) {
  return validate(schema, 'params');
}

/**
 * Validate query parameters
 */
function validateQuery(schema) {
  return validate(schema, 'query');
}

/**
 * Validate headers
 */
function validateHeaders(schema) {
  return validate(schema, 'headers');
}

/**
 * Sanitize input to prevent XSS
 */
function sanitizeInput(req, res, next) {
  const sanitizeValue = (value) => {
    if (typeof value === 'string') {
      return value
        .replace(/[<>]/g, '') // Remove < and >
        .replace(/javascript:/gi, '') // Remove javascript: protocol
        .replace(/on\w+=/gi, '') // Remove event handlers
        .trim();
    }
    return value;
  };

  const sanitizeObject = (obj) => {
    if (typeof obj !== 'object' || obj === null) {
      return sanitizeValue(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(sanitizeObject);
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  };

  // Sanitize request body
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  // Sanitize query parameters
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }

  // Sanitize URL parameters
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }

  next();
}

/**
 * Validate file upload
 */
function validateFileUpload(options = {}) {
  const {
    maxSize = 5 * 1024 * 1024, // 5MB default
    allowedTypes = ['image/jpeg', 'image/png', 'image/gif'],
    required = false,
  } = options;

  return (req, res, next) => {
    if (!req.file && required) {
      return res.status(400).json({
        error: 'File upload required',
        code: 'FILE_REQUIRED',
      });
    }

    if (!req.file) {
      return next();
    }

    // Check file size
    if (req.file.size > maxSize) {
      return res.status(400).json({
        error: 'File too large',
        code: 'FILE_TOO_LARGE',
        details: {
          maxSize: maxSize,
          actualSize: req.file.size,
        },
      });
    }

    // Check file type
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        error: 'Invalid file type',
        code: 'FILE_TYPE_INVALID',
        details: {
          allowedTypes,
          actualType: req.file.mimetype,
        },
      });
    }

    next();
  };
}

module.exports = {
  validate,
  validateParams,
  validateQuery,
  validateHeaders,
  sanitizeInput,
  validateFileUpload,
  schemas,
  // Pre-built validators
  validateRtmpDestination,
  validateUpdateRtmpDestination,
  validateStreamKeyRegenerate,
  validateTestPatternSettings,
  validateSystemSettings,
  validateUserProfile,
  validatePagination,
  validateStreamStatus,
  validateApiKey,
  validateWebhook,
  validateLogin,
  validateStreamConfig,
  validateLocationSettings,
  validateLocationUpdate,
};
