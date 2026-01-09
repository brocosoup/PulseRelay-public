let lastUpdateTime = null;
let updateIntervalId = null;
let totalDistance = parseFloat(localStorage.getItem('telemetryDistance')) || 0;
let lastPosition = null;
let overlayToken = null; // Store overlay token from URL

// DOM elements
const speedValue = document.getElementById('speedValue');
const speedMph = document.getElementById('speedMph');
const altitudeValue = document.getElementById('altitudeValue');
const altitudeFeet = document.getElementById('altitudeFeet');
const distanceValue = document.getElementById('distanceValue');
const distanceMiles = document.getElementById('distanceMiles');
const gpsQualityValue = document.getElementById('gpsQualityValue');
const gpsQualityStatus = document.getElementById('gpsQualityStatus');
const gsmSignalStatus = document.getElementById('gsmSignalStatus');
const statusText = document.getElementById('statusText');
const statusDot = document.querySelector('.status-dot');
const speedCard = document.getElementById('speedCard');
const altitudeCard = document.getElementById('altitudeCard');
const distanceCard = document.getElementById('distanceCard');
const gpsQualityCard = document.getElementById('gpsQualityCard');
const gsmSignalCard = document.getElementById('gsmSignalCard');
const telemetryContainer = document.querySelector('.telemetry-container');
const dateDisplay = document.getElementById('dateDisplay');
const timeDisplay = document.getElementById('timeDisplay');
const timeDisplayContainer = document.querySelector('.time-display');
const telemetryRows = document.querySelectorAll('.telemetry-row');

function init() {
    // Extract token from URL
    const urlParams = new URLSearchParams(window.location.search);
    overlayToken = urlParams.get('token');
    
    if (!overlayToken) {
        statusText.textContent = 'Error: No overlay token provided';
        return;
    }
    
    statusText.textContent = 'Initializing...';
    updateDateTime();
    fetchTelemetry();
    
    // Update the date/time display every second
    setInterval(updateDateTime, 1000);
    
    // Update the time display every second
    updateIntervalId = setInterval(updateTimeDisplay, 1000);
}

function updateTimeDisplay() {
    if (lastUpdateTime && statusText) {
        const secondsSinceUpdate = Math.floor((Date.now() - lastUpdateTime) / 1000);
        statusText.textContent = `${secondsSinceUpdate}s ago`;
        
        // Update status dot based on staleness
        if (secondsSinceUpdate > 30) {
            statusDot.className = 'status-dot stale';
        } else {
            statusDot.className = 'status-dot';
        }
    }
}

function fetchTelemetry() {
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
                console.log('Telemetry fetch failed:', response.status, response.statusText);
                throw new Error(`HTTP ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.enabled && data.location) {
                updateTelemetry(data.location);
                
                // Parse timestamp
                if (data.location.timestamp) {
                    const timestamp = data.location.timestamp;
                    const utcTimestamp = timestamp.includes('Z') ? timestamp : timestamp.replace(' ', 'T') + 'Z';
                    lastUpdateTime = new Date(utcTimestamp).getTime();
                } else {
                    lastUpdateTime = Date.now();
                }
                
                updateTimeDisplay();
                statusDot.className = 'status-dot';
                if (timeDisplayContainer) timeDisplayContainer.classList.remove('centered');
                telemetryRows.forEach(row => row.style.display = 'flex');
            } else if (data.stale) {
                statusText.textContent = 'Data stale';
                statusDot.className = 'status-dot stale';
                disableCards();
                if (timeDisplayContainer) timeDisplayContainer.classList.add('centered');
                telemetryRows.forEach(row => row.style.display = 'none');
                resetDistance();
            } else {
                statusText.textContent = 'Tracking disabled';
                statusDot.className = 'status-dot error';
                lastUpdateTime = null;
                disableCards();
                if (timeDisplayContainer) timeDisplayContainer.classList.add('centered');
                telemetryRows.forEach(row => row.style.display = 'none');
                resetDistance();
            }
        })
        .catch((error) => {
            clearTimeout(timeoutId);
            console.log('Telemetry fetch error:', error.name, error.message);
            statusText.textContent = 'Connection failed';
            statusDot.className = 'status-dot error';
            lastUpdateTime = null;
            disableCards();
            if (timeDisplayContainer) timeDisplayContainer.classList.add('centered');
            telemetryRows.forEach(row => row.style.display = 'none');
            resetDistance();
        });
}

function updateTelemetry(location) {
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
            // This prevents huge jumps from GPS inaccuracies
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
        
        // Use European comma format for kilometers
        distanceValue.textContent = distanceKilometers.toFixed(2).replace('.', ',');
        distanceMiles.textContent = `${distanceMilesCalc.toFixed(2)} mi`;
        distanceCard.classList.remove('disabled');
    } else {
        distanceCard.classList.add('disabled');
    }
    
    // Update GPS Quality
    if (location.gpsQuality !== null && location.gpsQuality !== undefined) {
        gpsQualityValue.textContent = location.gpsQuality.toFixed(0);
        
        // Determine quality status
        let qualityText = '';
        if (location.gpsQuality >= 80) {
            qualityText = 'Excellent';
        } else if (location.gpsQuality >= 60) {
            qualityText = 'Good';
        } else if (location.gpsQuality >= 40) {
            qualityText = 'Fair';
        } else if (location.gpsQuality >= 20) {
            qualityText = 'Poor';
        } else {
            qualityText = 'Very poor';
        }
        
        gpsQualityStatus.textContent = qualityText;
        gpsQualityCard.classList.remove('disabled');
    } else {
        gpsQualityValue.textContent = '--';
        gpsQualityStatus.textContent = 'No signal';
        gpsQualityCard.classList.add('disabled');
    }
    
    // Update GSM Signal Bars
    if (location.gsmSignal !== null && location.gsmSignal !== undefined) {
        // Convert percentage/value to bars (0-5)
        let bars = 0;
        if (location.gsmSignal >= 85) {
            bars = 5; // Excellent
        } else if (location.gsmSignal >= 65) {
            bars = 4; // Good
        } else if (location.gsmSignal >= 40) {
            bars = 3; // Fair
        } else if (location.gsmSignal >= 15) {
            bars = 2; // Poor
        } else if (location.gsmSignal > 0) {
            bars = 1; // Very poor
        }
        
        // If value is 0-5 (raw level), use it directly
        if (location.gsmSignal <= 5) {
            bars = location.gsmSignal;
        }
        
        // Update bar visualization
        const signalBarsContainer = document.getElementById('signalBars');
        const barElements = signalBarsContainer.querySelectorAll('.bar');
        barElements.forEach((bar, index) => {
            if (index < bars) {
                bar.classList.add('active');
            } else {
                bar.classList.remove('active');
            }
        });
        
        // Determine signal status text
        let signalText = '';
        if (bars === 5) signalText = 'Excellent';
        else if (bars === 4) signalText = 'Good';
        else if (bars === 3) signalText = 'Fair';
        else if (bars === 2) signalText = 'Poor';
        else if (bars === 1) signalText = 'Very poor';
        else signalText = 'No signal';
        
        gsmSignalStatus.textContent = signalText;
        gsmSignalCard.classList.remove('disabled');
    } else {
        // Clear all bars
        const signalBarsContainer = document.getElementById('signalBars');
        const barElements = signalBarsContainer.querySelectorAll('.bar');
        barElements.forEach(bar => bar.classList.remove('active'));
        
        gsmSignalStatus.textContent = 'No signal';
        gsmSignalCard.classList.add('disabled');
    }
}

function disableCards() {
    speedCard.classList.add('disabled');
    altitudeCard.classList.add('disabled');
    distanceCard.classList.add('disabled');
    gpsQualityCard.classList.add('disabled');
    gsmSignalCard.classList.add('disabled');
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

// Update date and time display
function updateDateTime() {
    const now = new Date();
    
    // Format date: "mercredi 1 janvier 2026"
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const formattedDate = now.toLocaleDateString('fr-FR', dateOptions);
    
    // Format time: "14:35:42"
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const formattedTime = `${hours}:${minutes}:${seconds}`;
    
    if (dateDisplay) dateDisplay.textContent = formattedDate;
    if (timeDisplay) timeDisplay.textContent = formattedTime;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);

// Fetch telemetry every 5 seconds
setInterval(fetchTelemetry, 5000);
