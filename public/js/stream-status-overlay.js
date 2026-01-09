let overlayToken = null;
let obsWebSocket = null;
let obsConnected = false;
let obsPassword = null; // OBS WebSocket password
let sourceVisibility = {}; // Track OBS source visibility by name
let reconnectTimeout = null;

// DOM elements
const streamStatusContainer = document.getElementById('streamStatusContainer');

function init() {
    // Extract token from URL
    const urlParams = new URLSearchParams(window.location.search);
    overlayToken = urlParams.get('token');
    
    if (!overlayToken) {
        showError('Error: No token');
        return;
    }
    
    // Connect to OBS WebSocket
    connectOBSWebSocket();
    
    // Initial fetch
    fetchStreamStatus();
    
    // Update stream status every 5 seconds
    setInterval(fetchStreamStatus, 5000);
}

function connectOBSWebSocket() {
    const wsUrl = 'ws://localhost:4455';
    
    try {
        console.log('Connecting to OBS WebSocket at', wsUrl);
        obsWebSocket = new WebSocket(wsUrl);
        
        obsWebSocket.onopen = () => {
            console.log('WebSocket connection opened');
        };
        
        obsWebSocket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            handleOBSMessage(message);
        };
        
        obsWebSocket.onerror = (error) => {
            console.log('OBS WebSocket error:', error);
        };
        
        obsWebSocket.onclose = () => {
            console.log('OBS WebSocket disconnected');
            obsConnected = false;
            obsWebSocket = null;
            
            // Clear periodic refresh
            if (window.obsRefreshInterval) {
                clearInterval(window.obsRefreshInterval);
                window.obsRefreshInterval = null;
            }
            
            // Try to reconnect after 5 seconds
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            reconnectTimeout = setTimeout(connectOBSWebSocket, 5000);
        };
    } catch (error) {
        console.log('Could not connect to OBS WebSocket:', error);
    }
}

function handleOBSMessage(message) {
    // Handle different OBS WebSocket message types (protocol v5)
    if (message.op === 0) { // Hello
        console.log('Received Hello from OBS');
        
        // Check if authentication is required
        if (message.d.authentication) {
            console.log('Authentication required');
            
            if (!obsPassword) {
                console.log('No OBS password configured, cannot authenticate');
                obsWebSocket.close();
                return;
            }
            
            // Compute authentication string using SHA256
            const { salt, challenge } = message.d.authentication;
            
            // Step 1: SHA256(password + salt)
            const secret = obsPassword + salt;
            const secretHash = CryptoJS.SHA256(secret).toString(CryptoJS.enc.Base64);
            
            // Step 2: SHA256(secretHash + challenge)
            const authResponse = CryptoJS.SHA256(secretHash + challenge).toString(CryptoJS.enc.Base64);
            
            // Send Identify with authentication
            const identify = {
                op: 1,
                d: {
                    rpcVersion: 1,
                    authentication: authResponse,
                    eventSubscriptions: 161 // Scenes (1) + Inputs (32) + SceneItems (128) = 161
                }
            };
            obsWebSocket.send(JSON.stringify(identify));
        } else {
            // No authentication required
            console.log('No authentication required');
            const identify = {
                op: 1,
                d: {
                    rpcVersion: 1,
                    eventSubscriptions: 161 // Scenes (1) + Inputs (32) + SceneItems (128) = 161
                }
            };
            obsWebSocket.send(JSON.stringify(identify));
        }
    } else if (message.op === 2) { // Identified
        console.log('Identified with OBS');
        obsConnected = true;
        // Request current scene items
        requestSceneItems();
        // Also set up periodic refresh every 2 seconds to catch nested scene changes
        if (window.obsRefreshInterval) clearInterval(window.obsRefreshInterval);
        window.obsRefreshInterval = setInterval(requestSceneItems, 2000);
    } else if (message.op === 7) { // RequestResponse
        if (message.d.requestType === 'GetCurrentProgramScene') {
            handleCurrentScene(message.d.responseData);
        } else if (message.d.requestType === 'GetSceneItemList') {
            handleSceneItems(message.d.responseData);
        }
    } else if (message.op === 5) { // Event
        const eventType = message.d.eventType;
        if (eventType === 'CurrentProgramSceneChanged' || 
            eventType === 'SceneItemEnableStateChanged' ||
            eventType === 'SceneItemCreated' ||
            eventType === 'SceneItemRemoved' ||
            eventType === 'SceneItemVisibilityChanged' ||
            eventType === 'CurrentPreviewSceneChanged') {
            // Scene changed or items modified, refresh
            // Small delay to ensure OBS has updated its state
            setTimeout(requestSceneItems, 100);
        }
    }
}

function requestSceneItems() {
    if (!obsWebSocket || obsWebSocket.readyState !== WebSocket.OPEN) {
        return;
    }
    
    // First get current scene
    const request = {
        op: 6, // Request
        d: {
            requestType: 'GetCurrentProgramScene',
            requestId: 'getCurrentScene_' + Date.now()
        }
    };
    
    obsWebSocket.send(JSON.stringify(request));
}

function handleCurrentScene(data) {
    if (!data || !data.currentProgramSceneName) {
        return;
    }
    
    // Now get scene items for this scene
    const request = {
        op: 6,
        d: {
            requestType: 'GetSceneItemList',
            requestId: 'getSceneItems_' + Date.now(),
            requestData: {
                sceneName: data.currentProgramSceneName
            }
        }
    };
    
    obsWebSocket.send(JSON.stringify(request));
}

function handleSceneItems(data) {
    if (!data || !data.sceneItems) {
        return;
    }
    
    // Reset visibility on first call (from main scene)
    if (!handleSceneItems.processing) {
        sourceVisibility = {};
        handleSceneItems.processing = true;
        handleSceneItems.pendingRequests = 1; // Start with 1 for the current request
    }
    
    // Process each scene item
    data.sceneItems.forEach(item => {
        if (!item.sceneItemEnabled) {
            return; // Skip disabled items
        }
        
        // Check if this is a nested scene (sourceType is "OBS_SOURCE_TYPE_SCENE")
        if (item.sourceType && item.sourceType.includes('SCENE')) {
            // This is a nested scene, query its items too
            handleSceneItems.pendingRequests++;
            const request = {
                op: 6,
                d: {
                    requestType: 'GetSceneItemList',
                    requestId: 'getNestedSceneItems_' + Date.now(),
                    requestData: {
                        sceneName: item.sourceName
                    }
                }
            };
            obsWebSocket.send(JSON.stringify(request));
        }
        
        // Mark this source as visible
        if (item.sourceName) {
            sourceVisibility[item.sourceName] = true;
        }
    });
    
    // Decrement pending requests counter for this completed request
    handleSceneItems.pendingRequests--;
    
    // If no more pending requests, finalize
    if (handleSceneItems.pendingRequests === 0) {
        handleSceneItems.processing = false;
        console.log('Source visibility (including nested scenes):', sourceVisibility);
        updateStreamItemBackgrounds();
    }
}

function updateStreamItemBackgrounds() {
    const items = document.querySelectorAll('.stream-key-item');
    console.log('Updating backgrounds for', items.length, 'items. OBS connected:', obsConnected, 'Source visibility:', sourceVisibility);
    
    items.forEach(item => {
        const obsSourceName = item.dataset.obsSourceName;
        const statusText = item.querySelector('.status-text');
        
        if (!statusText) return;
        
        // Remove existing OBS classes
        statusText.classList.remove('obs-visible', 'obs-hidden', 'obs-unknown');
        
        if (!obsSourceName) {
            // No OBS source configured
            console.log('No OBS source name configured for item');
            statusText.classList.add('obs-unknown');
        } else if (sourceVisibility[obsSourceName]) {
            // Source is visible in OBS
            console.log('Source', obsSourceName, 'is VISIBLE in OBS');
            statusText.classList.add('obs-visible');
        } else {
            // Source is not visible
            console.log('Source', obsSourceName, 'is HIDDEN in OBS');
            statusText.classList.add('obs-hidden');
        }
    });
}

function showError(message) {
    streamStatusContainer.innerHTML = `
        <div class="stream-key-item">
            <div class="status-indicator offline"></div>
            <div class="status-text obs-unknown">${message}</div>
        </div>
    `;
}

function fetchStreamStatus() {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    fetch(`/api/overlay/stream/status?token=${overlayToken}`, { 
        credentials: 'include',
        signal: controller.signal,
        cache: 'no-cache'
    })
        .then(response => {
            clearTimeout(timeoutId);
            if (!response.ok) {
                console.log('Stream status fetch failed:', response.status, response.statusText);
                throw new Error(`HTTP ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                // Store OBS password if provided
                if (data.obsWebsocketPassword) {
                    obsPassword = data.obsWebsocketPassword;
                    // Reconnect if we got a password and not already connected
                    if (!obsConnected && !obsWebSocket) {
                        connectOBSWebSocket();
                    }
                }
                
                if (data.streamKeys && data.streamKeys.length > 0) {
                    // Clear container
                    streamStatusContainer.innerHTML = '';
                    
                    // Add each stream key
                    data.streamKeys.forEach(stream => {
                        const rtmpStatusClass = stream.isLive ? 'live' : 'offline';
                        const streamKeyItem = document.createElement('div');
                        streamKeyItem.className = 'stream-key-item';
                        
                        // Store OBS source name in data attribute
                        if (stream.obsSourceName) {
                            streamKeyItem.dataset.obsSourceName = stream.obsSourceName;
                        }
                        
                        // Determine OBS visibility class
                        let obsClass = 'obs-unknown';
                        if (stream.obsSourceName && obsConnected) {
                            obsClass = sourceVisibility[stream.obsSourceName] ? 'obs-visible' : 'obs-hidden';
                        }
                        
                        streamKeyItem.innerHTML = `
                            <div class="status-indicator ${rtmpStatusClass}"></div>
                            <div class="status-text ${obsClass}">${stream.description || 'Stream'}</div>
                        `;
                        streamStatusContainer.appendChild(streamKeyItem);
                    });
                    
                    // Update backgrounds based on current OBS state
                    if (obsConnected) {
                        updateStreamItemBackgrounds();
                    }
                } else {
                    showError('No Stream Keys');
                }
            } else {
                console.log('Stream status response not successful:', data);
                showError('No Stream Keys');
            }
        })
        .catch((error) => {
            clearTimeout(timeoutId);
            // Log to console for debugging, but don't show error popup (silent for stream)
            console.log('Stream status fetch error:', error.name, error.message);
            showError('Unavailable');
        });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
