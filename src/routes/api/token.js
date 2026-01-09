const express = require('express');
const { asyncHandler } = require('../../middleware/errors');
const { generateJWT } = require('../../utils/crypto');
const { getDatabase } = require('../../config/database');
const logger = require('../../utils/logger');

const router = express.Router();

/**
 * GET /api/token/mobile
 * Get user's mobile API token
 */
router.get('/mobile', asyncHandler(async (req, res) => {
  try {
    const db = getDatabase();
    
    const token = await db.get(
      'SELECT token, created_at, expires_at FROM mobile_api_tokens WHERE user_id = ? AND expires_at > datetime("now")',
      [req.user.id]
    );

    if (token) {
      res.json({
        success: true,
        token: token.token,
        createdAt: token.created_at,
        expiresAt: token.expires_at
      });
    } else {
      res.json({
        success: true,
        token: null
      });
    }
  } catch (error) {
    logger.error('Get mobile token error:', error);
    res.status(500).json({ error: 'Failed to retrieve token' });
  }
}));

/**
 * POST /api/token/mobile
 * Generate a new mobile API token (30 days validity)
 */
router.post('/mobile', asyncHandler(async (req, res) => {
  try {
    const db = getDatabase();
    
    // Generate JWT token valid for 30 days
    const token = generateJWT({
      id: req.user.id,
      username: req.user.username,
      twitchId: req.user.twitch_id,
      role: req.user.role || 'user',
      type: 'mobile_api'
    }, null, {
      expiresIn: '30d'
    });

    // Delete old token if exists
    await db.run(
      'DELETE FROM mobile_api_tokens WHERE user_id = ?',
      [req.user.id]
    );

    // Store new token in database
    const expiresAt = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)); // 30 days from now
    await db.run(
      `INSERT INTO mobile_api_tokens (user_id, token, expires_at) 
       VALUES (?, ?, ?)`,
      [req.user.id, token, expiresAt.toISOString()]
    );

    logger.info(`Generated mobile API token for user ${req.user.username}`);

    res.json({
      success: true,
      token: token,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    logger.error('Generate mobile token error:', error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
}));

/**
 * GET /api/token/overlay
 * Get user's overlay token
 */
router.get('/overlay', asyncHandler(async (req, res) => {
  try {
    const db = getDatabase();
    
    const token = await db.get(
      'SELECT token, created_at, last_used_at FROM overlay_tokens WHERE user_id = ?',
      [req.user.id]
    );

    if (token) {
      res.json({
        success: true,
        token: token.token,
        createdAt: token.created_at,
        lastUsedAt: token.last_used_at
      });
    } else {
      res.json({
        success: true,
        token: null
      });
    }
  } catch (error) {
    logger.error('Get overlay token error:', error);
    res.status(500).json({ error: 'Failed to retrieve overlay token' });
  }
}));

/**
 * POST /api/token/overlay
 * Generate a new overlay token (no expiry)
 */
router.post('/overlay', asyncHandler(async (req, res) => {
  try {
    const db = getDatabase();
    const crypto = require('crypto');
    
    // Generate a long, random token (64 characters)
    const token = crypto.randomBytes(32).toString('hex');

    // Delete old token if exists
    await db.run(
      'DELETE FROM overlay_tokens WHERE user_id = ?',
      [req.user.id]
    );

    // Store new token in database (no expiry)
    await db.run(
      `INSERT INTO overlay_tokens (user_id, token) 
       VALUES (?, ?)`,
      [req.user.id, token]
    );

    logger.info(`Generated overlay token for user ${req.user.username}`);

    res.json({
      success: true,
      token: token,
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Generate overlay token error:', error);
    res.status(500).json({ error: 'Failed to generate overlay token' });
  }
}));

/**
 * DELETE /api/token/overlay
 * Revoke overlay token
 */
router.delete('/overlay', asyncHandler(async (req, res) => {
  try {
    const db = getDatabase();
    
    await db.run(
      'DELETE FROM overlay_tokens WHERE user_id = ?',
      [req.user.id]
    );

    logger.info(`Revoked overlay token for user ${req.user.username}`);

    res.json({
      success: true,
      message: 'Overlay token revoked successfully'
    });
  } catch (error) {
    logger.error('Revoke overlay token error:', error);
    res.status(500).json({ error: 'Failed to revoke overlay token' });
  }
}));

/**
 * DELETE /api/token/mobile
 * Revoke mobile API token
 */
router.delete('/mobile', asyncHandler(async (req, res) => {
  try {
    const db = getDatabase();
    
    await db.run(
      'DELETE FROM mobile_api_tokens WHERE user_id = ?',
      [req.user.id]
    );

    logger.info(`Revoked mobile API token for user ${req.user.username}`);

    res.json({
      success: true,
      message: 'Token revoked successfully'
    });
  } catch (error) {
    logger.error('Revoke mobile token error:', error);
    res.status(500).json({ error: 'Failed to revoke token' });
  }
}));

module.exports = router;
