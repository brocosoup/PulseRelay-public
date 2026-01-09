// PulseRelay Service Worker for Background Tracking
// This service worker enables location tracking and updates even when the app is in background

const CACHE_VERSION = 'v1';
const BACKGROUND_SYNC_TAG = 'location-sync';

// Service worker activation
self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Handle background sync for location updates
self.addEventListener('sync', (event) => {
    if (event.tag === BACKGROUND_SYNC_TAG) {
        event.waitUntil(syncLocationInBackground());
    }
});

// Handle periodic background sync (if supported)
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'periodic-location-sync') {
        event.waitUntil(syncLocationInBackground());
    }
});

// Sync location data in background
async function syncLocationInBackground() {
    try {
        // Get queued locations from IndexedDB
        const queuedLocations = await getQueuedLocations();
        
        if (queuedLocations.length === 0) {
            // No queued locations - request fresh location from main thread
            const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
            if (clients.length > 0) {
                // Ask main thread to get location and queue it
                clients[0].postMessage({
                    type: 'REQUEST_LOCATION_UPDATE',
                    fromBackground: true
                });
            }
            return;
        }

        // Send queued location updates
        const authToken = await getStoredAuthToken();
        if (!authToken) {
            return;
        }

        // Process all queued locations
        for (const location of queuedLocations) {
            try {
                const response = await fetch('/api/location/update', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${authToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        ...location,
                        background: true
                    })
                });

                if (response.ok) {
                    // Remove successfully synced location from queue
                    await removeFromLocationQueue(location.id);
                } else {
                    console.error('Failed to sync location:', response.status);
                    // Keep in queue for retry
                }
            } catch (error) {
                console.error('Error syncing location:', error);
                // Keep in queue for retry
            }
        }
    } catch (error) {
        // Background location sync failed
    }
}

// Get stored auth token (from IndexedDB)
async function getStoredAuthToken() {
    try {
        const db = await openIndexedDB();
        const transaction = db.transaction(['auth'], 'readonly');
        const store = transaction.objectStore('auth');
        const request = store.get('authToken');
        
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result?.value);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        return null;
    }
}

// Open IndexedDB for auth and location queue storage
function openIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('PulseRelayDB', 2);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('auth')) {
                db.createObjectStore('auth', { keyPath: 'key' });
            }
            if (!db.objectStoreNames.contains('locationQueue')) {
                const locationStore = db.createObjectStore('locationQueue', { keyPath: 'id', autoIncrement: true });
                locationStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Get queued locations from IndexedDB
async function getQueuedLocations() {
    try {
        const db = await openIndexedDB();
        const transaction = db.transaction(['locationQueue'], 'readonly');
        const store = transaction.objectStore('locationQueue');
        const request = store.getAll();
        
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        return [];
    }
}

// Add location to queue
async function addToLocationQueue(locationData) {
    try {
        const db = await openIndexedDB();
        const transaction = db.transaction(['locationQueue'], 'readwrite');
        const store = transaction.objectStore('locationQueue');
        await store.add({
            ...locationData,
            queuedAt: Date.now()
        });
    } catch (error) {
        // Failed to queue location
    }
}

// Remove location from queue
async function removeFromLocationQueue(id) {
    try {
        const db = await openIndexedDB();
        const transaction = db.transaction(['locationQueue'], 'readwrite');
        const store = transaction.objectStore('locationQueue');
        await store.delete(id);
    } catch (error) {
        // Failed to remove from queue
    }
}

// Handle messages from main thread
self.addEventListener('message', async (event) => {
    if (event.data && event.data.type === 'STORE_AUTH_TOKEN') {
        try {
            const db = await openIndexedDB();
            const transaction = db.transaction(['auth'], 'readwrite');
            const store = transaction.objectStore('auth');
            await store.put({ key: 'authToken', value: event.data.token });
        } catch (error) {
            // Failed to store auth token
        }
    }
    
    if (event.data && event.data.type === 'QUEUE_LOCATION') {
        // Queue location update from main thread
        await addToLocationQueue(event.data.location);
        
        // Try to sync immediately if online
        if (navigator.onLine) {
            await syncLocationInBackground();
        } else {
            // Queue for background sync when back online
            await self.registration.sync.register(BACKGROUND_SYNC_TAG);
        }
    }
    
    if (event.data && event.data.type === 'START_BACKGROUND_TRACKING') {
        // Register periodic sync if supported (Android 16 supports this!)
        if ('periodicSync' in self.registration) {
            try {
                // Register with minimum interval (browser enforces actual interval)
                await self.registration.periodicSync.register('periodic-location-sync', {
                    minInterval: 30 * 1000 // 30 seconds - Android will enforce battery-aware intervals
                });
            } catch (error) {
                // Silently ignore - periodic sync not available or permission denied
            }
        }
    }
    
    if (event.data && event.data.type === 'STOP_BACKGROUND_TRACKING') {
        // Unregister periodic sync
        if ('periodicSync' in self.registration) {
            try {
                await self.registration.periodicSync.unregister('periodic-location-sync');
            } catch (error) {
                // Silently ignore
            }
        }
    }
});

// Handle push notifications (for keeping service worker alive)
self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : {};
    
    // Show notification to user if needed
    if (data.showNotification) {
        const options = {
            body: data.body || 'Location tracking active',
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: 'location-tracking',
            silent: !data.sound,
            requireInteraction: false
        };
        
        event.waitUntil(
            self.registration.showNotification(data.title || 'PulseRelay', options)
        );
    }
    
    // Update location in background
    event.waitUntil(syncLocationInBackground());
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then((clientList) => {
            // Focus existing window if open
            for (const client of clientList) {
                if (client.url.includes('/mobile') || client.url.includes('/dashboard')) {
                    return client.focus();
                }
            }
            // Open new window if none exists
            return clients.openWindow('/mobile');
        })
    );
});
