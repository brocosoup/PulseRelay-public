const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

/**
 * Generate a secure random stream key
 * @param {number} length - Length of the stream key
 * @returns {string} - Secure random stream key
 */
function generateStreamKey(length = 32) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    result += characters.charAt(crypto.randomInt(0, characters.length));
  }
  
  return result;
}

/**
 * Generate a secure random API key
 * @param {number} length - Length of the API key
 * @returns {string} - Secure random API key
 */
function generateApiKey(length = 64) {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Generate a secure random secret
 * @param {number} length - Length of the secret
 * @returns {string} - Secure random secret
 */
function generateSecret(length = 32) {
  return crypto.randomBytes(length).toString('base64');
}

/**
 * Hash a password using bcrypt
 * @param {string} password - Plain text password
 * @param {number} saltRounds - Number of salt rounds (default: 12)
 * @returns {Promise<string>} - Hashed password
 */
async function hashPassword(password, saltRounds = 12) {
  return bcrypt.hash(password, saltRounds);
}

/**
 * Verify a password against a hash
 * @param {string} password - Plain text password
 * @param {string} hash - Hashed password
 * @returns {Promise<boolean>} - True if password matches
 */
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Generate a JWT token
 * @param {object} payload - Token payload
 * @param {string} secret - JWT secret
 * @param {object} options - JWT options
 * @returns {string} - JWT token
 */
function generateJWT(payload, secret = null, options = {}) {
  if (!secret) {
    const { getSecrets } = require('../config/config');
    secret = getSecrets().jwtSecret;
  }
  
  const defaultOptions = {
    expiresIn: '24h',
    issuer: 'pulserelay',
    audience: 'pulserelay-client',
  };
  
  return jwt.sign(payload, secret, { ...defaultOptions, ...options });
}

/**
 * Verify a JWT token
 * @param {string} token - JWT token
 * @param {string} secret - JWT secret
 * @returns {object} - Decoded token payload
 */
function verifyJWT(token, secret = null) {
  if (!secret) {
    const { getSecrets } = require('../config/config');
    secret = getSecrets().jwtSecret;
  }
  
  try {
    return jwt.verify(token, secret, {
      issuer: 'pulserelay',
      audience: 'pulserelay-client',
    });
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

/**
 * Generate a secure hash for data integrity
 * @param {string} data - Data to hash
 * @param {string} algorithm - Hash algorithm (default: sha256)
 * @returns {string} - Hash digest
 */
function generateHash(data, algorithm = 'sha256') {
  return crypto.createHash(algorithm).update(data).digest('hex');
}

/**
 * Generate HMAC for data authentication
 * @param {string} data - Data to authenticate
 * @param {string} key - HMAC key
 * @param {string} algorithm - HMAC algorithm (default: sha256)
 * @returns {string} - HMAC digest
 */
function generateHMAC(data, key, algorithm = 'sha256') {
  return crypto.createHmac(algorithm, key).update(data).digest('hex');
}

/**
 * Verify HMAC
 * @param {string} data - Original data
 * @param {string} key - HMAC key
 * @param {string} expectedHmac - Expected HMAC
 * @param {string} algorithm - HMAC algorithm (default: sha256)
 * @returns {boolean} - True if HMAC is valid
 */
function verifyHMAC(data, key, expectedHmac, algorithm = 'sha256') {
  const actualHmac = generateHMAC(data, key, algorithm);
  return crypto.timingSafeEqual(
    Buffer.from(actualHmac, 'hex'),
    Buffer.from(expectedHmac, 'hex')
  );
}

/**
 * Encrypt data using AES-256-GCM
 * @param {string} data - Data to encrypt
 * @param {string} key - Encryption key (optional, uses default from config)
 * @returns {string} - Encrypted data as JSON string
 */
function encryptData(data, key = null) {
  if (!key) {
    const { getSecrets } = require('../config/config');
    key = getSecrets().encryptionKey;
  }
  
  const algorithm = 'aes-256-gcm';
  const iv = crypto.randomBytes(16);
  
  // Derive a proper 32-byte key from the encryption key
  const keyBuffer = crypto.createHash('sha256').update(key).digest();
  
  const cipher = crypto.createCipheriv(algorithm, keyBuffer, iv);
  cipher.setAAD(Buffer.from('pulserelay'));
  
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Return as JSON string for easy storage
  return JSON.stringify({
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  });
}

/**
 * Decrypt data using AES-256-GCM
 * @param {string} encryptedDataStr - Encrypted data as JSON string
 * @param {string} key - Decryption key (optional, uses default from config)
 * @returns {string} - Decrypted data
 */
function decryptData(encryptedDataStr, key = null) {
  if (!key) {
    const { getSecrets } = require('../config/config');
    key = getSecrets().encryptionKey;
  }
  
  const encryptedData = JSON.parse(encryptedDataStr);
  const algorithm = 'aes-256-gcm';
  
  // Derive a proper 32-byte key from the encryption key
  const keyBuffer = crypto.createHash('sha256').update(key).digest();
  
  const decipher = crypto.createDecipheriv(
    algorithm,
    keyBuffer,
    Buffer.from(encryptedData.iv, 'hex')
  );
  decipher.setAAD(Buffer.from('pulserelay'));
  decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
  
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Generate a secure session ID
 * @returns {string} - Secure session ID
 */
function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a time-based one-time password (TOTP) secret
 * @returns {string} - TOTP secret
 */
function generateTOTPSecret() {
  return crypto.randomBytes(20).toString('base32');
}

module.exports = {
  generateStreamKey,
  generateApiKey,
  generateSecret,
  hashPassword,
  verifyPassword,
  generateJWT,
  verifyJWT,
  generateHash,
  generateHMAC,
  verifyHMAC,
  encryptData,
  decryptData,
  generateSessionId,
  generateTOTPSecret,
};
