const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { asyncHandler } = require('../../middleware/errors');
const logger = require('../../utils/logger');
const { getDatabase } = require('../../config/database');

const router = express.Router();

// Configure multer for picture uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../../public/uploads/pictures');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'picture-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB max file size (larger for videos)
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'
    ];
    const allowedExtensions = /\.(jpeg|jpg|png|gif|webp|mp4|webm|ogg|mov)$/i;
    
    const mimetypeValid = allowedMimeTypes.includes(file.mimetype);
    const extnameValid = allowedExtensions.test(file.originalname);

    if (mimetypeValid || extnameValid) {
      return cb(null, true);
    } else {
      cb(new Error(`Only image/video files are allowed. Received: ${file.mimetype}`));
    }
  }
});

/**
 * POST /api/pictures
 * Upload a picture to be displayed on the overlay
 */
router.post('/', (req, res, next) => {
  upload.single('picture')(req, res, (err) => {
    if (err) {
      // Handle Multer errors
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          error: 'File too large. Maximum size is 100MB.'
        });
      }
      if (err.message) {
        return res.status(400).json({
          success: false,
          error: err.message
        });
      }
      return res.status(500).json({
        success: false,
        error: 'File upload failed'
      });
    }
    next();
  });
}, asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'No picture file provided'
    });
  }

  try {
    const db = getDatabase();
    const userId = req.user.id;
    const filename = req.file.filename;
    const filepath = `/uploads/pictures/${filename}`;
    
    // Determine media type (image or video)
    const mediaType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
    
    logger.info(`Picture upload - User ID: ${userId}, Username: ${req.user.username || 'unknown'}, File: ${filename}, Type: ${mediaType}`);
    
    // Store media metadata in database
    const result = await db.run(
      `INSERT INTO overlay_pictures (user_id, filename, filepath, media_type, created_at) 
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [userId, filename, filepath, mediaType]
    );

    logger.info(`${mediaType} uploaded: ${filename} by user ${userId} (ID: ${result.id})`);

    res.json({
      success: true,
      picture: {
        id: result.id,
        filename: filename,
        filepath: filepath,
        mediaType: mediaType,
        createdAt: new Date().toISOString()
      }
    });
  } catch (error) {
    // Clean up uploaded file if database insert fails
    if (req.file && req.file.path) {
      await fs.unlink(req.file.path).catch(err => 
        logger.error('Failed to delete uploaded file after error:', err)
      );
    }
    throw error;
  }
}));

/**
 * GET /api/pictures
 * Get all active pictures/videos for the current user (created within last 30 seconds for images, or any active videos)
 */
router.get('/', asyncHandler(async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  
  // Get media created in the last 30 seconds (for queue management) - ONLY for this user
  const pictures = await db.all(
    `SELECT id, user_id, filename, filepath, media_type, created_at 
     FROM overlay_pictures 
     WHERE user_id = ? AND datetime(created_at, '+30 seconds') > datetime('now')
     ORDER BY created_at DESC`,
    [userId]
  );

  res.json({
    success: true,
    pictures: pictures.map(pic => ({
      id: pic.id,
      userId: pic.user_id,
      filename: pic.filename,
      url: pic.filepath, // Frontend expects 'url' property
      mediaType: pic.media_type || 'image',
      createdAt: pic.created_at
    }))
  });
}));

/**
 * DELETE /api/pictures/queue
 * Clear all queued media for the current user
 * IMPORTANT: Must be before /:id route to avoid matching "queue" as an ID
 */
router.delete('/queue', asyncHandler(async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;

  logger.info(`Clear queue request from user ${userId}`);

  // Get all user's pictures
  const userPictures = await db.all(
    'SELECT * FROM overlay_pictures WHERE user_id = ?',
    [userId]
  );

  logger.info(`Found ${userPictures.length} pictures to delete for user ${userId}`);

  // Delete files from filesystem
  for (const picture of userPictures) {
    const filepath = path.join(__dirname, '../../../public', picture.filepath);
    try {
      await fs.unlink(filepath);
      logger.info(`Deleted file: ${filepath}`);
    } catch (err) {
      logger.warn(`Failed to delete picture file ${filepath}:`, err.message);
    }
  }

  // Delete from database
  await db.run('DELETE FROM overlay_pictures WHERE user_id = ?', [userId]);

  // Update queue version to signal overlay to clear
  await db.run(
    `INSERT OR REPLACE INTO queue_version (user_id, version, updated_at) 
     VALUES (?, datetime('now'), datetime('now'))`,
    [userId]
  );

  logger.info(`Cleared ${userPictures.length} media items from queue for user ${userId}`);

  res.json({
    success: true,
    deletedCount: userPictures.length,
    message: `Cleared ${userPictures.length} item(s) from queue`
  });
}));

/**
 * DELETE /api/pictures/:id
 * Delete a picture
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const db = getDatabase();
  const pictureId = req.params.id;
  const userId = req.user.id;

  // Get picture details
  const picture = await db.get(
    'SELECT * FROM overlay_pictures WHERE id = ? AND user_id = ?',
    [pictureId, userId]
  );

  if (!picture) {
    return res.status(404).json({
      success: false,
      error: 'Picture not found'
    });
  }

  // Delete file from filesystem
  const filepath = path.join(__dirname, '../../../public', picture.filepath);
  await fs.unlink(filepath).catch(err => 
    logger.warn(`Failed to delete picture file ${filepath}:`, err)
  );

  // Delete from database
  await db.run('DELETE FROM overlay_pictures WHERE id = ?', [pictureId]);

  logger.info(`Picture deleted: ${picture.filename} by user ${userId}`);

  res.json({
    success: true,
    message: 'Picture deleted successfully'
  });
}));

/**
 * POST /api/pictures/cleanup
 * Clean up expired pictures (older than 30 seconds)
 */
router.post('/cleanup', asyncHandler(async (req, res) => {
  const db = getDatabase();

  // Get expired pictures
  const expiredPictures = await db.all(
    `SELECT * FROM overlay_pictures 
     WHERE datetime(created_at, '+30 seconds') <= datetime('now')`
  );

  let deletedCount = 0;
  for (const picture of expiredPictures) {
    // Delete file from filesystem
    const filepath = path.join(__dirname, '../../../public', picture.filepath);
    await fs.unlink(filepath).catch(err => 
      logger.warn(`Failed to delete expired picture file ${filepath}:`, err)
    );
    deletedCount++;
  }

  // Delete from database
  await db.run(
    `DELETE FROM overlay_pictures 
     WHERE datetime(created_at, '+30 seconds') <= datetime('now')`
  );

  logger.info(`Cleaned up ${deletedCount} expired pictures`);

  res.json({
    success: true,
    deletedCount: deletedCount
  });
}));

module.exports = router;
