@echo off
REM PulseRelay Docker Management Script for Windows

setlocal enabledelayedexpansion

set "command=%~1"

if "%command%"=="" (
    set "command=help"
)

echo [INFO] PulseRelay Docker Management

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not running. Please start Docker Desktop and try again.
    exit /b 1
)

if /i "%command%"=="build" (
    echo [INFO] Building PulseRelay Docker image...
    docker build -t pulserelay:latest .
    if !errorlevel! equ 0 (
        echo [SUCCESS] Docker image built successfully!
    ) else (
        echo [ERROR] Failed to build Docker image
        exit /b 1
    )
) else if /i "%command%"=="dev" (
    echo [INFO] Starting PulseRelay in development mode...
    docker-compose up --build
) else if /i "%command%"=="prod" (
    echo [INFO] Starting PulseRelay in production mode...
    
    if not exist "config.json" (
        echo [WARNING] config.json not found. Creating from template...
        copy "config.json.template" "config.json"
        echo [WARNING] Please edit config.json with your configuration!
    )
    
    if not exist "secret.json" (
        echo [WARNING] secret.json not found. Creating from template...
        copy "secret.json.template" "secret.json"
        echo [WARNING] Please edit secret.json with your secrets (Twitch OAuth, etc.)!
    )
    
    docker-compose -f docker-compose.prod.yml up -d
    if !errorlevel! equ 0 (
        echo [SUCCESS] PulseRelay started in production mode!
        echo [INFO] Access the application at: http://localhost:3000
        echo [INFO] RTMP endpoint: rtmp://localhost:1935/live/YOUR_STREAM_KEY
    )
) else if /i "%command%"=="stop" (
    echo [INFO] Stopping PulseRelay containers...
    docker-compose down
    docker-compose -f docker-compose.prod.yml down
    echo [SUCCESS] Containers stopped successfully!
) else if /i "%command%"=="logs" (
    echo [INFO] Showing PulseRelay logs...
    docker-compose logs -f pulserelay
) else if /i "%command%"=="status" (
    echo [INFO] PulseRelay container status:
    docker-compose ps
    echo.
    docker-compose -f docker-compose.prod.yml ps
) else if /i "%command%"=="cleanup" (
    echo [INFO] Cleaning up Docker resources...
    docker-compose down -v
    docker-compose -f docker-compose.prod.yml down -v
    docker system prune -f
    echo [SUCCESS] Cleanup completed!
) else if /i "%command%"=="help" (
    echo.
    echo PulseRelay Docker Management Script for Windows
    echo.
    echo Usage: %~nx0 [COMMAND]
    echo.
    echo Commands:
    echo   build     Build the Docker image
    echo   dev       Run in development mode
    echo   prod      Run in production mode
    echo   stop      Stop all containers
    echo   logs      Show application logs
    echo   status    Show container status
    echo   cleanup   Clean up Docker resources
    echo   help      Show this help message
    echo.
    echo Examples:
    echo   %~nx0 build     # Build the Docker image
    echo   %~nx0 dev       # Start development environment
    echo   %~nx0 prod      # Start production environment
    echo   %~nx0 logs      # Follow application logs
) else (
    echo [ERROR] Unknown command: %command%
    echo.
    echo Use "%~nx0 help" to see available commands
    exit /b 1
)

endlocal
