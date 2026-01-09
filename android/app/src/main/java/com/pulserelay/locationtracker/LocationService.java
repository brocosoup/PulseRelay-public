package com.pulserelay.locationtracker;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.preference.PreferenceManager;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.pulserelay.locationtracker.api.ApiClient;
import com.pulserelay.locationtracker.api.LocationApiService;
import com.pulserelay.locationtracker.auth.AuthManager;
import com.pulserelay.locationtracker.models.LocationSettings;
import com.pulserelay.locationtracker.models.LocationSettingsResponse;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class LocationService extends Service {
    
    private static final String CHANNEL_ID = "LocationServiceChannel";
    private static final int NOTIFICATION_ID = 1;
    private static final String ACTION_STOP = "com.pulserelay.locationtracker.STOP";
    public static final String ACTION_SERVICE_STOPPED = "com.pulserelay.locationtracker.SERVICE_STOPPED";
    public static final String ACTION_MODE_CHANGED = "com.pulserelay.locationtracker.MODE_CHANGED";
    public static boolean isRunning = false;
    
    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private SharedPreferences prefs;
    private AuthManager authManager;
    private NotificationManager notificationManager;
    private SignalQualityHelper signalQualityHelper;
    private int locationUpdateCount = 0;
    private String lastUpdateTime = "--:--";
    private SimpleDateFormat timeFormat = new SimpleDateFormat("HH:mm:ss", Locale.getDefault());
    private android.os.Handler fixedLocationHandler;
    private Runnable fixedLocationRunnable;
    private android.content.BroadcastReceiver modeChangeReceiver;
    
    // Adaptive tracking variables
    private float lastKnownSpeed = 0f;
    private long currentUpdateInterval = 30000L; // milliseconds
    private static final float SPEED_THRESHOLD_LOW = 1.0f; // m/s (~3.6 km/h)
    private static final float SPEED_THRESHOLD_MEDIUM = 5.0f; // m/s (~18 km/h)
    private static final float SPEED_THRESHOLD_HIGH = 15.0f; // m/s (~54 km/h)
    private static final float SPEED_THRESHOLD_VERY_HIGH = 30.0f; // m/s (~108 km/h)
    
    @Override
    public void onCreate() {
        super.onCreate();
        
        prefs = PreferenceManager.getDefaultSharedPreferences(this);
        authManager = AuthManager.getInstance(this);
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        notificationManager = getSystemService(NotificationManager.class);
        signalQualityHelper = new SignalQualityHelper(this);
        
        // Register broadcast receiver for mode changes
        modeChangeReceiver = new android.content.BroadcastReceiver() {
            @Override
            public void onReceive(android.content.Context context, Intent intent) {
                if (ACTION_MODE_CHANGED.equals(intent.getAction())) {
                    // Reload preferences and restart location updates with new mode
                    prefs = PreferenceManager.getDefaultSharedPreferences(LocationService.this);
                    stopLocationUpdates();
                    startLocationUpdates();
                }
            }
        };
        IntentFilter filter = new IntentFilter(ACTION_MODE_CHANGED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(modeChangeReceiver, filter, android.content.Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(modeChangeReceiver, filter);
        }
        
        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult locationResult) {
                if (locationResult != null) {
                    Location location = locationResult.getLastLocation();
                    if (location != null) {
                        // Update speed tracking
                        if (location.hasSpeed()) {
                            lastKnownSpeed = location.getSpeed();
                            // Check if we need to adjust update interval based on speed
                            adjustUpdateIntervalBasedOnSpeed();
                        }
                        
                        sendLocationToServer(location);
                        locationUpdateCount++;
                        lastUpdateTime = timeFormat.format(new Date());
                        updateNotification();
                    }
                }
            }
        };
    }
    
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Handle stop action from notification
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        
        createNotificationChannel();
        
        Notification notification = buildNotification();
        startForeground(NOTIFICATION_ID, notification);
        isRunning = true;
        
        startLocationUpdates();
        
        return START_STICKY;
    }
    
    private Notification buildNotification() {
        // Intent to open the app
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, notificationIntent,
                PendingIntent.FLAG_IMMUTABLE);
        
        // Intent to stop tracking
        Intent stopIntent = new Intent(this, LocationService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPendingIntent = PendingIntent.getService(this, 0, stopIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        
        // Get update interval
        int intervalSeconds = prefs.getInt("update_interval", 30);
        
        // Get current location mode
        String locationMode = prefs.getString("location_mode", "gps");
        String modeDisplay = "gps".equals(locationMode) ? "GPS" : "Fixed";
        
        // Build tracking status info
        String trackingInfo;
        if ("gps".equals(locationMode) && lastKnownSpeed > 0) {
            // Show speed and adaptive interval in GPS mode
            trackingInfo = String.format(Locale.getDefault(),
                    "Mode: %s (Adaptive)\nSpeed: %.1f km/h\nUpdates sent: %d\nLast update: %s\nBase interval: %d sec\nCurrent interval: %.1f sec",
                    modeDisplay, lastKnownSpeed * 3.6f, locationUpdateCount, lastUpdateTime, 
                    intervalSeconds, currentUpdateInterval / 1000f);
        } else {
            // Standard display for fixed mode or no speed data
            trackingInfo = String.format(Locale.getDefault(),
                    "Mode: %s\nUpdates sent: %d\nLast update: %s\nInterval: %d seconds",
                    modeDisplay, locationUpdateCount, lastUpdateTime, intervalSeconds);
        }
        
        // Build notification with expandable content
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("📍 PulseRelay Active")
                .setContentText("Tracking in background • " + modeDisplay + " mode")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentIntent(pendingIntent)
                .setOngoing(true)  // Makes it persistent and non-dismissible
                .setAutoCancel(false)  // Prevent dismissal on tap
                .setPriority(NotificationCompat.PRIORITY_LOW)  // Low priority = no sound
                .setCategory(NotificationCompat.CATEGORY_SERVICE)  // Mark as service notification
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setSound(null)  // Explicitly no sound
                .setVibrate(null)  // No vibration
                .setOnlyAlertOnce(true)  // Only alert on first notification, not updates
                .setStyle(new NotificationCompat.BigTextStyle()
                        .bigText(trackingInfo))
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPendingIntent)
                .build();
    }
    
    private void updateNotification() {
        if (notificationManager != null) {
            Notification notification = buildNotification();
            notificationManager.notify(NOTIFICATION_ID, notification);
        }
    }
    
    private void stopLocationUpdates() {
        // Stop GPS updates
        stopGPSLocationUpdates();
        // Stop fixed location updates
        if (fixedLocationHandler != null && fixedLocationRunnable != null) {
            fixedLocationHandler.removeCallbacks(fixedLocationRunnable);
        }
    }
    
    private void startLocationUpdates() {
        // Get location mode from preferences
        String locationMode = prefs.getString("location_mode", "gps");
        
        // Get update interval from preferences (default 30 seconds, minimum 5 seconds)
        int intervalSeconds = prefs.getInt("update_interval", 30);
        if (intervalSeconds < 5) {
            intervalSeconds = 5;  // Enforce minimum 5 seconds
        }
        long intervalMillis = intervalSeconds * 1000L;
        currentUpdateInterval = intervalMillis; // Store for adaptive tracking
        
        if ("fixed".equals(locationMode)) {
            // Use fixed location mode - send fixed coordinates periodically
            startFixedLocationUpdates(intervalMillis);
        } else {
            // Use GPS mode - request location updates from GPS
            startGPSLocationUpdates(intervalMillis);
        }
    }
    
    /**
     * Calculate adaptive update interval based on current speed.
     * Faster speeds = more frequent updates for better tracking accuracy.
     * @return Update interval in milliseconds
     */
    private long calculateAdaptiveInterval() {
        // Get base interval from settings
        int baseIntervalSeconds = prefs.getInt("update_interval", 30);
        if (baseIntervalSeconds < 5) {
            baseIntervalSeconds = 5;
        }
        long baseIntervalMillis = baseIntervalSeconds * 1000L;
        
        // If speed is very low or zero, use base interval
        if (lastKnownSpeed < SPEED_THRESHOLD_LOW) {
            return baseIntervalMillis;
        }
        
        // Adjust interval based on speed
        // Higher speed = shorter interval (more frequent updates)
        // All intervals are percentages of the base interval set in settings
        if (lastKnownSpeed >= SPEED_THRESHOLD_VERY_HIGH) {
            // Very high speed (>108 km/h): 20% of base interval
            return (long) (baseIntervalMillis * 0.20);
        } else if (lastKnownSpeed >= SPEED_THRESHOLD_HIGH) {
            // High speed (54-108 km/h): 33% of base interval
            return (long) (baseIntervalMillis * 0.33);
        } else if (lastKnownSpeed >= SPEED_THRESHOLD_MEDIUM) {
            // Medium speed (18-54 km/h): 50% of base interval
            return (long) (baseIntervalMillis * 0.50);
        } else {
            // Low speed (3.6-18 km/h): 75% of base interval
            return (long) (baseIntervalMillis * 0.75);
        }
    }
    
    /**
     * Adjust GPS update interval based on current speed.
     * Only applies in GPS mode, not fixed location mode.
     */
    private void adjustUpdateIntervalBasedOnSpeed() {
        String locationMode = prefs.getString("location_mode", "gps");
        
        // Only adjust in GPS mode
        if (!"gps".equals(locationMode)) {
            return;
        }
        
        long newInterval = calculateAdaptiveInterval();
        
        // Only restart updates if interval changed significantly (>2 seconds difference)
        if (Math.abs(newInterval - currentUpdateInterval) > 2000) {
            android.util.Log.d("LocationService", String.format(
                "Speed: %.2f m/s - Adjusting interval from %d to %d ms",
                lastKnownSpeed, currentUpdateInterval, newInterval));
            
            currentUpdateInterval = newInterval;
            
            // Restart GPS updates with new interval
            stopGPSLocationUpdates();
            startGPSLocationUpdates(currentUpdateInterval);
        }
    }
    
    /**
     * Start GPS location updates with specified interval
     */
    private void startGPSLocationUpdates(long intervalMillis) {
        LocationRequest locationRequest = new LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY, intervalMillis)
                .setMinUpdateIntervalMillis(intervalMillis / 2)
                .setWaitForAccurateLocation(false)
                .build();
        
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) 
                == PackageManager.PERMISSION_GRANTED) {
            fusedLocationClient.requestLocationUpdates(locationRequest, locationCallback, 
                    Looper.getMainLooper());
        }
    }
    
    /**
     * Stop GPS location updates only
     */
    private void stopGPSLocationUpdates() {
        if (fusedLocationClient != null && locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
        }
    }
    
    private void startFixedLocationUpdates(long intervalMillis) {
        // Stop GPS updates if running
        stopGPSLocationUpdates();
        
        // Get fixed location from preferences - handle both Float and String for migration
        float fixedLat = 0f;
        float fixedLng = 0f;
        
        try {
            fixedLat = prefs.getFloat("fixed_latitude", 0f);
            fixedLng = prefs.getFloat("fixed_longitude", 0f);
        } catch (ClassCastException e) {
            // Old data stored as String, migrate to Float
            try {
                String latStr = prefs.getString("fixed_latitude", "0");
                String lngStr = prefs.getString("fixed_longitude", "0");
                fixedLat = Float.parseFloat(latStr);
                fixedLng = Float.parseFloat(lngStr);
                // Migrate to Float
                prefs.edit()
                    .putFloat("fixed_latitude", fixedLat)
                    .putFloat("fixed_longitude", fixedLng)
                    .apply();
            } catch (NumberFormatException ex) {
                Toast.makeText(this, "Invalid fixed location data", Toast.LENGTH_SHORT).show();
                stopSelf();
                return;
            }
        }
        
        if (fixedLat == 0f && fixedLng == 0f) {
            Toast.makeText(this, "Fixed location not set", Toast.LENGTH_SHORT).show();
            stopSelf();
            return;
        }
        
        // Make variables effectively final for use in Runnable
        final float finalFixedLat = fixedLat;
        final float finalFixedLng = fixedLng;
        
        // Create a handler to send fixed location periodically
        fixedLocationHandler = new android.os.Handler(Looper.getMainLooper());
        fixedLocationRunnable = new Runnable() {
            @Override
            public void run() {
                // Create a fake Location object with fixed coordinates
                Location fixedLocation = new Location("fixed");
                fixedLocation.setLatitude(finalFixedLat);
                fixedLocation.setLongitude(finalFixedLng);
                fixedLocation.setAccuracy(0f);
                fixedLocation.setAltitude(0);
                fixedLocation.setSpeed(0f);
                fixedLocation.setBearing(0f);
                fixedLocation.setTime(System.currentTimeMillis());
                
                sendLocationToServer(fixedLocation, true);  // true = fixed location mode
                locationUpdateCount++;
                lastUpdateTime = timeFormat.format(new Date());
                updateNotification();
                
                // Schedule next update
                fixedLocationHandler.postDelayed(this, intervalMillis);
            }
        };
        
        // Start sending fixed location immediately, then repeat
        fixedLocationHandler.post(fixedLocationRunnable);
    }
    
    private void sendLocationToServer(Location location) {
        sendLocationToServer(location, false);  // false = dynamic location mode
    }
    
    private void sendLocationToServer(Location location, boolean isFixedMode) {
        String serverUrl = prefs.getString("api_url", "");
        String jwtToken = authManager != null && authManager.hasToken() ? authManager.getToken() : "";
        
        android.util.Log.d("LocationService", "sendLocationToServer - serverUrl: " + serverUrl + 
            ", hasToken: " + !jwtToken.isEmpty() + 
            ", lat: " + location.getLatitude() + 
            ", lng: " + location.getLongitude() + 
            ", isFixedMode: " + isFixedMode);
        
        if (serverUrl.isEmpty()) {
            android.util.Log.e("LocationService", "Server URL is empty!");
            return;
        }
        
        if (jwtToken.isEmpty()) {
            android.util.Log.e("LocationService", "JWT token is empty!");
            return;
        }
        
        if (!serverUrl.isEmpty() && !jwtToken.isEmpty()) {
            String apiUrl = serverUrl + "/api/location/update";
            
            // Get signal quality metrics
            // For fixed mode: GPS quality is always 100, GSM signal is real
            // For dynamic mode: Both are real
            Integer gpsQuality;
            if (isFixedMode) {
                gpsQuality = 100;  // Max GPS quality for fixed location
            } else {
                gpsQuality = signalQualityHelper != null ? signalQualityHelper.getGpsQuality(location) : null;
            }
            Integer gsmSignal = signalQualityHelper != null ? signalQualityHelper.getGsmSignal() : null;
            
            android.util.Log.d("LocationService", "GPS Quality: " + gpsQuality + ", GSM Signal: " + gsmSignal);
            
            LocationSender.sendLocation(this, location, apiUrl, jwtToken, gpsQuality, gsmSignal, new LocationSender.Callback() {
                @Override
                public void onSuccess() {
                    android.util.Log.d("LocationService", "Location sent successfully");
                }
                
                @Override
                public void onError(String error, int statusCode) {
                    android.util.Log.e("LocationService", "Location send error: " + error + " (status: " + statusCode + ")");
                    // If unauthorized (403), fetch settings from server to sync state
                    if (statusCode == 403) {
                        fetchSettingsAndSync();
                    }
                }
            });
        }
    }
    
    @Override
    public void onDestroy() {
        super.onDestroy();
        // Stop location updates
        stopLocationUpdates();
        
        // Clean up signal quality helper
        if (signalQualityHelper != null) {
            signalQualityHelper.cleanup();
            signalQualityHelper = null;
        }
        
        // Unregister broadcast receiver
        if (modeChangeReceiver != null) {
            unregisterReceiver(modeChangeReceiver);
        }
        
        isRunning = false;
        
        // Notify MainActivity that service has stopped
        Intent broadcastIntent = new Intent(ACTION_SERVICE_STOPPED);
        broadcastIntent.setPackage(getPackageName());
        sendBroadcast(broadcastIntent);
        
        // Show toast notification
        Toast.makeText(this, "Location tracking stopped", Toast.LENGTH_SHORT).show();
    }
    
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
    
    /**
     * Fetch settings from server and sync local state.
     * Called when receiving a 403 error to check if sharing was disabled.
     */
    private void fetchSettingsAndSync() {
        String serverUrl = prefs.getString("api_url", "");
        if (serverUrl.isEmpty()) {
            android.util.Log.e("LocationService", "Cannot fetch settings - no server URL");
            Toast.makeText(this, "Location sharing disabled", Toast.LENGTH_LONG).show();
            stopSelf();
            return;
        }
        
        try {
            LocationApiService apiService = ApiClient.getRetrofitInstance(this)
                    .create(LocationApiService.class);
            
            apiService.getSettings().enqueue(new Callback<LocationSettingsResponse>() {
                @Override
                public void onResponse(Call<LocationSettingsResponse> call, Response<LocationSettingsResponse> response) {
                    if (response.isSuccessful() && response.body() != null) {
                        LocationSettingsResponse settingsResponse = response.body();
                        if (settingsResponse.isSuccess() && settingsResponse.getSettings() != null) {
                            LocationSettings settings = settingsResponse.getSettings();
                            
                            // Update local preferences with server settings
                            SharedPreferences.Editor editor = prefs.edit();
                            editor.putBoolean("sharing_enabled", settings.isEnabled());
                            editor.putString("location_mode", settings.getLocationMode());
                            editor.putInt("accuracy_threshold", settings.getAccuracyThreshold());
                            editor.putInt("update_interval", settings.getUpdateInterval());
                            
                            if ("fixed".equals(settings.getLocationMode()) && 
                                settings.getFixedLatitude() != null && 
                                settings.getFixedLongitude() != null) {
                                editor.putFloat("fixed_latitude", settings.getFixedLatitude().floatValue());
                                editor.putFloat("fixed_longitude", settings.getFixedLongitude().floatValue());
                            }
                            
                            editor.apply();
                            
                            android.util.Log.i("LocationService", "Settings synced from server - sharing enabled: " + settings.isEnabled());
                            
                            // If sharing is disabled, stop the service
                            if (!settings.isEnabled()) {
                                Toast.makeText(LocationService.this, "Location sharing disabled on server", Toast.LENGTH_LONG).show();
                                stopSelf();
                            }
                        }
                    } else {
                        android.util.Log.e("LocationService", "Failed to fetch settings: " + response.code());
                        Toast.makeText(LocationService.this, "Location sharing disabled", Toast.LENGTH_LONG).show();
                        stopSelf();
                    }
                }
                
                @Override
                public void onFailure(Call<LocationSettingsResponse> call, Throwable t) {
                    android.util.Log.e("LocationService", "Error fetching settings: " + t.getMessage());
                    Toast.makeText(LocationService.this, "Location sharing disabled", Toast.LENGTH_LONG).show();
                    stopSelf();
                }
            });
        } catch (Exception e) {
            android.util.Log.e("LocationService", "Exception fetching settings: " + e.getMessage());
            Toast.makeText(this, "Location sharing disabled", Toast.LENGTH_LONG).show();
            stopSelf();
        }
    }
    
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel serviceChannel = new NotificationChannel(
                    CHANNEL_ID,
                    "Location Tracking",
                    NotificationManager.IMPORTANCE_LOW  // Low importance = no sound/vibration
            );
            serviceChannel.setDescription("Shows persistent notification while tracking location");
            serviceChannel.setShowBadge(false);
            serviceChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            serviceChannel.setSound(null, null);  // Explicitly disable sound
            serviceChannel.enableVibration(false);  // Disable vibration
            
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(serviceChannel);
            }
        }
    }
}
