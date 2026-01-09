const logger = require('../utils/logger');

class AuthFailureHandler {
    constructor() {
        this.failedUsers = new Set();
        this.recentlyCleared = new Map(); // Track recently cleared users with timestamp
        this.cleanupInterval = null;
        this.startCleanupTimer();
    }

    /**
     * Mark a user as having authentication failure
     */
    markUserAuthFailed(userId, username) {
        // Don't mark as failed if recently cleared (grace period of 60 seconds)
        const recentlyClearedTime = this.recentlyCleared.get(userId);
        if (recentlyClearedTime && (Date.now() - recentlyClearedTime) < 60000) {
            logger.info(`Ignoring auth failure for user ${username} (ID: ${userId}) - recently reauthenticated`);
            return;
        }
        
        this.failedUsers.add(userId);
        logger.warn(`User ${username} (ID: ${userId}) marked as auth failed`);
    }

    /**
     * Check if a user has authentication failure
     */
    isUserAuthFailed(userId) {
        return this.failedUsers.has(userId);
    }

    /**
     * Clear authentication failure for a user (on successful re-auth)
     */
    clearUserAuthFailure(userId) {
        this.failedUsers.delete(userId);
        this.recentlyCleared.set(userId, Date.now());
        logger.info(`Cleared auth failure for user ID: ${userId}`);
    }

    /**
     * Invalidate user session when auth fails
     */
    async invalidateUserSession(userId, username) {
        try {
            this.markUserAuthFailed(userId, username);

            // Invalidate the user's token in database
            const { User } = require('../models/User');
            const user = await User.findById(userId);
            if (user && user.twitchAccessToken) {
                await user.invalidateTwitchToken();
                logger.warn(`Session invalidated for user: ${username} (ID: ${userId})`);
            }

            return true;
        } catch (error) {
            logger.error('Failed to invalidate user session:', error);
            return false;
        }
    }

    /**
     * Start cleanup timer to clear old failed users
     */
    startCleanupTimer() {
        // Clear failed users every 30 minutes
        this.cleanupInterval = setInterval(() => {
            if (this.failedUsers.size > 0) {
                logger.info(`Clearing ${this.failedUsers.size} failed auth users from memory`);
                this.failedUsers.clear();
            }
            
            // Clean up old recently cleared entries (older than 5 minutes)
            const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
            for (const [userId, timestamp] of this.recentlyCleared.entries()) {
                if (timestamp < fiveMinutesAgo) {
                    this.recentlyCleared.delete(userId);
                }
            }
        }, 30 * 60 * 1000);
    }

    /**
     * Stop cleanup timer
     */
    stopCleanupTimer() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

// Singleton instance
let authFailureHandlerInstance = null;

/**
 * Get or create the auth failure handler instance
 */
function getAuthFailureHandler() {
    if (!authFailureHandlerInstance) {
        authFailureHandlerInstance = new AuthFailureHandler();
    }
    return authFailureHandlerInstance;
}

module.exports = {
    AuthFailureHandler,
    getAuthFailureHandler
};
