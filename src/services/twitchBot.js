const tmi = require('tmi.js');
const logger = require('../utils/logger');
const { get: getConfig } = require('../config/config');
const { getAuthFailureHandler } = require('./authFailureHandler');
const { getOpenAIService } = require('./openai');

class TwitchBotService {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.authFailed = false;
        this.currentUserId = null; // Track current connected user
        this.currentToken = null; // Track current token
        this.currentUsername = null; // Track current username
        this.isRefreshing = false; // Track if we're currently refreshing tokens
        this.isInitializing = false; // Prevent multiple simultaneous initialization attempts
        this.initializationPromise = null; // Store current initialization promise
        this.lastAuthFailure = null; // Track when last auth failure occurred
        this.authFailureCooldown = 60000; // 60 seconds cooldown after auth failure
        this.recentMessages = []; // Store recent chat messages (last 50)
        this.maxMessages = 50; // Maximum messages to keep in memory
        this.lastReadTimestamps = new Map(); // Track last read timestamp per user ID
        this.deletedMessageIds = new Set(); // Track deleted message IDs
        this.timedOutUsers = new Map(); // Track timed out users with expiry timestamp
    }

    /**
     * Check if bot needs to be refreshed for this user/token combination
     */
    needsRefresh(username, oauthToken, userId) {
        // If not connected at all, needs refresh
        if (!this.isConnected || !this.client) {
            return true;
        }
        
        // If auth failed, needs refresh
        if (this.authFailed) {
            return true;
        }
        
        // If different user, needs refresh
        if (this.currentUserId !== userId) {
            return true;
        }
        
        // If different token, needs refresh (user reauthenticated)
        if (this.currentToken !== oauthToken) {
            logger.info(`Token mismatch detected for user ${username} - forcing bot refresh`);
            return true;
        }
        
        // If different username, needs refresh
        if (this.currentUsername !== username.toLowerCase()) {
            return true;
        }
        
        return false;
    }

    /**
     * Initialize the Twitch bot with user credentials
     */
    async initializeBot(username, oauthToken, userId = null, userObject = null) {
        // If already initializing, wait for the current initialization to complete
        if (this.isInitializing && this.initializationPromise) {
            logger.warn(`Bot initialization already in progress for ${username}, waiting for completion... (preventing duplicate connections)`);
            try {
                return await this.initializationPromise;
            } catch (error) {
                logger.warn(`Previous initialization failed for ${username}, retrying...`);
                // Continue with new initialization attempt
            }
        }

        // Set initialization lock
        this.isInitializing = true;
        logger.debug(`Setting initialization lock for user ${username}`);
        
        // Create initialization promise
        this.initializationPromise = this._performInitialization(username, oauthToken, userId, userObject);
        
        try {
            const result = await this.initializationPromise;
            logger.debug(`Initialization completed successfully for user ${username}`);
            return result;
        } finally {
            // Always clear the initialization lock
            this.isInitializing = false;
            this.initializationPromise = null;
            logger.debug(`Initialization lock cleared for user ${username}`);
        }
    }

    /**
     * Internal method to perform the actual initialization
     */
    async _performInitialization(username, oauthToken, userId = null, userObject = null) {
        try {
            // Check if we're in a cooldown period after auth failure
            if (this.lastAuthFailure && (Date.now() - this.lastAuthFailure) < this.authFailureCooldown) {
                logger.warn(`Skipping bot initialization for ${username} - in cooldown period after auth failure`);
                throw new Error('Bot initialization in cooldown period after authentication failure');
            }

            // Get additional channels from user
            let additionalChannels = [];
            if (userObject && userObject.additionalChannels) {
                additionalChannels = userObject.additionalChannels;
            }

            // If we have a user object, try to refresh token if needed
            if (userObject) {
                try {
                    const freshUser = await userObject.getFreshToken();
                    if (freshUser.twitchAccessToken !== oauthToken) {
                        logger.info(`Token was refreshed for user ${username}, using fresh token`);
                        oauthToken = freshUser.twitchAccessToken;
                    }
                } catch (refreshError) {
                    logger.debug(`Token refresh not available for user ${username}:`, refreshError.message);
                    // Continue with existing token - this is normal for older users without refresh tokens
                }
            }

            // Check if we need to refresh the connection
            const needsRefresh = this.needsRefresh(username, oauthToken, userId);
            if (!needsRefresh) {
                logger.debug(`Bot already connected for user ${username} with current token - skipping initialization`);
                return true;
            }

            logger.info(`Initializing bot for user ${username} (refresh needed: token/user change)`);

            // Clean up existing client
            if (this.client) {
                await this.disconnect();
            }

            // Store current connection details
            this.currentUserId = userId;
            this.currentToken = oauthToken;
            this.currentUsername = username.toLowerCase();
            
            // Build channel list: own channel + additional channels
            const channels = [username.toLowerCase(), ...additionalChannels.map(ch => ch.toLowerCase())];
            const uniqueChannels = [...new Set(channels)]; // Remove duplicates

            // Configure the TMI client with simple, reliable settings
            const options = {
                options: { 
                    debug: false,
                    messagesLogLevel: "info", // Prevent TMI from logging normal messages as errors
                    skipMembership: true, // Skip membership events to reduce noise
                    skipUpdatingEmotesets: true // Skip emote updates to reduce noise
                },
                connection: {
                    reconnect: true, // Let TMI handle reconnections
                    secure: true,
                    reconnectInterval: 10000, // 10 seconds between reconnect attempts
                    maxReconnectAttempts: 5 // Reasonable limit
                },
                identity: {
                    username: username.toLowerCase(),
                    password: `oauth:${oauthToken}`
                },
                channels: uniqueChannels
            };

            logger.info(`Bot will join channels: ${uniqueChannels.join(', ')}`);

            this.client = new tmi.Client(options);

            // Set up event handlers
            this.setupEventHandlers(username, userId);

            // Connect to Twitch
            await this.client.connect();
            
            // Clear auth failure state on successful connection
            this.authFailed = false;
            this.lastAuthFailure = null;
            
            logger.info(`Twitch bot connected for user: ${username}`);
            return true;

        } catch (error) {
            logger.error('Failed to initialize Twitch bot:', error);
            this.isConnected = false;
            this.authFailed = true;
            this.lastAuthFailure = Date.now();
            
            // Check for authentication-related errors
            if (error.message && (
                error.message.includes('Login authentication failed') ||
                error.message.includes('authentication') ||
                error.message.includes('Invalid oauth token') ||
                error.message.includes('oauth') ||
                error.message.includes('401')
            )) {
                // Try token refresh first if we have user info (but avoid recursion)
                if (userId && userObject && !this.isRefreshing) {
                    logger.info(`Authentication failed, attempting token refresh for user ${username}`);
                    
                    this.isRefreshing = true; // Prevent recursive refresh attempts
                    
                    try {
                        const refreshSuccess = await this.attemptTokenRefresh(userId, username);
                        if (refreshSuccess) {
                            logger.info(`Token refresh successful, retrying bot initialization`);
                            
                            // Reset state and retry initialization with fresh token
                            this.authFailed = false;
                            this.lastAuthFailure = null;
                            
                            // Use the updated token from attemptTokenRefresh
                            const updatedOauthToken = this.currentToken;
                            
                            // Clear state and retry
                            if (this.client) {
                                await this.disconnect();
                            }
                            
                            // Store current connection details
                            this.currentUserId = userId;
                            this.currentToken = updatedOauthToken;
                            this.currentUsername = username.toLowerCase();
                            
                            // Retry initialization
                            await this.initializeBot(username, updatedOauthToken, userId, userObject);
                            return true; // Success after refresh
                        }
                    } finally {
                        this.isRefreshing = false; // Always clear the flag
                    }
                    
                    logger.warn(`Token refresh failed for user ${username}, invalidating session`);
                }
                
                // Immediately invalidate the session when auth fails and refresh doesn't work
                if (userId) {
                    const authHandler = getAuthFailureHandler();
                    await authHandler.invalidateUserSession(userId, username);
                }
                
                throw new Error('Twitch authentication failed. Please re-authenticate.');
            }
            
            throw error;
        }
    }

    /**
     * Attempt to refresh token and reinitialize bot
     * @param {number} userId - User ID
     * @param {string} username - Username
     * @returns {boolean} - Success status
     */
    async attemptTokenRefresh(userId, username) {
        try {
            logger.info(`Attempting token refresh for user ${username} (ID: ${userId})`);
            
            // Get user from database
            const { User } = require('../models/User');
            const user = await User.findById(userId);
            
            if (!user) {
                logger.error(`User not found for token refresh: ${userId}`);
                return false;
            }
            
            // Try to refresh token
            const freshUser = await user.getFreshToken();
            
            if (!freshUser.twitchAccessToken) {
                logger.error(`No fresh token available for user ${username}`);
                return false;
            }
            
            logger.info(`Token refreshed successfully for user ${username}`);
            
            // Update our current token tracking but DON'T call initializeBot again to avoid recursion
            this.currentToken = freshUser.twitchAccessToken;
            
            // Clear auth failure state since we have fresh token
            this.authFailed = false;
            this.lastAuthFailure = null;
            
            return true;
            
        } catch (error) {
            logger.error(`Failed to refresh token for user ${username}:`, error);
            return false;
        }
    }

    /**
     * Invalidate user token in database when authentication fails
     */
    async invalidateUserToken(userId, username) {
        try {
            const { User } = require('../models/User');
            const user = await User.findById(userId);
            if (user) {
                await user.invalidateTwitchToken();
                logger.warn(`Twitch token invalidated due to auth failure for user: ${username} (ID: ${userId})`);
            }
        } catch (error) {
            logger.error('Failed to invalidate user token:', error);
        }
    }

    /**
     * Set up event handlers for the Twitch client
     */
    setupEventHandlers(username, userId = null) {
        this.client.on('connected', (addr, port) => {
            logger.info(`Twitch bot connected to ${addr}:${port}`);
            this.isConnected = true;
            this.authFailed = false; // Reset auth failure flag on successful connection
            this.lastAuthFailure = null; // Clear auth failure timestamp
        });

        this.client.on('disconnected', async (reason) => {
            logger.warn(`Twitch bot disconnected: ${reason}`);
            this.isConnected = false;
            
            // Check if disconnection is due to authentication failure
            if (reason && reason.includes('Login authentication failed')) {
                this.authFailed = true;
                logger.error('Authentication failed - bot will stop reconnecting');
                
                // Invalidate session immediately when auth fails
                if (userId) {
                    const authHandler = getAuthFailureHandler();
                    await authHandler.invalidateUserSession(userId, username);
                }
                return;
            }
            
            // Trust TMI.js to handle reconnections automatically - no custom logic needed
            logger.info('Disconnected - TMI.js will handle reconnection automatically');
        });

        this.client.on('reconnect', () => {
            logger.info('Twitch bot attempting to reconnect...');
        });

        this.client.on('join', (channel, username, self) => {
            if (self) {
                logger.info(`Bot joined channel: ${channel}`);
            }
        });

        this.client.on('message', async (channel, tags, message, self) => {
            // Log received messages for debugging
            logger.debug(`[${channel}] ${tags.username}: ${message}`);
            
            // CRITICAL: Log message ID assignment for debugging deletion issues
            logger.info(`Message received - ID: ${tags.id}, User: ${tags.username}, Text: "${message}", Channel: ${channel}`);
            
            // Store messages from all joined channels
            await this.addRecentMessage({
                id: tags.id, // Twitch message ID for deletion
                username: tags.username || tags['display-name'] || 'Anonymous',
                message: message,
                timestamp: Date.now(),
                channel: channel,
                platform: 'Twitch',
                userId: tags['user-id'],
                userColor: tags.color,
                badges: tags.badges,
                emotes: tags.emotes,
                isSelf: self
            });
        });

        this.client.on('notice', (channel, msgid, message) => {
            logger.info(`Twitch notice [${msgid}]: ${message}`);
            
            // Check for authentication failure notices
            if (msgid === 'login_authentication_failed' || 
                msgid === 'invalid_oauth_token' ||
                message.includes('authentication failed')) {
                logger.error('Twitch authentication failed - invalid token');
                this.authFailed = true;
                this.isConnected = false;
            }
        });

        this.client.on('messagedeleted', (channel, username, deletedMessage, userstate) => {
            logger.debug(`Message deleted in ${channel} by ${username}: ${deletedMessage}`);
        });

        // Handle TMI errors and filter out harmless ones
        this.client.on('error', (error) => {
            const errorMessage = error.message || error.toString();
            
            // Filter out harmless TMI errors that don't affect functionality
            if (errorMessage.includes('No response from Twitch') ||
                errorMessage.includes('Request timed out') ||
                errorMessage.includes('Timeout reached')) {
                // These are common TMI errors that don't indicate actual problems
                logger.debug(`TMI harmless error (filtered): ${errorMessage}`);
                return;
            }
            
            // Log actual errors that might be problematic
            logger.error(`Twitch bot error: ${errorMessage}`);
            
            // Check if this is an authentication-related error
            if (errorMessage.includes('authentication') ||
                errorMessage.includes('Login authentication failed') ||
                errorMessage.includes('Invalid oauth token')) {
                this.authFailed = true;
                this.isConnected = false;
                logger.error('Authentication error detected in TMI error handler');
            }
        });
    }

    /**
     * Send a command/message to the user's Twitch channel with automatic token refresh
     * @param {string} username - Channel username
     * @param {string} command - Message to send
     * @param {number} userId - User ID for token refresh
     */
    async sendCommandWithRefresh(username, command, userId = null) {
        try {
            return await this.sendCommand(username, command);
        } catch (error) {
            // Check if this is an authentication error and we can try to refresh
            const isAuthError = error.message && (
                error.message.includes('authentication') ||
                error.message.includes('Login authentication failed') ||
                error.message.includes('oauth') ||
                error.message.includes('401') ||
                error.message.includes('Invalid oauth token')
            );
            
            if (isAuthError && userId) {
                logger.info(`Authentication error in sendCommand, attempting token refresh for user ${username}`);
                
                const refreshSuccess = await this.attemptTokenRefresh(userId, username);
                if (refreshSuccess) {
                    logger.info(`Token refresh successful, retrying command for user ${username}`);
                    return await this.sendCommand(username, command);
                }
                
                logger.warn(`Token refresh failed for user ${username}`);
            }
            
            // Re-throw the original error
            throw error;
        }
    }

    /**
     * Send a command/message to the user's Twitch channel
     * @param {string} username - Channel username
     * @param {string} command - Message to send
     */
    async sendCommand(username, command) {
        if (this.authFailed) {
            logger.error('SendCommand called but authFailed is true - throwing authentication error');
            throw new Error('Twitch authentication failed. Please re-authenticate.');
        }
        
        if (!this.client || !this.isConnected) {
            logger.error('SendCommand called but bot is not connected');
            throw new Error('Twitch bot is not connected');
        }

        try {
            const channel = `#${username.toLowerCase()}`;
            
            // Send the command to the channel
            await this.client.say(channel, command);
            
            logger.debug(`Command sent to ${channel}: ${command}`);
            
            // Don't manually add to recentMessages - message will come back through Twitch's message handler
            // This prevents duplicate messages showing in the Android app
            
            return {
                success: true,
                message: `Command "${command}" sent to ${username}'s channel`,
                channel: username,
                command: command,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            logger.error(`Failed to send command to ${username}:`, error);
            throw new Error(`Failed to send command: ${error.message}`);
        }
    }

    /**
     * Check if the bot is ready to send commands
     */
    isReady() {
        return this.client !== null && this.isConnected;
    }

    /**
     * Get the current connection status
     */
    getStatus() {
        return {
            connected: this.isConnected,
            client_ready: this.client !== null,
            auth_failed: this.authFailed
        };
    }

    /**
     * Disconnect the bot
     */
    async disconnect() {
        if (this.client) {
            try {
                await this.client.disconnect();
                logger.info('Twitch bot disconnected');
            } catch (error) {
                logger.error('Error disconnecting Twitch bot:', error);
            }
            
            this.client = null;
            this.isConnected = false;
            
            // Clear tracking variables
            this.currentUserId = null;
            this.currentToken = null;
            this.currentUsername = null;
            
            // Clear initialization state
            this.isInitializing = false;
            this.initializationPromise = null;
            
            // Clear auth failure state when disconnecting
            this.authFailed = false;
            this.lastAuthFailure = null;
        }
    }

    /**
     * Check if bot is ready to send messages
     */
    isReady() {
        return this.client !== null && this.isConnected;
    }

    /**
     * Add a message to recent messages array
     */
    async addRecentMessage(messageData) {
        // Process message with OpenAI for TTS version
        const openaiService = getOpenAIService();
        const displayName = messageData.displayName || messageData.username || 'Unknown';
        let ttsMessage = `${displayName} a dit: ${messageData.message}`;
        
        // Skip OpenAI processing only for commands (messages starting with !) and ignored users
        const isCommand = messageData.message && messageData.message.trim().startsWith('!');
        
        // Check if user is in ignored users list
        let isIgnoredUser = false;
        if (this.currentUserId && messageData.username) {
            try {
                const { User } = require('../models/User');
                const ignoredUsers = await User.getTTSIgnoredUsers(this.currentUserId);
                isIgnoredUser = ignoredUsers.some(ignored => 
                    ignored.toLowerCase() === messageData.username.toLowerCase()
                );
                if (isIgnoredUser) {
                    logger.debug(`Skipping OpenAI/TTS for ignored user: "${messageData.username}"`);
                }
            } catch (error) {
                logger.error('Error checking ignored users:', error);
            }
        }
        
        if (!isCommand && !isIgnoredUser) {
            try {
                ttsMessage = await openaiService.processTTSMessage(
                    messageData.message,
                    messageData.username,
                    this.currentUserId
                );
            } catch (error) {
                logger.error('Failed to process TTS message, using fallback with username:', error);
                // ttsMessage already set to fallback format with username
            }
        } else {
            if (isCommand) {
                logger.debug(`Skipping OpenAI/TTS for command message: "${messageData.message}"`);
            }
            // ttsMessage already set to fallback format with username
        }
        
        // Add TTS version to message data
        const enrichedMessageData = {
            ...messageData,
            ttsMessage: ttsMessage
        };
        
        this.recentMessages.push(enrichedMessageData);
        
        // Keep only the last N messages
        if (this.recentMessages.length > this.maxMessages) {
            this.recentMessages = this.recentMessages.slice(-this.maxMessages);
        }
    }

    /**
     * Get recent messages
     * @param {number} limit - Maximum number of messages to return
     * @param {string} channelFilter - Optional channel to filter by (e.g., '#username')
     */
    getRecentMessages(limit = 50, channelFilter = null) {
        let messages = this.recentMessages;
        
        // Filter by channel if specified
        if (channelFilter) {
            messages = messages.filter(msg => 
                msg.channel.toLowerCase() === channelFilter.toLowerCase()
            );
        }
        
        // Add deleted and userTimedOut flags to messages
        const now = Date.now();
        messages = messages.map(msg => {
            const deleted = this.deletedMessageIds.has(msg.id);
            const normalizedUsername = msg.username ? msg.username.toLowerCase() : '';
            const userTimedOut = this.isUserTimedOut(msg.username, now);
            
            // Debug logging for timeout checking
            if (this.timedOutUsers.size > 0) {
                logger.debug(`Checking message from ${msg.username} (normalized: ${normalizedUsername})`, {
                    userTimedOut,
                    timedOutUsersSize: this.timedOutUsers.size,
                    hasInMap: this.timedOutUsers.has(normalizedUsername)
                });
            }
            
            return {
                ...msg,
                deleted: deleted,
                userTimedOut: userTimedOut
            };
        });
        
        const actualLimit = Math.min(limit, this.maxMessages);
        return messages.slice(-actualLimit);
    }

    /**
     * Mark a message as deleted
     * @param {string} messageId - Message ID to mark as deleted
     */
    markMessageDeleted(messageId) {
        this.deletedMessageIds.add(messageId);
        logger.debug(`Marked message ${messageId} as deleted`);
    }

    /**
     * Mark a user as timed out and delete all their messages
     * @param {string} username - Username to timeout
     * @param {number} duration - Duration in seconds (default 60)
     */
    markUserTimedOut(username, duration = 60) {
        const expiryTime = Date.now() + (duration * 1000);
        const normalizedUsername = username.toLowerCase();
        this.timedOutUsers.set(normalizedUsername, expiryTime);
        
        // Mark all messages from this user as deleted
        let deletedCount = 0;
        for (const msg of this.recentMessages) {
            if (msg.username && msg.username.toLowerCase() === normalizedUsername) {
                this.deletedMessageIds.add(msg.id);
                deletedCount++;
            }
        }
        
        logger.info(`Marked user ${username} (normalized: ${normalizedUsername}) as timed out until ${new Date(expiryTime).toISOString()}, deleted ${deletedCount} messages`, {
            timedOutUsersSize: this.timedOutUsers.size,
            allTimedOutUsers: Array.from(this.timedOutUsers.keys())
        });
    }

    /**
     * Check if a user is currently timed out
     * @param {string} username - Username to check
     * @param {number} now - Current timestamp (optional)
     */
    isUserTimedOut(username, now = null) {
        const currentTime = now || Date.now();
        const expiryTime = this.timedOutUsers.get(username.toLowerCase());
        
        if (!expiryTime) {
            return false;
        }
        
        // Check if timeout has expired
        if (currentTime >= expiryTime) {
            this.timedOutUsers.delete(username.toLowerCase());
            return false;
        }
        
        return true;
    }

    /**
     * Clear recent messages
     */
    clearRecentMessages() {
        this.recentMessages = [];
    }

    /**
     * Mark messages as read for a specific user
     * @param {number} userId - User ID
     * @param {Date|number} timestamp - Timestamp to mark as read (defaults to now)
     */
    markMessagesAsRead(userId, timestamp = null) {
        const readTimestamp = timestamp || Date.now();
        this.lastReadTimestamps.set(userId, readTimestamp);
        logger.debug(`Marked messages as read for user ${userId} at ${new Date(readTimestamp).toISOString()}`);
    }

    /**
     * Get unread message count for a specific user and channel
     * @param {number} userId - User ID
     * @param {string} channelFilter - Channel to filter by (e.g., '#username')
     */
    getUnreadCount(userId, channelFilter = null) {
        const lastRead = this.lastReadTimestamps.get(userId) || 0;
        
        let messages = this.recentMessages;
        
        // Filter by channel if specified
        if (channelFilter) {
            messages = messages.filter(msg => 
                msg.channel.toLowerCase() === channelFilter.toLowerCase()
            );
        }
        
        // Count messages after last read timestamp
        const unreadCount = messages.filter(msg => msg.timestamp > lastRead).length;
        
        return unreadCount;
    }

    /**
     * Timeout a user in the channel using Twitch Helix API
     */
    async timeout(channel, username, duration, accessToken, broadcasterId) {
        if (!this.client || !this.isConnected) {
            throw new Error('Bot not connected');
        }

        const channelName = channel.startsWith('#') ? channel.slice(1) : channel;
        
        try {
            const axios = require('axios');
            const { getSecret } = require('../config/config');
            const clientId = getSecret('twitch.clientId');
            
            logger.info('Attempting timeout', {
                channel: channelName,
                username: username,
                duration: duration,
                tokenLength: accessToken ? accessToken.length : 0,
                broadcasterId: broadcasterId
            });
            
            // Get user ID to timeout
            const userResponse = await axios.get('https://api.twitch.tv/helix/users', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Client-Id': clientId
                },
                params: {
                    login: username
                }
            });
            
            const userId = userResponse.data.data[0]?.id;
            
            if (!userId) {
                throw new Error('Could not find user to timeout');
            }
            
            // Ban the user using Helix API
            await axios.post(
                `https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`,
                {
                    data: {
                        user_id: userId,
                        duration: duration,
                        reason: 'Moderation action'
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Client-Id': clientId,
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            logger.info(`Timed out user ${username} in ${channelName} for ${duration}s via Helix API`);
        } catch (error) {
            logger.error(`Failed to timeout user ${username}:`, error.response?.data || error.message);
            throw new Error(error.response?.data?.message || error.message);
        }
    }

    /**
     * Delete a message by ID using Twitch Helix API
     */
    async deletemessage(channel, messageId, accessToken, broadcasterId) {
        if (!this.client || !this.isConnected) {
            throw new Error('Bot not connected');
        }

        const channelName = channel.startsWith('#') ? channel.slice(1) : channel;
        
        try {
            const axios = require('axios');
            const { getSecret } = require('../config/config');
            const clientId = getSecret('twitch.clientId');
            
            logger.info('Attempting delete message', {
                channel: channelName,
                messageId: messageId,
                tokenLength: accessToken ? accessToken.length : 0,
                broadcasterId: broadcasterId
            });
            
            // Delete the message using Helix API
            await axios.delete(
                `https://api.twitch.tv/helix/moderation/chat?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}&message_id=${messageId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Client-Id': clientId
                    }
                }
            );
            
            logger.info(`Deleted message ${messageId} in ${channelName} via Helix API`);
        } catch (error) {
            logger.error(`Failed to delete message ${messageId}:`, error.response?.data || error.message);
            throw new Error(error.response?.data?.message || error.message);
        }
    }

    /**
     * Clear all stored recent messages
     */
    clearRecentMessages() {
        this.recentMessages = [];
        logger.info('Cleared all recent chat messages from memory');
    }
}

// Map of user-specific bot instances (keyed by user ID)
const twitchBotInstances = new Map();

/**
 * Get or create a user-specific Twitch bot instance
 */
function getTwitchBot(userId = null) {
    // If no userId provided, this is an error - we need user-specific bots
    if (!userId) {
        logger.error('getTwitchBot called without userId - this will cause multi-user issues');
        // For backward compatibility, return a default instance, but log warning
        if (!twitchBotInstances.has('default')) {
            twitchBotInstances.set('default', new TwitchBotService());
        }
        return twitchBotInstances.get('default');
    }
    
    // Get or create user-specific bot instance
    if (!twitchBotInstances.has(userId)) {
        logger.info(`Creating new Twitch bot instance for user ${userId}`);
        twitchBotInstances.set(userId, new TwitchBotService());
    }
    return twitchBotInstances.get(userId);
}

/**
 * Remove a user's bot instance (cleanup on logout)
 */
function removeTwitchBot(userId) {
    if (twitchBotInstances.has(userId)) {
        const bot = twitchBotInstances.get(userId);
        if (bot && bot.client) {
            bot.disconnect();
        }
        twitchBotInstances.delete(userId);
        logger.info(`Removed Twitch bot instance for user ${userId}`);
    }
}

module.exports = {
    TwitchBotService,
    getTwitchBot,
    removeTwitchBot
};
