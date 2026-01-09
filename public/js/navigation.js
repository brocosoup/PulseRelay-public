// PulseRelay Navigation Functions

// Make functions globally accessible
window.showDestinations = function() {
    window.showModal('destinations', 'RTMP Destinations', window.loadDestinationsModal);
};

window.showStats = function() {
    window.showModal('stats', 'Statistics', window.loadStatsModal);
};

window.showProfile = function() {
    window.showModal('profile', 'User Profile', window.loadProfileModal);
};

window.showStats = function() {
    window.showModal('stats', 'Statistics', window.loadStatsModal);
};

// Modal system for navigation - exposed globally
window.showModal = function(id, title, contentLoader) {
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
        <div class="modal-dialog modal-lg">
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
    
    // Initialize Bootstrap modal
    const bsModal = new bootstrap.Modal(modal);
    
    // Load content
    contentLoader(modal.querySelector('.modal-body'), modal.querySelector('.modal-footer'));
    
    // Show modal
    bsModal.show();
    
    // Clean up when modal is hidden
    modal.addEventListener('hidden.bs.modal', () => {
        modal.remove();
    });
}

// Modal content loaders - exposed globally
window.loadDestinationsModal = function(bodyElement, footerElement) {
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
                    <button type="button" class="btn btn-primary btn-sm" id="add-destination-btn">
                        <i class="fas fa-plus me-1"></i> Add Destination
                    </button>
                </div>
                
                ${destinations.length === 0 ? 
                    '<div class="text-center text-muted py-4"><i class="fas fa-share-alt mb-2"></i><div>No destinations configured</div></div>' :
                    `<div class="list-group" id="destinations-list">
                        ${destinations.map(dest => `
                            <div class="list-group-item d-flex justify-content-between align-items-center" data-destination-id="${dest.id}">
                                <div>
                                    <h6 class="mb-1">${escapeHtml(dest.name)}</h6>
                                    <small class="text-muted">${escapeHtml(dest.rtmp_url)}</small>
                                    <span class="badge bg-${dest.is_active ? 'success' : 'secondary'} ms-2">
                                        ${dest.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                </div>
                                <div class="btn-group" role="group">
                                    <button type="button" class="btn btn-outline-secondary btn-sm toggle-destination" 
                                            data-active="${dest.is_active}">
                                        <i class="fas fa-${dest.is_active ? 'pause' : 'play'}"></i>
                                    </button>
                                    <button type="button" class="btn btn-outline-danger btn-sm delete-destination">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>`
                }
            `;
        })
        .catch(error => {
            bodyElement.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    Failed to load destinations
                </div>
            `;
        });
}

window.loadStatsModal = function(bodyElement, footerElement) {
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
                        timeAgoText = formatNavTimeAgo(date);
                        fullDateTime = formatNavLocalDateTime(date);
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
        bodyElement.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-triangle me-2"></i>
                Failed to load statistics
            </div>
        `;
    });
}

window.loadProfileModal = function(bodyElement, footerElement) {
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
    
    // Add delete account handler - use global function
    const deleteBtn = bodyElement.querySelector('#deleteAccountBtn');
    if (deleteBtn && typeof window.handleDeleteAccount === 'function') {
        deleteBtn.addEventListener('click', window.handleDeleteAccount);
    }
}

}

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

// Navigation timezone helper functions
function formatNavTimeAgo(date) {
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
    return formatNavLocalDateTime(date);
}

function formatNavLocalDateTime(date) {
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

// Destination management functions (placeholder implementations)
function addDestination() {
    alert('Add destination functionality - to be implemented in a future update');
}

function toggleDestination(id, isActive) {
    alert(`Toggle destination ${id} to ${isActive ? 'active' : 'inactive'} - to be implemented`);
}

function deleteDestination(id) {
    if (confirm('Are you sure you want to delete this destination?')) {
        alert(`Delete destination ${id} - to be implemented`);
    }
}
