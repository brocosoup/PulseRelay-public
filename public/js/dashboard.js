// PulseRelay Dashboard - CSP-Compliant Event Handlers and Dashboard Management

// Service Worker registration for background tracking
let serviceWorkerRegistration = null;

// Register service worker
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            serviceWorkerRegistration = await navigator.serviceWorker.register('/service-worker.js', {
                scope: '/'
            });
            
            await navigator.serviceWorker.ready;
            
            const authToken = localStorage.getItem('authToken');
            if (authToken && serviceWorkerRegistration.active) {
                serviceWorkerRegistration.active.postMessage({
                    type: 'STORE_AUTH_TOKEN',
                    token: authToken
                });
            }
            
            return serviceWorkerRegistration;
        } catch (error) {
            console.error('Service worker registration failed:', error);
            return null;
        }
    }
    return null;
}

// Request notification permission
async function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        try {
            const permission = await Notification.requestPermission();
            return permission === 'granted';
        } catch (error) {
            return false;
        }
    }
    return Notification.permission === 'granted';
}

// Dashboard object to manage all functionality (prevent redeclaration)
window.dashboard = window.dashboard || {
    init: async function() {
        // Register service worker for background tracking
        await registerServiceWorker();
        
        this.setupEventListeners();
        this.setupUserSettingsListeners();
        this.loadStats();
        this.loadStreamStatus();
        this.loadLiveStreams();
        this.location.init(); // Initialize location functionality
        
        // Initialize Bootstrap tooltips
        this.initializeTooltips();
        
        // Load and apply overlay token URLs on page load
        this.loadOverlayTokenOnInit();
        
        // Initialize refresh countdown
        this.refreshCountdown = 10;
        this.updateCountdownDisplay();
        
        // Set up countdown timer (updates every second)
        this.countdownInterval = setInterval(() => {
            this.refreshCountdown--;
            this.updateCountdownDisplay();
            
            // Update relative timestamps every 30 seconds
            if (Date.now() % 30000 < 1000) {
                this.updateRelativeTimestamps();
            }
            
            if (this.refreshCountdown <= 0) {
                this.refreshCountdown = 10; // Reset countdown to 10 seconds
                // Update data even if page is not visible to maintain live tracking
                this.refreshData();
            }
        }, 1000);
        
        // Background keepalive - ping every 30 seconds to maintain connection
        this.keepaliveInterval = setInterval(() => {
            // Silent ping to keep session alive (even when in background)
            fetch('/api/stats/ping', { 
                method: 'GET', 
                credentials: 'same-origin',
                keepalive: true // Allow request to complete even if page is closed
            }).catch(() => {
                // Ignore errors - this is just a keepalive
            });
        }, 30000);
        
        // Add visibility change handler to force immediate refresh when page becomes visible
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                // Immediately update when page becomes visible and reset countdown
                this.refreshData();
                this.refreshCountdown = 10; // Reset to 10 seconds
                this.updateCountdownDisplay();
                
                // Ensure location tracking is still active if enabled
                if (this.location && this.location.settings.enabled) {
                    const deviceEnabled = this.location.isEnabledOnThisDevice();
                    if (deviceEnabled && !this.location.watchId) {
                        // Restart tracking if it was stopped
                        this.location.startLocationTracking();
                    }
                }
            }
            // Note: Updates continue in background for live tracking
        });
    },
    
    setupEventListeners: function() {
        // Wait for global functions to be available
        const waitForGlobalFunctions = () => {
            if (typeof window.generateNewKey === 'function' && 
                typeof window.showDestinations === 'function' && 
                typeof window.copyToClipboard === 'function') {
                this.attachEventListeners();
            } else {
                // Log what's missing for debugging
                const missing = [];
                if (typeof window.generateNewKey !== 'function') missing.push('generateNewKey');
                if (typeof window.showDestinations !== 'function') missing.push('showDestinations');
                if (typeof window.copyToClipboard !== 'function') missing.push('copyToClipboard');
                
                setTimeout(waitForGlobalFunctions, 50);
            }
        };
        
        waitForGlobalFunctions();
    },
    
    attachEventListeners: function() {
        // Generate new key button (updated for multiple keys)
        const generateKeyBtn = document.getElementById('generate-new-key-btn');
        if (generateKeyBtn) {
            generateKeyBtn.addEventListener('click', function() {
                if (confirm('This will create a new stream key. Continue?')) {
                    window.dashboard.showAddStreamKeyModal();
                }
            });
        }

        // Add stream key button
        const addKeyBtn = document.getElementById('add-stream-key-btn');
        if (addKeyBtn) {
            addKeyBtn.addEventListener('click', function() {
                window.dashboard.showAddStreamKeyModal();
            });
        }

        // Save stream key button
        const saveKeyBtn = document.getElementById('saveStreamKey');
        if (saveKeyBtn) {
            saveKeyBtn.addEventListener('click', function() {
                // The actual function to call will be set dynamically by the modal functions
                // This prevents duplicate event handlers
                const action = this.dataset.action;
                const keyId = this.dataset.keyId;
                
                if (action === 'create') {
                    window.dashboard.createStreamKey();
                } else if (action === 'update' && keyId) {
                    window.dashboard.updateStreamKey(keyId);
                }
            });
        }

        // Toggle key visibility buttons
        document.addEventListener('click', function(e) {
            if (e.target.closest('.toggle-key-visibility')) {
                const btn = e.target.closest('.toggle-key-visibility');
                const keyId = btn.dataset.keyId;
                const keyElement = document.getElementById(`stream-key-${keyId}`);
                const icon = btn.querySelector('i');
                
                if (keyElement) {
                    if (keyElement.type === 'password') {
                        keyElement.type = 'text';
                        icon.className = 'fas fa-eye-slash';
                        btn.title = 'Hide stream key';
                    } else {
                        keyElement.type = 'password';
                        icon.className = 'fas fa-eye';
                        btn.title = 'Show stream key';
                    }
                }
            }
        });

        // Stream key management buttons
        document.addEventListener('click', function(e) {
            if (e.target.closest('.watch-stream-btn')) {
                e.preventDefault();
                const streamKey = e.target.closest('.watch-stream-btn').dataset.streamKey;
                if (window.videoPlayer && typeof window.videoPlayer.playStream === 'function') {
                    window.videoPlayer.playStream(streamKey);
                }
            } else if (e.target.closest('.edit-key-btn')) {
                const keyId = e.target.closest('.edit-key-btn').dataset.keyId;
                window.dashboard.editStreamKey(keyId);
            } else if (e.target.closest('.activate-key-btn')) {
                const keyId = e.target.closest('.activate-key-btn').dataset.keyId;
                window.dashboard.toggleStreamKey(keyId, true);
            } else if (e.target.closest('.deactivate-key-btn')) {
                const keyId = e.target.closest('.deactivate-key-btn').dataset.keyId;
                window.dashboard.toggleStreamKey(keyId, false);
            } else if (e.target.closest('.delete-key-btn')) {
                const keyId = e.target.closest('.delete-key-btn').dataset.keyId;
                window.dashboard.deleteStreamKey(keyId);
            }
        });

        // Legacy toggle key visibility button
        const toggleKeyBtn = document.getElementById('toggle-key-visibility');
        if (toggleKeyBtn) {
            toggleKeyBtn.addEventListener('click', function() {
                const keyElement = document.getElementById('stream-key');
                const icon = this.querySelector('i');
                
                if (keyElement && keyElement.type === 'password') {
                    // Show key
                    keyElement.type = 'text';
                    icon.className = 'fas fa-eye-slash';
                    this.title = 'Hide stream key';
                } else if (keyElement) {
                    // Hide key
                    keyElement.type = 'password';
                    icon.className = 'fas fa-eye';
                    this.title = 'Show stream key';
                }
            });
        }

        // Copy buttons
        const copyButtons = document.querySelectorAll('.copy-btn');
        copyButtons.forEach(btn => {
            btn.addEventListener('click', function() {
                const targetId = this.dataset.target;
                const copyFullKey = this.dataset.copyFullKey === 'true';
                
                if (targetId) {
                    if (copyFullKey) {
                        // For stream keys, copy the full key from data attribute
                        const targetElement = document.getElementById(targetId);
                        if (targetElement && targetElement.dataset.fullKey) {
                            window.copyTextToClipboard(targetElement.dataset.fullKey);
                        } else {
                            window.copyToClipboard(targetId);
                        }
                    } else {
                        // Regular copy behavior for other elements
                        window.copyToClipboard(targetId);
                    }
                }
            });
        });

        // Manage destinations button
        const manageDestBtn = document.getElementById('manage-destinations-btn');
        if (manageDestBtn) {
            manageDestBtn.addEventListener('click', function() {
                if (typeof window.showDestinations === 'function') {
                    window.showDestinations();
                }
            });
        }
        
        // Statistics button
        const statsBtn = document.getElementById('statistics-btn');
        if (statsBtn) {
            statsBtn.addEventListener('click', function() {
                if (typeof window.showStats === 'function') {
                    window.showStats();
                }
            });
        }

        // Location settings button
        const locationSettingsBtn = document.getElementById('location-settings-btn');
        if (locationSettingsBtn) {
            locationSettingsBtn.addEventListener('click', function() {
                dashboard.showLocationSettings();
            });
        }
        
        // OBS settings button
        const obsSettingsBtn = document.getElementById('obs-settings-btn');
        if (obsSettingsBtn) {
            obsSettingsBtn.addEventListener('click', function() {
                dashboard.showObsSettings();
            });
        }
        
        // API Token button
        const apiTokenBtn = document.getElementById('api-token-btn');
        if (apiTokenBtn) {
            apiTokenBtn.addEventListener('click', function() {
                dashboard.showApiTokenModal();
            });
        }
        
        // Clear activity button
        const clearActivityBtn = document.getElementById('clear-activity-btn');
        if (clearActivityBtn) {
            clearActivityBtn.addEventListener('click', function() {
                dashboard.clearActivity();
            });
        }
        
        // Refresh live streams button
        const refreshLiveStreamsBtn = document.getElementById('refresh-live-streams-btn');
        if (refreshLiveStreamsBtn) {
            refreshLiveStreamsBtn.addEventListener('click', function() {
                dashboard.loadLiveStreams();
            });
        }
        
        // Manual refresh button
        const manualRefreshBtn = document.getElementById('manual-refresh-btn');
        if (manualRefreshBtn) {
            manualRefreshBtn.addEventListener('click', function() {
                dashboard.manualRefresh();
            });
        }
        
        // Load more activity button
        const loadMoreBtn = document.getElementById('load-more-activity-btn');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', function() {
                dashboard.loadMoreActivity();
            });
        }
    },
    
    loadStats: function() {
        fetch('/api/stats/overview')
            .then(response => {
                if (!response.ok) {
                    if (response.status === 401) {
                        window.location.href = '/auth/twitch';
                        return;
                    }
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data.overview) {
                    const stats = data.overview;
                    document.getElementById('active-streams').textContent = stats.activeStreams || 0;
                    document.getElementById('total-viewers').textContent = stats.totalViewers || 0;
                    
                    this.loadDestinationsCount();
                    
                    const uptime = this.formatUptime(stats.totalStreamTime || 0);
                    document.getElementById('uptime').textContent = uptime;
                }
            })
            .catch(error => {
                // Silent error handling
            });
    },

    loadDestinationsCount: function() {
        fetch('/api/rtmp/destinations')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                const count = data.destinations ? data.destinations.length : 0;
                document.getElementById('destinations').textContent = count;
            })
            .catch(error => {
                document.getElementById('destinations').textContent = '0';
            });
    },

    loadLiveStreams: function() {
        fetch('/api/stream/live')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data.success && data.streams) {
                    this.renderLiveStreams(data.streams);
                } else {
                    this.showNoLiveStreams();
                }
            })
            .catch(error => {
                this.showNoLiveStreams();
            });
    },

    renderLiveStreams: function(streams) {
        const streamsContainer = document.getElementById('live-streams-list');
        if (!streamsContainer) return;

        if (streams.length === 0) {
            this.showNoLiveStreams();
            return;
        }

        let html = '';
        streams.forEach(stream => {
            const duration = this.formatUptime(stream.duration);
            html += `
                <div class="stream-item d-flex justify-content-between align-items-center py-2 px-3 mb-2 rounded border border-opacity-25 shadow-sm hover-lift">
                    <div class="d-flex align-items-center">
                        <img src="${stream.profileImage || '/img/default-avatar.png'}" 
                             alt="${stream.displayName}" 
                             class="rounded-circle me-3" 
                             style="width: 32px; height: 32px;">
                        <div>
                            <div class="fw-medium">${stream.displayName}</div>
                            <small class="text-muted">Live for ${duration}</small>
                        </div>
                    </div>
                    <div class="d-flex align-items-center gap-2">
                        <span class="badge bg-danger">
                            <i class="fas fa-circle me-1"></i>LIVE
                        </span>
                        <button class="btn btn-sm btn-outline-primary watch-stream-btn" 
                                data-stream-key="${stream.streamKey}"
                                title="Watch Stream">
                            <i class="fas fa-play"></i>
                        </button>
                    </div>
                </div>
            `;
        });

        streamsContainer.innerHTML = html;
    },

    showNoLiveStreams: function() {
        const streamsContainer = document.getElementById('live-streams-list');
        if (streamsContainer) {
            streamsContainer.innerHTML = `
                <div class="text-center text-muted py-3">
                    <i class="fas fa-broadcast-tower mb-2 fs-4"></i>
                    <div>No Live Streams</div>
                </div>
            `;
        }
    },

    formatUptime: function(seconds) {
        if (!seconds || seconds === 0) return '0m';
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else {
            return `${minutes}m`;
        }
    },
    
    loadStreamStatus: function() {
        // Load both stream status and connection stats in parallel
        Promise.all([
            fetch('/api/stream/status').then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            }),
            fetch('/api/stats/connections').then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
        ])
            .then(([streamData, statsData]) => {
                this.updateStreamKeyStatus(streamData.isLive);
                
                // Use the active RTMP session instead of database session for stream details
                if (streamData.isLive && streamData.session) {
                    this.showStreamDetails(streamData.session);
                } else {
                    this.hideStreamDetails();
                }
                
                // Update bitrate indicators with stats data
                if (statsData.success) {
                    this.updateBitrateOverview(statsData);
                    // Don't call updateConnectionStatus as it conflicts with showStreamDetails
                }
            })
            .catch(error => {
                this.updateStreamKeyStatus(false);
                this.hideStreamDetails();
            });
    },

    showStreamDetails: function(session) {
        const statusElement = document.getElementById('connection-status');
        
        if (statusElement && session) {
            // Calculate duration from start time
            const startTime = session.startTime || session.connectTime;
            const duration = startTime ? Math.floor((Date.now() - new Date(startTime).getTime()) / 1000) : 0;
            
            const htmlContent = `
                <div class="row g-3">
                    <div class="col-md-3">
                        <small class="text-muted">Session ID</small>
                        <div class="fw-bold">${session.id || 'Unknown'}</div>
                    </div>
                    <div class="col-md-3">
                        <small class="text-muted">IP Address</small>
                        <div class="fw-bold">${session.ip || 'Unknown'}</div>
                    </div>
                    <div class="col-md-3">
                        <small class="text-muted">Type</small>
                        <div class="fw-bold">${session.isPublisher ? 'Publisher' : 'Viewer'}</div>
                    </div>
                    <div class="col-md-3">
                        <small class="text-muted">Duration</small>
                        <div class="fw-bold">${this.formatUptime(duration)}</div>
                    </div>
                </div>
            `;
            
            statusElement.innerHTML = htmlContent;
            
            // Also show the connection card
            const connectionCard = document.getElementById('connection-card');
            if (connectionCard) {
                connectionCard.style.display = 'block';
            }
        }
    },

    hideStreamDetails: function() {
        const statusElement = document.getElementById('connection-status');
        if (statusElement) {
            statusElement.innerHTML = '<div class="text-center text-muted"><i class="fas fa-spinner fa-spin me-2"></i>Establishing stream...</div>';
        }
        
        // Hide the connection card
        const connectionCard = document.getElementById('connection-card');
        if (connectionCard) {
            connectionCard.style.display = 'none';
        }
    },

    updateElementText: function(elementId, text) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = text;
        }
    },

    updateElementTextWithAnimation: function(elementId, text) {
        const element = document.getElementById(elementId);
        
        if (element && element.textContent !== text) {
            // Add updating animation class
            element.classList.add('updating');
            
            // Update the text
            element.textContent = text;
            
            // Remove animation class after a short delay
            setTimeout(() => {
                element.classList.remove('updating');
            }, 300);
        }
    },

    updateProgressBar: function(elementId, value, max) {
        const element = document.getElementById(elementId);
        if (element) {
            const percentage = Math.round((value / max) * 100);
            element.style.width = percentage + '%';
            element.setAttribute('aria-valuenow', value);
            element.textContent = percentage + '%';
        }
    },
    
    updateStreamKeyStatus: function(isLive) {
        const statusBadge = document.getElementById('publisher-status-badge');
        if (statusBadge) {
            if (isLive) {
                statusBadge.className = 'badge bg-danger';
                statusBadge.innerHTML = '<i class="fas fa-circle me-1"></i>LIVE';
            } else {
                statusBadge.className = 'badge bg-secondary';
                statusBadge.innerHTML = '<i class="fas fa-circle me-1"></i>OFFLINE';
            }
        }
    },

    loadRecentActivity: function(offset = 0, append = false) {
        // Store pagination state
        if (!this.activityState) {
            this.activityState = { offset: 0, hasMore: true };
        }
        
        if (offset === 0) {
            this.activityState.offset = 0;
        }
        
        fetch(`/api/stats/activity/detailed?offset=${offset}&limit=10`)
            .then(response => {
                if (!response.ok) {
                    if (response.status === 401) {
                        window.location.href = '/auth/twitch';
                        return;
                    }
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data.success && data.events && data.events.length > 0) {
                    this.renderActivity(data.events, append);
                    this.activityState.hasMore = data.hasMore || data.events.length === 10;
                    this.activityState.offset = offset + data.events.length;
                    this.updateLoadMoreButton();
                } else if (!append) {
                    this.showNoActivity();
                }
            })
            .catch(error => {
                if (!append) {
                    this.showNoActivity();
                }
            });
    },

    renderActivity: function(events, append = false) {
        const activityList = document.getElementById('recent-activity');
        if (!activityList) return;

        if (!append) {
            activityList.innerHTML = '';
        }

        events.forEach(event => {
            const eventElement = document.createElement('div');
            eventElement.className = 'activity-item d-flex justify-content-between align-items-center py-2 px-3 mb-2 rounded border border-opacity-25 shadow-sm hover-lift';

            let iconClass, eventText, iconColor;

            switch(event.event_type) {
                case 'stream_started':
                    iconClass = 'fas fa-play-circle';
                    iconColor = 'text-success';
                    eventText = 'Stream started';
                    break;
                case 'stream_ended':
                    iconClass = 'fas fa-stop-circle';
                    iconColor = 'text-danger';
                    eventText = 'Stream ended';
                    break;
                case 'viewer_joined':
                    iconClass = 'fas fa-user-plus';
                    iconColor = 'text-primary';
                    eventText = 'Viewer joined';
                    break;
                case 'viewer_left':
                    iconClass = 'fas fa-user-minus';
                    iconColor = 'text-warning';
                    eventText = 'Viewer left';
                    break;
                case 'publish':
                    iconClass = 'fas fa-broadcast-tower';
                    iconColor = 'text-info';
                    eventText = 'Publishing started';
                    break;
                case 'disconnect':
                    iconClass = 'fas fa-wifi-slash';
                    iconColor = 'text-muted';
                    eventText = 'Disconnected';
                    break;
                default:
                    iconClass = 'fas fa-circle-dot';
                    iconColor = 'text-muted';
                    eventText = event.event_type ? event.event_type.replace('_', ' ') : 'Unknown event';
            }

            // Enhanced UTC timestamp handling
            let timeAgoText = 'Unknown time';
            let fullDateTime = '';
            if (event.timestamp) {
                // Ensure proper UTC timestamp parsing
                let timestamp = event.timestamp;
                
                // If timestamp doesn't end with 'Z', it's likely from SQLite format
                // Convert SQLite datetime format to ISO string if needed
                if (!timestamp.includes('T') && !timestamp.endsWith('Z')) {
                    // SQLite format: "2025-07-19 06:33:12" -> ISO format
                    timestamp = timestamp.replace(' ', 'T') + 'Z';
                } else if (!timestamp.endsWith('Z') && !timestamp.includes('+')) {
                    // Ensure UTC timezone marker
                    timestamp += 'Z';
                }
                
                const date = new Date(timestamp);
                if (!isNaN(date.getTime())) {
                    timeAgoText = this.timeAgo(date);
                    fullDateTime = this.formatLocalDateTime(date);
                }
            }

            eventElement.innerHTML = `
                <div class="d-flex align-items-center">
                    <i class="${iconClass} ${iconColor} me-2"></i>
                    <span class="fw-medium">${eventText}</span>
                </div>
                <small class="text-muted timestamp-relative" 
                       data-timestamp="${event.timestamp}" 
                       title="${fullDateTime}" 
                       data-bs-toggle="tooltip">${timeAgoText}</small>
            `;

            activityList.appendChild(eventElement);
        });
        
        // Initialize Bootstrap tooltips for the new activity items
        this.initializeTooltips();
    },
    
    initializeTooltips: function() {
        // Initialize Bootstrap tooltips if Bootstrap is available
        if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
            const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
            tooltipTriggerList.forEach(tooltipTriggerEl => {
                // Dispose existing tooltip if it exists to avoid duplicates
                const existingTooltip = bootstrap.Tooltip.getInstance(tooltipTriggerEl);
                if (existingTooltip) {
                    existingTooltip.dispose();
                }
                // Create new tooltip
                new bootstrap.Tooltip(tooltipTriggerEl);
            });
        }
    },

    updateRelativeTimestamps: function() {
        // Update all relative timestamps in the activity feed
        const timestampElements = document.querySelectorAll('.timestamp-relative[data-timestamp]');
        timestampElements.forEach(element => {
            const timestamp = element.getAttribute('data-timestamp');
            if (timestamp) {
                let date;
                
                // Enhanced timestamp parsing for UTC format
                if (timestamp.includes('T') && timestamp.endsWith('Z')) {
                    // ISO 8601 UTC format from new server responses
                    date = new Date(timestamp);
                } else if (timestamp.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
                    // SQLite datetime format from legacy responses - treat as UTC
                    date = new Date(timestamp + 'Z');
                } else {
                    // Fallback to standard parsing
                    date = new Date(timestamp);
                }
                
                if (!isNaN(date.getTime())) {
                    const newRelativeTime = this.timeAgo(date);
                    const newFullDateTime = this.formatLocalDateTime(date);
                    
                    // Update the text content
                    element.textContent = newRelativeTime;
                    
                    // Update the tooltip
                    element.setAttribute('title', newFullDateTime);
                    
                    // Update Bootstrap tooltip if it exists
                    if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
                        const tooltip = bootstrap.Tooltip.getInstance(element);
                        if (tooltip) {
                            tooltip.setContent({ '.tooltip-inner': newFullDateTime });
                        }
                    }
                }
            }
        });
    },

    showNoActivity: function() {
        const activityList = document.getElementById('recent-activity');
        if (activityList) {
            activityList.innerHTML = `
                <div class="text-center py-3 text-muted">
                    <i class="fas fa-clock-rotate-left mb-2 fs-4"></i>
                    <div>No recent activity</div>
                </div>
            `;
        }
        
        // Hide load more button
        const loadMoreBtn = document.getElementById('load-more-activity-btn');
        if (loadMoreBtn) {
            loadMoreBtn.style.display = 'none';
        }
    },

    refreshActivity: function() {
        this.loadRecentActivity(0, false);
    },

    clearActivity: function() {
        if (!confirm('Are you sure you want to clear all activity logs? This action cannot be undone.')) {
            return;
        }
        
        fetch('/api/stats/activity', {
            method: 'DELETE'
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                window.PulseToast.success('Activity cleared successfully');
                this.showNoActivity();
            } else {
                window.PulseToast.error('Failed to clear activity');
            }
        })
        .catch(error => {

            window.PulseToast.error('Error clearing activity');
        });
    },

    escapeHtml: function(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    timeAgo: function(date) {
        // Ensure we're working with a proper Date object
        if (!(date instanceof Date)) {
            date = new Date(date);
        }
        
        // If invalid date, fallback to server time display
        if (isNaN(date.getTime())) {
            return 'Invalid date';
        }
        
        const now = new Date();
        const diff = Math.floor((now - date) / 1000); // difference in seconds
        
        // Handle future dates (clock skew)
        if (diff < 0) {
            return 'Just now';
        }
        
        // Less than 1 minute
        if (diff < 60) {
            return diff < 10 ? 'Just now' : `${diff}s ago`;
        }
        
        // Less than 1 hour (show minutes)
        if (diff < 3600) {
            const minutes = Math.floor(diff / 60);
            return `${minutes}m ago`;
        }
        
        // Less than 24 hours (show hours and minutes)
        if (diff < 86400) {
            const hours = Math.floor(diff / 3600);
            const minutes = Math.floor((diff % 3600) / 60);
            if (minutes === 0) {
                return `${hours}h ago`;
            }
            return `${hours}h ${minutes}m ago`;
        }
        
        // Less than 7 days (show days and hours)
        if (diff < 604800) {
            const days = Math.floor(diff / 86400);
            const hours = Math.floor((diff % 86400) / 3600);
            if (hours === 0) {
                return `${days}d ago`;
            }
            return `${days}d ${hours}h ago`;
        }
        
        // More than 7 days - show localized date and time
        return this.formatLocalDateTime(date);
    },
    
    formatLocalDateTime: function(date) {
        // Use user's locale and timezone for formatting
        const options = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false // Use 24-hour format for consistency
        };
        
        try {
            return date.toLocaleString(undefined, options);
        } catch (error) {
            // Fallback if toLocaleString fails
            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        }
    },
    
    updateConnectionStatus: function(data) {
        const statusElement = document.getElementById('connection-status');
        if (!statusElement) return;
        
        const { summary, connections } = data;
        
        // Build HTML for connections
        let connectionsHtml = '';
        
        if (connections && connections.length > 0) {
            // Group connections by type
            const publishers = connections.filter(c => c.isPublisher);
            const viewers = connections.filter(c => c.isPlayer);
            
            // Publishers section
            if (publishers.length > 0) {
                connectionsHtml += `
                    <div class="mb-4">
                        <h6 class="mb-3"><i class="fas fa-broadcast-tower me-2 text-danger"></i>Active Publishers</h6>
                        <div class="row g-3">`;
                
                publishers.forEach(conn => {
                    const statusBadge = conn.isStale ? 'bg-warning' : (conn.isActivelyStreaming ? 'bg-success' : 'bg-secondary');
                    const statusText = conn.isStale ? 'Stale' : (conn.isActivelyStreaming ? 'Streaming' : 'Connected');
                    const connectionAge = Math.floor((Date.now() - new Date(conn.connectTime).getTime()) / 1000);
                    const ageText = connectionAge < 60 ? `${connectionAge}s` : `${Math.floor(connectionAge / 60)}m`;
                    
                    connectionsHtml += `
                        <div class="col-md-6 col-lg-4">
                            <div class="card border-start border-danger border-3">
                                <div class="card-body p-3">
                                    <div class="d-flex justify-content-between align-items-start mb-2">
                                        <h6 class="card-title mb-0 font-monospace text-truncate" style="max-width: 120px;" title="${conn.streamKey}">
                                            ${conn.streamKey ? conn.streamKey.substring(0, 8) + '...' : 'Unknown'}
                                        </h6>
                                        <span class="badge ${statusBadge} ms-2">${statusText}</span>
                                    </div>
                                    
                                    <div class="small text-muted mb-2">
                                        <i class="fas fa-globe-americas me-1"></i>${conn.ip}
                                        <span class="ms-2"><i class="fas fa-clock me-1"></i>${ageText}</span>
                                    </div>
                                    
                                    ${conn.averageBitrate > 0 ? `
                                    <div class="row g-1 mt-2">
                                        <div class="col-12">
                                            <div class="d-flex justify-content-between">
                                                <small class="text-muted">Current:</small>
                                                <small class="fw-bold text-primary">${conn.currentBitrateFormatted}</small>
                                            </div>
                                        </div>
                                        <div class="col-12">
                                            <div class="d-flex justify-content-between">
                                                <small class="text-muted">Average:</small>
                                                <small class="fw-bold text-info">${conn.averageBitrateFormatted}</small>
                                            </div>
                                        </div>
                                        <div class="col-12">
                                            <div class="d-flex justify-content-between">
                                                <small class="text-muted">Peak:</small>
                                                <small class="fw-bold text-success">${conn.peakBitrateFormatted}</small>
                                            </div>
                                        </div>
                                    </div>
                                    ` : `
                                    <div class="text-center text-muted mt-2">
                                        <small><i class="fas fa-spinner fa-pulse me-1"></i>Establishing stream...</small>
                                    </div>
                                    `}
                                    
                                    <div class="row g-1 mt-2 pt-2 border-top">
                                        <div class="col-6">
                                            <small class="text-muted">Packets:</small>
                                            <div class="small fw-bold">${conn.dataPackets || 0}</div>
                                        </div>
                                        <div class="col-6">
                                            <small class="text-muted">Data:</small>
                                            <div class="small fw-bold">${this.formatBytes(conn.bytesReceived || 0)}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>`;
                });
                
                connectionsHtml += `</div></div>`;
            }
            
            // Viewers section
            if (viewers.length > 0) {
                connectionsHtml += `
                    <div class="mb-3">
                        <h6 class="mb-3"><i class="fas fa-eye me-2 text-info"></i>Active Viewers (${viewers.length})</h6>
                        <div class="row g-2">`;
                
                viewers.forEach(conn => {
                    const connectionAge = Math.floor((Date.now() - new Date(conn.connectTime).getTime()) / 1000);
                    const ageText = connectionAge < 60 ? `${connectionAge}s` : `${Math.floor(connectionAge / 60)}m`;
                    
                    connectionsHtml += `
                        <div class="col-md-3 col-sm-6">
                            <div class="card bg-light">
                                <div class="card-body p-2">
                                    <div class="d-flex justify-content-between align-items-center">
                                        <small class="text-muted">${conn.ip}</small>
                                        <small class="text-muted">${ageText}</small>
                                    </div>
                                </div>
                            </div>
                        </div>`;
                });
                
                connectionsHtml += `</div></div>`;
            }
        }
        
        // Update connection summary
        statusElement.innerHTML = `
            <div class="row g-3 mb-4">
                <div class="col-md-3">
                    <small class="text-muted">Publishers</small>
                    <div class="fw-bold ${summary.activePublishers > 0 ? 'text-success' : 'text-muted'}">
                        ${summary.activePublishers}
                    </div>
                </div>
                <div class="col-md-3">
                    <small class="text-muted">Viewers</small>
                    <div class="fw-bold ${summary.activeViewers > 0 ? 'text-info' : 'text-muted'}">
                        ${summary.activeViewers}
                    </div>
                </div>
                <div class="col-md-3">
                    <small class="text-muted">Stale</small>
                    <div class="fw-bold ${summary.staleConnections > 0 ? 'text-warning' : 'text-muted'}">
                        ${summary.staleConnections}
                    </div>
                </div>
                <div class="col-md-3">
                    <small class="text-muted">Monitoring</small>
                    <div class="fw-bold ${summary.connectionMonitoring.enabled ? 'text-success' : 'text-muted'}">
                        ${summary.connectionMonitoring.enabled ? 'Enabled' : 'Disabled'}
                    </div>
                </div>
            </div>
            ${connectionsHtml}
        `;
        
        // Show/hide the connection status section
        const connectionCard = document.getElementById('connection-card');
        if (connectionCard) {
            connectionCard.style.display = summary.totalConnections > 0 ? 'block' : 'none';
        }
        
        // Update bitrate overview
        this.updateBitrateOverview(data);
    },
    
    updateBitrateOverview: function(data) {
        const { connections } = data;
        const publishers = connections ? connections.filter(c => c.isPublisher) : [];
        
        const bitrateOverview = document.getElementById('bitrate-overview');
        if (!bitrateOverview) return;
        
        if (publishers.length > 0) {
            if (publishers.length === 1) {
                // Single publisher - show individual stats with quality monitoring
                const publisher = publishers[0];
                
                // Get bitrate values in bps
                const currentBitrate = publisher.currentBitrate || 0;
                const averageBitrate = publisher.averageBitrate || 0;
                const peakBitrate = publisher.peakBitrate || 0;
                
                // Quality assessment based on production targets (3-12 Mbps)
                const quality = this.assessBitrateQuality(currentBitrate, averageBitrate, peakBitrate);
                
                // Format bitrates for display
                const currentFormatted = publisher.currentBitrateFormatted || this.formatBitrate(currentBitrate);
                const averageFormatted = publisher.averageBitrateFormatted || this.formatBitrate(averageBitrate);
                const peakFormatted = publisher.peakBitrateFormatted || this.formatBitrate(peakBitrate);
                
                // Show status based on quality and connection state
                const displayCurrent = this.getBitrateDisplayValue(currentBitrate, averageBitrate, currentFormatted, quality);
                const displayAverage = this.getBitrateDisplayValue(averageBitrate, 0, averageFormatted, quality, 'average');
                const displayPeak = this.getBitrateDisplayValue(peakBitrate, 0, peakFormatted, quality, 'peak');
                
                this.updateElementTextWithAnimation('current-bitrate', displayCurrent);
                this.updateElementTextWithAnimation('average-bitrate', displayAverage);
                this.updateElementTextWithAnimation('peak-bitrate', displayPeak);
                
                // Update quality indicators and warnings
                this.updateBitrateQualityIndicators(quality, publisher);
                
            } else {
                // Multiple publishers - show aggregated stats with combined quality assessment
                let totalCurrent = 0, totalAverage = 0, maxPeak = 0;
                const publisherQualities = [];
                
                publishers.forEach(pub => {
                    const current = pub.currentBitrate || 0;
                    const average = pub.averageBitrate || 0;
                    const peak = pub.peakBitrate || 0;
                    
                    totalCurrent += current;
                    totalAverage += average;
                    maxPeak = Math.max(maxPeak, peak);
                    
                    publisherQualities.push(this.assessBitrateQuality(current, average, peak));
                });
                
                // Aggregate quality assessment
                const aggregateQuality = this.aggregateQualityAssessment(publisherQualities);
                
                this.updateElementTextWithAnimation('current-bitrate', this.formatBitrate(totalCurrent));
                this.updateElementTextWithAnimation('average-bitrate', this.formatBitrate(totalAverage));
                this.updateElementTextWithAnimation('peak-bitrate', this.formatBitrate(maxPeak));
                
                // Update quality indicators for multiple publishers
                this.updateBitrateQualityIndicators(aggregateQuality, null, publishers.length);
            }
            
            // Show the bitrate overview section
            bitrateOverview.style.display = 'flex';
        } else {
            // Hide the bitrate overview section when no active publishers
            bitrateOverview.style.display = 'none';
            this.clearBitrateQualityIndicators();
        }
    },
    
    assessBitrateQuality: function(currentBitrate, averageBitrate, peakBitrate) {
        const targetMin = 3000000; // 3 Mbps in bps
        const targetMax = 12000000; // 12 Mbps in bps
        const criticalLow = 1000000; // 1 Mbps - critically low
        const acceptable = 2000000; // 2 Mbps - acceptable but below target
        
        // Use current bitrate for real-time assessment, fallback to average
        const activeBitrate = currentBitrate > 0 ? currentBitrate : averageBitrate;
        
        if (activeBitrate === 0) {
            return {
                status: 'connecting',
                level: 'info',
                message: 'Establishing connection...',
                color: 'text-info',
                bgColor: 'bg-info',
                percentage: 0,
                recommendation: 'Waiting for stream data'
            };
        }
        
        if (activeBitrate < criticalLow) {
            return {
                status: 'critical',
                level: 'danger',
                message: 'Critically low bitrate',
                color: 'text-danger',
                bgColor: 'bg-danger',
                percentage: Math.round((activeBitrate / targetMin) * 100),
                recommendation: 'Check encoder settings and network connection'
            };
        }
        
        if (activeBitrate < acceptable) {
            return {
                status: 'poor',
                level: 'warning',
                message: 'Poor quality bitrate',
                color: 'text-warning',
                bgColor: 'bg-warning',
                percentage: Math.round((activeBitrate / targetMin) * 100),
                recommendation: 'Increase bitrate for better quality'
            };
        }
        
        if (activeBitrate < targetMin) {
            return {
                status: 'below-target',
                level: 'warning',
                message: 'Below production target',
                color: 'text-warning',
                bgColor: 'bg-warning',
                percentage: Math.round((activeBitrate / targetMin) * 100),
                recommendation: 'Consider increasing bitrate to 3+ Mbps'
            };
        }
        
        if (activeBitrate <= targetMax) {
            return {
                status: 'excellent',
                level: 'success',
                message: 'Excellent production quality',
                color: 'text-success',
                bgColor: 'bg-success',
                percentage: 100,
                recommendation: 'Perfect for production streaming'
            };
        }
        
        // Above 12 Mbps - still good but monitor for efficiency
        return {
            status: 'high',
            level: 'success',
            message: 'High bitrate (monitor efficiency)',
            color: 'text-success',
            bgColor: 'bg-success',
            percentage: 100,
            recommendation: 'Excellent quality, monitor bandwidth usage'
        };
    },
    
    getBitrateDisplayValue: function(bitrate, fallbackBitrate, formattedValue, quality, type = 'current') {
        if (bitrate === 0 && (fallbackBitrate === 0 || !fallbackBitrate)) {
            switch (type) {
                case 'average': return 'Calculating...';
                case 'peak': return 'No data yet';
                default: return 'Connecting...';
            }
        }
        
        return formattedValue;
    },
    
    aggregateQualityAssessment: function(qualities) {
        if (qualities.length === 0) {
            return {
                status: 'no-data',
                level: 'secondary',
                message: 'No active publishers',
                color: 'text-muted',
                bgColor: 'bg-secondary',
                percentage: 0,
                recommendation: 'Start streaming to see quality metrics'
            };
        }
        
        const statusPriority = { 'critical': 4, 'poor': 3, 'below-target': 2, 'connecting': 1, 'excellent': 0, 'high': 0 };
        const worstQuality = qualities.reduce((worst, current) => 
            statusPriority[current.status] > statusPriority[worst.status] ? current : worst
        );
        
        const excellentCount = qualities.filter(q => q.status === 'excellent' || q.status === 'high').length;
        const totalCount = qualities.length;
        
        if (worstQuality.status === 'critical' || worstQuality.status === 'poor') {
            return {
                ...worstQuality,
                message: `${worstQuality.message} (${totalCount - excellentCount}/${totalCount} publishers)`,
                recommendation: `${worstQuality.recommendation} - Check all ${totalCount} publisher(s)`
            };
        }
        
        return {
            status: 'mixed',
            level: excellentCount === totalCount ? 'success' : 'info',
            message: `${excellentCount}/${totalCount} publishers at production quality`,
            color: excellentCount === totalCount ? 'text-success' : 'text-info',
            bgColor: excellentCount === totalCount ? 'bg-success' : 'bg-info',
            percentage: Math.round((excellentCount / totalCount) * 100),
            recommendation: excellentCount === totalCount ? 'All publishers performing excellently' : 'Some publishers need attention'
        };
    },
    
    updateBitrateQualityIndicators: function(quality, publisher = null, publisherCount = 1) {
        // Update quality badge if it exists
        const qualityBadge = document.getElementById('bitrate-quality-badge');
        if (qualityBadge) {
            qualityBadge.className = `badge ${quality.bgColor} ms-2`;
            qualityBadge.textContent = quality.message;
            qualityBadge.title = quality.recommendation;
        }
        
        // Update quality progress bar if it exists
        const qualityProgress = document.getElementById('bitrate-quality-progress');
        if (qualityProgress) {
            qualityProgress.className = `progress-bar ${quality.bgColor}`;
            qualityProgress.style.width = `${quality.percentage}%`;
            qualityProgress.setAttribute('aria-valuenow', quality.percentage);
        }
        
        // Show quality alerts for poor performance
        if (quality.status === 'critical' || quality.status === 'poor') {
            this.showBitrateQualityAlert(quality, publisherCount);
        }
        
        // Update connection status with quality info if available
        this.updateConnectionQualityStatus(quality, publisher);
    },
    
    showBitrateQualityAlert: function(quality, publisherCount = 1) {
        const alertMessage = publisherCount > 1 
            ? `Stream Quality Alert: ${quality.message} detected across ${publisherCount} publisher(s). ${quality.recommendation}`
            : `Stream Quality Alert: ${quality.message}. ${quality.recommendation}`;
            
        if (quality.status === 'critical') {
            window.PulseToast.error(alertMessage, 15000);
        } else {
            window.PulseToast.warning(alertMessage, 10000);
        }
    },
    
    updateConnectionQualityStatus: function(quality, publisher) {
        // Add quality indicator to connection status if publisher data is available
        if (publisher && quality.status !== 'connecting') {
            const statusElement = document.getElementById('connection-status');
            if (statusElement) {
                const qualityIndicator = statusElement.querySelector('.quality-indicator');
                if (qualityIndicator) {
                    qualityIndicator.className = `badge ${quality.bgColor} quality-indicator`;
                    qualityIndicator.textContent = quality.message;
                    qualityIndicator.title = quality.recommendation;
                }
            }
        }
    },
    
    clearBitrateQualityIndicators: function() {
        const qualityBadge = document.getElementById('bitrate-quality-badge');
        if (qualityBadge) {
            qualityBadge.className = 'badge bg-secondary ms-2';
            qualityBadge.textContent = 'No stream';
            qualityBadge.title = 'No active publishers';
        }
        
        const qualityProgress = document.getElementById('bitrate-quality-progress');
        if (qualityProgress) {
            qualityProgress.className = 'progress-bar bg-secondary';
            qualityProgress.style.width = '0%';
            qualityProgress.setAttribute('aria-valuenow', 0);
        }
    },
    
    formatBitrate: function(bitrate) {
        if (bitrate < 1000) {
            return `${Math.round(bitrate)} bps`;
        } else if (bitrate < 1000000) {
            return `${Math.round(bitrate / 1000)} kbps`;
        } else {
            return `${Math.round(bitrate / 1000000)} Mbps`;
        }
    },
    
    formatBytes: function(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },
    
    checkForStaleConnections: function(data) {
        const { summary, connections } = data;
        
        // Check if there are stale publisher connections
        const stalePublishers = connections.filter(c => c.isPublisher && c.isStale);
        
        if (stalePublishers.length > 0) {
            this.showStaleConnectionToast(stalePublishers);
        }
    },
    
    showStaleConnectionToast: function(stalePublishers) {
        const message = `Connection Issue: ${stalePublishers.length} stale publisher connection(s) detected. This may indicate network issues.`;
        window.PulseToast.warning(message, 8000);
    },
    
    hideConnectionStatus: function() {
        const connectionCard = document.getElementById('connection-card');
        if (connectionCard) {
            connectionCard.style.display = 'none';
        }
    },
    
    updateCountdownDisplay: function() {
        const countdownElement = document.getElementById('refresh-countdown');
        if (countdownElement) {
            countdownElement.textContent = this.refreshCountdown;
        }
    },
    
    refreshData: function() {
        this.loadStats();
        this.loadStreamStatus();
        this.loadLiveStreams();
        this.location.loadSettings(); // Refresh location status
        
        // Refresh dashboard location map if visible
        if (this.location.dashboardMap && this.location.settings.enabled) {
            this.location.refreshDashboardLocation();
        }
    },
    
    manualRefresh: function() {
        const refreshIcon = document.getElementById('refresh-icon');
        
        // Add spinning animation
        if (refreshIcon) {
            refreshIcon.classList.add('fa-spin');
        }
        
        // Reset countdown and refresh data
        this.refreshCountdown = 10;
        this.updateCountdownDisplay();
        this.refreshData();
        
        // Remove spinning animation after a short delay
        setTimeout(() => {
            if (refreshIcon) {
                refreshIcon.classList.remove('fa-spin');
            }
        }, 1000);
    },
    
    loadMoreActivity: function() {
        if (this.activityState && this.activityState.hasMore) {
            this.loadRecentActivity(this.activityState.offset, true);
        }
    },
    
    updateLoadMoreButton: function() {
        const loadMoreBtn = document.getElementById('load-more-activity-btn');
        if (loadMoreBtn) {
            if (this.activityState && this.activityState.hasMore) {
                loadMoreBtn.style.display = 'block';
            } else {
                loadMoreBtn.style.display = 'none';
            }
        }
    },

    // Stream Key Management Methods
    showAddStreamKeyModal: function() {
        const modal = new bootstrap.Modal(document.getElementById('streamKeyModal'));
        const saveBtn = document.getElementById('saveStreamKey');
        
        document.getElementById('streamKeyModalLabel').textContent = 'Add Stream Key';
        document.getElementById('keyDescription').value = '';
        document.getElementById('keyObsSourceName').value = '';
        document.getElementById('keyConnectMessage').value = '';
        document.getElementById('keyDisconnectMessage').value = '';
        saveBtn.textContent = 'Create Stream Key';
        saveBtn.dataset.action = 'create';
        saveBtn.removeAttribute('data-key-id');
        
        modal.show();
    },

    createStreamKey: function() {
        const description = document.getElementById('keyDescription').value.trim();
        const obsSourceName = document.getElementById('keyObsSourceName').value.trim();
        const connectMessage = document.getElementById('keyConnectMessage').value.trim();
        const disconnectMessage = document.getElementById('keyDisconnectMessage').value.trim();
        const button = document.getElementById('saveStreamKey');
        const originalText = button.textContent;
        
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Creating...';
        
        fetch('/api/stream/keys', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ description, obsSourceName, connectMessage, disconnectMessage }),
            credentials: 'include'
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(data => {
                    throw new Error(data.error || 'Failed to create stream key');
                });
            }
            return response.json();
        })
        .then(data => {
            // Close modal
            bootstrap.Modal.getInstance(document.getElementById('streamKeyModal')).hide();
            
            // Show success message
            window.showToast('Stream key created successfully!', 'success');
            
            // Refresh the page to show the new key
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        })
        .catch(error => {
            window.showToast(error.message, 'error');
        })
        .finally(() => {
            button.disabled = false;
            button.textContent = originalText;
        });
    },

    editStreamKey: function(keyId) {
        // Find the stream key item
        const keyItem = document.querySelector(`[data-key-id="${keyId}"]`);
        if (!keyItem) return;
        
        const currentDescription = keyItem.querySelector('h6').textContent.replace(/\s*(Active|Inactive)\s*$/, '').trim();
        const currentObsSourceName = keyItem.dataset.obsSourceName || '';
        const currentConnectMessage = keyItem.dataset.connectMessage || '';
        const currentDisconnectMessage = keyItem.dataset.disconnectMessage || '';
        
        const modal = new bootstrap.Modal(document.getElementById('streamKeyModal'));
        const saveBtn = document.getElementById('saveStreamKey');
        
        document.getElementById('streamKeyModalLabel').textContent = 'Edit Stream Key';
        document.getElementById('keyDescription').value = currentDescription;
        document.getElementById('keyObsSourceName').value = currentObsSourceName;
        document.getElementById('keyConnectMessage').value = currentConnectMessage;
        document.getElementById('keyDisconnectMessage').value = currentDisconnectMessage;
        saveBtn.textContent = 'Update Stream Key';
        saveBtn.dataset.action = 'update';
        saveBtn.dataset.keyId = keyId;
        
        modal.show();
    },

    updateStreamKey: function(keyId) {
        const description = document.getElementById('keyDescription').value.trim();
        const obsSourceName = document.getElementById('keyObsSourceName').value.trim();
        const connectMessage = document.getElementById('keyConnectMessage').value.trim();
        const disconnectMessage = document.getElementById('keyDisconnectMessage').value.trim();
        const button = document.getElementById('saveStreamKey');
        const originalText = button.textContent;
        
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Updating...';
        
        fetch(`/api/stream/keys/${keyId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ description, obsSourceName, connectMessage, disconnectMessage }),
            credentials: 'include'
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(data => {
                    throw new Error(data.error || 'Failed to update stream key');
                });
            }
            return response.json();
        })
        .then(data => {
            // Close modal
            bootstrap.Modal.getInstance(document.getElementById('streamKeyModal')).hide();
            
            // Show success message
            window.showToast('Stream key updated successfully!', 'success');
            
            // Update the UI
            const keyItem = document.querySelector(`[data-key-id="${keyId}"]`);
            if (keyItem) {
                const titleElement = keyItem.querySelector('h6');
                if (titleElement) {
                    const badges = titleElement.innerHTML.match(/<span class="badge[^>]*>.*?<\/span>/g) || [];
                    titleElement.innerHTML = description + ' ' + badges.join(' ');
                }
                // Update data attributes so next edit loads correct values
                keyItem.dataset.obsSourceName = obsSourceName;
                keyItem.dataset.connectMessage = connectMessage;
                keyItem.dataset.disconnectMessage = disconnectMessage;
            }
        })
        .catch(error => {
            window.showToast(error.message, 'error');
        })
        .finally(() => {
            button.disabled = false;
            button.textContent = originalText;
        });
    },

    toggleStreamKey: function(keyId, activate) {
        const action = activate ? 'activate' : 'deactivate';
        
        if (!confirm(`Are you sure you want to ${action} this stream key?`)) {
            return;
        }
        
        fetch(`/api/stream/keys/${keyId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ isActive: activate }),
            credentials: 'include'
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(data => {
                    throw new Error(data.error || `Failed to ${action} stream key`);
                });
            }
            return response.json();
        })
        .then(data => {
            window.showToast(`Stream key ${action}d successfully!`, 'success');
            
            // Update the UI
            const keyItem = document.querySelector(`[data-key-id="${keyId}"]`);
            if (keyItem) {
                const badge = keyItem.querySelector('.badge');
                const buttonGroup = keyItem.querySelector('.btn-group');
                
                if (badge) {
                    if (activate) {
                        badge.className = 'badge bg-success ms-2';
                        badge.textContent = 'Active';
                        keyItem.removeAttribute('data-inactive');
                    } else {
                        badge.className = 'badge bg-secondary ms-2';
                        badge.textContent = 'Inactive';
                        keyItem.setAttribute('data-inactive', 'true');
                    }
                }
                
                // Update the activate/deactivate button
                if (buttonGroup) {
                    const activateBtn = buttonGroup.querySelector('.activate-key-btn');
                    const deactivateBtn = buttonGroup.querySelector('.deactivate-key-btn');
                    
                    if (activate && activateBtn) {
                        // Replace activate button with deactivate button
                        activateBtn.className = 'btn btn-sm btn-outline-warning deactivate-key-btn';
                        activateBtn.title = 'Deactivate';
                        activateBtn.innerHTML = '<i class="fas fa-pause"></i>';
                    } else if (!activate && deactivateBtn) {
                        // Replace deactivate button with activate button
                        deactivateBtn.className = 'btn btn-sm btn-outline-success activate-key-btn';
                        deactivateBtn.title = 'Activate';
                        deactivateBtn.innerHTML = '<i class="fas fa-play"></i>';
                    }
                }
            }
        })
        .catch(error => {
            window.showToast(error.message, 'error');
        });
    },

    deleteStreamKey: function(keyId) {
        if (!confirm('Are you sure you want to delete this stream key? This action cannot be undone.')) {
            return;
        }
        
        fetch(`/api/stream/keys/${keyId}`, {
            method: 'DELETE',
            credentials: 'include'
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(data => {
                    throw new Error(data.error || 'Failed to delete stream key');
                });
            }
            return response.json();
        })
        .then(data => {
            window.showToast('Stream key deleted successfully!', 'success');
            
            // Remove the key item from the UI
            const keyItem = document.querySelector(`[data-key-id="${keyId}"]`);
            if (keyItem) {
                keyItem.remove();
            }
            
            // Check if no keys remain
            const remainingKeys = document.querySelectorAll('.stream-key-item');
            if (remainingKeys.length === 0) {
                const container = document.getElementById('stream-keys-container');
                if (container) {
                    container.innerHTML = `
                        <div class="text-center text-muted py-4" id="no-keys-message">
                            <i class="fas fa-key fa-3x mb-3"></i>
                            <p>No stream keys found. Create your first stream key to get started.</p>
                        </div>
                    `;
                }
            }
        })
        .catch(error => {
            window.showToast(error.message, 'error');
        });
    },

    // Video Player Management
    videoPlayer: {
        flvPlayer: null,
        currentStreamKey: null,
        modal: null,

        init: function() {
            this.modal = new bootstrap.Modal(document.getElementById('videoPlayerModal'));
            this.setupPlayerEvents();
        },

        setupPlayerEvents: function() {
            // Watch stream button handler
            document.addEventListener('click', (e) => {
                if (e.target.closest('.watch-stream-btn')) {
                    e.preventDefault();
                    const streamKey = e.target.closest('.watch-stream-btn').dataset.streamKey;
                    this.playStream(streamKey);
                }
            });

            // Retry button
            document.getElementById('retryStreamBtn').addEventListener('click', () => {
                if (this.currentStreamKey) {
                    this.playStream(this.currentStreamKey);
                }
            });

            // Fullscreen button
            document.getElementById('toggleFullscreenBtn').addEventListener('click', () => {
                this.toggleFullscreen();
            });

            // Clean up when modal is closed
            document.getElementById('videoPlayerModal').addEventListener('hidden.bs.modal', () => {
                this.stopStream();
            });
        },

        playStream: function(streamKey) {
            this.currentStreamKey = streamKey;
            
            // Show modal and loading state first
            this.modal.show();
            this.showLoadingState();
            
            // Fetch player configuration from API
            fetch('/api/stream/player-config')
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        const streamUrl = `${data.playerBaseUrl}/${streamKey}.flv`;
                        document.getElementById('currentStreamUrl').textContent = streamUrl;
                        
                        // Initialize FLV player with the correct URL
                        setTimeout(() => {
                            this.initFlvPlayer(streamUrl);
                        }, 500); // Small delay to ensure modal is fully shown
                    } else {
                        throw new Error('Failed to get player configuration');
                    }
                })
                .catch(error => {

                    // Fallback to old hardcoded URL in case of error
                    const fallbackUrl = `http://${window.location.hostname}:4000/live/${streamKey}.flv`;
                    document.getElementById('currentStreamUrl').textContent = fallbackUrl;
                    
                    setTimeout(() => {
                        this.initFlvPlayer(fallbackUrl);
                    }, 500);
                });
        },

        initFlvPlayer: function(url) {
            const videoElement = document.getElementById('streamPlayer');
            
            // Clean up existing player
            this.stopStream();

            if (window.flvjs && window.flvjs.isSupported()) {
                try {
                    this.flvPlayer = window.flvjs.createPlayer({
                        type: 'flv',
                        url: url,
                        isLive: true
                    });

                    this.flvPlayer.attachMediaElement(videoElement);
                    
                    // Set up event handlers
                    this.flvPlayer.on(window.flvjs.Events.LOADING_COMPLETE, () => {

                    });

                    this.flvPlayer.on(window.flvjs.Events.LOADED_METADATA, () => {

                        this.hideLoadingState();
                        
                        // Try to auto-play when metadata is loaded
                        const videoElement = document.getElementById('streamPlayer');
                        if (videoElement) {
                            videoElement.play().catch(error => {

                                // Autoplay was prevented - player controls will handle this
                            });
                        }
                    });

                    this.flvPlayer.on(window.flvjs.Events.ERROR, (errorType, errorDetail, errorInfo) => {

                        this.showErrorState('Failed to load stream. The stream may not be active.');
                    });

                    // Handle video events for live streaming
                    videoElement.addEventListener('ended', () => {

                        this.showErrorState('Stream has ended.');
                    });

                    videoElement.addEventListener('canplay', () => {

                        this.hideLoadingState();
                        
                        // Auto-play the video
                        videoElement.play().catch(error => {

                            // Autoplay was prevented - player controls will handle this
                        });
                    });

                    videoElement.addEventListener('error', (e) => {

                        this.showErrorState('Video playback error occurred.');
                    });

                    // Start loading
                    this.flvPlayer.load();
                    
                    // Player is ready - loading state will be hidden
                    this.hideLoadingState();

                } catch (error) {

                    this.showErrorState('Failed to initialize video player.');
                }
            } else {
                this.showErrorState('FLV.js is not supported in this browser.');
            }
        },

        stopStream: function() {
            if (this.flvPlayer) {
                try {
                    this.flvPlayer.pause();
                    this.flvPlayer.unload();
                    this.flvPlayer.detachMediaElement();
                    this.flvPlayer.destroy();
                } catch (error) {

                }
                this.flvPlayer = null;
            }

            // Reset video element
            const videoElement = document.getElementById('streamPlayer');
            if (videoElement) {
                videoElement.src = '';
                videoElement.load();
            }
        },

        reconnectPlayer: function() {

            
            // Stop current player if exists
            this.stopStream();
            
            // Show loading state
            this.showLoadingState();
            
            // Get the current stream key and try to reconnect
            const currentStreamKey = this.currentStreamKey;
            if (currentStreamKey) {
                setTimeout(() => {
                    this.playStream(currentStreamKey);
                }, 1000);
            } else {
                this.showErrorState('Unable to reconnect: No stream key available.');
            }
        },

        showLoadingState: function() {
            document.getElementById('playerLoadingOverlay').classList.remove('d-none');
            document.getElementById('playerLoadingOverlay').classList.add('d-flex');
            document.getElementById('playerErrorOverlay').classList.add('d-none');
        },

        hideLoadingState: function() {
            document.getElementById('playerLoadingOverlay').classList.add('d-none');
            document.getElementById('playerErrorOverlay').classList.add('d-none');
        },

        showErrorState: function(message) {
            document.getElementById('playerLoadingOverlay').classList.add('d-none');
            document.getElementById('playerErrorOverlay').classList.remove('d-none');
            document.getElementById('playerErrorOverlay').classList.add('d-flex');
            document.getElementById('playerErrorMessage').textContent = message;
        },

        toggleFullscreen: function() {
            const videoElement = document.getElementById('streamPlayer');
            
            if (!document.fullscreenElement) {
                if (videoElement.requestFullscreen) {
                    videoElement.requestFullscreen();
                } else if (videoElement.webkitRequestFullscreen) {
                    videoElement.webkitRequestFullscreen();
                } else if (videoElement.msRequestFullscreen) {
                    videoElement.msRequestFullscreen();
                }
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                } else if (document.webkitExitFullscreen) {
                    document.webkitExitFullscreen();
                } else if (document.msExitFullscreen) {
                    document.msExitFullscreen();
                }
            }
        }
    },

    // Location sharing functionality
    location: {
        watchId: null,
        updateInterval: null,
        dashboardMap: null,
        dashboardMarker: null,
        lastAccuracyWarning: null,
        settings: {
            enabled: false,
            accuracyThreshold: 5000,
            updateInterval: 30,
            autoDisableAfter: 3600
        },

        // Get or create unique device ID
        getDeviceId: function() {
            let deviceId = localStorage.getItem('deviceId');
            if (!deviceId) {
                deviceId = 'device_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
                localStorage.setItem('deviceId', deviceId);
            }
            return deviceId;
        },

        // Check if location is enabled on THIS device
        isEnabledOnThisDevice: function() {
            const deviceId = this.getDeviceId();
            return localStorage.getItem(`location_enabled_${deviceId}`) === 'true';
        },

        // Enable/disable location on THIS device
        setEnabledOnThisDevice: function(enabled) {
            const deviceId = this.getDeviceId();
            localStorage.setItem(`location_enabled_${deviceId}`, enabled.toString());
        },

        init: function() {
            this.getDeviceId(); // Initialize device ID
            this.loadSettings();
            this.setupLocationEventListeners();
        },

        initDashboardMap: function() {
            if (typeof L === 'undefined') {
                return;
            }

            const mapContainer = document.getElementById('dashboard-map');
            if (!mapContainer || this.dashboardMap) {
                return;
            }

            // Initialize map
            this.dashboardMap = L.map('dashboard-map', {
                zoom: 15,
                zoomControl: true,
                attributionControl: false
            }).setView([40.7128, -74.0060], 15); // Default to NYC

            // Add tile layer
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                maxZoom: 18,
                attribution: '© OpenStreetMap contributors © CARTO'
            }).addTo(this.dashboardMap);

            // Add map control event listeners
            const centerMapBtn = document.getElementById('center-map-btn');
            if (centerMapBtn) {
                centerMapBtn.addEventListener('click', () => {
                    this.centerMapOnLocation();
                });
            }

            const refreshLocationBtn = document.getElementById('refresh-location-btn');
            if (refreshLocationBtn) {
                refreshLocationBtn.addEventListener('click', () => {
                    this.refreshDashboardLocation();
                });
            }
        },

        showMapSection: function() {
            const mapSection = document.getElementById('location-map-section');
            if (mapSection) {
                mapSection.style.display = 'block';
                
                // Initialize map after section is visible
                setTimeout(() => {
                    this.initDashboardMap();
                    this.refreshDashboardLocation();
                }, 100);
            }
        },

        hideMapSection: function() {
            const mapSection = document.getElementById('location-map-section');
            if (mapSection) {
                mapSection.style.display = 'none';
            }
        },

        showObsOverlaySection: function() {
            const obsSection = document.getElementById('obs-overlay-section');
            if (obsSection) {
                obsSection.style.display = 'block';
            }
        },

        hideObsOverlaySection: function() {
            const obsSection = document.getElementById('obs-overlay-section');
            if (obsSection) {
                obsSection.style.display = 'none';
            }
        },

        updateDashboardMap: function(locationData) {
            if (!this.dashboardMap || !locationData.enabled || !locationData.location) {
                return;
            }

            const location = locationData.location;
            const latlng = [location.latitude, location.longitude];

            // Update or create marker
            if (this.dashboardMarker) {
                this.dashboardMarker.setLatLng(latlng);
            } else {
                // Create custom marker
                const customIcon = L.divIcon({
                    html: '<div class="location-marker"></div>',
                    className: '',
                    iconSize: [26, 26],
                    iconAnchor: [13, 13]
                });
                
                this.dashboardMarker = L.marker(latlng, { icon: customIcon })
                    .addTo(this.dashboardMap);
            }

            // Center map on location
            this.dashboardMap.setView(latlng, 15);

            // Update info displays
            this.updateMapInfo(location);
        },

        updateMapInfo: function(location) {
            const coordinates = document.getElementById('map-coordinates');
            const accuracy = document.getElementById('map-accuracy');
            const timestamp = document.getElementById('map-timestamp');
            const status = document.getElementById('map-status');

            if (coordinates) coordinates.textContent = `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
            if (accuracy) accuracy.textContent = `±${Math.round(location.accuracy || 0)}m`;
            if (timestamp) timestamp.textContent = new Date(location.timestamp).toLocaleTimeString();
            if (status) status.textContent = 'Active';
        },

        centerMapOnLocation: function() {
            if (this.dashboardMarker && this.dashboardMap) {
                this.dashboardMap.setView(this.dashboardMarker.getLatLng(), 15);
            }
        },

        refreshDashboardLocation: async function() {
            try {
                const response = await fetch('/api/location/current', {
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    throw new Error(`Failed to fetch location: ${response.status}`);
                }

                const data = await response.json();
                this.updateDashboardMap(data);
            } catch (error) {
                console.error('Error refreshing location:', error);
                window.showToast('Failed to refresh location', 'error');
            }
        },

        setupLocationEventListeners: function() {
            // Auto-save when location toggle is changed
            const locationEnabledToggle = document.getElementById('locationEnabled');
            if (locationEnabledToggle && !locationEnabledToggle.hasAttribute('data-listener')) {
                locationEnabledToggle.setAttribute('data-listener', 'true');
                locationEnabledToggle.addEventListener('change', async () => {
                    const enabled = locationEnabledToggle.checked;
                    
                    try {
                        // Save location settings
                        const locationResponse = await fetch('/api/location/settings', {
                            method: 'PUT',
                            headers: {
                                'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                enabled: enabled,
                                locationMode: 'gps',
                                accuracyThreshold: 5000,
                                updateInterval: 30,
                                autoDisableAfter: 3600
                            })
                        });

                        if (!locationResponse.ok) {
                            throw new Error(`Failed to save location settings: ${locationResponse.status}`);
                        }

                        // Refresh all location data
                        await this.loadSettings();
                        await this.loadLocationHistory();
                        window.showToast('Location settings saved successfully', 'success');
                    } catch (error) {
                        console.error('Error saving location settings:', error);
                        window.showToast('Failed to save location settings', 'error');
                        // Revert the toggle on error
                        locationEnabledToggle.checked = !enabled;
                    }
                });
            }

            // Save location settings button (kept for compatibility)
            const saveLocationSettings = document.getElementById('saveLocationSettings');
            if (saveLocationSettings) {
                saveLocationSettings.addEventListener('click', async () => {
                    const enabled = document.getElementById('locationEnabled').checked;
                    
                    try {
                        // Save location settings
                        const locationResponse = await fetch('/api/location/settings', {
                            method: 'PUT',
                            headers: {
                                'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                enabled: enabled,
                                locationMode: 'gps',
                                accuracyThreshold: 5000,
                                updateInterval: 30,
                                autoDisableAfter: 3600
                            })
                        });

                        if (!locationResponse.ok) {
                            throw new Error(`Failed to save location settings: ${locationResponse.status}`);
                        }

                        await this.loadSettings();
                        window.showToast('Location settings saved successfully', 'success');
                        
                        const modal = bootstrap.Modal.getInstance(document.getElementById('locationSettingsModal'));
                        if (modal) modal.hide();
                    } catch (error) {
                        console.error('Error saving location settings:', error);
                        window.showToast('Failed to save location settings', 'error');
                    }
                });
            }
        },

        loadSettings: async function() {
            try {
                // Load location settings
                const locationResponse = await fetch('/api/location/settings', {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!locationResponse.ok) {
                    throw new Error(`Failed to load location settings: ${locationResponse.status}`);
                }

                const locationData = await locationResponse.json();
                this.settings = locationData.settings;
                
                this.updateUI();
            } catch (error) {
                console.error('Error loading settings:', error);
                window.showToast('Failed to load settings', 'error');
            }
        },

        updateUI: function() {
            // Update dashboard indicator
            const indicator = document.getElementById('location-enabled-indicator');
            if (indicator) {
                if (this.settings.enabled) {
                    indicator.textContent = 'Active';
                    indicator.className = 'badge bg-success';
                } else {
                    indicator.textContent = 'Disabled';
                    indicator.className = 'badge bg-secondary';
                }
            }

            // Show/hide map section (OBS overlay section always visible)
            if (this.settings.enabled) {
                this.showMapSection();
            } else {
                this.hideMapSection();
            }

            // Update modal checkboxes
            const enabledCheckbox = document.getElementById('locationEnabled');
            if (enabledCheckbox) {
                enabledCheckbox.checked = Boolean(this.settings.enabled);
            }

            // Update fixed location display - always show, populate with data or show empty
            const nameEl = document.getElementById('fixedLocationName');
            const latEl = document.getElementById('fixedLocationLat');
            const lngEl = document.getElementById('fixedLocationLng');
            
            if (nameEl) {
                nameEl.textContent = this.settings.fixedLocationName || '-';
            }
            if (latEl) {
                latEl.textContent = this.settings.fixedLatitude ? this.settings.fixedLatitude.toFixed(6) : '-';
            }
            if (lngEl) {
                lngEl.textContent = this.settings.fixedLongitude ? this.settings.fixedLongitude.toFixed(6) : '-';
            }
        },

        loadLocationHistory: async function() {
            try {
                const response = await fetch('/api/location/history?limit=20', {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    throw new Error(`Failed to load location history: ${response.status}`);
                }

                const data = await response.json();
                const tbody = document.getElementById('locationDataTableBody');
                
                if (!tbody) return;

                if (!data.history || data.history.length === 0) {
                    tbody.innerHTML = `
                        <tr>
                            <td colspan="6" class="text-center text-muted">
                                No location data available
                            </td>
                        </tr>
                    `;
                    return;
                }

                tbody.innerHTML = data.history.map(loc => {
                    const timestamp = new Date(loc.timestamp).toLocaleString();
                    const speed = loc.speed ? `${(loc.speed * 3.6).toFixed(1)} km/h` : '-';
                    const altitude = loc.altitude ? `${loc.altitude.toFixed(0)}m` : '-';
                    const accuracy = loc.accuracy ? `±${loc.accuracy.toFixed(0)}m` : '-';
                    
                    return `
                        <tr>
                            <td><small>${timestamp}</small></td>
                            <td>${loc.latitude.toFixed(6)}</td>
                            <td>${loc.longitude.toFixed(6)}</td>
                            <td>${accuracy}</td>
                            <td>${speed}</td>
                            <td>${altitude}</td>
                        </tr>
                    `;
                }).join('');
            } catch (error) {
                console.error('Error loading location history:', error);
                const tbody = document.getElementById('locationDataTableBody');
                if (tbody) {
                    tbody.innerHTML = `
                        <tr>
                            <td colspan="6" class="text-center text-danger">
                                <i class="fas fa-exclamation-triangle me-2"></i>Failed to load location data
                            </td>
                        </tr>
                    `;
                }
            }
        }
    },

    showLocationSettings: async function() {
        const modalElement = document.getElementById('locationSettingsModal');
        let modal = bootstrap.Modal.getInstance(modalElement);
        if (!modal) {
            modal = new bootstrap.Modal(modalElement);
        }
        modal.show();
        
        await this.location.loadSettings();
        await this.location.loadLocationHistory();

        // Setup location event listeners
        this.location.setupLocationEventListeners();

        // Setup refresh button if not already done
        const refreshBtn = document.getElementById('refreshLocationDataBtn');
        if (refreshBtn && !refreshBtn.hasAttribute('data-listener')) {
            refreshBtn.setAttribute('data-listener', 'true');
            refreshBtn.addEventListener('click', async () => {
                // Refresh both settings (fixed location) and history
                await this.location.loadSettings();
                await this.location.loadLocationHistory();
                window.showToast('Location data refreshed', 'success');
            });
        }
    },

    showObsSettings: function() {
        const modalElement = document.getElementById('obsSettingsModal');
        let modal = bootstrap.Modal.getInstance(modalElement);
        if (!modal) {
            modal = new bootstrap.Modal(modalElement);
        }
        modal.show();

        // Setup show/hide password toggle
        const showPasswordCheckbox = document.getElementById('showObsPassword');
        const passwordInput = document.getElementById('obsWebsocketPassword');
        
        if (showPasswordCheckbox && passwordInput) {
            showPasswordCheckbox.addEventListener('change', function() {
                passwordInput.type = this.checked ? 'text' : 'password';
            });
        }

        // Setup save button
        const saveBtn = document.getElementById('saveObsSettings');
        if (saveBtn) {
            saveBtn.addEventListener('click', async function() {
                const password = passwordInput.value;
                
                try {
                    const response = await fetch('/api/user/obs-websocket-password', {
                        method: 'PUT',
                        headers: {
                            'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ password })
                    });

                    if (response.ok) {
                        window.showToast('OBS WebSocket password updated', 'success');
                        modal.hide();
                        passwordInput.value = '';
                    } else {
                        const data = await response.json();
                        window.showToast(data.message || 'Failed to update password', 'error');
                    }
                } catch (error) {
                    window.showToast('Error saving OBS settings', 'error');
                }
            });
        }
    },

    showProfile: async function() {
        const modalElement = document.getElementById('userProfileModal');
        let modal = bootstrap.Modal.getInstance(modalElement);
        if (!modal) {
            modal = new bootstrap.Modal(modalElement);
        }
        modal.show();
        
        // Load TTS settings
        await this.loadUserSettings();
    },

    loadUserSettings: async function() {
        try {
            // Load TTS settings
            const ttsResponse = await fetch('/api/user/tts-settings', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`,
                    'Content-Type': 'application/json'
                }
            });

            if (ttsResponse.ok) {
                const ttsData = await ttsResponse.json();
                
                // Update checkbox
                const ttsCheckbox = document.getElementById('ttsOpenaiEnabled');
                if (ttsCheckbox) {
                    ttsCheckbox.checked = Boolean(ttsData.ttsOpenaiEnabled);
                }
            }
            
            // Load additional channels
            const channelsResponse = await fetch('/api/user/channels', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`,
                    'Content-Type': 'application/json'
                }
            });

            if (channelsResponse.ok) {
                const channelsData = await channelsResponse.json();
                this.renderChannelsList(channelsData.channels || []);
            }
        } catch (error) {
            console.error('Error loading user settings:', error);
            window.showToast('Failed to load user settings', 'error');
        }
    },

    renderChannelsList: function(channels) {
        const channelsList = document.getElementById('channelsList');
        if (!channelsList) return;
        
        if (channels.length === 0) {
            channelsList.innerHTML = '<p class="small text-muted">No additional channels added</p>';
            return;
        }
        
        channelsList.innerHTML = channels.map(channel => `
            <div class="badge bg-purple me-2 mb-2" style="font-size: 0.9rem;">
                ${channel}
                <i class="fas fa-times ms-2" style="cursor: pointer;" data-channel="${channel}"></i>
            </div>
        `).join('');
        
        // Add remove handlers
        channelsList.querySelectorAll('.fa-times').forEach(icon => {
            icon.addEventListener('click', async (e) => {
                const channelToRemove = e.target.dataset.channel;
                await this.removeChannel(channelToRemove);
            });
        });
    },

    removeChannel: async function(channelName) {
        try {
            const channelsResponse = await fetch('/api/user/channels', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!channelsResponse.ok) return;
            
            const channelsData = await channelsResponse.json();
            const updatedChannels = channelsData.channels.filter(ch => ch !== channelName);
            
            const updateResponse = await fetch('/api/user/channels', {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ channels: updatedChannels })
            });
            
            if (updateResponse.ok) {
                this.renderChannelsList(updatedChannels);
                window.showToast(`Removed channel: ${channelName}`, 'success');
            }
        } catch (error) {
            console.error('Error removing channel:', error);
            window.showToast('Failed to remove channel', 'error');
        }
    },

    setupUserSettingsListeners: function() {
        // Add channel button
        const addChannelBtn = document.getElementById('addChannelBtn');
        const newChannelInput = document.getElementById('newChannelInput');
        
        if (addChannelBtn && newChannelInput) {
            const addChannel = async () => {
                const channelName = newChannelInput.value.trim().toLowerCase();
                if (!channelName) return;
                
                if (!/^[a-z0-9_]+$/.test(channelName)) {
                    window.showToast('Channel name can only contain letters, numbers, and underscores', 'error');
                    return;
                }
                
                try {
                    const channelsResponse = await fetch('/api/user/channels', {
                        headers: {
                            'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    if (!channelsResponse.ok) throw new Error('Failed to get channels');
                    
                    const channelsData = await channelsResponse.json();
                    const updatedChannels = [...channelsData.channels, channelName];
                    
                    const updateResponse = await fetch('/api/user/channels', {
                        method: 'PUT',
                        headers: {
                            'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ channels: updatedChannels })
                    });
                    
                    if (updateResponse.ok) {
                        const result = await updateResponse.json();
                        this.renderChannelsList(result.channels);
                        newChannelInput.value = '';
                        window.showToast(`Added channel: ${channelName}`, 'success');
                    }
                } catch (error) {
                    console.error('Error adding channel:', error);
                    window.showToast('Failed to add channel', 'error');
                }
            };
            
            addChannelBtn.addEventListener('click', addChannel);
            newChannelInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') addChannel();
            });
        }
        
        // Save user settings button
        const saveUserSettings = document.getElementById('saveUserSettings');
        if (saveUserSettings) {
            saveUserSettings.addEventListener('click', async () => {
                const ttsOpenaiEnabled = document.getElementById('ttsOpenaiEnabled').checked;
                
                try {
                    // Save TTS settings
                    const ttsResponse = await fetch('/api/user/tts-settings', {
                        method: 'PUT',
                        headers: {
                            'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            ttsOpenaiEnabled: ttsOpenaiEnabled
                        })
                    });

                    if (!ttsResponse.ok) {
                        throw new Error(`Failed to save TTS settings: ${ttsResponse.status}`);
                    }

                    window.showToast('User settings saved successfully', 'success');
                    
                    const modal = bootstrap.Modal.getInstance(document.getElementById('userProfileModal'));
                    if (modal) modal.hide();
                } catch (error) {
                    console.error('Error saving user settings:', error);
                    window.showToast('Failed to save user settings', 'error');
                }
            });
        }
        
        // Delete account button
        const deleteAccountBtn = document.getElementById('deleteAccountBtn');
        if (deleteAccountBtn && typeof window.handleDeleteAccount === 'function') {
            deleteAccountBtn.addEventListener('click', window.handleDeleteAccount);
        }
    },

    // API Token Management
    showApiTokenModal: async function() {
        const modal = new bootstrap.Modal(document.getElementById('apiTokenModal'));
        await this.loadAllTokens();
        modal.show();

        // Set up mobile token event listeners
        const generateMobileBtn = document.getElementById('generateMobileTokenBtn');
        const revokeMobileBtn = document.getElementById('revokeMobileTokenBtn');

        if (generateMobileBtn) {
            generateMobileBtn.replaceWith(generateMobileBtn.cloneNode(true));
            const newGenerateMobileBtn = document.getElementById('generateMobileTokenBtn');
            newGenerateMobileBtn.addEventListener('click', () => this.generateMobileToken());
        }

        if (revokeMobileBtn) {
            revokeMobileBtn.replaceWith(revokeMobileBtn.cloneNode(true));
            const newRevokeMobileBtn = document.getElementById('revokeMobileTokenBtn');
            newRevokeMobileBtn.addEventListener('click', () => this.revokeMobileToken());
        }

        // Set up overlay token event listeners
        const generateOverlayBtn = document.getElementById('generateOverlayTokenBtn');
        const revokeOverlayBtn = document.getElementById('revokeOverlayTokenBtn');

        if (generateOverlayBtn) {
            generateOverlayBtn.replaceWith(generateOverlayBtn.cloneNode(true));
            const newGenerateOverlayBtn = document.getElementById('generateOverlayTokenBtn');
            newGenerateOverlayBtn.addEventListener('click', () => this.generateOverlayToken());
        }

        if (revokeOverlayBtn) {
            revokeOverlayBtn.replaceWith(revokeOverlayBtn.cloneNode(true));
            const newRevokeOverlayBtn = document.getElementById('revokeOverlayTokenBtn');
            newRevokeOverlayBtn.addEventListener('click', () => this.revokeOverlayToken());
        }
    },

    loadAllTokens: async function() {
        try {
            // Load mobile token
            const mobileResponse = await fetch('/api/token/mobile', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (mobileResponse.ok) {
                const mobileData = await mobileResponse.json();
                if (mobileData.token) {
                    this.displayMobileToken(mobileData);
                } else {
                    this.showNoMobileToken();
                }
            } else {
                this.showNoMobileToken();
            }

            // Load overlay token
            const overlayResponse = await fetch('/api/token/overlay', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (overlayResponse.ok) {
                const overlayData = await overlayResponse.json();
                if (overlayData.token) {
                    this.displayOverlayToken(overlayData);
                } else {
                    this.showNoOverlayToken();
                }
            } else {
                this.showNoOverlayToken();
            }
        } catch (error) {
            console.error('Error loading tokens:', error);
            this.showNoMobileToken();
            this.showNoOverlayToken();
        }
    },

    generateMobileToken: async function() {
        try {
            const response = await fetch('/api/token/mobile', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.displayMobileToken(data);
                showToast('Mobile API Token generated successfully!', 'success');
            } else {
                const error = await response.json();
                showToast(error.error || 'Failed to generate mobile token', 'error');
            }
        } catch (error) {
            console.error('Error generating mobile token:', error);
            showToast('Failed to generate mobile token', 'error');
        }
    },

    revokeMobileToken: async function() {
        if (!confirm('Are you sure you want to revoke this token? Your mobile app will stop working until you generate a new one.')) {
            return;
        }

        try {
            const response = await fetch('/api/token/mobile', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                this.showNoMobileToken();
                showToast('Mobile API Token revoked successfully', 'success');
            } else {
                const error = await response.json();
                showToast(error.error || 'Failed to revoke mobile token', 'error');
            }
        } catch (error) {
            console.error('Error revoking mobile token:', error);
            showToast('Failed to revoke mobile token', 'error');
        }
    },

    generateOverlayToken: async function() {
        try {
            const response = await fetch('/api/token/overlay', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.displayOverlayToken(data);
                showToast('Overlay Token generated successfully!', 'success');
            } else {
                const error = await response.json();
                showToast(error.error || 'Failed to generate overlay token', 'error');
            }
        } catch (error) {
            console.error('Error generating overlay token:', error);
            showToast('Failed to generate overlay token', 'error');
        }
    },

    revokeOverlayToken: async function() {
        if (!confirm('Are you sure you want to revoke this token? Your OBS overlays will stop working until you generate a new one.')) {
            return;
        }

        try {
            const response = await fetch('/api/token/overlay', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                this.showNoOverlayToken();
                showToast('Overlay Token revoked successfully', 'success');
            } else {
                const error = await response.json();
                showToast(error.error || 'Failed to revoke overlay token', 'error');
            }
        } catch (error) {
            console.error('Error revoking overlay token:', error);
            showToast('Failed to revoke overlay token', 'error');
        }
    },

    displayMobileToken: function(data) {
        document.getElementById('mobileTokenDisplay').style.display = 'block';
        document.getElementById('noMobileTokenMessage').style.display = 'none';
        document.getElementById('mobileApiTokenValue').value = data.token;

        // Format dates
        if (data.createdAt) {
            document.getElementById('mobileTokenGeneratedAt').textContent = new Date(data.createdAt).toLocaleString();
        }
        if (data.expiresAt) {
            document.getElementById('mobileTokenExpiresAt').textContent = new Date(data.expiresAt).toLocaleString();
        }
    },

    showNoMobileToken: function() {
        document.getElementById('mobileTokenDisplay').style.display = 'none';
        document.getElementById('noMobileTokenMessage').style.display = 'block';
    },

    displayOverlayToken: function(data) {
        document.getElementById('overlayTokenDisplay').style.display = 'block';
        document.getElementById('noOverlayTokenMessage').style.display = 'none';
        document.getElementById('overlayTokenValue').value = data.token;

        // Format dates
        if (data.createdAt) {
            document.getElementById('overlayTokenGeneratedAt').textContent = new Date(data.createdAt).toLocaleString();
        }
        if (data.lastUsedAt) {
            document.getElementById('overlayTokenLastUsed').textContent = new Date(data.lastUsedAt).toLocaleString();
        } else {
            document.getElementById('overlayTokenLastUsed').textContent = 'Never';
        }

        // Update overlay URLs with token
        this.updateOverlayUrls(data.token);
    },

    showNoOverlayToken: function() {
        document.getElementById('overlayTokenDisplay').style.display = 'none';
        document.getElementById('noOverlayTokenMessage').style.display = 'block';

        // Clear overlay URLs (remove token)
        this.updateOverlayUrls(null);
    },

    loadOverlayTokenOnInit: async function() {
        try {
            const response = await fetch('/api/token/overlay', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.token) {
                    this.updateOverlayUrls(data.token);
                }
            }
        } catch (error) {
            console.error('Error loading overlay token on init:', error);
            // Don't show error to user, just skip URL updates
        }
    },

    updateOverlayUrls: function(token) {
        const baseUrl = window.location.origin;
        const tokenParam = token ? `?token=${token}` : '';

        // Update dashboard overlay URL inputs
        const mapOverlayUrl = document.getElementById('map-overlay-url');
        const telemetryOverlayUrl = document.getElementById('telemetry-overlay-url');
        const pictureOverlayUrl = document.getElementById('picture-overlay-url');
        const streamStatusOverlayUrl = document.getElementById('stream-status-overlay-url');
        const nowPlayingOverlayUrl = document.getElementById('now-playing-overlay-url');

        if (mapOverlayUrl) {
            mapOverlayUrl.value = `${baseUrl}/map-overlay${tokenParam}`;
        }
        if (telemetryOverlayUrl) {
            telemetryOverlayUrl.value = `${baseUrl}/telemetry-overlay${tokenParam}`;
        }
        if (pictureOverlayUrl) {
            pictureOverlayUrl.value = `${baseUrl}/picture-overlay${tokenParam}`;
        }
        if (streamStatusOverlayUrl) {
            streamStatusOverlayUrl.value = `${baseUrl}/stream-status-overlay${tokenParam}`;
        }
        if (nowPlayingOverlayUrl) {
            nowPlayingOverlayUrl.value = `${baseUrl}/now-playing-overlay${tokenParam}`;
        }

        // Update navigation menu overlay links
        const navMapOverlay = document.getElementById('nav-map-overlay');
        const navTelemetryOverlay = document.getElementById('nav-telemetry-overlay');
        const navPictureOverlay = document.getElementById('nav-picture-overlay');
        const navStreamStatusOverlay = document.getElementById('nav-stream-status-overlay');
        const navNowPlayingOverlay = document.getElementById('nav-now-playing-overlay');
        const navMusicPlayer = document.getElementById('nav-music-player');

        if (navMapOverlay) {
            navMapOverlay.href = `/map-overlay${tokenParam}`;
        }
        if (navTelemetryOverlay) {
            navTelemetryOverlay.href = `/telemetry-overlay${tokenParam}`;
        }
        if (navPictureOverlay) {
            navPictureOverlay.href = `/picture-overlay${tokenParam}`;
        }
        if (navStreamStatusOverlay) {
            navStreamStatusOverlay.href = `/stream-status-overlay${tokenParam}`;
        }
        if (navNowPlayingOverlay) {
            navNowPlayingOverlay.href = `/now-playing-overlay${tokenParam}`;
        }
        if (navMusicPlayer) {
            navMusicPlayer.href = `/music-overlay${tokenParam}`;
        }
    },

    // Deprecated old methods - kept for backwards compatibility
    loadApiToken: async function() {
        await this.loadAllTokens();
    },

    generateApiToken: async function() {
        await this.generateMobileToken();
    },

    revokeApiToken: async function() {
        await this.revokeMobileToken();
    },

    displayToken: function(data) {
        this.displayMobileToken(data);
    },

    showNoToken: function() {
        this.showNoMobileToken();
    }
};

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    if (window.dashboard) {
        window.dashboard.init();
        // Initialize video player
        window.dashboard.videoPlayer.init();
    }
});
