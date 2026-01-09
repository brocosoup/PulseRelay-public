const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { parseFile } = require('music-metadata');
const logger = require('../../utils/logger');
const { getConfig } = require('../../config/config');
const { requireOverlayAuth } = require('../../middleware/auth');

// In-memory state for current playing track
let currentTrack = null;
const TRACK_TIMEOUT_MS = 30000; // 30 seconds - if no update, consider stopped

// Apply overlay auth to all music routes
router.use(requireOverlayAuth);

/**
 * GET /api/music/library
 * Scan music directory and return list of MP3 files with metadata
 */
router.get('/library', async (req, res) => {
  try {
    const config = getConfig();
    const musicDir = config.musicPlayer?.directory;

    if (!musicDir) {
      return res.json({ tracks: [] });
    }

    // Check if directory exists
    try {
      await fs.access(musicDir);
    } catch (err) {
      logger.warn(`Music directory not found: ${musicDir}`);
      return res.json({ tracks: [] });
    }

    // Recursively scan directory for MP3 files
    const tracks = await scanMusicDirectory(musicDir);
    res.json({ tracks });
  } catch (error) {
    logger.error('Error getting music library:', error);
    res.json({ tracks: [] }); // Fail silently for overlays
  }
});

/**
 * GET /api/music/file/:trackId
 * Stream audio file
 */
router.get('/file/:trackId', async (req, res) => {
  try {
    const { trackId } = req.params;
    const config = getConfig();
    const musicDir = config.musicPlayer?.directory;

    if (!musicDir) {
      return res.status(404).end();
    }

    // Decode the track ID (base64 encoded file path)
    const filePath = Buffer.from(trackId, 'base64').toString('utf-8');

    // Security: Ensure file is within music directory
    const resolvedPath = path.resolve(filePath);
    const resolvedMusicDir = path.resolve(musicDir);
    
    if (!resolvedPath.startsWith(resolvedMusicDir)) {
      logger.warn(`Attempted access outside music directory: ${filePath}`);
      return res.status(403).end();
    }

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (err) {
      return res.status(404).end();
    }

    // Determine content type from file extension
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.flac': 'audio/flac',
      '.m4a': 'audio/mp4',
      '.ogg': 'audio/ogg',
      '.opus': 'audio/opus',
      '.aac': 'audio/aac',
      '.wma': 'audio/x-ms-wma'
    };

    // Stream the file
    res.setHeader('Content-Type', contentTypes[ext] || 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    
    const stat = await fs.stat(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', chunksize);
      
      const readStream = require('fs').createReadStream(filePath, { start, end });
      readStream.pipe(res);
    } else {
      res.setHeader('Content-Length', fileSize);
      const readStream = require('fs').createReadStream(filePath);
      readStream.pipe(res);
    }
  } catch (error) {
    logger.error('Error streaming music file:', error);
    res.status(500).end();
  }
});

/**
 * GET /api/music/cover/:trackId
 * Get album cover art for a track
 */
router.get('/cover/:trackId', async (req, res) => {
  try {
    const { trackId } = req.params;
    const config = getConfig();
    const musicDir = config.musicPlayer?.directory;

    if (!musicDir) {
      return res.status(404).end();
    }

    const filePath = Buffer.from(trackId, 'base64').toString('utf-8');
    const resolvedPath = path.resolve(filePath);
    const resolvedMusicDir = path.resolve(musicDir);
    
    if (!resolvedPath.startsWith(resolvedMusicDir)) {
      return res.status(403).end();
    }

    const metadata = await parseFile(filePath);
    const picture = metadata.common.picture?.[0];

    if (picture) {
      res.setHeader('Content-Type', picture.format);
      res.send(picture.data);
    } else {
      res.status(404).end();
    }
  } catch (error) {
    logger.error('Error getting album cover:', error);
    res.status(404).end();
  }
});

/**
 * GET /api/music/settings
 * Get music player settings
 */
router.get('/settings', (req, res) => {
  try {
    const config = getConfig();
    res.json({
      directory: config.musicPlayer?.directory || '',
      audioOutput: config.musicPlayer?.audioOutput || 'default'
    });
  } catch (error) {
    logger.error('Error getting music settings:', error);
    res.json({ directory: '', audioOutput: 'default' });
  }
});

/**
 * POST /api/music/settings
 * Update music player settings
 */
router.post('/settings', async (req, res) => {
  try {
    const { directory } = req.body;

    if (!directory || typeof directory !== 'string') {
      return res.status(400).json({ error: 'Directory is required' });
    }

    // Read current config
    const configPath = path.join(process.cwd(), 'config.json');
    let config = {};
    
    try {
      const configContent = await fs.readFile(configPath, 'utf8');
      config = JSON.parse(configContent);
    } catch (err) {
      logger.error('Error reading config.json:', err);
      return res.status(500).json({ error: 'Failed to read configuration' });
    }

    // Update music player directory
    if (!config.musicPlayer) {
      config.musicPlayer = {};
    }
    config.musicPlayer.directory = directory;

    // Write updated config
    try {
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
      logger.info(`Music directory updated to: ${directory}`);
    } catch (err) {
      logger.error('Error writing config.json:', err);
      return res.status(500).json({ error: 'Failed to save configuration' });
    }

    // Force reload of config
    delete require.cache[require.resolve('../../config/config')];

    res.json({ success: true, directory });
  } catch (error) {
    logger.error('Error updating music settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * GET /api/music/now-playing
 * Get currently playing track (with timeout check)
 */
router.get('/now-playing', (req, res) => {
  try {
    // Check if current track has timed out
    if (currentTrack && currentTrack.updatedAt) {
      const lastUpdate = new Date(currentTrack.updatedAt);
      const now = new Date();
      const timeSinceUpdate = now - lastUpdate;
      
      // If no update in 30 seconds, consider it stopped
      if (timeSinceUpdate > TRACK_TIMEOUT_MS) {
        logger.info('Now playing timed out - no update in 30s');
        currentTrack = null;
      }
    }
    
    res.json(currentTrack || {
      isPlaying: false,
      track: null
    });
  } catch (error) {
    logger.error('Error getting now playing:', error);
    res.json({ isPlaying: false, track: null });
  }
});

/**
 * POST /api/music/now-playing
 * Update currently playing track
 */
router.post('/now-playing', express.json(), (req, res) => {
  try {
    const { isPlaying, track } = req.body;
    
    currentTrack = {
      isPlaying: !!isPlaying,
      track: track || null,
      updatedAt: new Date().toISOString()
    };
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Error updating now playing:', error);
    res.status(500).json({ success: false });
  }
});

/**
 * Recursively scan directory for audio files
 */
async function scanMusicDirectory(dir, baseDir = dir) {
  const tracks = [];
  const supportedExtensions = ['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.opus', '.aac', '.wma'];
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subTracks = await scanMusicDirectory(fullPath, baseDir);
        tracks.push(...subTracks);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (supportedExtensions.includes(ext)) {
          // Parse audio metadata
          try {
            const metadata = await parseFile(fullPath);
            const trackId = Buffer.from(fullPath).toString('base64');
            
            tracks.push({
              id: trackId,
              title: metadata.common.title || path.basename(entry.name, ext),
              artist: metadata.common.artist || 'Unknown Artist',
              album: metadata.common.album || 'Unknown Album',
              duration: metadata.format.duration || 0,
              hasCover: !!metadata.common.picture?.[0],
              path: path.relative(baseDir, fullPath)
            });
          } catch (err) {
            logger.warn(`Failed to parse metadata for ${fullPath}:`, err.message);
          }
        }
      }
    }
  } catch (err) {
    logger.error(`Error scanning directory ${dir}:`, err);
  }
  
  return tracks;
}

module.exports = router;
