#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log('🚀 PulseRelay Setup Script');
console.log('==========================\n');

// Generate secure random string
function generateSecureKey(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

// Generate JWT/Session secrets (64 bytes for higher entropy)
function generateSecureJWTKey() {
  return crypto.randomBytes(64).toString('hex');
}

// Check if files exist
const configExists = fs.existsSync('config.json');
const secretExists = fs.existsSync('secret.json');

if (!configExists || !secretExists) {
  console.log('📋 Setting up configuration files...\n');

  // Copy config template
  if (!configExists) {
    if (fs.existsSync('config.json.template')) {
      fs.copyFileSync('config.json.template', 'config.json');
      console.log('✅ Created config.json from template');
    } else {
      console.log('❌ config.json.template not found!');
      process.exit(1);
    }
  }

  // Copy and configure secret template
  if (!secretExists) {
    if (fs.existsSync('secret.json.template')) {
      const secretTemplate = JSON.parse(fs.readFileSync('secret.json.template', 'utf8'));
      
      // Remove template warnings/instructions
      delete secretTemplate._WARNING;
      delete secretTemplate._GENERATE_SECRETS;
      
      // Generate cryptographically secure keys
      secretTemplate.jwtSecret = generateSecureJWTKey();
      secretTemplate.encryptionKey = generateSecureKey(32);
      secretTemplate.session.secret = generateSecureJWTKey();
      secretTemplate.database.encryptionKey = generateSecureKey(32);
      
      fs.writeFileSync('secret.json', JSON.stringify(secretTemplate, null, 2));
      console.log('✅ Created secret.json with cryptographically secure keys');
      console.log('   🔐 JWT Secret: 512 bits of entropy');
      console.log('   🔐 Encryption Keys: 256 bits of entropy');
      console.log('   🔐 Session Secret: 512 bits of entropy');
    } else {
      console.log('❌ secret.json.template not found!');
      process.exit(1);
    }
  }

  console.log('\n🔧 Configuration files created successfully!');
  console.log('\n⚠️  IMPORTANT: You still need to configure Twitch OAuth credentials:');
  console.log('   1. Go to https://dev.twitch.tv/console');
  console.log('   2. Create a new application');
  console.log('   3. Edit secret.json and add your:');
  console.log('      - clientId');
  console.log('      - clientSecret');
  console.log('      - redirectUri (default: http://localhost:3000/auth/twitch/callback)');
  console.log('\n📝 Example secret.json configuration:');
  console.log('   {');
  console.log('     "twitch": {');
  console.log('       "clientId": "your_actual_client_id",');
  console.log('       "clientSecret": "your_actual_client_secret",');
  console.log('       "redirectUri": "http://localhost:3000/auth/twitch/callback"');
  console.log('     }');
  console.log('   }');
  console.log('\n🚀 Once configured, run: npm start');
} else {
  console.log('✅ Configuration files already exist');
  console.log('📋 Checking configuration...\n');
  
  try {
    const secrets = JSON.parse(fs.readFileSync('secret.json', 'utf8'));
    const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    
    // Check Twitch configuration
    if (!secrets.twitch.clientId || secrets.twitch.clientId === 'your_twitch_client_id') {
      console.log('⚠️  Twitch Client ID not configured');
    } else {
      console.log('✅ Twitch Client ID configured');
    }
    
    if (!secrets.twitch.clientSecret || secrets.twitch.clientSecret === 'your_twitch_client_secret') {
      console.log('⚠️  Twitch Client Secret not configured');
    } else {
      console.log('✅ Twitch Client Secret configured');
    }
    
    // Check security keys
    if (secrets.jwtSecret && !secrets.jwtSecret.includes('change-this')) {
      console.log('✅ JWT Secret configured');
    } else {
      console.log('⚠️  JWT Secret needs to be updated');
    }
    
    if (secrets.encryptionKey && !secrets.encryptionKey.includes('change-this')) {
      console.log('✅ Encryption Key configured');
    } else {
      console.log('⚠️  Encryption Key needs to be updated');
    }
    
    console.log('\n📊 Server Configuration:');
    console.log(`   - HTTP Port: ${config.server.port}`);
    console.log(`   - RTMP Port: ${config.rtmp.port}`);
    console.log(`   - Database: ${config.database.path}`);
    console.log(`   - Test Pattern: ${config.testPattern.enabled ? 'Enabled' : 'Disabled'}`);
    console.log(`   - Restreaming: ${config.restreaming.enabled ? 'Enabled' : 'Disabled'}`);
    
    console.log('\n🚀 Ready to start! Run: npm start');
    
  } catch (error) {
    console.log('❌ Error reading configuration files:', error.message);
    process.exit(1);
  }
}

// Create directories if they don't exist
const directories = ['logs', 'storage', 'temp', 'public/uploads'];
directories.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
});

console.log('\n🎉 Setup complete!');
