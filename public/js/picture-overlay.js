let status;
let picturesContainer;
let checkInterval = null;
let pictureQueue = []; // Queue of pictures to display
let currentPicture = null; // Currently displayed picture
let knownPictureIds = new Set(); // Track pictures we've already queued
let overlayToken = null; // Store overlay token from URL
let lastQueueVersion = null; // Track queue version for clear detection
let isConnected = false; // Connection state

function init() {
    status = document.getElementById('status');
    picturesContainer = document.getElementById('pictures-container');
    
    if (!status || !picturesContainer) {
        console.error('Required elements not found');
        return;
    }
    
    // Extract token from URL
    const urlParams = new URLSearchParams(window.location.search);
    overlayToken = urlParams.get('token');
    
    if (!overlayToken) {
        updateStatus('error', 'Error: No overlay token provided');
        return;
    }
    
    updateStatus('connecting', 'Connecting...');
    
    // Start polling for new pictures
    startPolling();
    
    // Initial load
    loadPictures();
}

function startPolling() {
    // Poll every 2 seconds for new pictures
    checkInterval = setInterval(() => {
        loadPictures();
    }, 2000);
}

function stopPolling() {
    if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
    }
}

async function loadPictures() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`/api/overlay/pictures?token=${overlayToken}`, {
            signal: controller.signal,
            cache: 'no-cache'
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            console.log('Picture fetch failed:', response.status, response.statusText);
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            // Mark as connected on first successful response
            if (!isConnected) {
                isConnected = true;
                updateStatus('connected', 'Connected');
                // Hide status after 2 seconds
                setTimeout(() => {
                    hideStatus();
                }, 2000);
            }
            
            // Check if queue was cleared (version changed)
            if (data.queueVersion && lastQueueVersion && data.queueVersion !== lastQueueVersion) {
                console.log('Queue cleared detected - stopping display immediately');
                clearCurrentDisplay();
                pictureQueue = [];
                knownPictureIds.clear();
            }
            lastQueueVersion = data.queueVersion;
            
            // Add new pictures to queue
            for (const picture of data.pictures) {
                if (!knownPictureIds.has(picture.id)) {
                    pictureQueue.push(picture);
                    knownPictureIds.add(picture.id);
                    console.log(`Added media ${picture.id} to queue (type: ${picture.mediaType || 'image'})`);
                }
            }
            
            // Always hide status when connected (clear screen)
            const totalPictures = pictureQueue.length + (currentPicture ? 1 : 0);
            if (totalPictures === 0 && isConnected) {
                hideStatus();
            }
            
            // If no picture is currently displayed, show the next one
            if (!currentPicture && pictureQueue.length > 0) {
                showNextPicture();
            }
        }
    } catch (error) {
        console.log('Picture fetch error:', error.name, error.message);
        console.error('Error loading media:', error);
        // Show error only if not previously connected
        if (!isConnected) {
            updateStatus('error', 'Connection failed');
        }
    }
}

function showNextPicture() {
    if (pictureQueue.length === 0) {
        console.log('Queue is empty');
        return;
    }
    
    const picture = pictureQueue.shift();
    currentPicture = picture;
    
    displayPicture(picture);
}

function displayPicture(picture) {
    const isVideo = picture.mediaType === 'video';
    
    // Videos play until ended, images show for 30 seconds
    const displayDuration = isVideo ? null : 30; // seconds (null for videos)
    const displayStartTime = new Date();
    
    console.log('Media display info:', {
        id: picture.id,
        type: isVideo ? 'video' : 'image',
        displayDuration: displayDuration || 'until ended',
        displayStartTime: displayStartTime,
        queueLength: pictureQueue.length
    });
    
    // Declare interval/timeout IDs for cleanup
    let countdownInterval;
    let timeoutId;
    
    // Create picture wrapper
    const wrapper = document.createElement('div');
    wrapper.id = `picture-${picture.id}`;
    wrapper.className = 'picture-wrapper fadein';
    
    if (isVideo) {
        // Create video element
        const video = document.createElement('video');
        video.src = picture.url;
        video.autoplay = true;
        video.loop = false; // Prevent video from looping
        video.muted = false; // Videos play with sound
        video.controls = false;
        video.playsInline = true; // Prevent fullscreen on mobile
        video.preload = 'auto';
        video.style.maxWidth = '100%';
        video.style.maxHeight = '100%';
        video.style.objectFit = 'contain'; // Fit video within bounds without cropping
        
        let hasEnded = false; // Flag to prevent multiple ended events
        
        // Handle video errors - fail silently
        video.onerror = () => {
            // Skip this video and show next item without showing errors
            if (countdownInterval) clearInterval(countdownInterval);
            wrapper.remove();
            finishCurrentPicture();
        };
        
        // Video ended event - automatically move to next
        video.onended = () => {
            if (hasEnded) return; // Prevent multiple triggers
            hasEnded = true;
            console.log(`Video ${picture.id} ended at time: ${video.currentTime}s`);
            
            // Immediately stop and clean up video
            video.pause();
            video.src = '';
            video.load();
            
            if (countdownInterval) clearInterval(countdownInterval);
            fadeOutAndRemove(picture.id, () => {
                finishCurrentPicture();
            });
        };
        
        // Prevent seeking/replaying
        video.onseeking = () => {
            if (hasEnded) {
                video.pause();
            }
        };
        
        // Log when video loads successfully
        video.onloadeddata = () => {
            console.log(`Video loaded successfully: ${picture.url}, duration: ${video.duration}s`);
        };
        
        // Log when video starts playing
        video.onplay = () => {
            console.log(`Video ${picture.id} started playing`);
        };
        
        // Create info overlay with queue info
        const info = document.createElement('div');
        info.className = 'picture-info';
        const queueText = pictureQueue.length > 0 ? ` • ${pictureQueue.length} queued` : '';
        info.textContent = `Playing${queueText}`;
        
        wrapper.appendChild(video);
        wrapper.appendChild(info);
        
        // Update queue count periodically
        countdownInterval = setInterval(() => {
            const queueText = pictureQueue.length > 0 ? ` • ${pictureQueue.length} queued` : '';
            info.textContent = `Playing${queueText}`;
        }, 1000);
        
    } else {
        // Create image element (original code)
        const img = document.createElement('img');
        img.src = picture.url;
        img.alt = 'Overlay Picture';
        
        // Handle image load errors - fail silently
        img.onerror = () => {
            // Skip this picture and show next one without showing errors
            if (countdownInterval) clearInterval(countdownInterval);
            if (timeoutId) clearTimeout(timeoutId);
            wrapper.remove();
            finishCurrentPicture();
        };
        
        // Log when image loads successfully
        img.onload = () => {
            console.log(`Image loaded successfully: ${picture.url}`);
        };
        
        // Create info overlay with queue info
        const info = document.createElement('div');
        info.className = 'picture-info';
        const queueText = pictureQueue.length > 0 ? ` • ${pictureQueue.length} queued` : '';
        info.textContent = `${displayDuration}s${queueText}`;
        
        wrapper.appendChild(img);
        wrapper.appendChild(info);
        
        // Update countdown every second
        countdownInterval = setInterval(() => {
            const elapsed = Math.floor((new Date() - displayStartTime) / 1000);
            const remaining = Math.max(0, displayDuration - elapsed);
            const queueText = pictureQueue.length > 0 ? ` • ${pictureQueue.length} queued` : '';
            info.textContent = `${remaining}s${queueText}`;
            
            if (remaining <= 0) {
                clearInterval(countdownInterval);
            }
        }, 1000);
        
        // Set timeout to remove picture after display duration
        timeoutId = setTimeout(() => {
            clearInterval(countdownInterval);
            fadeOutAndRemove(picture.id, () => {
                finishCurrentPicture();
            });
        }, displayDuration * 1000);
    }
    
    // Append wrapper to container (for both images and videos)
    picturesContainer.appendChild(wrapper);
    
    // Store current picture info
    currentPicture = {
        ...picture,
        timeoutId,
        countdownInterval
    };
}

function finishCurrentPicture() {
    if (currentPicture) {
        // Don't delete from knownPictureIds - keep it to prevent re-queuing
        // It will only be cleared when queue is cleared (version change)
        currentPicture = null;
    }
    
    // Show next picture in queue
    showNextPicture();
}

function clearCurrentDisplay() {
    if (!currentPicture) return;
    
    // Clear timers
    if (currentPicture.timeoutId) {
        clearTimeout(currentPicture.timeoutId);
    }
    if (currentPicture.countdownInterval) {
        clearInterval(currentPicture.countdownInterval);
    }
    
    // Remove display immediately
    const wrapper = document.getElementById(`picture-${currentPicture.id}`);
    if (wrapper) {
        wrapper.remove();
    }
    
    currentPicture = null;
    console.log('Current display cleared');
}

function fadeOutAndRemove(pictureId, callback) {
    const wrapper = document.getElementById(`picture-${pictureId}`);
    if (wrapper) {
        wrapper.classList.add('fadeout');
        setTimeout(() => {
            wrapper.remove();
            if (callback) callback();
        }, 500); // Match fadeout animation duration
    } else if (callback) {
        callback();
    }
}

function updateStatus(state, message) {
    if (!status) return;
    
    status.className = `status ${state}`;
    status.textContent = message;
    status.style.display = 'block';
}

function hideStatus() {
    if (!status) return;
    status.style.display = 'none';
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    stopPolling();
    if (currentPicture) {
        if (currentPicture.timeoutId) {
            clearTimeout(currentPicture.timeoutId);
        }
        if (currentPicture.countdownInterval) {
            clearInterval(currentPicture.countdownInterval);
        }
    }
});

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
