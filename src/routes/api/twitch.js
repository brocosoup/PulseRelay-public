const express = require('express');
const { requireAuthOrJWT } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/errors');
const { getTwitchBot } = require('../../services/twitchBot');
const logger = require('../../utils/logger');

const router = express.Router();

/**
 * POST /api/twitch/send-command
 * Send a command to the user's Twitch channel
 */
router.post('/send-command', requireAuthOrJWT, asyncHandler(async (req, res) => {
  try {
    const { command, targetChannel } = req.body;
    
    if (!command) {
      return res.status(400).json({
        success: false,
        message: 'Command is required'
      });
    }
    
    // Validate command format
    const sanitizedCommand = command.trim();
    if (!sanitizedCommand) {
      return res.status(400).json({
        success: false,
        message: 'Message cannot be empty'
      });
    }
    
    // Get user information
    const { User } = require('../../models/User');
    
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Determine target user and channel
    let targetUser = user;
    let channelUsername = user.username || user.display_name || user.login || 'unknown';
    
    // If a target channel is specified, use it directly (KISS approach)
    if (targetChannel && targetChannel.trim() !== '') {
      channelUsername = targetChannel.trim().toLowerCase();
      // Use the current user's token to send to any channel
      logger.debug(`Sending command to channel: ${channelUsername} using ${user.username}'s token`);
    }
    
    logger.debug('User for Twitch command:', { 
      requester: user.username, 
      targetChannel: channelUsername,
      usingToken: user.username
    });

    logger.debug('Using channel username:', channelUsername);

    // Get the user-specific Twitch bot instance
    const twitchBot = getTwitchBot(user.id);
    
    // Get the stored access token for the current user (always use current user's token)
    const accessToken = user.twitchAccessToken;
    
    if (!accessToken) {
      logger.error('No Twitch access token found for user - token may have expired');
      return res.status(401).json({
        success: false,
        message: 'Twitch access token expired. Please re-authenticate.'
      });
    }

    // Initialize bot if not already connected for this user
    try {
      // Only initialize if bot is not ready - don't check needsRefresh on every message send
      // The bot is already initialized at server startup
      if (!twitchBot.isReady()) {
        logger.info(`Bot not ready, initializing for user: ${user.username}`);
        await twitchBot.initializeBot(user.username, accessToken, user.id, user);
      }
      // Else: bot is ready - just send the command without reinitializing
    } catch (initError) {
      logger.error('Failed to initialize Twitch bot - token may be expired:', initError);
      
      // Check if this is an authentication failure
      const isAuthError = initError.message && (
        initError.message.includes('Login authentication failed') ||
        initError.message.includes('Twitch authentication failed') ||
        initError.message.includes('oauth') ||
        initError.message.includes('authentication')
      );
      
      if (isAuthError) {
        // Token should already be invalidated by the bot service
        logger.warn(`Authentication failed - token invalidated for user: ${user.username}`);
      }
      
      return res.status(401).json({
        success: false,
        message: 'Twitch authentication failed. Please re-authenticate.',
        code: 'TOKEN_EXPIRED'
      });
    }

    // Send the command to the specified channel using current user's token
    const result = await twitchBot.sendCommandWithRefresh(channelUsername, sanitizedCommand, user.id);
    
    logger.debug(`Command sent to Twitch channel ${channelUsername}: ${sanitizedCommand}`);
    
    res.json({
      success: true,
      message: result.message,
      command: sanitizedCommand,
      timestamp: result.timestamp,
      channel: result.channel
    });
    
  } catch (error) {
    logger.error('Error sending Twitch command:', error);
    
    // Provide more specific error messages and status codes
    let errorMessage = 'Failed to send command';
    let statusCode = 500;
    
    const errorMsg = error.message || error.toString() || '';
    logger.error(`Debug: Received error message: "${errorMsg}"`);
    
    const isAuthError = errorMsg.includes('authentication') || 
                       errorMsg.includes('Login authentication failed') ||
                       errorMsg.includes('oauth') ||
                       errorMsg.includes('401') ||
                       errorMsg.includes('Invalid oauth token');
    
    if (isAuthError) {
      logger.error('Debug: Detected authentication error - returning 401');
      
      // Invalidate the token in the database
      try {
        // Get current user again to ensure we have the latest data
        const { User } = require('../../models/User');
        const userForInvalidation = await User.findById(user.id);
        if (userForInvalidation) {
          await userForInvalidation.invalidateTwitchToken();
          logger.warn(`Invalidated expired Twitch token for user: ${userForInvalidation.username}`);
        }
      } catch (invalidateError) {
        logger.error('Failed to invalidate token in database:', invalidateError);
      }
      
      errorMessage = 'Twitch authentication failed. Please re-authenticate.';
      statusCode = 401;
    } else if (errorMsg.includes('not connected')) {
      errorMessage = 'Twitch bot is not connected. Please try again.';
    } else if (errorMsg.includes('rate limit')) {
      errorMessage = 'Rate limited by Twitch. Please wait before sending another command.';
    }
    
    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      code: statusCode === 401 ? 'TOKEN_EXPIRED' : 'COMMAND_FAILED',
      error: errorMsg
    });
  }
}));

/**
 * GET /api/twitch/status
 * Get Twitch bot connection status
 */
router.get('/status', requireAuthOrJWT, asyncHandler(async (req, res) => {
  try {
    const twitchBot = getTwitchBot(req.user.id);
    const botStatus = twitchBot.getStatus();
    
    // Get user information
    const { User } = require('../../models/User');
    
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Check if user has a valid Twitch token
    if (!user.twitchAccessToken) {
      return res.status(401).json({
        success: false,
        message: 'Twitch access token expired. Please re-authenticate.',
        code: 'TOKEN_EXPIRED',
        connected: false,
        bot_ready: false
      });
    }
    
    // Check if bot needs refresh for this user
    const channelUsername = user.username || user.display_name || user.login || 'unknown';
    if (twitchBot.needsRefresh(channelUsername, user.twitchAccessToken, req.user.id)) {
      logger.debug(`Bot token/user mismatch detected in status check - user may need to re-authenticate: ${channelUsername}`);
      // Don't auto-disconnect or invalidate here in status check, just log it
      // The actual command sending will handle token refresh if needed
    }
    
    // Only invalidate token if bot explicitly indicates auth failure (not just mismatches)
    if (botStatus.auth_failed && botStatus.error && botStatus.error.includes('authentication')) {
      if (user.twitchAccessToken) {
        try {
          await user.invalidateTwitchToken();
          logger.warn(`Invalidated expired Twitch token for user: ${user.username} (bot reported auth failure)`);
          
          // Mark user as auth failed
          const { getAuthFailureHandler } = require('../../services/authFailureHandler');
          const authHandler = getAuthFailureHandler();
          await authHandler.invalidateUserSession(user.id, user.username);
        } catch (invalidateError) {
          logger.error('Failed to invalidate token in database:', invalidateError);
        }
        
        return res.status(401).json({
          success: false,
          message: 'Twitch authentication failed. Please re-authenticate.',
          code: 'TOKEN_EXPIRED',
          connected: false,
          bot_ready: false
        });
      }
    }
    
    res.json({
      success: true,
      connected: botStatus.connected,
      bot_ready: botStatus.client_ready,
      channel: user.username || user.display_name,
      reconnect_attempts: botStatus.reconnect_attempts,
      max_reconnect_attempts: botStatus.max_reconnect_attempts,
      last_check: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Error getting Twitch status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get status'
    });
  }
}));

/**
 * GET /api/twitch/commands
 * Get available commands
 */
router.get('/commands', requireAuthOrJWT, asyncHandler(async (req, res) => {
  try {
    const commands = [
      {
        command: '!irl',
        description: 'Switch to IRL scene',
        category: 'scenes',
        icon: 'fas fa-walking'
      },
      {
        command: '!scene',
        description: 'Switch scene',
        category: 'scenes',
        icon: 'fas fa-desktop'
      },
      {
        command: '!start_stream',
        description: 'Start stream',
        category: 'stream',
        icon: 'fas fa-play'
      },
      {
        command: '!stop_stream',
        description: 'Stop stream',
        category: 'stream',
        icon: 'fas fa-stop'
      },
      {
        command: '!brb',
        description: 'Be right back',
        category: 'status',
        icon: 'fas fa-pause-circle'
      },
      {
        command: '!reload',
        description: 'Reload stream',
        category: 'technical',
        icon: 'fas fa-sync-alt'
      },
      {
        command: '!full',
        description: 'Fullscreen camera',
        category: 'camera',
        icon: 'fas fa-expand'
      },
      {
        command: '!main',
        description: 'Main scene',
        category: 'scenes',
        icon: 'fas fa-home'
      }
    ];
    
    res.json({
      success: true,
      commands: commands
    });
    
  } catch (error) {
    logger.error('Error getting commands:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get commands'
    });
  }
}));

/**
 * GET /api/twitch/chat/recent
 * Get recent chat messages from the authenticated user's channel only
 */
router.get('/chat/recent', requireAuthOrJWT, asyncHandler(async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    
    const bot = getTwitchBot(req.user.id);
    
    if (!bot || !bot.isReady()) {
      return res.json({
        success: true,
        messages: [],
        note: 'Bot not connected yet'
      });
    }
    
    // Get user information to filter by their channel
    const { User } = require('../../models/User');
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Build list of channels this user should see: own channel + additional channels
    const userChannels = [`#${user.username}`, ...user.additionalChannels.map(ch => `#${ch}`)];
    
    // Get all messages and filter to user's channels
    const allMessages = bot.getRecentMessages(limit);
    
    // Debug logging
    logger.debug(`User channels (${userChannels.length}): ${JSON.stringify(userChannels)}`);
    logger.debug(`All messages (${allMessages.length}): ${allMessages.map(m => m.channel).join(', ')}`);
    
    const messages = allMessages.filter(msg => 
      userChannels.some(ch => ch.toLowerCase() === msg.channel.toLowerCase())
    );
    
    logger.debug(`Filtered messages (${messages.length}): ${messages.map(m => `${m.channel}: ${m.message}`).join(', ')}`);
    
    res.json({
      success: true,
      messages: messages
    });
    
  } catch (error) {
    logger.error('Error getting recent chat messages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get recent chat messages'
    });
  }
}));

/**
 * DELETE /api/twitch/chat/clear
 * Clear stored chat messages from memory
 */
router.delete('/chat/clear', requireAuthOrJWT, asyncHandler(async (req, res) => {
  try {
    const bot = getTwitchBot(req.user.id);
    
    if (!bot || !bot.isReady()) {
      return res.json({
        success: true,
        message: 'No messages to clear (bot not connected)'
      });
    }
    
    // Clear the messages
    bot.clearRecentMessages();
    
    res.json({
      success: true,
      message: 'Chat messages cleared'
    });
    
  } catch (error) {
    logger.error('Error clearing chat messages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear chat messages'
    });
  }
}));

/**
 * POST /api/twitch/chat/mark-read
 * Mark chat messages as read for the authenticated user
 */
router.post('/chat/mark-read', requireAuthOrJWT, asyncHandler(async (req, res) => {
  try {
    const bot = getTwitchBot(req.user.id);
    
    if (!bot || !bot.isReady()) {
      return res.json({
        success: true,
        message: 'No messages to mark (bot not connected)'
      });
    }
    
    // Mark messages as read with current timestamp
    bot.markMessagesAsRead(req.user.id);
    
    res.json({
      success: true,
      message: 'Messages marked as read'
    });
    
  } catch (error) {
    logger.error('Error marking messages as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark messages as read'
    });
  }
}));

/**
 * GET /api/twitch/chat/unread-count
 * Get count of unread messages for the authenticated user
 */
router.get('/chat/unread-count', requireAuthOrJWT, asyncHandler(async (req, res) => {
  try {
    const bot = getTwitchBot(req.user.id);
    
    if (!bot || !bot.isReady()) {
      return res.json({
        success: true,
        unreadCount: 0,
        note: 'Bot not connected yet'
      });
    }
    
    // Get user information to filter by their channel
    const { User } = require('../../models/User');
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Get unread count for user's channel
    const userChannel = `#${user.username || user.login}`;
    const unreadCount = bot.getUnreadCount(req.user.id, userChannel);
    
    res.json({
      success: true,
      unreadCount: unreadCount,
      channel: userChannel
    });
    
  } catch (error) {
    logger.error('Error getting unread count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unread count'
    });
  }
}));

/**
 * POST /api/twitch/timeout
 * Timeout a user in the channel for 60 seconds
 */
router.post('/timeout', requireAuthOrJWT, asyncHandler(async (req, res) => {
  try {
    const { username, duration = 60 } = req.body;
    
    if (!username) {
      return res.status(400).json({
        success: false,
        message: 'Username is required'
      });
    }
    
    // Get user information
    const { User } = require('../../models/User');
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Ensure we have a fresh, valid token
    const freshUser = await user.getFreshToken();
    
    const bot = getTwitchBot(req.user.id);
    
    if (!bot || !bot.isReady()) {
      logger.warn('Timeout request but bot not ready', {
        botExists: !!bot,
        botReady: bot ? bot.isReady() : false,
        botConnected: bot ? bot.isConnected : false,
        username: freshUser.username
      });
      return res.status(503).json({
        success: false,
        message: 'Bot not connected. Please visit the mobile page first to connect the bot.',
        botStatus: {
          ready: bot ? bot.isReady() : false,
          connected: bot ? bot.isConnected : false
        }
      });
    }
    
    // Send timeout command to channel
    const channelName = freshUser.username || freshUser.login;
    await bot.timeout(channelName, username, duration, freshUser.twitchAccessToken, freshUser.twitchId);
    
    // Mark user as timed out in bot's message tracking
    bot.markUserTimedOut(username, duration);
    
    logger.info(`User ${username} timed out for ${duration}s in ${channelName}`);
    
    res.json({
      success: true,
      message: `User ${username} timed out for ${duration} seconds`
    });
    
  } catch (error) {
    logger.error('Error timing out user:', {
      error: error.message,
      stack: error.stack,
      username: req.body.username,
      duration: req.body.duration
    });
    
    // Check for specific Twitch errors
    const errorMsg = error.message || '';
    
    // Can't timeout yourself or certain users
    if (errorMsg.includes('may not be banned/timed out')) {
      return res.status(400).json({
        success: false,
        message: 'Cannot timeout this user (broadcaster, moderator, or VIP)',
        error: errorMsg
      });
    }
    
    // Permission errors
    if (errorMsg.includes('no_permission') || 
        errorMsg.includes('missing required scope') || 
        errorMsg.includes('Unauthorized') ||
        errorMsg.includes('Invalid OAuth token')) {
      return res.status(403).json({
        success: false,
        message: 'Missing moderator permissions. Please log out and log back in to grant the required scopes.',
        needsReauth: true
      });
    }
    
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to timeout user',
      error: error.message
    });
  }
}));

/**
 * POST /api/twitch/delete-message
 * Delete a specific message by ID
 */
router.post('/delete-message', requireAuthOrJWT, asyncHandler(async (req, res) => {
  try {
    const { messageId } = req.body;
    
    if (!messageId) {
      return res.status(400).json({
        success: false,
        message: 'Message ID is required'
      });
    }
    
    // Get user information
    const { User } = require('../../models/User');
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Ensure we have a fresh, valid token
    const freshUser = await user.getFreshToken();
    
    const bot = getTwitchBot(req.user.id);
    
    if (!bot || !bot.isReady()) {
      return res.status(503).json({
        success: false,
        message: 'Bot not connected'
      });
    }
    
    // Delete message by ID
    const channelName = freshUser.username || freshUser.login;
    await bot.deletemessage(channelName, messageId, freshUser.twitchAccessToken, freshUser.twitchId);
    
    // Mark message as deleted in bot's message tracking
    bot.markMessageDeleted(messageId);
    
    logger.info(`Message ${messageId} deleted in ${channelName}`);
    
    res.json({
      success: true,
      message: 'Message deleted'
    });
    
  } catch (error) {
    logger.error('Error deleting message:', {
      error: error.message,
      stack: error.stack,
      messageId: req.body.messageId
    });
    
    // Check if it's a permission error
    const errorMsg = error.message || '';
    if (errorMsg.includes('no_permission') || 
        errorMsg.includes('missing required scope') || 
        errorMsg.includes('Unauthorized') ||
        errorMsg.includes('Invalid OAuth token')) {
      return res.status(403).json({
        success: false,
        message: 'Missing moderator permissions. Please log out and log back in to grant the required scopes.',
        needsReauth: true
      });
    }
    
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete message',
      error: error.message
    });
  }
}));

module.exports = router;
