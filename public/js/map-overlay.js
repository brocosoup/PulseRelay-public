let map, marker, status;
let lastUpdateTime = null;
let updateIntervalId = null;
let currentZoom = 15; // Track current zoom level for hysteresis

// Telemetry variables
let totalDistance = parseFloat(localStorage.getItem('telemetryDistance')) || 0;
let lastPosition = null;
let overlayToken = null; // Store overlay token from URL

// Initialize after DOM is loaded
let speedValue, speedMph, altitudeValue, altitudeFeet, distanceValue, distanceMiles;
let speedCard, altitudeCard, distanceCard;

function init() {
    status = document.getElementById('status');
    if (!status) return;
    
    // Extract token from URL
    const urlParams = new URLSearchParams(window.location.search);
    overlayToken = urlParams.get('token');
    
    if (!overlayToken) {
        status.textContent = 'Error: No overlay token provided';
        return;
    }
    
    // Initialize telemetry DOM elements here since they're in the DOM now
    speedValue = document.getElementById('speedValue');
    speedMph = document.getElementById('speedMph');
    altitudeValue = document.getElementById('altitudeValue');
    altitudeFeet = document.getElementById('altitudeFeet');
    distanceValue = document.getElementById('distanceValue');
    distanceMiles = document.getElementById('distanceMiles');
    speedCard = document.getElementById('speedCard');
    altitudeCard = document.getElementById('altitudeCard');
    distanceCard = document.getElementById('distanceCard');
    
    status.textContent = 'Initializing map...';
    
    map = L.map('map', { 
        zoomControl: false, 
        attributionControl: false 
    }).setView([40.7128, -74.0060], 10);
    
    // Map style options - uncomment one to use:
    
    // 1. Light gray with minimal details (great for overlay, clean and subtle)
    // L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png').addTo(map);
    
    // 2. Dark but not too dark (original with better visibility)
    // L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png').addTo(map);
    
    // 3. Voyager style (balanced colors, good contrast)
    // L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png').addTo(map);
    
    // 4. OpenStreetMap standard (bright, detailed, familiar)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    
    // 5. Stamen Toner Lite (minimalist black & white)
    // L.tileLayer('https://tiles.stadiamaps.com/tiles/stamen_toner_lite/{z}/{x}/{y}.png').addTo(map);
    
    // 6. CartoDB Positron (very light, subtle labels)
    // L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png').addTo(map);
    
    // 7. Esri World Street Map (clean, modern)
    // L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}').addTo(map);
    
    // 8. Esri World Imagery (satellite view)
    // L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}').addTo(map);
    
    status.textContent = 'Map ready, fetching location...';
    fetchLocation();
    
    // Update the time display every second
    updateIntervalId = setInterval(updateTimeDisplay, 1000);
}

function updateTimeDisplay() {
    if (lastUpdateTime && status) {
        const secondsSinceUpdate = Math.floor((Date.now() - lastUpdateTime) / 1000);
        status.textContent = `${secondsSinceUpdate}s ago`;
    }
}

function fetchLocation() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    fetch(`/api/overlay/location/current?token=${overlayToken}`, { 
        credentials: 'include',
        signal: controller.signal,
        cache: 'no-cache'
    })
        .then(response => {
            clearTimeout(timeoutId);
            if (!response.ok) {
                console.log('Map location fetch failed:', response.status, response.statusText);
                throw new Error(`HTTP ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            const mapElement = document.getElementById('map');
            
            if (data.enabled && data.location) {
                updateMap(data.location);
                updateTelemetry(data.location);
                
                // Use the actual timestamp from when the location was received from the client
                if (data.location.timestamp) {
                    // Parse the SQLite timestamp correctly (it's in UTC format)
                    // SQLite CURRENT_TIMESTAMP format: "YYYY-MM-DD HH:MM:SS"
                    const timestamp = data.location.timestamp;
                    // Add 'Z' to indicate UTC if not already present
                    const utcTimestamp = timestamp.includes('Z') ? timestamp : timestamp.replace(' ', 'T') + 'Z';
                    lastUpdateTime = new Date(utcTimestamp).getTime();
                } else {
                    lastUpdateTime = Date.now();
                }
                updateTimeDisplay();
                if (mapElement) mapElement.style.display = 'block';
                if (status) status.style.display = 'block';
            } else {
                status.textContent = 'Location disabled';
                lastUpdateTime = null;
                if (mapElement) mapElement.style.display = 'none';
                if (status) status.style.display = 'none';
                disableTelemetryCards();
                resetDistance();
            }
        })
        .catch((error) => {
            console.log('Map location fetch error:', error.name, error.message);
            status.textContent = 'Connection failed';
            lastUpdateTime = null;
            const mapElement = document.getElementById('map');
            if (mapElement) mapElement.style.display = 'none';
            if (status) status.style.display = 'none';
            disableTelemetryCards();
            resetDistance();
        });
}

function updateMap(location) {
    const pos = [location.latitude, location.longitude];
    
    if (marker) {
        marker.setLatLng(pos);
    } else {
        const icon = L.divIcon({
            html: '<div class="marker"></div>',
            className: '',
            iconSize: [26, 26],
            iconAnchor: [13, 13]
        });
        marker = L.marker(pos, { icon }).addTo(map);
    }
    
    // Dynamic zoom based on speed with hysteresis
    let zoomLevel = currentZoom; // Start with current zoom
    if (location.speed !== null && location.speed !== undefined) {
        const speedKmh = metersPerSecondToKmh(location.speed);
        
        // Hysteresis: different thresholds for zooming in vs out
        if (currentZoom === 17) {
            // From 17 (walking), need 10 km/h to zoom out to 15
            if (speedKmh >= 10) zoomLevel = 15;
        } else if (currentZoom === 15) {
            // From 15 (city), can zoom in at 3 km/h or out at 65 km/h
            if (speedKmh < 3) zoomLevel = 17;
            else if (speedKmh >= 65) zoomLevel = 13;
        } else if (currentZoom === 13) {
            // From 13 (highway), can zoom in at 55 km/h or out at 95 km/h
            if (speedKmh < 55) zoomLevel = 15;
            else if (speedKmh >= 95) zoomLevel = 11;
        } else if (currentZoom === 11) {
            // From 11 (high speed), need to drop below 85 km/h to zoom back in
            if (speedKmh < 85) zoomLevel = 13;
        } else {
            // Initial state - set zoom based on speed
            if (speedKmh < 5) zoomLevel = 17;
            else if (speedKmh < 60) zoomLevel = 15;
            else if (speedKmh < 90) zoomLevel = 13;
            else zoomLevel = 11;
        }
    }
    
    currentZoom = zoomLevel; // Update current zoom state
    map.setView(pos, zoomLevel);
}

document.addEventListener('DOMContentLoaded', init);
setInterval(fetchLocation, 5000);

// Telemetry functions
function updateTelemetry(location) {
    // Check if telemetry elements exist
    if (!speedValue || !altitudeValue || !distanceValue) return;
    
    // Update Speed
    if (location.speed !== null && location.speed !== undefined) {
        const speedKmph = metersPerSecondToKmh(location.speed);
        const speedMilesph = metersPerSecondToMph(location.speed);
        
        speedValue.textContent = speedKmph.toFixed(0);
        speedMph.textContent = `${speedMilesph.toFixed(1)} mph`;
        speedCard.classList.remove('disabled');
    } else {
        speedValue.textContent = '--';
        speedMph.textContent = '-- mph';
        speedCard.classList.add('disabled');
    }
    
    // Update Altitude
    if (location.altitude !== null && location.altitude !== undefined) {
        const altFeet = metersToFeet(location.altitude);
        
        altitudeValue.textContent = location.altitude.toFixed(0);
        altitudeFeet.textContent = `${altFeet.toFixed(0)} ft`;
        altitudeCard.classList.remove('disabled');
    } else {
        altitudeValue.textContent = '--';
        altitudeFeet.textContent = '-- ft';
        altitudeCard.classList.add('disabled');
    }
    
    // Update Distance (calculate from position changes)
    if (location.latitude && location.longitude) {
        if (lastPosition) {
            const distance = calculateDistance(
                lastPosition.latitude,
                lastPosition.longitude,
                location.latitude,
                location.longitude
            );
            
            // Only add to total if distance is reasonable (less than 1km between updates)
            if (distance < 1000) {
                totalDistance += distance;
            }
        }
        
        lastPosition = {
            latitude: location.latitude,
            longitude: location.longitude
        };
        
        const distanceKilometers = totalDistance / 1000;
        const distanceMilesCalc = metersToMiles(totalDistance);
        
        // Save to localStorage
        localStorage.setItem('telemetryDistance', totalDistance.toString());
        
        distanceValue.textContent = distanceKilometers.toFixed(2).replace('.', ',');
        distanceMiles.textContent = `${distanceMilesCalc.toFixed(2)} mi`;
        distanceCard.classList.remove('disabled');
    } else {
        distanceCard.classList.add('disabled');
    }
}

function disableTelemetryCards() {
    if (speedCard) speedCard.classList.add('disabled');
    if (altitudeCard) altitudeCard.classList.add('disabled');
    if (distanceCard) distanceCard.classList.add('disabled');
}

function resetDistance() {
    totalDistance = 0;
    lastPosition = null;
    localStorage.setItem('telemetryDistance', '0');
    if (distanceValue && distanceMiles) {
        distanceValue.textContent = '0,00';
        distanceMiles.textContent = '0.00 mi';
    }
}

// Conversion functions
function metersPerSecondToMph(mps) {
    return mps * 2.23694;
}

function metersPerSecondToKmh(mps) {
    return mps * 3.6;
}

function metersToFeet(meters) {
    return meters * 3.28084;
}

function metersToMiles(meters) {
    return meters * 0.000621371;
}

// Haversine formula for calculating distance between two GPS coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
}
