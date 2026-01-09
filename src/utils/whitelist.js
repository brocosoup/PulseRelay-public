const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class WhitelistManager {
  constructor() {
    this.whitelist = null;
    this.whitelistPath = path.join(process.cwd(), 'whitelist.json');
    this.loaded = false;
  }

  loadWhitelist() {
    try {
      if (fs.existsSync(this.whitelistPath)) {
        const data = fs.readFileSync(this.whitelistPath, 'utf8');
        this.whitelist = JSON.parse(data);
        this.loaded = true;
        
        // Handle both array and object formats
        let userCount = 0;
        if (Array.isArray(this.whitelist.allowedUsers)) {
          userCount = this.whitelist.allowedUsers.length;
        }
        
        logger.info('User whitelist loaded successfully', {
          allowedUsers: userCount,
          whitelistEnabled: this.whitelist.security?.whitelistEnabled || false
        });
      } else {
        logger.warn('whitelist.json not found - all Twitch users will be allowed to login');
        logger.warn('To enable user restrictions, copy whitelist.json.template to whitelist.json and configure it');
        this.whitelist = {
          allowedUsers: [],
          security: {
            whitelistEnabled: false,
            logRejectedAttempts: true
          }
        };
        this.loaded = true;
      }
    } catch (error) {
      logger.error('Failed to load whitelist configuration:', error);
      // Fail secure - if we can't load the whitelist, disable new logins
      this.whitelist = {
        allowedUsers: [],
        security: {
          whitelistEnabled: true,
          logRejectedAttempts: true
        }
      };
      this.loaded = true;
    }
  }

  isWhitelistEnabled() {
    if (!this.loaded) this.loadWhitelist();
    return this.whitelist?.security?.whitelistEnabled === true;
  }

  isUserAllowed(twitchUser) {
    if (!this.loaded) this.loadWhitelist();
    
    // If whitelist is disabled, allow all users
    if (!this.isWhitelistEnabled()) {
      return { allowed: true, reason: 'whitelist_disabled' };
    }

    const allowedUsers = this.whitelist?.allowedUsers || [];
    
    // Check if user is in whitelist (simple string array)
    const isAllowed = allowedUsers.some(username => {
      if (typeof username === 'string') {
        // Simple string format - just compare usernames
        return username.toLowerCase() === twitchUser.login.toLowerCase();
      } else if (typeof username === 'object' && username.username) {
        // Legacy object format support
        if (username.twitch_id && twitchUser.id) {
          return username.twitch_id === twitchUser.id;
        }
        return username.username.toLowerCase() === twitchUser.login.toLowerCase();
      }
      return false;
    });

    if (isAllowed) {
      logger.info('User allowed by whitelist', {
        username: twitchUser.login,
        twitch_id: twitchUser.id
      });
      
      return { 
        allowed: true, 
        reason: 'whitelisted',
        role: 'user' // Default role for simplified format
      };
    }

    // User not found in whitelist
    if (this.whitelist?.security?.logRejectedAttempts) {
      logger.warn('User rejected by whitelist', {
        username: twitchUser.login,
        twitch_id: twitchUser.id,
        display_name: twitchUser.display_name,
        email: twitchUser.email
      });
    }

    return { 
      allowed: false, 
      reason: 'not_whitelisted'
    };
  }

  getAllowedUsers() {
    if (!this.loaded) this.loadWhitelist();
    return this.whitelist?.allowedUsers || [];
  }

  getWhitelistConfig() {
    if (!this.loaded) this.loadWhitelist();
    return this.whitelist?.security || {};
  }

  reloadWhitelist() {
    this.loaded = false;
    this.loadWhitelist();
    logger.info('Whitelist configuration reloaded');
  }
}

// Export singleton instance
module.exports = new WhitelistManager();
