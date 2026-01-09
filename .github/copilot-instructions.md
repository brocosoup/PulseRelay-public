# PulseRelay - Claude Sonnet 4.5 Instructions

## KISS Principle - Keep It Simple, Stupid

## Project Overview
RTMP streaming server with Twitch OAuth, OBS overlays, Android app, and multi-destination restreaming. Node.js + Express on Ubuntu 24.04.

## Core Stack
- **Server**: Node.js 20.x, Express, NodeMediaServer (RTMP)
- **Database**: SQLite with models in `src/models/`
- **Auth**: Passport.js (Twitch OAuth) + JWT (3 token types)
- **Frontend**: EJS templates, Bootstrap 5, strict CSP
- **Android**: Java/Kotlin, Retrofit API client, Material Design 3

## Authentication System

### Token Types (All JWT-based)
1. **Session Token** - Web UI login cookie (24h expiry)
2. **Mobile Token** - Android app API access (90 days expiry) - `/api/token/mobile`
3. **Overlay Token** - OBS browser sources (no expiry, long-lived) - `/api/token/overlay`

### Middleware
- `requireAuth` - Session cookie only
- `requireJWT` - JWT header/query/body
- `requireAuthOrJWT` - Either method (all `/api/*` routes)
- `requireOverlayAuth` - Token in URL query param for overlays

## Configuration
- **NO environment variables** - Use `config.json` + `secret.json`
- Access via `getConfig()` / `getSecrets()` from `src/config/config.js`
- Templates: `*.template` files → `npm run setup` copies & generates secrets
- Auto-generates secure 256-bit keys for JWT, encryption, and sessions
- **Google Maps API Key**: Stored in `android/local.properties` (gitignored), injected at build time via Gradle

## Template Files System
| Template File | Actual File | Purpose | Auto-Generated |
|---------------|-------------|---------|----------------|
| `config.json.template` | `config.json` | Application settings | No (manual edit) |
| `secret.json.template` | `secret.json` | API keys, JWT secrets | Yes (keys only) |
| `whitelist.json.template` | `whitelist.json` | IP whitelist | No (manual edit) |
| `android/local.properties.template` | `android/local.properties` | Android SDK path, Maps API key | No (manual edit) |

All actual files (without `.template`) are gitignored for security.

## Overlay System

### Five OBS Browser Sources
1. **Map Overlay** (`/map-overlay?token=...`) - GPS location from Android
2. **Telemetry Overlay** (`/telemetry-overlay?token=...`) - Speed, signal, battery
3. **Picture Overlay** (`/picture-overlay?token=...`) - Image/video uploads (30s display)
4. **Stream Status Overlay** (`/stream-status-overlay?token=...`) - Viewer count, uptime
5. **Music Overlay** (`/music-overlay?token=...`) - Now playing information

All overlays:
- Require `?token=` query parameter (overlay token)
- Poll API endpoints for data updates
- Silent error handling (no popups during stream)
- No layout wrapper (`layout: false`)

## Android App (`android/`)

### Features
- GPS tracking with adaptive intervals (5-300s)
- Fixed location mode with map picker (requires Google Maps API key)
- Picture/video upload to overlay
- Background foreground service
- JWT mobile token authentication
- Twitch Purple theme (#9146FF)

### Google Maps API Key Security
- **NEVER hardcode** API keys in AndroidManifest.xml or source files
- Key stored in `android/local.properties` (gitignored)
- Build-time injection via Gradle `manifestPlaceholders`
- Restrict key to package name (`com.pulserelay.locationtracker`) and SHA-1 fingerprint
- GitHub Actions builds use placeholder key (maps won't work but APK compiles)

### API Endpoints Used
- `POST /api/location` - Send GPS coordinates
- `POST /api/pictures` - Upload media (multipart/form-data, 10MB max)
- `GET /api/location/settings` - Get tracking preferences

### Build Configuration
```gradle
// android/app/build.gradle injects API key from local.properties
manifestPlaceholders = [
    MAPS_API_KEY: localProperties.getProperty('MAPS_API_KEY', 'YOUR_GOOGLE_MAPS_API_KEY_HERE')
]
```

## API Structure (`src/routes/api/`)
- `location.js` - GPS data from Android
- `pictures.js` - Media upload/retrieval for picture overlay
- `stream.js` - Stream key management
- `rtmp.js` - Restream destinations
- `token.js` - Mobile/overlay token generation
- `stats.js`, `twitch.js`, `webhooks.js`

## Frontend Security (CSP)
- **NO inline JavaScript**: `scriptSrcAttr: ["'none"]`
- Event handlers in external `.js` files only
- Data transfer via `data-*` attributes on hidden divs
- Script load order: app.js → navigation.js → toast.js → layout.js → page-specific

## Development Rules
1. **SIMPLE FIRST** - Minimal implementation, iterate later
2. **NO console.log** - Use Winston logger only
3. **NO process.env** - Use config functions
4. **NO inline handlers** - External JS files for CSP
5. **Fail silently** - Stream overlays must never show error popups
6. **Test incrementally** - Small changes, verify, commit

## Repository Structure
- **Private Repo** (`brocosoup/PulseRelay`) - Full development with history, Docker builds, VS Code tasks
- **Public Repo** (`brocosoup/PulseRelay-public`) - Clean single-commit history, source code only
- **Documentation**: Public repo has generic README without VS Code tasks or Docker references
- **Internal Docs**: Planning/implementation .md files removed from both repos (kept only essential guides)

## VS Code Tasks
- **FORBIDDEN**: Never use tasks starting with `_` (internal/dependency tasks)
- **USE ONLY**: Tasks without `_` prefix (user-facing tasks)
- Example: Use "Android: Build, Deploy & Run" NOT "_Android: Build Debug APK"
- **NOTE**: Tasks are private development tools, not included in public repo documentation

## CI/CD
- **Docker Builds**: Private repo only (GitHub Actions workflow exists in private, not public)
- **Android Builds**: Local only (no GitHub Actions, requires proper API keys)
- **Public Repo**: No automated builds (source distribution only)

## Key Files
- `src/server.js` - Entry point
- `src/config/rtmp.js` - RTMP server config
- `src/middleware/auth.js` - All auth middleware
- `public/js/*.js` - Frontend scripts (CSP-compliant)
- `android/app/src/main/` - Android app source
