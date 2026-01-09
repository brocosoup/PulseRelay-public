# PulseRelay Android - Release Guide

## 📦 v1.0.0 Release

### Release APK Location
```
android/app/build/outputs/apk/release/app-release.apk
```

### APK Details
- **Size**: ~2.1 MB
- **Version**: 1.0.0 (versionCode: 1)
- **Min Android**: 5.0 (API 21)
- **Target Android**: 14 (API 34)
- **Signed**: Yes (with release keystore)
- **Optimized**: ProGuard enabled with code shrinking

## 🚀 Installation Instructions

### For End Users

1. **Download the APK**
   - Get `app-release.apk` from the releases page or build folder

2. **Transfer to Android Device**
   - Via USB cable, email, or file sharing service

3. **Enable Installation from Unknown Sources**
   - Settings → Security → Install Unknown Apps
   - Allow your file manager/browser to install apps

4. **Install the APK**
   - Open the APK file
   - Tap "Install"
   - Grant required permissions

5. **Configure the App**
   - Open PulseRelay app
   - Tap menu (⋮) → Settings
   - Get API Token from PulseRelay web dashboard:
     1. Open https://pulse.brocosoup.fr
     2. Login with Twitch
     3. Go to Settings → API Token
     4. Click "Generate New Token"
     5. Copy the token
   - Paste token in app settings
   - Configure API URL (default: `https://pulse.brocosoup.fr`)

6. **Start Tracking**
   - Return to main screen
   - Toggle "Background Tracking" ON
   - Grant notification and location permissions when prompted

## 🔧 Building Release APK

### Prerequisites
```bash
# Java 11 or higher
java -version

# Android SDK installed
# Gradle will download automatically
```

### Build Command
```bash
cd android
./gradlew assembleRelease

# Windows:
.\gradlew.bat assembleRelease
```

### Output Location
```
android/app/build/outputs/apk/release/app-release.apk
```

## 🔐 Signing Configuration

The release APK is signed with:
- **Keystore**: `android/app/pulserelay-release-key.jks`
- **Alias**: `pulserelay`
- **Validity**: 10,000 days (~27 years)
- **Algorithm**: RSA 2048-bit

> ⚠️ **Important**: The keystore file is excluded from git via `.gitignore`. Keep it safe and backed up!

### Keystore Details
```
CN=PulseRelay
OU=Mobile
O=BrocoSoup
L=Paris
ST=IDF
C=FR
```

## 📝 ProGuard Configuration

The release build includes:
- ✅ Code minification (ProGuard)
- ✅ Resource shrinking
- ✅ Optimization enabled
- ✅ Keep rules for:
  - Application classes
  - Google Play Services Location
  - OkHttp networking
  - Android components
  - Source file/line numbers (for crash reports)

## 🔍 Verification

### Check APK Signature
```bash
jarsigner -verify -verbose -certs app-release.apk
```

### Extract APK Info
```bash
aapt dump badging app-release.apk
```

## 📋 Required Permissions

The app requests:
- `ACCESS_FINE_LOCATION` - GPS tracking
- `ACCESS_COARSE_LOCATION` - Network location
- `ACCESS_BACKGROUND_LOCATION` - Track when app closed (Android 10+)
- `POST_NOTIFICATIONS` - Foreground service notification (Android 13+)
- `INTERNET` - Send location to server
- `FOREGROUND_SERVICE` - Background tracking
- `FOREGROUND_SERVICE_LOCATION` - Location service type
- `WAKE_LOCK` - Prevent sleep during tracking
- `RECEIVE_BOOT_COMPLETED` - Auto-start (future feature)

## 🐛 Troubleshooting

### Build Fails
```bash
# Clean and rebuild
./gradlew clean assembleRelease
```

### Installation Blocked
- Ensure "Install from Unknown Sources" is enabled
- Check device has enough storage space
- Verify APK is not corrupted (re-download)

### App Crashes on Launch
- Check Android version (min 5.0 required)
- Clear app data: Settings → Apps → PulseRelay → Clear Data
- Check crash logs: `adb logcat | grep PulseRelay`

### Location Not Sending
- Verify API Token is valid (30-day expiration)
- Check API URL is correct
- Ensure location permissions granted
- Test internet connectivity

## 📊 Version History

### v1.0.0 (2025-12-30)
**Initial Release**

Features:
- JWT token authentication
- Background location tracking with foreground service
- Configurable update intervals (5-300 seconds)
- Material Design 3 UI with Twitch dark theme
- Settings screen for API configuration
- Manual location send button
- Notification permission support (Android 13+)

Fixes:
- Fixed ClassCastException with update_interval preference
- Added POST_NOTIFICATIONS permission for Android 13+
- Fixed foreground service crashes

Technical:
- Java 11 compatibility
- Gradle 8.9
- Android Gradle Plugin 8.7.3
- Target SDK 34 (Android 14)
- Min SDK 21 (Android 5.0)

## 🔄 Update Process

### For Users
1. Download new APK
2. Install over existing app (data preserved)
3. Reopen app and reconfigure if needed

### For Developers
1. Update `versionCode` and `versionName` in `build.gradle`
2. Make code changes
3. Test thoroughly
4. Build release APK
5. Test release APK on device
6. Create GitHub release with APK attachment
7. Update changelog

## 📱 Distribution

### GitHub Releases (Recommended)
1. Tag release: `git tag -a android-v1.0.0 -m "Android v1.0.0"`
2. Push tag: `git push origin android-v1.0.0`
3. Create GitHub Release
4. Upload `app-release.apk`
5. Add release notes

### Direct Distribution
- Share APK via file hosting service
- Email to users
- Deploy to internal enterprise store
- Self-host on website

> ⚠️ **Note**: For Google Play Store distribution, additional setup required (signed bundle, Play Console account, etc.)

## 🔒 Security Notes

- API Token expires after 30 days
- Use HTTPS for API endpoint
- Keystore password stored in build.gradle (consider using gradle.properties for production)
- Location data encrypted in transit (HTTPS)
- No sensitive data stored locally

## 📞 Support

- **Issues**: https://github.com/brocosoup/PulseRelay/issues
- **Documentation**: See android/README.md
- **API Docs**: See API-TESTING.md
