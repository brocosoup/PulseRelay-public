# PulseRelay Android Location Tracker

> 🎨 **Now with PulseRelay Twitch Dark Theme!**

Simple Android application for tracking and sending GPS location data to your PulseRelay server.

## 🎨 Design & Theme

The Android app now matches PulseRelay's web interface with:

- **Twitch Purple** color scheme (#9146FF)
- **Dark theme** optimized for OLED displays
- **Material Design 3** components
- **Card-based layouts** with subtle borders and shadows
- **Modern typography** with Inter-style fonts
- **Consistent branding** across all screens

### Color Palette
- Primary: Twitch Purple (#9146FF)
- Background: Dark (#0E0E10, #18181B)
- Text: Light Gray (#EFEFF1)
- Accents: Purple variants and status colors

## Features

- ✅ **Manual Location Send**: Button to send current location immediately
- ✅ **Background Tracking**: Continuous location tracking with foreground service
- ✅ **Settings Page**: Configure API URL and update intervals
- ✅ **Auto-start on Boot**: Optionally start tracking when device boots
- ✅ **Customizable Update Interval**: Set location update frequency (5-300 seconds)

## Setup

1. **Open in Android Studio**
   ```bash
   cd android
   # Open this folder in Android Studio
   ```

2. **Sync Gradle files**
   - Android Studio will automatically sync dependencies

3. **Configure API URL**
   - Install the app on your device
   - Open Settings (gear icon)
   - Enter your API URL (e.g., `https://your-domain.com/api/location`)

4. **Build and Run**
   - Connect an Android device or use an emulator
   - Click Run in Android Studio

## API Endpoint Format

The app sends location data as JSON POST requests:

```json
{
  "latitude": 37.7749,
  "longitude": -122.4194,
  "accuracy": 10.5,
  "altitude": 15.0,
  "speed": 0.0,
  "bearing": 0.0,
  "timestamp": 1735574400000
}
```

## Permissions

The app requires:
- **Location** (Fine & Coarse): GPS tracking
- **Background Location**: Tracking while app is not visible
- **Foreground Service**: Keep tracking service running
- **Internet**: Send data to API
- **Boot Completed**: Auto-start on boot (optional)

## Usage

### Manual Location Send
1. Tap "Send Location Now" button
2. Location is immediately sent to configured API

### Background Tracking
1. Toggle "Background Tracking" switch
2. App runs in background with notification
3. Location updates sent at configured interval

### Settings
- **API URL**: Your server endpoint
- **Update Interval**: 5-300 seconds between updates
- **Auto-start on boot**: Enable to start tracking automatically

## Building APK

### Option 1: GitHub Actions (No Android Studio Required!)

The easiest way to get an APK without installing Android Studio:

1. **Push your code to GitHub**:
   ```bash
   git add .
   git commit -m "Add Android location tracker app"
   git push origin main
   ```

2. **Download the APK**:
   - Go to your repository on GitHub
   - Click on "Actions" tab
   - Click on the latest workflow run
   - Scroll down to "Artifacts"
   - Download `pulserelay-tracker-debug.zip`
   - Extract and install `app-debug.apk` on your device

3. **Manual build trigger**:
   - Go to Actions → Build Android APK → Run workflow
   - Download the APK from artifacts when complete

### Option 2: Local Build (Requires Android Studio)

```bash
cd android
./gradlew assembleDebug
# APK will be in: app/build/outputs/apk/debug/app-debug.apk
```

For Windows:
```bash
cd android
.\gradlew.bat assembleDebug
```

## Minimum Requirements

- Android 7.0 (API 24) or higher
- GPS capability
- Internet connection

## Privacy & Battery

- Uses foreground service for transparent tracking
- Configurable update intervals to balance accuracy vs battery
- All location data sent directly to your configured API
- No third-party tracking or analytics

## Troubleshooting

**Location not sending:**
- Check API URL is correct in settings
- Verify location permissions are granted
- Ensure device has GPS enabled
- Check internet connectivity

**Background tracking stops:**
- Some devices aggressively kill background services
- Disable battery optimization for this app in device settings
- Check that location permission includes "Allow all the time"
