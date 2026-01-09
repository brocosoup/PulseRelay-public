const logger = require('../utils/logger');
const { get: getConfig, getSecret } = require('../config/config');

class OpenAIService {
    constructor() {
        this.openai = null;
        this.initialized = false;
    }

    /**
     * Initialize OpenAI client
     */
    async initialize() {
        if (this.initialized) {
            return;
        }

        try {
            const config = getConfig('openai');
            
            // Check if OpenAI is enabled
            if (!config || !config.enabled) {
                logger.info('OpenAI service is disabled in config');
                return;
            }

            const apiKey = getSecret('openai.apiKey');
            
            if (!apiKey || apiKey === 'your-openai-api-key-here') {
                logger.warn('OpenAI API key not configured - TTS message processing will be skipped');
                return;
            }

            // Dynamically import OpenAI SDK
            const { OpenAI } = require('openai');
            
            this.openai = new OpenAI({
                apiKey: apiKey
            });

            this.initialized = true;
            logger.debug('OpenAI service initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize OpenAI service:', error);
            this.initialized = false;
        }
    }

    /**
     * Check if OpenAI service is ready
     */
    isReady() {
        return this.initialized && this.openai !== null;
    }

    /**
     * Process a message for TTS
     * @param {string} message - Original message
     * @param {string} username - Username of the message sender
     * @param {number} userId - User ID to check TTS OpenAI settings
     * @returns {Promise<string>} - Processed TTS message
     */
    async processTTSMessage(message, username = 'user', userId = null) {
        // Check if user has TTS OpenAI enabled and get alias
        let displayName = username;
        let processedMessage = message;
        
        if (userId) {
            try {
                const { User } = require('../models/User');
                const user = await User.findById(userId);
                
                // Check for username alias (fetch even if OpenAI disabled)
                const db = require('../config/database').getDatabase();
                const aliasRow = await db.get(
                    'SELECT alias FROM username_aliases WHERE user_id = ? AND twitch_username = ?',
                    [userId, username.toLowerCase()]
                );
                
                if (aliasRow) {
                    displayName = aliasRow.alias;
                    logger.debug(`Using alias "${displayName}" for username "${username}"`);
                }
                
                // Replace @mentions in message with aliases
                processedMessage = await this.replaceMessageMentionsWithAliases(message, userId);
                if (processedMessage !== message) {
                    logger.debug(`Message mentions replaced: "${message}" -> "${processedMessage}"`);
                }
                
                // If OpenAI is disabled, return simple format with alias
                if (user && !user.ttsOpenaiEnabled) {
                    logger.debug(`TTS OpenAI processing DISABLED for user ${userId} (${username}) - returning simple format with alias`);
                    return `${displayName} a dit: ${processedMessage}`;
                }
            } catch (error) {
                logger.error('Error checking user TTS settings - returning simple format to avoid OpenAI call:', error);
                // CRITICAL: Do NOT continue processing on error - return simple format to avoid consuming tokens
                return `${displayName} a dit: ${processedMessage}`;
            }
        }

        // If not initialized, try to initialize
        if (!this.initialized) {
            await this.initialize();
        }

        // If still not ready, return original message with display name
        if (!this.isReady()) {
            logger.debug('OpenAI not ready - returning original message');
            return `${displayName} a dit: ${message}`;
        }

        try {
            const config = getConfig('openai');
            const model = config.model || 'gpt-3.5-turbo';
            const systemPrompt = config.systemPrompt || 'You are a helpful assistant that processes chat messages for text-to-speech.';
            const userPromptTemplate = config.userPrompt || 'Convert this message to TTS format: {{message}}';

            // Replace template variables in user prompt (use alias if available)
            const userPrompt = userPromptTemplate
                .replace('{{username}}', displayName)
                .replace('{{message}}', processedMessage);

            logger.debug(`Processing TTS with OpenAI for ${username} (alias: ${displayName}): "${processedMessage}"`);

            const response = await this.openai.chat.completions.create({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                max_tokens: 150,
                temperature: 0.7
            });

            const processedResult = response.choices[0]?.message?.content?.trim() || `${displayName} a dit: ${processedMessage}`;
            
            logger.debug(`TTS OpenAI result: "${processedMessage}" -> "${processedResult}"`);
            
            return processedResult;

        } catch (error) {
            logger.error('Error processing TTS message with OpenAI:', error);
            // Return fallback format on error
            return `${displayName} a dit: ${processedMessage}`;
        }
    }

    /**
     * Replace @mentions in message with their aliases
     * @param {string} message - Original message text
     * @param {number} userId - User ID to look up aliases for
     * @returns {Promise<string>} - Message with @mentions replaced by aliases
     */
    async replaceMessageMentionsWithAliases(message, userId) {
        if (!message || !userId) {
            return message;
        }

        try {
            // Find all @mentions in the message (alphanumeric + underscore)
            const mentionRegex = /@(\w+)/g;
            const mentions = [...message.matchAll(mentionRegex)];
            
            if (mentions.length === 0) {
                return message;
            }

            // Get all aliases for this user
            const db = require('../config/database').getDatabase();
            const rows = await db.all(
                'SELECT twitch_username, alias FROM username_aliases WHERE user_id = ?',
                [userId]
            );
            
            if (!rows || rows.length === 0) {
                return message;
            }

            // Build alias map (case-insensitive)
            const aliasMap = new Map();
            rows.forEach(row => {
                aliasMap.set(row.twitch_username.toLowerCase(), row.alias);
            });

            // Replace each @mention with alias if found
            let result = message;
            mentions.forEach(match => {
                const mentionedUsername = match[1].toLowerCase();
                const alias = aliasMap.get(mentionedUsername);
                
                if (alias) {
                    // Replace @username with alias (preserve original case in message)
                    result = result.replace(match[0], alias);
                }
            });

            return result;
        } catch (error) {
            logger.error('Error replacing message mentions with aliases:', error);
            return message; // Return original on error
        }
    }

    /**
     * Disconnect and cleanup
     */
    async disconnect() {
        this.openai = null;
        this.initialized = false;
        logger.info('OpenAI service disconnected');
    }
}

// Singleton instance
let openaiServiceInstance = null;

/**
 * Get or create the OpenAI service instance
 */
function getOpenAIService() {
    if (!openaiServiceInstance) {
        openaiServiceInstance = new OpenAIService();
    }
    return openaiServiceInstance;
}

module.exports = {
    OpenAIService,
    getOpenAIService
};
