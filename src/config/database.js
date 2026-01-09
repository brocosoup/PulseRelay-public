const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

class Database {
  constructor() {
    this.db = null;
    this.dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/pulserelay.db');
  }

  async initialize() {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Connect to database
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          logger.error('Database connection error:', err);
          throw err;
        }
        logger.info(`Connected to SQLite database at ${this.dbPath}`);
      });

      // Enable foreign keys
      await this.run('PRAGMA foreign_keys = ON');

      // Create tables
      await this.createTables();
      
      // Run database migrations
      await this.runMigrations();
      
      logger.info('Database initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw error;
    }
  }

  async createTables() {
    const tables = [
      // Users table
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        twitch_id TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT,
        profile_image_url TEXT,
        email TEXT,
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Stream keys table
      `CREATE TABLE IF NOT EXISTS stream_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        stream_key TEXT UNIQUE NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )`,

      // Stream sessions table
      `CREATE TABLE IF NOT EXISTS stream_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stream_key TEXT NOT NULL,
        session_id TEXT UNIQUE NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        stream_settings TEXT, -- JSON string
        is_publisher BOOLEAN DEFAULT 1, -- 1 for publisher, 0 for viewer
        is_active BOOLEAN DEFAULT 1,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ended_at DATETIME,
        FOREIGN KEY (stream_key) REFERENCES stream_keys (stream_key) ON DELETE CASCADE
      )`,

      // RTMP destinations table
      `CREATE TABLE IF NOT EXISTS rtmp_destinations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        rtmp_url TEXT NOT NULL,
        stream_key TEXT NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )`,

      // Test pattern settings table
      `CREATE TABLE IF NOT EXISTS test_pattern_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stream_key TEXT UNIQUE NOT NULL,
        settings TEXT NOT NULL, -- JSON string
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (stream_key) REFERENCES stream_keys (stream_key) ON DELETE CASCADE
      )`,

      // Stream settings table (for publisher and other stream-related settings)
      `CREATE TABLE IF NOT EXISTS stream_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stream_key TEXT NOT NULL,
        settings_type TEXT NOT NULL, -- 'publisher', 'viewer', etc.
        settings TEXT NOT NULL, -- JSON string
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (stream_key) REFERENCES stream_keys (stream_key) ON DELETE CASCADE,
        UNIQUE(stream_key, settings_type)
      )`,

      // System settings table
      `CREATE TABLE IF NOT EXISTS system_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Audit log table
      `CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        details TEXT, -- JSON string
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
      )`,

      // Location sharing settings table
      `CREATE TABLE IF NOT EXISTS location_sharing (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL,
        enabled BOOLEAN DEFAULT 0,
        location_mode TEXT DEFAULT 'gps', -- 'gps' or 'fixed'
        accuracy_threshold INTEGER DEFAULT 100, -- meters
        update_interval INTEGER DEFAULT 30, -- seconds
        auto_disable_after INTEGER DEFAULT 3600, -- auto-disable after 1 hour
        fixed_latitude REAL, -- for fixed location mode
        fixed_longitude REAL, -- for fixed location mode
        fixed_name TEXT, -- optional name for fixed location
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )`,

      // Location data table
      `CREATE TABLE IF NOT EXISTS location_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy REAL, -- meters
        altitude REAL,
        altitude_accuracy REAL,
        heading REAL, -- degrees
        speed REAL, -- m/s
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )`,

      // Mobile API tokens table
      `CREATE TABLE IF NOT EXISTS mobile_api_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )`,

      // Overlay tokens table (no expiry)
      `CREATE TABLE IF NOT EXISTS overlay_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        token TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )`,
    ];

    // Create indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_users_twitch_id ON users (twitch_id)',
      'CREATE INDEX IF NOT EXISTS idx_stream_keys_user_id ON stream_keys (user_id)',
      'CREATE INDEX IF NOT EXISTS idx_stream_keys_stream_key ON stream_keys (stream_key)',
      'CREATE INDEX IF NOT EXISTS idx_stream_sessions_stream_key ON stream_sessions (stream_key)',
      'CREATE INDEX IF NOT EXISTS idx_stream_sessions_session_id ON stream_sessions (session_id)',
      'CREATE INDEX IF NOT EXISTS idx_rtmp_destinations_user_id ON rtmp_destinations (user_id)',
      'CREATE INDEX IF NOT EXISTS idx_test_pattern_settings_stream_key ON test_pattern_settings (stream_key)',
      'CREATE INDEX IF NOT EXISTS idx_stream_settings_stream_key ON stream_settings (stream_key)',
      'CREATE INDEX IF NOT EXISTS idx_stream_settings_type ON stream_settings (stream_key, settings_type)',
      'CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings (key)',
      'CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log (user_id)',
      'CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at)',
      'CREATE INDEX IF NOT EXISTS idx_location_sharing_user_id ON location_sharing (user_id)',
      'CREATE INDEX IF NOT EXISTS idx_location_data_user_id ON location_data (user_id)',
      'CREATE INDEX IF NOT EXISTS idx_location_data_created_at ON location_data (created_at)',
      'CREATE INDEX IF NOT EXISTS idx_mobile_api_tokens_user_id ON mobile_api_tokens (user_id)',
      'CREATE INDEX IF NOT EXISTS idx_mobile_api_tokens_token ON mobile_api_tokens (token)',
      'CREATE INDEX IF NOT EXISTS idx_mobile_api_tokens_expires_at ON mobile_api_tokens (expires_at)',
      'CREATE INDEX IF NOT EXISTS idx_overlay_tokens_user_id ON overlay_tokens (user_id)',
      'CREATE INDEX IF NOT EXISTS idx_overlay_tokens_token ON overlay_tokens (token)',
    ];

    try {
      // Create tables
      for (const table of tables) {
        await this.run(table);
      }

      // Create indexes
      for (const index of indexes) {
        await this.run(index);
      }

      // Create triggers for automatic updated_at timestamp updates
      const triggers = [
        `CREATE TRIGGER IF NOT EXISTS update_users_updated_at 
         AFTER UPDATE ON users 
         FOR EACH ROW 
         WHEN OLD.updated_at = NEW.updated_at 
         BEGIN 
           UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; 
         END`,
         
        `CREATE TRIGGER IF NOT EXISTS update_stream_keys_updated_at 
         AFTER UPDATE ON stream_keys 
         FOR EACH ROW 
         WHEN OLD.updated_at = NEW.updated_at 
         BEGIN 
           UPDATE stream_keys SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; 
         END`,
         
        `CREATE TRIGGER IF NOT EXISTS update_rtmp_destinations_updated_at 
         AFTER UPDATE ON rtmp_destinations 
         FOR EACH ROW 
         WHEN OLD.updated_at = NEW.updated_at 
         BEGIN 
           UPDATE rtmp_destinations SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; 
         END`,
         
        `CREATE TRIGGER IF NOT EXISTS update_test_pattern_settings_updated_at 
         AFTER UPDATE ON test_pattern_settings 
         FOR EACH ROW 
         WHEN OLD.updated_at = NEW.updated_at 
         BEGIN 
           UPDATE test_pattern_settings SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; 
         END`,
         
        `CREATE TRIGGER IF NOT EXISTS update_stream_settings_updated_at 
         AFTER UPDATE ON stream_settings 
         FOR EACH ROW 
         WHEN OLD.updated_at = NEW.updated_at 
         BEGIN 
           UPDATE stream_settings SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; 
         END`,

        `CREATE TRIGGER IF NOT EXISTS update_location_sharing_updated_at 
         AFTER UPDATE ON location_sharing 
         FOR EACH ROW 
         WHEN OLD.updated_at = NEW.updated_at 
         BEGIN 
           UPDATE location_sharing SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; 
         END`
      ];

      // Create triggers
      for (const trigger of triggers) {
        await this.run(trigger);
      }

      logger.info('Database tables and indexes created successfully');
    } catch (error) {
      logger.error('Failed to create database tables:', error);
      throw error;
    }
  }

  async runMigrations() {
    try {
      // Create migrations table if it doesn't exist
      await this.run(`
        CREATE TABLE IF NOT EXISTS migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Define migrations
      const migrations = [
        {
          name: 'add_role_to_users',
          query: `ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`
        },
        {
          name: 'add_twitch_access_token_to_users',
          query: `ALTER TABLE users ADD COLUMN twitch_access_token TEXT`
        },
        {
          name: 'add_twitch_refresh_token_to_users',
          query: `ALTER TABLE users ADD COLUMN twitch_refresh_token TEXT`
        },
        {
          name: 'add_twitch_token_expires_at_to_users',
          query: `ALTER TABLE users ADD COLUMN twitch_token_expires_at DATETIME`
        },
        {
          name: 'add_description_to_stream_keys',
          query: `ALTER TABLE stream_keys ADD COLUMN description TEXT`
        },
        {
          name: 'add_last_used_at_to_stream_keys',
          query: `ALTER TABLE stream_keys ADD COLUMN last_used_at DATETIME`
        },
        {
          name: 'add_obs_source_name_to_stream_keys',
          query: `ALTER TABLE stream_keys ADD COLUMN obs_source_name TEXT`
        },
        {
          name: 'create_location_sharing_table',
          query: `CREATE TABLE IF NOT EXISTS location_sharing (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE NOT NULL,
            enabled BOOLEAN DEFAULT 0,
            accuracy_threshold INTEGER DEFAULT 100,
            update_interval INTEGER DEFAULT 30,
            auto_disable_after INTEGER DEFAULT 3600,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
          )`
        },
        {
          name: 'create_location_data_table',
          query: `CREATE TABLE IF NOT EXISTS location_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            accuracy REAL,
            altitude REAL,
            altitude_accuracy REAL,
            heading REAL,
            speed REAL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
          )`
        },
        {
          name: 'add_location_mode_to_location_sharing',
          query: `ALTER TABLE location_sharing ADD COLUMN location_mode TEXT DEFAULT 'gps'`
        },
        {
          name: 'add_fixed_latitude_to_location_sharing',
          query: `ALTER TABLE location_sharing ADD COLUMN fixed_latitude REAL`
        },
        {
          name: 'add_fixed_longitude_to_location_sharing',
          query: `ALTER TABLE location_sharing ADD COLUMN fixed_longitude REAL`
        },
        {
          name: 'add_fixed_name_to_location_sharing',
          query: `ALTER TABLE location_sharing ADD COLUMN fixed_name TEXT`
        },
        {
          name: 'add_gps_quality_to_location_data',
          query: `ALTER TABLE location_data ADD COLUMN gps_quality INTEGER`
        },
        {
          name: 'add_gsm_signal_to_location_data',
          query: `ALTER TABLE location_data ADD COLUMN gsm_signal INTEGER`
        },
        {
          name: 'create_overlay_pictures_table',
          query: `CREATE TABLE IF NOT EXISTS overlay_pictures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            filepath TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
          )`
        },
        {
          name: 'add_media_type_to_overlay_pictures',
          query: `ALTER TABLE overlay_pictures ADD COLUMN media_type TEXT DEFAULT 'image'`
        },
        {
          name: 'create_queue_version_table',
          query: `CREATE TABLE IF NOT EXISTS queue_version (
            user_id INTEGER PRIMARY KEY,
            version DATETIME NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
          )`
        },
        {
          name: 'add_tts_openai_enabled_to_users',
          query: `ALTER TABLE users ADD COLUMN tts_openai_enabled BOOLEAN DEFAULT 1`
        },
        {
          name: 'add_additional_channels_to_users',
          query: `ALTER TABLE users ADD COLUMN additional_channels TEXT DEFAULT '[]'`
        },
        {
          name: 'create_username_aliases_table',
          query: `CREATE TABLE IF NOT EXISTS username_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            twitch_username TEXT NOT NULL,
            alias TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            UNIQUE(user_id, twitch_username)
          )`
        },
        {
          name: 'add_obs_websocket_password_to_users',
          query: `ALTER TABLE users ADD COLUMN obs_websocket_password TEXT`
        },
        {
          name: 'add_tts_ignored_users_to_users',
          query: `ALTER TABLE users ADD COLUMN tts_ignored_users TEXT DEFAULT '[]'`
        },
        {
          name: 'add_disconnect_message_to_stream_keys',
          query: `ALTER TABLE stream_keys ADD COLUMN disconnect_message TEXT`
        },
        {
          name: 'add_connect_message_to_stream_keys',
          query: `ALTER TABLE stream_keys ADD COLUMN connect_message TEXT`
        }
      ];

      // Execute pending migrations
      for (const migration of migrations) {
        const existing = await this.get(
          'SELECT * FROM migrations WHERE name = ?',
          [migration.name]
        );

        if (!existing) {
          try {
            await this.run(migration.query);
            await this.run(
              'INSERT INTO migrations (name) VALUES (?)',
              [migration.name]
            );
            logger.info(`Migration executed: ${migration.name}`);
          } catch (error) {
            // Ignore errors for columns that already exist
            if (error.message.includes('duplicate column name') || 
                error.message.includes('already exists')) {
              await this.run(
                'INSERT INTO migrations (name) VALUES (?)',
                [migration.name]
              );
              logger.info(`Migration marked as completed: ${migration.name}`);
            } else {
              throw error;
            }
          }
        }
      }

      logger.info('Database migrations completed successfully');
    } catch (error) {
      logger.error('Failed to run database migrations:', error);
      throw error;
    }
  }

  // Promisify database methods
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Transaction support
  async transaction(callback) {
    await this.run('BEGIN TRANSACTION');
    try {
      const result = await callback();
      await this.run('COMMIT');
      return result;
    } catch (error) {
      await this.run('ROLLBACK');
      throw error;
    }
  }

  // Close database connection
  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

// Global database instance
let db = null;

async function initDatabase() {
  if (!db) {
    db = new Database();
    await db.initialize();
  }
  return db;
}

function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

module.exports = {
  initDatabase,
  getDatabase,
  Database,
};
