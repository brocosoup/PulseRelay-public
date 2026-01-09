#!/usr/bin/env node

/**
 * Development Mode Helper Script
 * 
 * This script helps enable/disable no-auth development mode for PulseRelay.
 * 
 * Usage:
 *   node scripts/dev-mode.js enable   # Enable no-auth dev mode
 *   node scripts/dev-mode.js disable  # Disable no-auth dev mode
 *   node scripts/dev-mode.js status   # Check current status
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function readConfig() {
  try {
    const configData = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    console.error('❌ Error reading config.json:', error.message);
    console.log('💡 Make sure config.json exists. Run "npm run setup" to create it.');
    process.exit(1);
  }
}

function writeConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    console.error('❌ Error writing config.json:', error.message);
    return false;
  }
}

function showStatus() {
  const config = readConfig();
  const isEnabled = config.devMode?.noAuth === true;
  
  console.log('\n📊 PulseRelay Development Mode Status');
  console.log('=====================================');
  console.log(`No-Auth Mode: ${isEnabled ? '✅ ENABLED' : '❌ DISABLED'}`);
  
  if (isEnabled) {
    console.log('\n🔓 Authentication is bypassed');
    console.log('👤 Using mock user:', config.devMode.mockUser.display_name);
    console.log('⚠️  WARNING: Do not use this in production!');
  } else {
    console.log('\n🔒 Twitch OAuth authentication required');
    console.log('💡 To enable dev mode: npm run dev-mode enable');
  }
  console.log('');
}

function enableDevMode() {
  const config = readConfig();
  
  // Ensure devMode object exists
  if (!config.devMode) {
    config.devMode = {};
  }
  
  // Set no-auth mode
  config.devMode.noAuth = true;
  
  // Ensure mock user exists
  if (!config.devMode.mockUser) {
    config.devMode.mockUser = {
      id: 1,
      username: 'devuser',
      display_name: 'Development User',
      twitch_id: 'dev123456',
      email: 'dev@pulserelay.local',
      profile_image_url: 'https://via.placeholder.com/150',
      role: 'user'
    };
  }
  
  if (writeConfig(config)) {
    console.log('\n✅ No-Auth Development Mode ENABLED');
    console.log('🔓 Authentication bypassed - you can now access PulseRelay without Twitch OAuth');
    console.log('👤 Mock user:', config.devMode.mockUser.display_name);
    console.log('\n⚠️  SECURITY WARNING: This mode should NEVER be used in production!');
    console.log('💡 To disable: npm run dev-mode disable');
    console.log('');
  }
}

function disableDevMode() {
  const config = readConfig();
  
  // Ensure devMode object exists
  if (!config.devMode) {
    config.devMode = {};
  }
  
  // Disable no-auth mode
  config.devMode.noAuth = false;
  
  if (writeConfig(config)) {
    console.log('\n✅ No-Auth Development Mode DISABLED');
    console.log('🔒 Twitch OAuth authentication is now required');
    console.log('💡 Make sure to configure your Twitch credentials in secret.json');
    console.log('');
  }
}

function showHelp() {
  console.log('\n🛠️  PulseRelay Development Mode Helper');
  console.log('=====================================');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/dev-mode.js <command>');
  console.log('');
  console.log('Commands:');
  console.log('  enable   Enable no-auth development mode');
  console.log('  disable  Disable no-auth development mode');
  console.log('  status   Show current development mode status');
  console.log('  help     Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  npm run dev-mode enable');
  console.log('  npm run dev-mode disable');
  console.log('  npm run dev-mode status');
  console.log('');
}

// Main execution
const command = process.argv[2];

switch (command) {
  case 'enable':
    enableDevMode();
    break;
  case 'disable':
    disableDevMode();
    break;
  case 'status':
    showStatus();
    break;
  case 'help':
  case '--help':
  case '-h':
    showHelp();
    break;
  default:
    console.log('❌ Unknown command:', command || '(none)');
    showHelp();
    process.exit(1);
}
