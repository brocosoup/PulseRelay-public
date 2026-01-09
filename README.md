# PulseRelay

[![Docker Build](https://github.com/brocosoup/PulseRelay/actions/workflows/docker-build.yml/badge.svg)](https://github.com/brocosoup/PulseRelay/actions/workflows/docker-build.yml)
[![GitHub Container Registry](https://img.shields.io/badge/ghcr.io-pulserelay-blue?logo=github)](https://github.com/brocosoup/PulseRelay/pkgs/container/pulserelay)

Professional RTMP streaming server with Android integration, GPS tracking, OBS overlays, and multi-platform restreaming. Built for IRL streamers who need reliability, security, and real-time telemetry.

## ⚡ Key Features

### 📡 RTMP Streaming
- **Secure NodeMediaServer** with JWT-authenticated stream keys
- **Multi-destination restreaming** to Twitch, YouTube, Facebook, etc.
- **Test pattern generator** for troubleshooting and setup
- **Real-time statistics** and stream health monitoring

### 📱 Android Mobile App
- **Adaptive GPS tracking** (5-300 second intervals) with battery optimization
- **Fixed location mode** with map picker for testing/simulation
- **Background foreground service** for reliable tracking during streams
- **Picture/video upload** to stream overlays (10MB max)
- **Twitch Purple theme** (#9146FF) optimized for OLED displays
- **Material Design 3** with modern, intuitive UI

### 🎨 OBS Browser Source Overlays
- **Map Overlay** - Live GPS location with animated marker
- **Telemetry Overlay** - Speed, signal strength, battery level, connection status
- **Picture Overlay** - Auto-display uploaded media for 30 seconds
- **Stream Status Overlay** - Viewer count, uptime, connection quality
- **Music Overlay** - Now playing information from Spotify/media players
- **Silent error handling** - Never interrupts your live stream

### 🔐 Security & Authentication
- **Three JWT token types**: Session (24h), Mobile (90 days), Overlay (long-lived)
- **Twitch OAuth integration** for secure user authentication
- **Strict Content Security Policy (CSP)** - No inline JavaScript
- **Token-based overlay access** with secure URL parameters
- **IP whitelist support** for admin functions


## 📋 Tech Stack

- **Runtime**: Node.js 20.x with Express.js
- **Database**: SQLite with async/await models
- **RTMP Server**: NodeMediaServer (FFmpeg-based)
- **Authentication**: Passport.js (Twitch OAuth) + JWT
- **Frontend**: EJS templates, Bootstrap 5, vanilla JavaScript
- **Android**: Java/Kotlin, Retrofit, Material Design 3, Google Maps
- **Deployment**: Docker, Ubuntu 24.04 LTS, systemd

## 🚀 Quick Start

### Ubuntu 24.04 Automated Setup

```bash
git clone https://github.com/brocosoup/PulseRelay.git
cd PulseRelay
sudo chmod +x setup.sh
sudo ./setup.sh
```

The setup script installs Node.js, FFmpeg, creates a systemd service, and configures the application.

### Manual Installation

#### Prerequisites
- Node.js 20.x or higher
- FFmpeg (`sudo apt install ffmpeg`)
- SQLite3 (`sudo apt install sqlite3`)

#### Steps

1. **Clone and install dependencies**:
   ```bash
   git clone https://github.com/brocosoup/PulseRelay.git
   cd PulseRelay
   npm install
   ```

2. **Generate configuration files**:
   ```bash
   npm run setup
   ```
   
   This automated setup script:
   - Copies `config.json.template` → `config.json`
   - Copies `secret.json.template` → `secret.json`
   - Copies `whitelist.json.template` → `whitelist.json` (optional)
   - Generates secure random keys for JWT, encryption, and sessions
   - Creates required directories (`data/`, `logs/`, `public/uploads/`)
   
   **Manual alternative** (if you prefer):
   ```bash
   cp config.json.template config.json
   cp secret.json.template secret.json
   # Then manually edit both files with your settings
   ```

3. **Configure Twitch OAuth**:
   - Create a Twitch app at https://dev.twitch.tv/console
   - Edit `secret.json`:
     ```json
     {
       "twitch": {
         "clientId": "your_client_id_here",
         "clientSecret": "your_client_secret_here",
         "redirectUri": "http://localhost:3000/auth/twitch/callback"
       }
     }
     ```

4. **Start the server**:
   ```bash
   npm start          # Production mode
   npm run dev        # Development mode with nodemon
   ```

5. **Access the dashboard**:
   - Open http://localhost:3000
   - Login with Twitch OAuth
   - Copy your stream key and configure OBS

### Docker Deployment

```bash
docker-compose up -d
```

Docker images available at `ghcr.io/brocosoup/pulserelay:latest`

## 📱 Android App Setup

### Building the APK

#### Prerequisites
- Android Studio or Android SDK
- JDK 11 or higher
- Set `ANDROID_HOME` environment variable

#### Build with VS Code Tasks

Use the pre-configured task: **Android: Build, Deploy & Run on Emulator**

#### Manual Build

```bash
cd android
./gradlew assembleDebug  # Windows: gradlew.bat assembleDebug
```

APK output: `android/app/build/outputs/apk/debug/app-debug.apk`

### Configuration

1. **Copy template** (if not already done):
   ```bash
   cd android
   cp local.properties.template local.properties
   ```
   
   This creates `local.properties` from the template. The actual file contains your local paths and API keys and is gitignored.

2. **Get Google Maps API key** (optional, for map picker feature):

   **Step 1: Create API Key**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one
   - Navigate to **APIs & Services** → **Credentials**
   - Click **Create Credentials** → **API Key**
   - Copy the generated key
   
   **Step 2: Enable Required API**
   - Go to **APIs & Services** → **Library**
   - Search for "Maps SDK for Android"
   - Click **Enable**
   
   **Step 3: Restrict API Key (CRITICAL for security)**
   - Go back to **Credentials** and click on your API key
   - Under **Application restrictions**:
     - Select **Android apps**
     - Click **Add an item**
     - Package name: `com.pulserelay.locationtracker`
     - SHA-1 certificate fingerprint: Get it using:
       ```bash
       cd android
       keytool -list -v -keystore app/pulserelay-release-key.jks -alias pulserelay
       # Password: pulserelay123
       # Copy the SHA1 fingerprint
       ```
   - Under **API restrictions**:
     - Select **Restrict key**
     - Check **Maps SDK for Android**
   - Click **Save**
   
   **Step 4: Add to local.properties**
   - Edit `android/local.properties`:
     ```properties
     sdk.dir=C:/Users/YourName/AppData/Local/Android/Sdk
     MAPS_API_KEY=AIzaSy...your_actual_key_here
     ```
   
   ⚠️ **Security Notes:**
   - The key is injected at build time from `local.properties` (gitignored)
   - Never commit API keys to git
   - Restrictions prevent unauthorized use
   - Key only works with your app package name and signing certificate

3. **Install on device/emulator**:
   ```bash
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```

### First Launch

1. Open the app and enter your PulseRelay server URL
2. Login with Twitch to get a mobile token
3. Configure GPS tracking interval (5-300 seconds)
4. Enable background service for reliable tracking
5. Upload pictures/videos directly to your stream overlay

## 🎥 OBS Overlay Setup

### 1. Generate Overlay Token

1. Login to PulseRelay dashboard
2. Navigate to **Settings** → **Tokens**
3. Click **Generate Overlay Token**
4. Copy the token (save it securely - no expiry)

### 2. Add Browser Sources in OBS

#### Map Overlay
- **URL**: `http://localhost:3000/map-overlay?token=YOUR_OVERLAY_TOKEN`
- **Width**: 400px
- **Height**: 300px
- **Refresh**: Disable
- **Control audio via OBS**: Check

#### Telemetry Overlay
- **URL**: `http://localhost:3000/telemetry-overlay?token=YOUR_OVERLAY_TOKEN`
- **Width**: 300px
- **Height**: 200px
- **Refresh**: Disable

#### Picture Overlay
- **URL**: `http://localhost:3000/picture-overlay?token=YOUR_OVERLAY_TOKEN`
- **Width**: 1920px (or your stream width)
- **Height**: 1080px (or your stream height)
- **Refresh**: Disable

### 3. Configure Transparency

- Right-click browser source → **Filters**
- Add **Color Key** filter (if needed for transparency)
- Adjust CSS opacity in overlay settings

All overlays poll the API for updates (1-5 second intervals) and handle errors silently to never interrupt your stream.


## ⚙️ Configuration

### Configuration Philosophy

**NO environment variables.** PulseRelay uses JSON configuration files for clarity and simplicity:

- **`config.json`** - Application settings (ports, RTMP config, features)
- **`secret.json`** - Sensitive data (API keys, JWT secrets, encryption keys)
- **`whitelist.json`** - IP whitelist for admin functions (optional)

### Template Files

PulseRelay provides `.template` files as starting points:

| Template File | Actual File | Purpose |
|---------------|-------------|---------|
| `config.json.template` | `config.json` | Application configuration |
| `secret.json.template` | `secret.json` | Secrets and API keys |
| `whitelist.json.template` | `whitelist.json` | IP whitelist (optional) |
| `android/local.properties.template` | `android/local.properties` | Android build config |

**The actual files (without `.template`) are gitignored** to protect your secrets.

### Setup Process

When you run `npm run setup`, the script (`scripts/setup.js`):
1. Copies each `.template` file to its actual filename
2. Auto-generates secure random values for:
   - `jwtSecret` (256-bit)
   - `encryptionKey` (256-bit)
   - `session.secret` (256-bit)
3. Leaves placeholder values for you to fill (like Twitch OAuth credentials)

### Configuration Files

#### config.json

```json
{
  "server": {
    "port": 3000,
    "host": "0.0.0.0"
  },
  "rtmp": {
    "port": 1935,
    "chunkSize": 60000,
    "gop": 30
  },
  "location": {
    "updateInterval": 30,
    "minInterval": 5,
    "maxInterval": 300
  },
  "pictures": {
    "maxSize": 10485760,
    "allowedTypes": ["image/jpeg", "image/png", "video/mp4"],
    "displayDuration": 30000
  },
  "devMode": {
    "noAuth": false
  }
}
```

#### secret.json

```json
{
  "twitch": {
    "clientId": "your_twitch_client_id",
    "clientSecret": "your_twitch_client_secret",
    "redirectUri": "http://localhost:3000/auth/twitch/callback"
  },
  "jwtSecret": "auto-generated-on-setup",
  "encryptionKey": "auto-generated-on-setup",
  "session": {
    "secret": "auto-generated-on-setup"
  }
}
```

### Token Types

PulseRelay uses three distinct JWT token types:

| Token Type | Expiry | Use Case | Generated Via |
|------------|--------|----------|---------------|
| **Session Token** | 24 hours | Web dashboard login (cookie) | Twitch OAuth login |
| **Mobile Token** | 90 days | Android app API access | `/api/token/mobile` endpoint |
| **Overlay Token** | None (long-lived) | OBS browser sources | `/api/token/overlay` endpoint |

### Development Mode

For testing without Twitch OAuth:

1. Edit `config.json`:
   ```json
   {
     "devMode": {
       "noAuth": true,
       "mockUser": {
         "id": 1,
         "username": "devuser",
         "display_name": "Development User"
       }
     }
   }
   ```

2. Start the server - auto-login with mock user

**⚠️ NEVER use devMode.noAuth in production!**

## 📡 RTMP Streaming

### Stream Configuration

**Publisher URL**: `rtmp://your-server:1935/live/YOUR_STREAM_KEY`

Get your stream key from the dashboard or via API:

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:3000/api/stream/key
```

### OBS Configuration

1. **Settings** → **Stream**
2. **Service**: Custom
3. **Server**: `rtmp://your-server:1935/live`
4. **Stream Key**: Your PulseRelay stream key
5. **Output**:
   - Encoder: x264 or NVENC
   - Bitrate: 3000-6000 kbps (recommended)
   - Keyframe Interval: 2 seconds

### Multi-Platform Restreaming

Add restream destinations via dashboard or API:

```bash
curl -X POST http://localhost:3000/api/rtmp/destinations \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Twitch",
    "url": "rtmp://live.twitch.tv/app/your_twitch_stream_key",
    "enabled": true
  }'
```

Supported platforms: Twitch, YouTube, Facebook, Kick, custom RTMP endpoints.

## 🛠️ API Reference

### Authentication

All `/api/*` routes support both methods:
- **Cookie**: Session token (web dashboard)
- **Header**: `Authorization: Bearer <token>` (mobile/API)

### Key Endpoints

#### Stream Management
- `GET /api/stream/key` - Get your stream key
- `POST /api/stream/key/regenerate` - Generate new stream key
- `GET /api/stream/status` - Current stream status

#### Location (Android App)
- `POST /api/location` - Submit GPS coordinates
- `GET /api/location/latest` - Get latest location
- `GET /api/location/settings` - Get tracking settings

#### Media Upload (Android App)
- `POST /api/pictures` - Upload picture/video (multipart/form-data)
- `GET /api/pictures/latest` - Get latest uploaded media

#### Restreaming
- `GET /api/rtmp/destinations` - List all restream destinations
- `POST /api/rtmp/destinations` - Add new destination
- `PUT /api/rtmp/destinations/:id` - Update destination
- `DELETE /api/rtmp/destinations/:id` - Remove destination

#### Tokens
- `POST /api/token/mobile` - Generate mobile token (90 days)
- `POST /api/token/overlay` - Generate overlay token (no expiry)

### Example: Upload Picture from Android

```java
// Retrofit API call
MultipartBody.Part filePart = MultipartBody.Part.createFormData(
    "picture", file.getName(), 
    RequestBody.create(file, MediaType.parse("image/jpeg"))
);

Call<ResponseBody> call = apiService.uploadPicture(
    "Bearer " + mobileToken, 
    filePart
);
```


## 📂 Project Structure

```
PulseRelay/
├── android/                    # Android mobile app
│   ├── app/src/main/java/      # Java/Kotlin source code
│   │   └── com/pulserelay/locationtracker/
│   │       ├── MainActivity.java
│   │       ├── LoginActivity.java
│   │       ├── LocationService.java
│   │       └── api/            # Retrofit API client
│   ├── app/src/main/res/       # Android resources
│   └── build.gradle            # Android build config
│
├── src/
│   ├── server.js               # Express app entry point
│   ├── config/
│   │   ├── config.js           # Configuration loader
│   │   ├── database.js         # SQLite database setup
│   │   ├── rtmp.js             # NodeMediaServer config
│   │   └── auth.js             # Passport.js config
│   ├── middleware/
│   │   ├── auth.js             # JWT/session middleware
│   │   ├── validation.js       # Request validation
│   │   └── errors.js           # Error handling
│   ├── models/
│   │   ├── User.js             # User database model
│   │   ├── StreamKey.js        # Stream key model
│   │   └── RTMPDestination.js  # Restream destination model
│   ├── routes/
│   │   ├── auth.js             # Twitch OAuth routes
│   │   ├── dashboard.js        # Web UI routes
│   │   ├── api.js              # API router
│   │   └── api/                # API endpoint modules
│   │       ├── location.js     # GPS tracking API
│   │       ├── pictures.js     # Media upload API
│   │       ├── stream.js       # Stream management API
│   │       ├── rtmp.js         # Restream API
│   │       └── token.js        # Token generation API
│   ├── services/
│   │   ├── restream.js         # FFmpeg restream service
│   │   ├── testPattern.js      # Test pattern generator
│   │   ├── pictureCleanup.js   # Auto-delete old uploads
│   │   └── twitchBot.js        # Twitch chat integration
│   └── utils/
│       ├── logger.js           # Winston logging
│       ├── crypto.js           # JWT/encryption utilities
│       └── whitelist.js        # IP whitelist management
│
├── public/                     # Static web assets
│   ├── js/
│   │   ├── app.js              # Core app logic (CSP-compliant)
│   │   ├── dashboard.js        # Dashboard UI
│   │   ├── map-overlay.js      # Map overlay polling
│   │   ├── telemetry-overlay.js
│   │   └── picture-overlay.js
│   ├── css/
│   │   └── style.css           # Bootstrap 5 + custom styles
│   └── uploads/pictures/       # Uploaded media storage
│
├── views/                      # EJS templates
│   ├── layout.ejs              # Base layout
│   ├── dashboard.ejs           # Main dashboard
│   ├── stream.ejs              # Stream management
│   ├── map-overlay.ejs         # OBS map overlay
│   ├── telemetry-overlay.ejs   # OBS telemetry overlay
│   └── picture-overlay.ejs     # OBS picture overlay
│
├── data/                       # SQLite database files
├── logs/                       # Winston log files
├── storage/                    # Session storage
├── config.json                 # Application config (generated)
├── secret.json                 # Secrets (generated)
└── package.json                # Node.js dependencies
```

## 🔒 Security Features

### Content Security Policy (CSP)

**CRITICAL**: PulseRelay enforces strict CSP - **NO inline JavaScript allowed**.

```javascript
// ❌ FORBIDDEN - CSP violation
<button onclick="handleClick()">Click</button>

// ✅ CORRECT - External event handlers
// HTML: <button id="myButton" data-action="click">Click</button>
// app.js:
document.getElementById('myButton').addEventListener('click', handleClick);
```

### Authentication Middleware

- `requireAuth` - Session cookie only (web dashboard)
- `requireJWT` - JWT header/query/body only
- `requireAuthOrJWT` - Either method (all `/api/*` routes)
- `requireOverlayAuth` - Token in URL query param (overlays)

### Data Protection

- JWT tokens with configurable expiry
- Encrypted stream keys in database
- Secure session management with rolling secrets
- Optional IP whitelist for admin functions

## 🐛 Development

### Prerequisites
- Node.js 20.x
- FFmpeg
- Android Studio (for Android app development)

### Development Server

```bash
npm run dev  # Starts nodemon with auto-restart
```

### VS Code Tasks

Use the pre-configured tasks in `.vscode/tasks.json`:

- **Launch PulseRelay Dev Server (Nodemon)** - Start dev server
- **Android: Build, Deploy & Run on Emulator** - Full Android build/deploy cycle
- **Git: Commit and Merge to Main** - Auto-commit dev → merge to main

**⚠️ NEVER use tasks prefixed with `_`** - These are internal dependency tasks.

### Testing

```bash
npm test               # Run all tests
npm run test:unit      # Unit tests only
npm run test:api       # API integration tests
```

### Android Development

1. Open `android/` folder in Android Studio
2. Build → **Make Project**
3. Run → **Run 'app'** (or use VS Code task)

See [android/BUILD_GUIDE.md](android/BUILD_GUIDE.md) for detailed instructions.

## 🚢 Production Deployment

### Systemd Service (Ubuntu 24.04)

The `setup.sh` script creates a systemd service:

```bash
sudo systemctl start pulserelay
sudo systemctl enable pulserelay   # Auto-start on boot
sudo systemctl status pulserelay   # Check status
```

### Docker

```bash
# Build
docker build -t pulserelay:latest .

# Run
docker-compose up -d

# View logs
docker-compose logs -f
```

### Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Environment Checklist

- [ ] `config.json` configured with production settings
- [ ] `secret.json` with real Twitch OAuth credentials
- [ ] `devMode.noAuth` set to `false`
- [ ] Firewall allows ports 3000 (web) and 1935 (RTMP)
- [ ] SSL certificate installed (for HTTPS)
- [ ] Database backups configured (`data/` directory)
- [ ] Log rotation enabled (`logs/` directory)

## 📚 Documentation

- [Android Build Guide](android/BUILD_GUIDE.md)
- [Android Release Process](android/RELEASE.md)
- [GPS Tracking Implementation](android/ADAPTIVE_GPS_TRACKING.md)
- [Picture Overlay Guide](PICTURE_OVERLAY.md)
- [Security Assessment](SECURITY_ASSESSMENT.md)
- [Docker Deployment](DOCKER.md)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make changes following the code style:
   - **NO console.log** - Use Winston logger
   - **NO process.env** - Use `getConfig()` / `getSecrets()`
   - **NO inline JavaScript** - External files for CSP compliance
4. Test thoroughly: `npm test`
5. Commit: `git commit -m "Add my feature"`
6. Push: `git push origin feature/my-feature`
7. Open a Pull Request to `dev` branch

### Development Guidelines

- **KISS Principle** - Keep it simple, stupid
- **Fail silently** - Stream overlays never show error popups
- **Test incrementally** - Small changes, verify, commit
- Follow existing patterns in `src/routes/api/` and `public/js/`

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [NodeMediaServer](https://github.com/illuspas/Node-Media-Server) - RTMP server
- [Passport.js](http://www.passportjs.org/) - Authentication
- [Bootstrap](https://getbootstrap.com/) - Frontend framework
- [Retrofit](https://square.github.io/retrofit/) - Android HTTP client

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/brocosoup/PulseRelay/issues)
- **Discussions**: [GitHub Discussions](https://github.com/brocosoup/PulseRelay/discussions)
- **Documentation**: Check the `/docs` folder and markdown files in project root

---

**Built with ❤️ for IRL streamers**
