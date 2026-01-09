# Building PulseRelay Android App

## Quick Build (Windows)

From the `android/` directory:

```batch
# Build debug APK
gradlew.bat assembleDebug

# Output: app\build\outputs\apk\debug\app-debug.apk
```

Or use the existing build script:
```batch
build-apk.bat
```

## What's New in This Build

✅ **Twitch Dark Theme**
- Matches PulseRelay web interface
- Purple branding throughout (#9146FF)
- Dark backgrounds optimized for OLED

✅ **Modern Material Design**
- Material Design 3 components
- Card-based layouts
- Smooth animations and ripple effects

✅ **Enhanced UI**
- Custom app icon with pulse wave design
- Improved typography and spacing
- Professional settings screen

## Preview the Theme

The app will now display:
1. **Splash screen** with purple branding
2. **Main screen** with:
   - PulseRelay logo (📡) and title
   - Purple status card
   - Large purple action button
   - Info card with tips
3. **Settings screen** matching dark theme

## Installation

1. Enable "Unknown Sources" on your Android device
2. Transfer the APK to your device
3. Install and open
4. Grant location permissions
5. Configure API URL in settings

## Theme Components

- **Launcher Icon**: Purple circle with pulse waves
- **Action Bar**: Dark with white text
- **Buttons**: Twitch purple with ripple effect
- **Cards**: Dark gray with purple borders
- **Switch**: Purple when ON, gray when OFF
- **Status Bar**: Dark background

Enjoy your themed PulseRelay Android app! 🎨📡
