// PulseRelay Client-Side JavaScript - Dark Theme Enhanced

// Global navigation functions for layout
function showDestinations() {
    showModal('destinations', 'RTMP Destinations', loadDestinationsModal);
}

function showStats() {
    showModal('stats', 'Statistics', loadStatsModal);
}

function showProfile() {
    showModal('profile', 'User Profile', loadProfileModal);
}

// Modal system for navigation
function showModal(id, title, contentLoader) {
    // Remove existing modal if present
    const existingModal = document.getElementById(`modal-${id}`);
    if (existingModal) {
        existingModal.remove();
    }
    
    // Create modal structure
    const modal = document.createElement('div');
    modal.id = `modal-${id}`;
    modal.className = 'modal fade';
    modal.tabIndex = -1;
    modal.innerHTML = `
        <div class="modal-dialog modal-lg modal-dialog-scrollable">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">${title}</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <div class="text-center py-4">
                        <div class="spinner-border text-primary" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Check if Bootstrap is available
    if (typeof bootstrap === 'undefined') {
        return;
    }
    
    // Initialize Bootstrap modal
    const bsModal = new bootstrap.Modal(modal);
    
    // Load content
    try {
        contentLoader(modal.querySelector('.modal-body'), modal.querySelector('.modal-footer'));
    } catch (error) {
        // Silent error handling
    }
    
    // Show modal
    bsModal.show();
    
    // Clean up when modal is hidden
    modal.addEventListener('hidden.bs.modal', () => {
        modal.remove();
    });
}

// Expose functions to global window object for dashboard integration
window.showModal = showModal;
window.showDestinations = showDestinations;
window.showStats = showStats;
window.showProfile = showProfile;

// Initialize dark theme and floating animations
document.addEventListener('DOMContentLoaded', function() {
    // Initialize floating elements animation
    initFloatingElements();
    
    // Initialize theme
    initDarkTheme();
    
    // Initialize smooth scrolling
    initSmoothScrolling();
    
    // Initialize tooltips
    initTooltips();
});

// Dark theme initialization
function initDarkTheme() {
    // Add theme toggle functionality
    const themeToggle = document.createElement('button');
    themeToggle.className = 'btn btn-outline-secondary btn-sm theme-toggle';
    themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
    themeToggle.title = 'Toggle theme';
    
    // Note: Currently forced dark theme, but prepared for future theme switching
    document.documentElement.setAttribute('data-bs-theme', 'dark');
}

// Initialize floating background elements
function initFloatingElements() {
    const floatingContainer = document.querySelector('.floating-elements');
    if (!floatingContainer) return;
    
    // Add more dynamic floating elements
    for (let i = 0; i < 15; i++) {
        const element = document.createElement('div');
        element.className = 'floating-element';
        element.style.left = Math.random() * 100 + '%';
        element.style.animationDelay = Math.random() * 20 + 's';
        element.style.animationDuration = (15 + Math.random() * 10) + 's';
        
        // Random colors from Twitch palette
        const colors = ['#9146ff', '#e91e63', '#1e90ff', '#00f593'];
        element.style.background = colors[Math.floor(Math.random() * colors.length)];
        
        floatingContainer.appendChild(element);
    }
}

// Initialize smooth scrolling
function initSmoothScrolling() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const href = this.getAttribute('href');
            // Skip empty or just '#' hrefs
            if (href === '#' || !href || href.length <= 1) return;
            
            const target = document.querySelector(href);
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
}

// Initialize tooltips
function initTooltips() {
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });
}

// Global utilities
const Utils = {
    // Copy text to clipboard with enhanced feedback
    copyToClipboard: function(text, successMessage = 'Copied to clipboard!') {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).then(() => {
                window.PulseToast.success(successMessage);
            });
        } else {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            try {
                document.execCommand('copy');
                window.PulseToast.success(successMessage);
                return Promise.resolve();
            } catch (err) {
                window.PulseToast.error('Failed to copy to clipboard');
                return Promise.reject(err);
            } finally {
                document.body.removeChild(textArea);
            }
        }
    },

    // Format duration in seconds to HH:MM:SS
    formatDuration: function(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    },

    // Format bytes to human readable
    formatBytes: function(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    },

    // Format number with commas
    formatNumber: function(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },

    // Debounce function
    debounce: function(func, wait, immediate) {
        let timeout;
        return function executedFunction() {
            const context = this;
            const args = arguments;
            
            const later = function() {
                timeout = null;
                if (!immediate) func.apply(context, args);
            };
            
            const callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            
            if (callNow) func.apply(context, args);
        };
    },

    // Throttle function
    throttle: function(func, limit) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
};

// API client
const API = {
    baseURL: '/api',
    
    request: function(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        };
        
        return fetch(url, config)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .catch(error => {
                // Silent error handling - errors logged server-side
                throw error;
            });
    },

    get: function(endpoint, options = {}) {
        return this.request(endpoint, { method: 'GET', ...options });
    },

    post: function(endpoint, data, options = {}) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data),
            ...options
        });
    },

    put: function(endpoint, data, options = {}) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data),
            ...options
        });
    },

    delete: function(endpoint, options = {}) {
        return this.request(endpoint, { method: 'DELETE', ...options });
    }
};

// Real-time connection management
const RealTime = {
    eventSource: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    reconnectDelay: 1000,
    
    connect: function() {
        if (this.eventSource) {
            this.eventSource.close();
        }
        
        this.eventSource = new EventSource('/api/events');
        
        this.eventSource.onopen = () => {
            this.reconnectAttempts = 0;
        };
        
        this.eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (error) {
                // Silent error handling
            }
        };
        
        this.eventSource.onerror = (error) => {
            // Silent error handling
            this.eventSource.close();
            this.attemptReconnect();
        };
    },
    
    handleMessage: function(data) {
        // Dispatch custom events based on message type
        const event = new CustomEvent('realtime-message', { detail: data });
        document.dispatchEvent(event);
        
        // Handle specific message types
        switch (data.type) {
            case 'stream-status':
                this.handleStreamStatus(data.payload);
                break;
            case 'stats-update':
                this.handleStatsUpdate(data.payload);
                break;
            case 'notification':
                this.handleNotification(data.payload);
                break;
        }
    },
    
    handleStreamStatus: function(status) {
        const event = new CustomEvent('stream-status-update', { detail: status });
        document.dispatchEvent(event);
    },
    
    handleStatsUpdate: function(stats) {
        const event = new CustomEvent('stats-update', { detail: stats });
        document.dispatchEvent(event);
    },
    
    handleNotification: function(notification) {
        window.PulseToast.show(notification.message, notification.type);
    },
    
    attemptReconnect: function() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            
            setTimeout(() => {
                this.connect();
            }, delay);
        } else {
            // Max reconnection attempts reached - silent handling
            window.PulseToast.error('Real-time connection lost. Please refresh the page.');
        }
    },
    
    disconnect: function() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
    }
};

// Form validation utilities
const Validation = {
    rules: {
        required: (value) => value && value.trim() !== '',
        email: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
        url: (value) => {
            try {
                new URL(value);
                return true;
            } catch {
                return false;
            }
        },
        number: (value) => !isNaN(value) && !isNaN(parseFloat(value)),
        minLength: (min) => (value) => value && value.length >= min,
        maxLength: (max) => (value) => value && value.length <= max,
        min: (min) => (value) => parseFloat(value) >= min,
        max: (max) => (value) => parseFloat(value) <= max
    },
    
    validate: function(form) {
        const errors = {};
        const elements = form.querySelectorAll('[data-validate]');
        
        elements.forEach(element => {
            const rules = element.getAttribute('data-validate').split('|');
            const fieldName = element.name || element.id;
            const value = element.value;
            
            for (const rule of rules) {
                const [ruleName, ruleValue] = rule.split(':');
                
                if (this.rules[ruleName]) {
                    const validator = ruleValue ? this.rules[ruleName](ruleValue) : this.rules[ruleName];
                    
                    if (!validator(value)) {
                        errors[fieldName] = this.getErrorMessage(ruleName, ruleValue);
                        break;
                    }
                }
            }
        });
        
        return errors;
    },
    
    getErrorMessage: function(rule, value) {
        const messages = {
            required: 'This field is required',
            email: 'Please enter a valid email address',
            url: 'Please enter a valid URL',
            number: 'Please enter a valid number',
            minLength: `Must be at least ${value} characters`,
            maxLength: `Must be no more than ${value} characters`,
            min: `Must be at least ${value}`,
            max: `Must be no more than ${value}`
        };
        
        return messages[rule] || 'Invalid value';
    },
    
    showErrors: function(form, errors) {
        // Clear previous errors
        form.querySelectorAll('.invalid-feedback').forEach(el => el.remove());
        form.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
        
        // Show new errors
        Object.keys(errors).forEach(fieldName => {
            const field = form.querySelector(`[name="${fieldName}"], #${fieldName}`);
            if (field) {
                field.classList.add('is-invalid');
                
                const errorDiv = document.createElement('div');
                errorDiv.className = 'invalid-feedback';
                errorDiv.textContent = errors[fieldName];
                
                field.parentNode.appendChild(errorDiv);
            }
        });
    }
};

// Modal content loaders
function loadDestinationsModal(bodyElement, footerElement) {
    fetch('/api/rtmp/destinations')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            const destinations = data.destinations || [];
            
            bodyElement.innerHTML = `
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <h6 class="mb-0">RTMP Destinations</h6>
                    <button type="button" class="btn btn-primary btn-sm" data-action="add-destination">
                        <i class="fas fa-plus me-1"></i> Add Destination
                    </button>
                </div>
                
                ${destinations.length === 0 ? 
                    '<div class="text-center text-muted py-4"><i class="fas fa-share-alt mb-2"></i><div>No destinations configured</div></div>' :
                    `<div class="list-group">
                        ${destinations.map(dest => `
                            <div class="list-group-item d-flex justify-content-between align-items-center">
                                <div>
                                    <h6 class="mb-1">${escapeHtml(dest.name)}</h6>
                                    <small class="text-muted">${escapeHtml(dest.rtmp_url)}</small>
                                    <span class="badge bg-${dest.is_active ? 'success' : 'secondary'} ms-2">
                                        ${dest.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                </div>
                                <div class="btn-group" role="group">
                                    <button type="button" class="btn btn-outline-secondary btn-sm" 
                                            data-action="toggle-destination" data-dest-id="${dest.id}" data-dest-active="${!dest.is_active}">
                                        <i class="fas fa-${dest.is_active ? 'pause' : 'play'}"></i>
                                    </button>
                                    <button type="button" class="btn btn-outline-danger btn-sm" 
                                            data-action="delete-destination" data-dest-id="${dest.id}">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>`
                }
            `;
            
            // Add event listeners for the destination actions
            setupDestinationEventListeners(bodyElement);
            
            // Update footer with add button
            footerElement.innerHTML = `
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                <button type="button" class="btn btn-primary" data-action="add-destination">
                    <i class="fas fa-plus me-1"></i> Add Destination
                </button>
            `;
            
            // Set up footer event listeners
            setupDestinationEventListeners(footerElement);
        })
        .catch(error => {
            // Silent error handling - show user-friendly message
            bodyElement.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    Failed to load destinations
                </div>
            `;
        });
}

function loadStatsModal(bodyElement, footerElement) {
    Promise.all([
        fetch('/api/stats/overview').then(r => r.json()),
        fetch('/api/stats/activity/detailed?limit=100').then(r => r.json())
    ])
    .then(([overviewData, activityData]) => {
        const overview = overviewData.overview || {};
        const activity = activityData.events || [];
        
        // Process activity events outside of template string to be CSP-compliant
        let activityHtml = '';
        if (activity.length === 0) {
            activityHtml = `
                <div class="text-center py-3 text-muted">
                    <i class="fas fa-clock-rotate-left mb-2 fs-4"></i>
                    <div>No recent activity</div>
                </div>
            `;
        } else {
            activityHtml = '<div class="activity-feed">';
            activity.forEach(event => {
                let iconClass, eventText, iconColor;
                
                // Use event.event_type instead of event.action with modern icons
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
                    case 'viewer_disconnected':
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
                    case 'rtmp_error':
                        iconClass = 'fas fa-exclamation-triangle';
                        iconColor = 'text-danger';
                        eventText = 'RTMP error';
                        break;
                    default:
                        iconClass = 'fas fa-circle-dot';
                        iconColor = 'text-muted';
                        eventText = event.event_type ? event.event_type.replace('_', ' ') : 'Unknown event';
                }
                
                // Enhanced time formatting with timezone awareness
                let timeAgoText = 'Unknown time';
                let fullDateTime = '';
                if (event.timestamp) {
                    let date;
                    
                    // Enhanced timestamp parsing for UTC format
                    if (event.timestamp.includes('T') && event.timestamp.endsWith('Z')) {
                        // ISO 8601 UTC format from new server responses
                        date = new Date(event.timestamp);
                    } else if (event.timestamp.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
                        // SQLite datetime format from legacy responses - treat as UTC
                        date = new Date(event.timestamp + 'Z');
                    } else {
                        // Fallback to standard parsing
                        date = new Date(event.timestamp);
                    }
                    
                    if (!isNaN(date.getTime())) {
                        timeAgoText = formatStatsTimeAgo(date);
                        fullDateTime = formatStatsLocalDateTime(date);
                    }
                }
                
                activityHtml += `
                    <div class="activity-item d-flex justify-content-between align-items-center py-2 px-3 mb-2 rounded border border-opacity-25 shadow-sm hover-lift">
                        <div class="d-flex align-items-center">
                            <i class="${iconClass} ${iconColor} me-2"></i>
                            <span class="fw-medium">${eventText}</span>
                        </div>
                        <small class="text-muted" title="${fullDateTime}">${timeAgoText}</small>
                    </div>
                `;
            });
            activityHtml += '</div>';
        }
        
        bodyElement.innerHTML = `
            <div class="row mb-4">
                <div class="col-md-6">
                    <div class="card bg-primary text-white">
                        <div class="card-body text-center">
                            <h5 class="card-title">Total Stream Time</h5>
                            <h3>${formatDuration(overview.totalStreamTime || 0)}</h3>
                        </div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="card bg-success text-white">
                        <div class="card-body text-center">
                            <h5 class="card-title">This Month</h5>
                            <h3>${overview.monthlyStats ? formatDuration(overview.monthlyStats.streamTime) : '0m'}</h3>
                            <small>${overview.monthlyStats ? overview.monthlyStats.sessions : 0} sessions</small>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="row mb-4">
                <div class="col-md-12">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h6 class="mb-0">Complete Activity Log</h6>
                        <small class="text-muted">${activity.length} total events</small>
                    </div>
                    <div style="max-height: 400px; overflow-y: auto;" class="border rounded p-2">
                        ${activityHtml}
                    </div>
                </div>
            </div>
        `;
    })
    .catch(error => {
        // Silent error handling
        bodyElement.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-triangle me-2"></i>
                Failed to load statistics
            </div>
        `;
    });
}

function loadProfileModal(bodyElement, footerElement) {
    // Get user info from the page context or fetch from API
    const userInfo = window.currentUser || {};
    
    bodyElement.innerHTML = `
        <div class="row mb-4">
            <div class="col-md-4 text-center">
                ${userInfo.profile_image_url ? 
                    `<img src="${escapeHtml(userInfo.profile_image_url)}" alt="Profile" class="rounded-circle mb-3" style="width: 120px; height: 120px; border: 3px solid #9146FF;">` :
                    '<div class="bg-secondary rounded-circle mx-auto mb-3 d-flex align-items-center justify-content-center" style="width: 120px; height: 120px; border: 3px solid #9146FF;"><i class="fas fa-user fa-3x text-white"></i></div>'
                }
                <h5 class="text-purple">${escapeHtml(userInfo.display_name || userInfo.username || 'User')}</h5>
                <p class="text-muted">@${escapeHtml(userInfo.username || 'username')}</p>
            </div>
            <div class="col-md-8">
                <h6 class="mb-3"><i class="fas fa-info-circle me-2 text-purple"></i>Account Information</h6>
                <div class="table-responsive">
                    <table class="table table-sm table-dark">
                        <tr>
                            <td style="width: 40%;"><i class="fas fa-id-badge me-2 text-muted"></i><strong>User ID:</strong></td>
                            <td>${escapeHtml(String(userInfo.id || 'N/A'))}</td>
                        </tr>
                        <tr>
                            <td><i class="fab fa-twitch me-2 text-purple"></i><strong>Twitch ID:</strong></td>
                            <td>${escapeHtml(userInfo.twitch_id || 'N/A')}</td>
                        </tr>
                        <tr>
                            <td><i class="fas fa-envelope me-2 text-muted"></i><strong>Email:</strong></td>
                            <td>${escapeHtml(userInfo.email || 'N/A')}</td>
                        </tr>
                        <tr>
                            <td><i class="fas fa-user-plus me-2 text-muted"></i><strong>Member Since:</strong></td>
                            <td>${userInfo.created_at ? (() => {
                                let date;
                                if (userInfo.created_at.includes('T') && userInfo.created_at.endsWith('Z')) {
                                    date = new Date(userInfo.created_at);
                                } else if (userInfo.created_at.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
                                    date = new Date(userInfo.created_at + 'Z');
                                } else {
                                    date = new Date(userInfo.created_at);
                                }
                                return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                            })() : 'N/A'}</td>
                        </tr>
                        <tr>
                            <td><i class="fas fa-clock me-2 text-muted"></i><strong>Last Active:</strong></td>
                            <td>${userInfo.updated_at ? (() => {
                                let date;
                                if (userInfo.updated_at.includes('T') && userInfo.updated_at.endsWith('Z')) {
                                    date = new Date(userInfo.updated_at);
                                } else if (userInfo.updated_at.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
                                    date = new Date(userInfo.updated_at + 'Z');
                                } else {
                                    date = new Date(userInfo.updated_at);
                                }
                                return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                            })() : 'N/A'}</td>
                        </tr>
                    </table>
                </div>
            </div>
        </div>
        
        <!-- Danger Zone -->
        <div class="card bg-danger bg-opacity-10 border-danger">
            <div class="card-body">
                <h6 class="card-title text-danger mb-3">
                    <i class="fas fa-exclamation-triangle me-2"></i>Danger Zone
                </h6>
                <p class="card-text text-muted mb-3">
                    Deleting your account is permanent and cannot be undone. This will:
                </p>
                <ul class="text-muted small mb-3">
                    <li>Remove all your stream keys and RTMP destinations</li>
                    <li>Delete all location data and tracking history</li>
                    <li>Remove all uploaded pictures and media</li>
                    <li>Revoke all API tokens (mobile and overlay)</li>
                    <li>Clear all stream statistics and session data</li>
                </ul>
                <button type="button" class="btn btn-danger btn-sm" id="deleteAccountBtn">
                    <i class="fas fa-trash-alt me-2"></i>Delete My Account
                </button>
            </div>
        </div>
    `;
    
    // Add delete account handler
    const deleteBtn = bodyElement.querySelector('#deleteAccountBtn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', handleDeleteAccount);
    }
}

async function handleDeleteAccount() {
    const userInfo = window.currentUser || {};
    const username = userInfo.username || 'your account';
    
    // Create custom confirmation modal
    const confirmModal = document.createElement('div');
    confirmModal.className = 'modal fade';
    confirmModal.innerHTML = `
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content bg-dark border-danger">
                <div class="modal-header bg-danger bg-opacity-10">
                    <h5 class="modal-title text-danger">
                        <i class="fas fa-exclamation-triangle me-2"></i>Confirm Account Deletion
                    </h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <div class="alert alert-danger mb-3">
                        <strong>⚠️ WARNING:</strong> This action is PERMANENT and IRREVERSIBLE!
                    </div>
                    <p>You are about to delete <strong>"${escapeHtml(username)}"</strong> and all associated data:</p>
                    <ul class="text-muted small mb-3">
                        <li>Stream keys and destinations</li>
                        <li>Location data and history</li>
                        <li>Pictures and media</li>
                        <li>API tokens</li>
                        <li>Statistics and sessions</li>
                    </ul>
                    <div class="mb-3">
                        <label for="deleteConfirmInput" class="form-label">
                            Type <strong class="text-danger">DELETE</strong> in capital letters to confirm:
                        </label>
                        <input type="text" class="form-control" id="deleteConfirmInput" placeholder="DELETE" autocomplete="off">
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                    <button type="button" class="btn btn-danger" id="confirmDeleteBtn" disabled>
                        <i class="fas fa-trash-alt me-2"></i>Delete Account
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(confirmModal);
    const bsModal = new bootstrap.Modal(confirmModal);
    
    // Enable/disable delete button based on input
    const input = confirmModal.querySelector('#deleteConfirmInput');
    const confirmBtn = confirmModal.querySelector('#confirmDeleteBtn');
    
    input.addEventListener('input', () => {
        confirmBtn.disabled = input.value !== 'DELETE';
    });
    
    // Handle enter key in input
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && input.value === 'DELETE') {
            confirmBtn.click();
        }
    });
    
    // Handle delete confirmation
    confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Deleting...';
        
        try {
            const response = await fetch('/auth/account', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include'
            });
            
            if (response.ok) {
                bsModal.hide();
                showToast('Account successfully deleted. Redirecting...', 'success');
                setTimeout(() => {
                    window.location.href = '/';
                }, 2000);
            } else {
                const data = await response.json();
                bsModal.hide();
                showToast(data.error || data.message || 'Failed to delete account. Please try again.', 'danger');
            }
        } catch (error) {
            bsModal.hide();
            showToast('Error deleting account. Please try again.', 'danger');
        }
    });
    
    // Clean up modal when hidden
    confirmModal.addEventListener('hidden.bs.modal', () => {
        confirmModal.remove();
    });
    
    // Show modal and focus input
    bsModal.show();
    confirmModal.addEventListener('shown.bs.modal', () => {
        input.focus();
    });
}

// Expose modal loader functions to global window object
window.loadDestinationsModal = loadDestinationsModal;
window.loadStatsModal = loadStatsModal;
window.loadProfileModal = loadProfileModal;

// Stats modal timezone helper functions
function formatStatsTimeAgo(date) {
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
    return formatStatsLocalDateTime(date);
}

function formatStatsLocalDateTime(date) {
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
}

// Expose stats timezone helper functions
window.formatStatsTimeAgo = formatStatsTimeAgo;
window.formatStatsLocalDateTime = formatStatsLocalDateTime;

// Expose destination management functions to global window object
window.addDestination = addDestination;
window.deleteDestination = deleteDestination;
window.toggleDestination = toggleDestination;

// Expose utility functions to global window object
window.escapeHtml = escapeHtml;
window.formatDuration = formatDuration;

// Expose dashboard utility functions to global window object (moved up for earlier availability)
window.generateNewKey = generateNewKey;
window.toggleKeyVisibility = toggleKeyVisibility;
window.copyToClipboard = copyToClipboard;
window.copyTextToClipboard = copyTextToClipboard;

// Utility functions for modals
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDuration(seconds) {
    if (!seconds || seconds === 0) return '0m';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else {
        return `${minutes}m`;
    }
}

// Destination management functions
function setupDestinationEventListeners(container) {
    // Use event delegation to handle button clicks
    container.addEventListener('click', function(e) {
        const button = e.target.closest('[data-action]');
        if (!button) return;
        
        const action = button.getAttribute('data-action');
        
        switch (action) {
            case 'add-destination':
                addDestination();
                break;
            case 'toggle-destination':
                const destId = button.getAttribute('data-dest-id');
                const destActive = button.getAttribute('data-dest-active') === 'true';
                toggleDestination(destId, destActive);
                break;
            case 'delete-destination':
                const deleteDestId = button.getAttribute('data-dest-id');
                deleteDestination(deleteDestId);
                break;
        }
    });
}

function addDestination() {
    // Create a modal for adding new destination
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.innerHTML = `
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Add RTMP Destination</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <form id="add-destination-form">
                        <div class="mb-3">
                            <label for="dest-name" class="form-label">Name</label>
                            <input type="text" class="form-control" id="dest-name" required>
                        </div>
                        <div class="mb-3">
                            <label for="dest-url" class="form-label">RTMP URL</label>
                            <input type="url" class="form-control" id="dest-url" placeholder="rtmp://example.com/live" required>
                        </div>
                        <div class="mb-3">
                            <label for="dest-key" class="form-label">Stream Key</label>
                            <input type="text" class="form-control" id="dest-key" required>
                        </div>
                        <div class="form-check">
                            <input type="checkbox" class="form-check-input" id="dest-active" checked>
                            <label class="form-check-label" for="dest-active">Active</label>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                    <button type="button" class="btn btn-primary" id="save-destination-btn">Save</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
    
    // Handle save button
    modal.querySelector('#save-destination-btn').addEventListener('click', function() {
        const formData = {
            name: modal.querySelector('#dest-name').value,
            rtmp_url: modal.querySelector('#dest-url').value,
            stream_key: modal.querySelector('#dest-key').value,
            is_active: modal.querySelector('#dest-active').checked
        };
        
        API.post('/rtmp/destinations', formData)
            .then(data => {
                if (data.success || data.message) {
                    window.PulseToast.success(data.message || 'Destination added successfully');
                    bsModal.hide();
                    // Refresh destinations modal if open
                    const destModal = document.querySelector('#modal-destinations');
                    if (destModal) {
                        loadDestinationsModal(destModal.querySelector('.modal-body'), destModal.querySelector('.modal-footer'));
                    }
                } else {
                    window.PulseToast.error('Failed to add destination');
                }
            })
            .catch(error => {
                window.PulseToast.error(error.message || 'Failed to add destination');
            });
    });
    
    // Clean up when modal is hidden
    modal.addEventListener('hidden.bs.modal', () => {
        modal.remove();
    });
}

function toggleDestination(id, isActive) {
    if (!id) return;
    
    const action = isActive ? 'activate' : 'deactivate';
    
    if (confirm(`Are you sure you want to ${action} this destination?`)) {
        API.put(`/rtmp/destinations/${id}`, { is_active: isActive })
            .then(data => {
                if (data.success || data.message) {
                    window.PulseToast.success(data.message || `Destination ${action}d successfully`);
                    // Refresh destinations modal if open
                    const destModal = document.querySelector('#modal-destinations');
                    if (destModal) {
                        loadDestinationsModal(destModal.querySelector('.modal-body'), destModal.querySelector('.modal-footer'));
                    }
                } else {
                    window.PulseToast.error(`Failed to ${action} destination`);
                }
            })
            .catch(error => {
                window.PulseToast.error(error.message || `Failed to ${action} destination`);
            });
    }
}

function deleteDestination(id) {
    if (!id) return;
    
    if (confirm('Are you sure you want to delete this destination? This action cannot be undone.')) {
        API.delete(`/rtmp/destinations/${id}`)
            .then(data => {
                if (data.success || data.message) {
                    window.PulseToast.success(data.message || 'Destination deleted successfully');
                    // Refresh destinations modal if open
                    const destModal = document.querySelector('#modal-destinations');
                    if (destModal) {
                        loadDestinationsModal(destModal.querySelector('.modal-body'), destModal.querySelector('.modal-footer'));
                    }
                } else {
                    window.PulseToast.error('Failed to delete destination');
                }
            })
            .catch(error => {
                window.PulseToast.error(error.message || 'Failed to delete destination');
            });
    }
}

// Dashboard utility functions
function generateNewKey() {
    if (confirm('Are you sure you want to generate a new stream key? Your current key will be invalidated.')) {
        const button = document.getElementById('generate-new-key-btn');
        if (!button) {
            // Button not found - silent handling
            return;
        }
        
        const originalText = button.innerHTML;
        
        // Show loading state
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Generating...';
        
        fetch('/api/stream/key/regenerate', { 
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                confirm: true
            }),
            credentials: 'include'
        })
        .then(response => {
            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('Please log in to regenerate your stream key');
                }
                return response.text().then(text => {
                    throw new Error(`Server error: ${response.status} - ${text}`);
                });
            }
            return response.json();
        })
        .then(data => {
            if (data.streamKey) {
                const streamKeyInput = document.getElementById('stream-key');
                if (streamKeyInput) {
                    streamKeyInput.value = data.streamKey;
                } else {
                    // Element not found - silent handling
                }
                
                if (data.rtmpUrl) {
                    const rtmpServerInput = document.getElementById('rtmp-server');
                    if (rtmpServerInput) {
                        rtmpServerInput.value = data.rtmpUrl;
                    }
                }
                
                window.PulseToast.success(data.message || 'New stream key generated successfully');
            } else {
                throw new Error('Invalid response format');
            }
        })
        .catch(error => {
            // Silent error handling
            window.PulseToast.error(error.message || 'An error occurred while generating the key');
        })
        .finally(() => {
            button.disabled = false;
            button.innerHTML = originalText;
        });
    }
}

function toggleKeyVisibility() {
    const streamKeyInput = document.getElementById('stream-key');
    const eyeIcon = document.getElementById('key-eye-icon');
    
    if (streamKeyInput && eyeIcon) {
        if (streamKeyInput.type === 'password') {
            streamKeyInput.type = 'text';
            eyeIcon.className = 'fas fa-eye-slash';
            document.getElementById('toggle-key-visibility').title = 'Hide stream key';
        } else {
            streamKeyInput.type = 'password';
            eyeIcon.className = 'fas fa-eye';
            document.getElementById('toggle-key-visibility').title = 'Show stream key';
        }
    } else {
        // Elements not found - silent handling
    }
}

function copyToClipboard(elementId) {
    const element = document.getElementById(elementId);
    if (!element) {
        // Element not found - silent handling
        return;
    }
    
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(element.value)
            .then(() => {
                window.PulseToast.success('Copied to clipboard!');
            })
            .catch(err => {
                // Silent error handling
                fallbackCopyTextToClipboard(element);
            });
    } else {
        fallbackCopyTextToClipboard(element);
    }
}

// Copy text directly to clipboard
function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text)
            .then(() => {
                window.PulseToast.success('Copied to clipboard!');
            })
            .catch(err => {
                // Fallback: create temporary textarea element
                fallbackCopyText(text);
            });
    } else {
        // Fallback: create temporary textarea element
        fallbackCopyText(text);
    }
}

function fallbackCopyText(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    
    // Avoid scrolling to bottom
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        const successful = document.execCommand('copy');
        if (successful) {
            window.PulseToast.success('Copied to clipboard!');
        } else {
            window.PulseToast.error('Failed to copy to clipboard');
        }
    } catch (err) {
        window.PulseToast.error('Failed to copy to clipboard');
    }
    
    document.body.removeChild(textArea);
}

function fallbackCopyTextToClipboard(element) {
    element.select();
    element.setSelectionRange(0, 99999);
    
    try {
        const successful = document.execCommand('copy');
        if (successful) {
            window.PulseToast.success('Copied to clipboard!');
        } else {
            window.PulseToast.error('Failed to copy to clipboard');
        }
    } catch (err) {
        // Silent error handling
        window.PulseToast.error('Failed to copy to clipboard');
    }
    
    element.blur();
}

// Global event handlers
document.addEventListener('DOMContentLoaded', function() {
    // Initialize tooltips
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });

    // Initialize popovers
    const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
    popoverTriggerList.map(function (popoverTriggerEl) {
        return new bootstrap.Popover(popoverTriggerEl);
    });

    // Handle copy buttons
    document.addEventListener('click', function(e) {
        if (e.target.matches('[data-copy]')) {
            const targetId = e.target.getAttribute('data-copy');
            const targetElement = document.getElementById(targetId);
            
            if (targetElement) {
                const text = targetElement.value || targetElement.textContent;
                Utils.copyToClipboard(text)
                    .then(() => {
                        window.PulseToast.success('Copied to clipboard!');
                        
                        // Visual feedback
                        const icon = e.target.querySelector('i');
                        if (icon) {
                            const originalClass = icon.className;
                            icon.className = 'fas fa-check';
                            setTimeout(() => {
                                icon.className = originalClass;
                            }, 1000);
                        }
                    })
                    .catch(() => {
                        window.PulseToast.error('Failed to copy to clipboard');
                    });
            }
        }
    });

    // Handle form validation
    document.addEventListener('submit', function(e) {
        const form = e.target;
        if (form.hasAttribute('data-validate-form')) {
            e.preventDefault();
            
            const errors = Validation.validate(form);
            
            if (Object.keys(errors).length > 0) {
                Validation.showErrors(form, errors);
                return false;
            }
            
            // If validation passes, you can submit the form
            form.submit();
        }
    });

    // Auto-refresh elements
    const autoRefreshElements = document.querySelectorAll('[data-auto-refresh]');
    autoRefreshElements.forEach(element => {
        const interval = parseInt(element.getAttribute('data-auto-refresh')) || 5000;
        const endpoint = element.getAttribute('data-endpoint');
        
        if (endpoint) {
            setInterval(() => {
                API.get(endpoint)
                    .then(data => {
                        if (data.success) {
                            element.textContent = data.value || '';
                        }
                    })
                    .catch(error => {
                        // Silent error handling
                    });
            }, interval);
        }
    });

    // Initialize real-time connection if on authenticated pages
    if (document.body.classList.contains('authenticated')) {
        RealTime.connect();
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    RealTime.disconnect();
});

// Export for module use
// Toast notification function
window.showToast = function(message, type = 'info') {
    // Create toast container if it doesn't exist
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.className = 'toast-container position-fixed top-0 end-0 p-3';
        toastContainer.style.zIndex = '1055';
        document.body.appendChild(toastContainer);
    }
    
    // Create toast element
    const toastId = 'toast-' + Date.now();
    const toastElement = document.createElement('div');
    toastElement.id = toastId;
    toastElement.className = 'toast';
    toastElement.setAttribute('role', 'alert');
    toastElement.setAttribute('aria-live', 'assertive');
    toastElement.setAttribute('aria-atomic', 'true');
    
    // Set background color based on type
    let bgClass = 'bg-primary';
    let icon = 'fas fa-info-circle';
    if (type === 'success') {
        bgClass = 'bg-success';
        icon = 'fas fa-check-circle';
    } else if (type === 'error' || type === 'danger') {
        bgClass = 'bg-danger';
        icon = 'fas fa-exclamation-circle';
    } else if (type === 'warning') {
        bgClass = 'bg-warning';
        icon = 'fas fa-exclamation-triangle';
    }
    
    toastElement.innerHTML = `
        <div class="toast-header ${bgClass} text-white">
            <i class="${icon} me-2"></i>
            <strong class="me-auto">PulseRelay</strong>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
        <div class="toast-body">
            ${message}
        </div>
    `;
    
    // Add to container
    toastContainer.appendChild(toastElement);
    
    // Initialize and show toast
    const toast = new bootstrap.Toast(toastElement, {
        autohide: true,
        delay: 5000
    });
    
    // Remove element after it's hidden
    toastElement.addEventListener('hidden.bs.toast', function() {
        toastElement.remove();
    });
    
    toast.show();
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        Utils,
        API,
        RealTime,
        Validation
    };
}
