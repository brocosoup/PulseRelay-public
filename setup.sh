#!/bin/bash

# PulseRelay Setup Script for Ubuntu 24.04
# This script installs and configures PulseRelay RTMP streaming server
#
# Usage:
#   sudo ./setup.sh           # Fresh installation
#   sudo ./setup.sh --upgrade # Upgrade existing installation

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="/opt/pulserelay"
SERVICE_USER="pulserelay"
SERVICE_NAME="pulserelay"
NODE_VERSION="20"

# Domain configuration (optional - if not set, will use server IP)
DOMAIN="${PULSERELAY_DOMAIN:-}"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

show_help() {
    echo "PulseRelay Setup Script for Ubuntu 24.04"
    echo ""
    echo "Usage:"
    echo "  sudo ./setup.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  (no args)          Fresh installation of PulseRelay"
    echo "  --upgrade, -u      Upgrade existing PulseRelay installation"
    echo "  --fix-permissions  Fix file ownership and npm permission issues"
    echo "  --help, -h         Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  PULSERELAY_DOMAIN  Set the domain for streaming URLs (e.g., pulse.example.com)"
    echo "                     If not set, will use server's external IP address"
    echo ""
    echo "Examples:"
    echo "  sudo ./setup.sh                                    # Install PulseRelay"
    echo "  sudo PULSERELAY_DOMAIN=pulse.example.com ./setup.sh # Install with domain"
    echo "  sudo ./setup.sh --upgrade                          # Upgrade PulseRelay"
    echo "  sudo ./setup.sh --fix-permissions                  # Fix permission issues"
    echo "  sudo ./setup.sh --help                             # Show help"
    echo ""
    echo "Note: The domain configuration is used for Content Security Policy (CSP)"
    echo "      to allow the web player to connect to the streaming server."
    echo ""
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root"
        exit 1
    fi
}

check_git_repo() {
    if [ -d ".git" ]; then
        log_info "Git repository detected"
        return 0
    else
        log_warning "Not a git repository - skipping git operations"
        return 1
    fi
}

update_codebase() {
    if check_git_repo; then
        log_info "Updating codebase from git repository..."
        
        # Stash any local changes
        if ! git diff --quiet; then
            log_warning "Local changes detected, stashing them..."
            git stash push -m "Setup script auto-stash $(date)"
        fi
        
        # Fetch latest changes
        git fetch origin
        
        # Get current branch
        CURRENT_BRANCH=$(git branch --show-current)
        log_info "Current branch: $CURRENT_BRANCH"
        
        # Pull latest changes
        if git pull origin "$CURRENT_BRANCH"; then
            log_success "Codebase updated successfully"
        else
            log_error "Failed to update codebase"
            return 1
        fi
        
        # Check if there were stashed changes
        if git stash list | grep -q "Setup script auto-stash"; then
            log_warning "Local changes were stashed. You may need to manually apply them later."
            log_info "To apply stashed changes: git stash pop"
        fi
    else
        log_info "Skipping git update - not a git repository"
    fi
}

update_system() {
    log_info "Updating system packages..."
    apt-get update -y
    apt-get upgrade -y
    log_success "System packages updated"
}

install_dependencies() {
    log_info "Installing system dependencies..."
    
    # Install required packages
    apt-get install -y \
        curl \
        wget \
        git \
        build-essential \
        software-properties-common \
        apt-transport-https \
        ca-certificates \
        gnupg \
        lsb-release \
        sqlite3 \
        nginx \
        ufw \
        fail2ban \
        htop \
        supervisor
    
    log_success "System dependencies installed"
}

install_nodejs() {
    log_info "Installing Node.js ${NODE_VERSION}..."
    
    # Install Node.js repository
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    
    # Install Node.js
    apt-get install -y nodejs
    
    # Verify installation
    node_version=$(node --version)
    npm_version=$(npm --version)
    
    log_success "Node.js ${node_version} and npm ${npm_version} installed"
}

install_ffmpeg() {
    log_info "Installing FFmpeg..."
    
    # Add FFmpeg repository
    add-apt-repository ppa:savoury1/ffmpeg4 -y
    apt-get update -y
    
    # Install FFmpeg
    apt-get install -y ffmpeg
    
    # Verify installation
    ffmpeg_version=$(ffmpeg -version | head -n 1)
    log_success "FFmpeg installed: ${ffmpeg_version}"
}

create_user() {
    log_info "Creating service user..."
    
    # Create system user
    if ! id "$SERVICE_USER" &>/dev/null; then
        useradd --system --home-dir "$INSTALL_DIR" --shell /bin/bash "$SERVICE_USER"
        log_success "User $SERVICE_USER created"
    else
        log_warning "User $SERVICE_USER already exists"
    fi
}

setup_directories() {
    log_info "Setting up directories..."
    
    # Create directories
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR/logs"
    mkdir -p "$INSTALL_DIR/storage"
    mkdir -p "$INSTALL_DIR/temp"
    mkdir -p "/var/log/pulserelay"
    
    # Set permissions
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    chown -R "$SERVICE_USER:$SERVICE_USER" "/var/log/pulserelay"
    
    log_success "Directories created and configured"
}

install_pulserelay() {
    log_info "Installing PulseRelay application..."
    
    # Copy application files
    cp -r . "$INSTALL_DIR/"
    
    # Fix ownership after copying files
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    
    # Clean npm cache to avoid permission issues
    sudo -u "$SERVICE_USER" npm cache clean --force 2>/dev/null || true
    
    # Install npm dependencies with proper error handling
    cd "$INSTALL_DIR"
    log_info "Installing npm dependencies..."
    if ! sudo -u "$SERVICE_USER" npm install --production; then
        log_error "NPM install failed. Trying with cache cleanup..."
        sudo -u "$SERVICE_USER" npm cache verify
        sudo -u "$SERVICE_USER" npm install --production
    fi
    
    # Set final permissions
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    
    log_success "PulseRelay application installed"
}

upgrade_pulserelay() {
    log_info "Upgrading PulseRelay application..."
    
    # Stop the service first
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log_info "Stopping PulseRelay service..."
        systemctl stop "$SERVICE_NAME"
    fi
    
    # Backup current installation
    BACKUP_DIR="/opt/pulserelay-backup-$(date +%Y%m%d-%H%M%S)"
    log_info "Creating backup at $BACKUP_DIR..."
    cp -r "$INSTALL_DIR" "$BACKUP_DIR"
    
    # Update code
    update_codebase
    
    # Copy new application files (preserve config files)
    log_info "Updating application files..."
    cp -r --preserve=mode . "$INSTALL_DIR/"
    
    # Restore config files from backup if they exist
    if [ -f "$BACKUP_DIR/config.json" ]; then
        cp "$BACKUP_DIR/config.json" "$INSTALL_DIR/config.json"
    fi
    if [ -f "$BACKUP_DIR/secret.json" ]; then
        cp "$BACKUP_DIR/secret.json" "$INSTALL_DIR/secret.json"
    fi
    
    # Update configuration for CSP domains
    update_streaming_config
    
    # Fix ownership after copying files
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    
    # Update npm dependencies
    cd "$INSTALL_DIR"
    sudo -u "$SERVICE_USER" npm install --production
    
    # Set final permissions
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    
    # Start the service
    log_info "Restarting PulseRelay service..."
    systemctl start "$SERVICE_NAME"
    
    # Check if service started successfully
    sleep 3
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log_success "PulseRelay upgraded and restarted successfully"
        log_info "Backup saved at: $BACKUP_DIR"
    else
        log_error "Service failed to start after upgrade"
        log_info "Restoring from backup..."
        systemctl stop "$SERVICE_NAME"
        rm -rf "$INSTALL_DIR"
        mv "$BACKUP_DIR" "$INSTALL_DIR"
        systemctl start "$SERVICE_NAME"
        exit 1
    fi
}

update_streaming_config() {
    log_info "Updating streaming configuration for CSP domains..."
    
    # Check if config.json exists
    if [ ! -f "$INSTALL_DIR/config.json" ]; then
        log_warning "Config file not found, skipping streaming config update"
        return
    fi
    
    # Get the configured domain or server IP
    STREAMING_URL=""
    if [ -n "$DOMAIN" ]; then
        # Use domain if provided
        STREAMING_URL="https://${DOMAIN}:4000"
    else
        # Try to detect if there's already a customPlayerUrl configured
        CURRENT_CUSTOM_URL=$(node -p "
            try {
                const config = JSON.parse(require('fs').readFileSync('$INSTALL_DIR/config.json', 'utf8'));
                config.httpStreaming?.customPlayerUrl || '';
            } catch(e) { ''; }
        " 2>/dev/null || echo "")
        
        if [ -n "$CURRENT_CUSTOM_URL" ]; then
            log_info "Custom player URL already configured: $CURRENT_CUSTOM_URL"
            return
        fi
        
        # Get external IP
        EXTERNAL_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s ipinfo.io/ip 2>/dev/null || echo "")
        if [ -n "$EXTERNAL_IP" ]; then
            STREAMING_URL="http://${EXTERNAL_IP}:4000"
        fi
    fi
    
    # Update config.json with streaming URL if we have one
    if [ -n "$STREAMING_URL" ]; then
        log_info "Setting streaming URL for CSP: $STREAMING_URL"
        
        TEMP_CONFIG=$(mktemp)
        node -e "
            const fs = require('fs');
            try {
                const config = JSON.parse(fs.readFileSync('$INSTALL_DIR/config.json', 'utf8'));
                
                // Ensure httpStreaming object exists
                if (!config.httpStreaming) {
                    config.httpStreaming = {};
                }
                
                // Set port if not already set
                if (!config.httpStreaming.port) {
                    config.httpStreaming.port = 4000;
                }
                
                // Set custom player URL for CSP
                config.httpStreaming.customPlayerUrl = '$STREAMING_URL';
                
                fs.writeFileSync('$TEMP_CONFIG', JSON.stringify(config, null, 2));
                console.log('Configuration updated successfully');
            } catch(e) {
                console.error('Error updating config:', e.message);
                process.exit(1);
            }
        "
        
        if [ $? -eq 0 ]; then
            mv "$TEMP_CONFIG" "$INSTALL_DIR/config.json"
            chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/config.json"
            log_success "Streaming configuration updated with URL: $STREAMING_URL"
        else
            rm -f "$TEMP_CONFIG"
            log_error "Failed to update streaming configuration"
        fi
    else
        log_warning "Could not determine streaming URL. You may need to manually configure 'httpStreaming.customPlayerUrl' in config.json"
    fi
}

configure_nginx() {
    log_info "Configuring Nginx..."
    
    # Create Nginx configuration
    cat > /etc/nginx/sites-available/pulserelay << 'EOF'
server {
    listen 80;
    server_name _;
    
    # Allow larger file uploads (for pictures and videos)
    client_max_body_size 50M;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    # Proxy to Node.js application
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
    
    # Static files
    location /static {
        alias /opt/pulserelay/public;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }
    
    # Health check
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}
EOF
    
    # Enable site
    ln -sf /etc/nginx/sites-available/pulserelay /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    
    # Test configuration
    nginx -t
    
    log_success "Nginx configured"
}

configure_systemd() {
    log_info "Configuring systemd service..."
    
    # Create systemd service file
    cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=PulseRelay RTMP Streaming Server
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=pulserelay

# Environment variables
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=LOG_LEVEL=info

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$INSTALL_DIR /var/log/pulserelay

[Install]
WantedBy=multi-user.target
EOF
    
    # Reload systemd
    systemctl daemon-reload
    
    log_success "Systemd service configured"
}

configure_firewall() {
    log_info "Configuring firewall..."
    
    # Reset UFW
    ufw --force reset
    
    # Default policies
    ufw default deny incoming
    ufw default allow outgoing
    
    # Allow SSH
    ufw allow ssh
    
    # Allow HTTP and HTTPS
    ufw allow 80/tcp
    ufw allow 443/tcp
    
    # Allow RTMP
    ufw allow 1935/tcp
    
    # Enable UFW
    ufw --force enable
    
    log_success "Firewall configured"
}

configure_fail2ban() {
    log_info "Configuring Fail2Ban..."
    
    # Create Fail2Ban configuration for PulseRelay
    cat > /etc/fail2ban/jail.d/pulserelay.conf << 'EOF'
[pulserelay]
enabled = true
port = 80,443,1935
filter = pulserelay
logpath = /var/log/pulserelay/error.log
maxretry = 5
bantime = 3600
findtime = 600
EOF
    
    # Create filter
    cat > /etc/fail2ban/filter.d/pulserelay.conf << 'EOF'
[Definition]
failregex = ^.*Authentication failed for.*<HOST>.*$
            ^.*Invalid stream key.*<HOST>.*$
            ^.*Rate limit exceeded.*<HOST>.*$
ignoreregex =
EOF
    
    # Restart Fail2Ban
    systemctl restart fail2ban
    
    log_success "Fail2Ban configured"
}

create_config() {
    log_info "Creating configuration files..."
    
    # Create main config from template
    if [ -f "$INSTALL_DIR/config.json.template" ]; then
        cp "$INSTALL_DIR/config.json.template" "$INSTALL_DIR/config.json"
        chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/config.json"
    fi
    
    # Create secret config from template
    if [ -f "$INSTALL_DIR/secret.json.template" ]; then
        cp "$INSTALL_DIR/secret.json.template" "$INSTALL_DIR/secret.json"
        
        # Set ownership first
        chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/secret.json"
        
        # Generate secure values
        JWT_SECRET=$(openssl rand -base64 32)
        ENCRYPTION_KEY=$(openssl rand -base64 32)
        SESSION_SECRET=$(openssl rand -base64 32)
        DB_ENCRYPTION_KEY=$(openssl rand -base64 32)
        
        # Get server's external IP or use domain if provided
        if [ -n "$DOMAIN" ]; then
            REDIRECT_URI="https://${DOMAIN}/auth/twitch/callback"
        else
            # Try to get external IP
            EXTERNAL_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s ipinfo.io/ip 2>/dev/null || echo "your-server-ip")
            REDIRECT_URI="http://${EXTERNAL_IP}/auth/twitch/callback"
        fi
        
        # Update secret.json with generated values using a temporary approach
        TEMP_CONFIG=$(mktemp)
        node -e "
            const fs = require('fs');
            const config = JSON.parse(fs.readFileSync('$INSTALL_DIR/secret.json', 'utf8'));
            config.jwtSecret = '$JWT_SECRET';
            config.encryptionKey = '$ENCRYPTION_KEY';
            config.session.secret = '$SESSION_SECRET';
            config.database.encryptionKey = '$DB_ENCRYPTION_KEY';
            config.twitch.redirectUri = '$REDIRECT_URI';
            fs.writeFileSync('$TEMP_CONFIG', JSON.stringify(config, null, 2));
        "
        
        # Move the temporary file to the final location
        mv "$TEMP_CONFIG" "$INSTALL_DIR/secret.json"
        chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/secret.json"
        chmod 600 "$INSTALL_DIR/secret.json"
        
        log_info "Twitch OAuth redirect URI set to: $REDIRECT_URI"
        log_warning "Make sure to configure this redirect URI in your Twitch application settings!"
    fi
    
    # Update streaming configuration for CSP domains
    update_streaming_config
    
    log_success "Configuration files created"
}

setup_logrotate() {
    log_info "Setting up log rotation..."
    
    # Create logrotate configuration
    cat > /etc/logrotate.d/pulserelay << 'EOF'
/var/log/pulserelay/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0644 pulserelay pulserelay
    postrotate
        systemctl reload pulserelay
    endscript
}
EOF
    
    log_success "Log rotation configured"
}

verify_installation() {
    log_info "Verifying installation..."
    
    # Check if main server file exists
    if [ ! -f "$INSTALL_DIR/src/server.js" ]; then
        log_error "Main server file not found at $INSTALL_DIR/src/server.js"
        exit 1
    fi
    
    # Check if config files exist
    if [ ! -f "$INSTALL_DIR/config.json" ]; then
        log_error "Config file not found at $INSTALL_DIR/config.json"
        exit 1
    fi
    
    if [ ! -f "$INSTALL_DIR/secret.json" ]; then
        log_error "Secret file not found at $INSTALL_DIR/secret.json"
        exit 1
    fi
    
    # Check if node_modules exists
    if [ ! -d "$INSTALL_DIR/node_modules" ]; then
        log_error "Node modules not found at $INSTALL_DIR/node_modules"
        exit 1
    fi
    
    # Check file permissions
    if [ ! -r "$INSTALL_DIR/src/server.js" ]; then
        log_error "Server file is not readable"
        exit 1
    fi
    
    # Test Node.js syntax
    cd "$INSTALL_DIR"
    if ! sudo -u "$SERVICE_USER" node -c src/server.js; then
        log_error "Server file has syntax errors"
        exit 1
    fi
    
    log_success "Installation verification completed"
}

start_services() {
    log_info "Starting services..."
    
    # Start and enable PulseRelay
    systemctl enable "$SERVICE_NAME"
    
    # Try to start the service and capture any immediate errors
    log_info "Starting PulseRelay service..."
    if ! systemctl start "$SERVICE_NAME"; then
        log_error "Failed to start PulseRelay service"
        log_info "Checking service logs..."
        journalctl -u "$SERVICE_NAME" -n 20 --no-pager
        exit 1
    fi
    
    # Start and enable Nginx
    systemctl enable nginx
    systemctl start nginx
    
    # Check service status with more detailed error reporting
    log_info "Checking service status..."
    sleep 5
    
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log_success "PulseRelay service started successfully"
    else
        log_error "PulseRelay service failed to start"
        log_info "Service status:"
        systemctl status "$SERVICE_NAME" --no-pager
        log_info "Recent logs:"
        journalctl -u "$SERVICE_NAME" -n 30 --no-pager
        log_info "Trying to run manually for debugging:"
        cd "$INSTALL_DIR"
        sudo -u "$SERVICE_USER" node src/server.js &
        sleep 3
        if ps aux | grep -v grep | grep "node src/server.js" > /dev/null; then
            log_info "Manual start successful - killing process"
            pkill -f "node src/server.js"
        else
            log_error "Manual start also failed"
        fi
        exit 1
    fi
    
    if systemctl is-active --quiet nginx; then
        log_success "Nginx service started successfully"
    else
        log_error "Nginx service failed to start"
        systemctl status nginx --no-pager
        exit 1
    fi
}

print_info() {
    echo ""
    echo "================================================================="
    echo -e "${GREEN}PulseRelay Installation Complete!${NC}"
    echo "================================================================="
    echo ""
    echo "Service Information:"
    echo "  - Service Name: $SERVICE_NAME"
    echo "  - Install Directory: $INSTALL_DIR"
    echo "  - Service User: $SERVICE_USER"
    echo "  - Logs: /var/log/pulserelay/"
    echo ""
    echo "Network Configuration:"
    echo "  - HTTP Port: 80"
    echo "  - RTMP Port: 1935"
    echo "  - Application Port: 3000 (internal)"
    echo ""
    echo "Service Management:"
    echo "  - Start: systemctl start $SERVICE_NAME"
    echo "  - Stop: systemctl stop $SERVICE_NAME"
    echo "  - Restart: systemctl restart $SERVICE_NAME"
    echo "  - Status: systemctl status $SERVICE_NAME"
    echo "  - Logs: journalctl -u $SERVICE_NAME -f"
    echo ""
    echo "Upgrade:"
    echo "  - To upgrade PulseRelay: sudo ./setup.sh --upgrade"
    echo "  - This will automatically pull latest code and restart services"
    echo ""
    echo "Configuration:"
    echo "  - Main Config: $INSTALL_DIR/config.json"
    echo "  - Secrets: $INSTALL_DIR/secret.json"
    echo "  - Streaming Config: httpStreaming.customPlayerUrl in config.json"
    echo ""
    echo "Next Steps:"
    echo "  1. Configure your domain/IP in Nginx"
    echo "  2. Set up SSL certificate (Let's Encrypt recommended)"
    echo "  3. Configure Twitch OAuth credentials in $INSTALL_DIR/secret.json"
    echo "     - Set your Twitch Client ID and Client Secret"
    echo "     - The redirect URI is automatically set to: http://your-server-ip/auth/twitch/callback"
    echo "  4. Access the web interface at http://your-server-ip"
    echo "  5. If you change your domain, update httpStreaming.customPlayerUrl in config.json"
    echo "     for proper Content Security Policy configuration"
    echo ""
    echo "Environment Variables (optional):"
    echo "  - PULSERELAY_DOMAIN: Set domain for HTTPS redirect URI and streaming CSP"
    echo "    Example: export PULSERELAY_DOMAIN=streaming.example.com"
    echo ""
    echo "================================================================="
}

# Manual fix for permission issues
fix_permissions() {
    log_info "Fixing file permissions..."
    
    # Remove any existing node_modules and package-lock.json
    rm -rf "$INSTALL_DIR/node_modules"
    rm -f "$INSTALL_DIR/package-lock.json"
    
    # Fix all file ownership
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    
    # Clean npm cache
    sudo -u "$SERVICE_USER" npm cache clean --force 2>/dev/null || true
    
    # Reinstall dependencies
    cd "$INSTALL_DIR"
    sudo -u "$SERVICE_USER" npm install --production
    
    log_success "Permissions fixed!"
}

# Check if manual fix is needed
check_manual_fix() {
    if [ "$1" = "--fix-permissions" ]; then
        log_info "Running manual permission fix..."
        check_root
        fix_permissions
        exit 0
    fi
}

# Main installation logic
main() {
    # Check for help
    if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
        show_help
        exit 0
    fi
    
    # Check for special flags
    check_manual_fix "$1"
    
    # Check for upgrade mode
    if [ "$1" = "--upgrade" ] || [ "$1" = "-u" ]; then
        log_info "Starting PulseRelay upgrade for Ubuntu 24.04"
        check_root
        
        # Check if installation exists
        if [ ! -d "$INSTALL_DIR" ] || [ ! -f "/etc/systemd/system/${SERVICE_NAME}.service" ]; then
            log_error "PulseRelay is not installed. Please run the installation first."
            exit 1
        fi
        
        upgrade_pulserelay
        log_success "Upgrade completed successfully!"
        return
    fi
    
    log_info "Starting PulseRelay installation for Ubuntu 24.04"
    
    check_root
    update_codebase
    update_system
    install_dependencies
    install_nodejs
    install_ffmpeg
    create_user
    setup_directories
    install_pulserelay
    configure_nginx
    configure_systemd
    configure_firewall
    configure_fail2ban
    create_config
    setup_logrotate
    verify_installation
    start_services
    
    print_info
    
    log_success "Installation completed successfully!"
}

# Run main function
main "$@"
