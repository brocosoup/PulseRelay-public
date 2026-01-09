// PulseRelay Stream Page - CSP-Compliant Test Pattern Management

// Stream object to manage all functionality (prevent redeclaration)
window.stream = window.stream || {
    init: function() {
        this.setupEventListeners();
        this.loadStreamStatus();
        this.loadTestPatternSettings();
        
        // Initialize refresh countdown
        this.refreshCountdown = 10;
        this.updateCountdownDisplay();
        
        // Set up countdown timer (updates every second)
        this.countdownInterval = setInterval(() => {
            this.refreshCountdown--;
            this.updateCountdownDisplay();
            
            if (this.refreshCountdown <= 0) {
                this.refreshCountdown = 10; // Reset countdown
                // Only update if page is visible to reduce unnecessary API calls
                if (!document.hidden) {
                    this.refreshData();
                }
            }
        }, 1000);
        
        // Add visibility change handler to resume updates when page becomes visible
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                // Immediately update when page becomes visible and reset countdown
                this.refreshData();
                this.refreshCountdown = 10;
                this.updateCountdownDisplay();
            }
        });
    },
    
    setupEventListeners: function() {
        // Test pattern form
        const testPatternForm = document.getElementById('test-pattern-form');
        if (testPatternForm) {
            testPatternForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveTestPatternSettings();
            });
        }
        
        // Manual refresh button
        const manualRefreshBtn = document.getElementById('manual-refresh-btn');
        if (manualRefreshBtn) {
            manualRefreshBtn.addEventListener('click', () => {
                this.manualRefresh();
            });
        }
        
        // Start test pattern button
        const startTestPatternBtn = document.getElementById('start-test-pattern-btn');
        if (startTestPatternBtn) {
            startTestPatternBtn.addEventListener('click', () => {
                this.startTestPattern();
            });
        }
        
        // Stop test pattern button
        const stopTestPatternBtn = document.getElementById('stop-test-pattern-btn');
        if (stopTestPatternBtn) {
            stopTestPatternBtn.addEventListener('click', () => {
                this.stopTestPattern();
            });
        }
        
        // Load defaults button
        const loadDefaultsBtn = document.getElementById('load-defaults-btn');
        if (loadDefaultsBtn) {
            loadDefaultsBtn.addEventListener('click', () => {
                this.loadDefaults();
            });
        }
    },
    
    updateCountdownDisplay: function() {
        const countdownElement = document.getElementById('refresh-countdown');
        if (countdownElement) {
            countdownElement.textContent = this.refreshCountdown;
        }
    },
    
    refreshData: function() {
        // Silent refresh - loading states handled in UI
        this.loadStreamStatus();
        this.loadTestPatternSettings();
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
    
    loadStreamStatus: function() {
        fetch('/api/stream/status')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                this.updateStreamStatus(data);
                this.updateStatusBadges(data.isLive, data.testPattern?.isRunning);
            })
            .catch(error => {
                // Silent error handling
                this.updateStreamStatus({ isLive: false, testPattern: { isRunning: false } });
                this.updateStatusBadges(false, false);
            });
    },
    
    updateStreamStatus: function(data) {
        const statusIndicator = document.getElementById('status-indicator');
        const statusText = document.getElementById('status-text');
        const statusDescription = document.getElementById('status-description');
        const currentSettings = document.getElementById('current-settings');
        const startBtn = document.getElementById('start-test-pattern-btn');
        const stopBtn = document.getElementById('stop-test-pattern-btn');
        
        if (data.testPattern?.isRunning) {
            // Test pattern is running - disable start, enable stop
            if (startBtn) startBtn.disabled = true;
            if (stopBtn) stopBtn.disabled = false;
            
            if (statusIndicator) {
                statusIndicator.className = 'modern-status-indicator warning me-2';
            }
            if (statusText) {
                statusText.textContent = 'TEST PATTERN ACTIVE';
                statusText.className = 'fw-medium text-warning';
            }
            if (statusDescription) {
                statusDescription.textContent = 'Test pattern is currently streaming.';
            }
            if (currentSettings) {
                currentSettings.style.display = 'block';
                this.updateCurrentSettings(data.testPattern.settings);
            }
        } else if (data.isLive && !data.testPattern?.isRunning) {
            // Real publisher is live - disable start (can't start test pattern while live)
            if (startBtn) startBtn.disabled = true;
            if (stopBtn) stopBtn.disabled = true;
            
            // Real publisher is live (not test pattern)
            if (statusIndicator) {
                statusIndicator.className = 'modern-status-indicator online me-2';
            }
            if (statusText) {
                statusText.textContent = 'PUBLISHER LIVE';
                statusText.className = 'fw-medium text-success';
            }
            if (statusDescription) {
                statusDescription.textContent = 'A publisher is currently streaming.';
            }
            if (currentSettings) {
                currentSettings.style.display = 'none';
            }
        } else {
            // Nothing is streaming - enable start, disable stop
            if (startBtn) startBtn.disabled = false;
            if (stopBtn) stopBtn.disabled = true;
            
            // Check for FFmpeg error
            if (data.testPattern?.error) {
                // There was an FFmpeg error - show notification and keep start enabled for retry
                PulseToast.error(`Test pattern failed: ${data.testPattern.error.message}`, {
                    duration: 8000,
                    title: 'FFmpeg Error'
                });
                
                if (statusIndicator) {
                    statusIndicator.className = 'modern-status-indicator offline me-2';
                }
                if (statusText) {
                    statusText.textContent = 'ERROR';
                    statusText.className = 'fw-medium text-danger';
                }
                if (statusDescription) {
                    statusDescription.textContent = 'Test pattern failed to start. Click start to retry.';
                }
            } else {
                // Normal offline state
                if (statusIndicator) {
                    statusIndicator.className = 'modern-status-indicator offline me-2';
                }
                if (statusText) {
                    statusText.textContent = 'OFFLINE';
                    statusText.className = 'fw-medium text-muted';
                }
                if (statusDescription) {
                    statusDescription.textContent = 'No publisher connected.';
                }
            }
            
            if (currentSettings) {
                currentSettings.style.display = 'none';
            }
        }
    },
    
    updateCurrentSettings: function(settings) {
        if (!settings) return;
        
        const elements = {
            'active-resolution': `${settings.width}x${settings.height}`,
            'active-bitrate': `${settings.bitrate} kbps`,
            'active-fps': `${settings.fps} fps`,
            'active-pattern': settings.patternType || 'colorbars'
        };
        
        Object.entries(elements).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value;
            }
        });
    },
    
    updateStatusBadges: function(isLive, isTestPatternRunning) {
        // Update stream status badge
        const streamBadge = document.getElementById('stream-status-badge');
        if (streamBadge) {
            if (isLive) {
                streamBadge.className = 'badge bg-success';
                streamBadge.innerHTML = '<i class="fas fa-circle me-1"></i>LIVE';
            } else {
                streamBadge.className = 'badge bg-secondary';
                streamBadge.innerHTML = '<i class="fas fa-circle me-1"></i>OFFLINE';
            }
        }
        
        // Update test pattern badge
        const testPatternBadge = document.getElementById('test-pattern-badge');
        if (testPatternBadge) {
            if (isTestPatternRunning) {
                testPatternBadge.className = 'badge bg-warning';
                testPatternBadge.innerHTML = '<i class="fas fa-test-tube me-1"></i>TEST PATTERN';
            } else {
                testPatternBadge.className = 'badge bg-secondary';
                testPatternBadge.innerHTML = '<i class="fas fa-test-tube me-1"></i>NO PATTERN';
            }
        }
    },
    
    loadTestPatternSettings: function() {
        fetch('/api/stream/test-pattern/status')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data.settings) {
                    this.populateTestPatternForm(data.settings);
                }
            })
            .catch(error => {
                // Silent error handling
            });
    },
    
    populateTestPatternForm: function(settings) {
        const elements = {
            'pattern-type': settings.patternType || 'colorbars',
            'pattern-resolution': `${settings.width || 1280}x${settings.height || 720}`,
            'pattern-fps': settings.fps || 30,
            'pattern-bitrate': settings.bitrate || 2000,
            'pattern-audio-bitrate': settings.audioBitrate || 128,
            'pattern-text': settings.text || 'PulseRelay Test Pattern'
        };
        
        Object.entries(elements).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) {
                if (element.type === 'checkbox') {
                    element.checked = value;
                } else {
                    element.value = value;
                }
            }
        });
    },

    saveTestPatternSettings: function() {
        const formData = this.getTestPatternFormData();
        
        fetch('/api/stream/test-pattern/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData)
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            window.PulseToast.success('Test pattern settings saved successfully!');
            this.loadTestPatternSettings(); // Reload to show updated settings
        })
        .catch(error => {
            // Silent error handling
            window.PulseToast.error('Failed to save test pattern settings');
        });
    },
    
    getTestPatternFormData: function() {
        const patternResolution = document.getElementById('pattern-resolution')?.value || '1280x720';
        const [width, height] = patternResolution.split('x').map(Number);
        
        return {
            patternType: document.getElementById('pattern-type')?.value || 'colorbars',
            width: width,
            height: height,
            fps: parseInt(document.getElementById('pattern-fps')?.value) || 30,
            bitrate: parseInt(document.getElementById('pattern-bitrate')?.value) || 2000,
            audioBitrate: parseInt(document.getElementById('pattern-audio-bitrate')?.value) || 128,
            text: document.getElementById('pattern-text')?.value || 'PulseRelay Test Pattern'
        };
    },
    
    startTestPattern: function() {
        // Immediately disable start button and enable stop button for responsive UI
        const startBtn = document.getElementById('start-test-pattern-btn');
        const stopBtn = document.getElementById('stop-test-pattern-btn');
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
        
        fetch('/api/stream/test-pattern/start', {
            method: 'POST'
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            window.PulseToast.success('Test pattern starting...', {
                title: 'FFmpeg Launching'
            });
            
            // Refresh data immediately, then check for errors after a short delay
            this.refreshData();
            
            // Check for FFmpeg errors after a brief startup period
            setTimeout(() => {
                this.loadStreamStatus();
            }, 2000);
        })
        .catch(error => {
            // Re-enable start button on error
            if (startBtn) startBtn.disabled = false;
            if (stopBtn) stopBtn.disabled = true;
            window.PulseToast.error('Failed to start test pattern');
        });
    },
    
    stopTestPattern: function() {
        // Immediately disable stop button and enable start button for responsive UI
        const startBtn = document.getElementById('start-test-pattern-btn');
        const stopBtn = document.getElementById('stop-test-pattern-btn');
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        
        fetch('/api/stream/test-pattern/stop', {
            method: 'POST'
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            window.PulseToast.success('Test pattern stopped successfully!');
            this.refreshData();
        })
        .catch(error => {
            // Re-enable stop button on error
            if (startBtn) startBtn.disabled = true;
            if (stopBtn) stopBtn.disabled = false;
            window.PulseToast.error('Failed to stop test pattern');
        });
    },
    
    loadDefaults: function() {
        const defaults = {
            'pattern-type': 'colorbars',
            'pattern-resolution': '1280x720',
            'pattern-fps': '30',
            'pattern-bitrate': '2000',
            'pattern-audio-bitrate': '128',
            'pattern-text': 'PulseRelay Test Pattern'
        };
        
        Object.entries(defaults).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) {
                if (element.type === 'checkbox') {
                    element.checked = value;
                } else {
                    element.value = value;
                }
            }
        });
        
        window.PulseToast.info('Default settings loaded');
    }
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    if (typeof window.stream !== 'undefined') {
        window.stream.init();
    }
});
