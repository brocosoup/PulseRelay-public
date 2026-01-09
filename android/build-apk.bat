@echo off
echo ========================================
echo Building PulseRelay Location Tracker APK
echo ========================================
echo.

REM Check if Android SDK is installed
if not defined ANDROID_HOME (
    echo ERROR: ANDROID_HOME environment variable is not set
    echo.
    echo Please install Android Studio and set ANDROID_HOME to your Android SDK path
    echo Example: C:\Users\YourName\AppData\Local\Android\Sdk
    echo.
    pause
    exit /b 1
)

echo Android SDK found at: %ANDROID_HOME%
echo.

REM Clean previous builds
echo Cleaning previous builds...
call gradlew.bat clean

echo.
echo Building debug APK...
call gradlew.bat assembleDebug

if %errorlevel% neq 0 (
    echo.
    echo ========================================
    echo BUILD FAILED!
    echo ========================================
    pause
    exit /b 1
)

echo.
echo ========================================
echo BUILD SUCCESSFUL!
echo ========================================
echo.
echo APK location:
echo app\build\outputs\apk\debug\app-debug.apk
echo.
echo You can now install this APK on your Android device.
echo.
pause
