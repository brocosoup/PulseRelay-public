package com.pulserelay.locationtracker;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.location.Location;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.WindowManager;
import android.widget.RadioGroup;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import com.google.android.material.textfield.TextInputEditText;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.preference.PreferenceManager;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.switchmaterial.SwitchMaterial;
import com.pulserelay.locationtracker.api.ApiClient;
import com.pulserelay.locationtracker.api.LocationApiService;
import com.pulserelay.locationtracker.api.PictureApiService;
import com.pulserelay.locationtracker.auth.AuthManager;
import com.pulserelay.locationtracker.dialogs.MapPickerDialog;
import com.pulserelay.locationtracker.models.LocationSettings;
import com.pulserelay.locationtracker.models.LocationSettingsResponse;
import com.pulserelay.locationtracker.models.PictureUploadResponse;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.RequestBody;
import okhttp3.ResponseBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class MainActivity extends AppCompatActivity {
    
    private static final int PERMISSION_REQUEST_CODE = 1001;
    private static final int PHOTO_PERMISSION_REQUEST_CODE = 1002;
    private static final int PICK_IMAGE_REQUEST = 2001;
    private ActivityResultLauncher<Intent> pickMediaLauncher;
    private FusedLocationProviderClient fusedLocationClient;
    private MaterialButton sendLocationButton;
    private MaterialButton uploadPictureButton;
    private MaterialButton clearQueueButton;
    private SwitchMaterial trackingSwitch;
    private SwitchMaterial locationSharingSwitch;
    private SwitchMaterial ttsSwitch;
    private SwitchMaterial openaiSwitch;
    private SharedPreferences prefs;
    private AuthManager authManager;
    private LocationApiService locationApiService;
    private PictureApiService pictureApiService;
    private com.pulserelay.locationtracker.api.UserApiService userApiService;
    private SignalQualityHelper signalQualityHelper;
    private boolean isUpdatingLocationSharing = false;
    private boolean isUpdatingTrackingSwitch = false;
    private boolean isUpdatingTtsSwitch = false;
    private boolean isUpdatingOpenaiSwitch = false;
    private boolean isSilentUpdate = false;
    private boolean userStoppedService = false;
    
    // Location mode views
    private View locationModeLayout;
    private View fixedLocationLayout;
    private RadioGroup locationModeRadioGroup;
    private TextInputEditText latitudeInput;
    private TextInputEditText longitudeInput;
    private TextInputEditText locationNameInput;
    private MaterialButton pickOnMapButton;
    private MaterialButton saveFixedLocationButton;
    private MaterialButton useCurrentLocationButton;
    private String currentLocationMode = "gps";
    
    // Chat mode views
    private RadioGroup chatModeRadioGroup;
    private android.widget.RadioButton radioTtsMode;
    private android.widget.RadioButton radioNotificationMode;
    private Location lastGpsLocation = null;
    
    private BroadcastReceiver serviceStoppedReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            // Mark that user manually stopped the service
            userStoppedService = true;
            
            // Update UI when service stops
            isUpdatingTrackingSwitch = true;
            trackingSwitch.setChecked(false);
            isUpdatingTrackingSwitch = false;
            
            // Refresh location settings from server to sync toggle state (won't auto-restart)
            loadLocationSettings();
        }
    };
    
    private BroadcastReceiver ttsServiceStoppedReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            // Update TTS switch when service stops
            isUpdatingTtsSwitch = true;
            ttsSwitch.setChecked(false);
            chatModeRadioGroup.setVisibility(View.GONE);
            isUpdatingTtsSwitch = false;
        }
    };
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        
        // Initialize ActivityResultLauncher for picking media
        pickMediaLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (result.getResultCode() == RESULT_OK && result.getData() != null) {
                    handleMediaPickerResult(result.getData());
                }
            }
        );
        
        prefs = PreferenceManager.getDefaultSharedPreferences(this);
        authManager = AuthManager.getInstance(this);
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        signalQualityHelper = new SignalQualityHelper(this);
        
        sendLocationButton = findViewById(R.id.sendLocationButton);
        uploadPictureButton = findViewById(R.id.uploadPictureButton);
        clearQueueButton = findViewById(R.id.clearQueueButton);
        trackingSwitch = findViewById(R.id.trackingSwitch);
        locationSharingSwitch = findViewById(R.id.locationSharingSwitch);
        ttsSwitch = findViewById(R.id.ttsSwitch);
        openaiSwitch = findViewById(R.id.openaiSwitch);
        
        // Initialize location mode views
        locationModeLayout = findViewById(R.id.locationModeLayout);
        fixedLocationLayout = findViewById(R.id.fixedLocationLayout);
        locationModeRadioGroup = findViewById(R.id.locationModeRadioGroup);
        latitudeInput = findViewById(R.id.latitudeInput);
        longitudeInput = findViewById(R.id.longitudeInput);
        locationNameInput = findViewById(R.id.locationNameInput);
        pickOnMapButton = findViewById(R.id.pickOnMapButton);
        saveFixedLocationButton = findViewById(R.id.saveFixedLocationButton);
        useCurrentLocationButton = findViewById(R.id.useCurrentLocationButton);
        
        // Initialize chat mode views
        chatModeRadioGroup = findViewById(R.id.chatModeRadioGroup);
        radioTtsMode = findViewById(R.id.radioTtsMode);
        radioNotificationMode = findViewById(R.id.radioNotificationMode);
        
        // Initialize API services
        locationApiService = ApiClient.getRetrofitInstance(this).create(LocationApiService.class);
        pictureApiService = ApiClient.getRetrofitInstance(this).create(PictureApiService.class);
        userApiService = ApiClient.getRetrofitInstance(this).create(com.pulserelay.locationtracker.api.UserApiService.class);
        
        // Check if service is running (set flag to prevent triggering listener)
        isUpdatingTrackingSwitch = true;
        trackingSwitch.setChecked(LocationService.isRunning);
        isUpdatingTrackingSwitch = false;
        
        // Check if TTS service is running
        isUpdatingTtsSwitch = true;
        ttsSwitch.setChecked(isServiceRunning(TTSService.class));
        isUpdatingTtsSwitch = false;
        
        // Load and set chat mode
        String savedChatMode = prefs.getString("chat_notification_mode", "tts");
        if ("notification".equals(savedChatMode)) {
            radioNotificationMode.setChecked(true);
        } else {
            radioTtsMode.setChecked(true);
        }
        
        // Show/hide chat mode selector based on TTS service state
        chatModeRadioGroup.setVisibility(isServiceRunning(TTSService.class) ? View.VISIBLE : View.GONE);
        
        sendLocationButton.setOnClickListener(v -> sendCurrentLocation());
        uploadPictureButton.setOnClickListener(v -> openImagePicker());
        clearQueueButton.setOnClickListener(v -> clearMediaQueue());
        
        trackingSwitch.setOnCheckedChangeListener((buttonView, isChecked) -> {
            if (!isUpdatingTrackingSwitch) {
                if (isChecked) {
                    userStoppedService = false; // Reset flag when user manually starts
                    startLocationService();
                } else {
                    stopLocationService();
                }
            }
        });
        
        ttsSwitch.setOnCheckedChangeListener((buttonView, isChecked) -> {
            if (!isUpdatingTtsSwitch) {
                // Show/hide chat mode selector
                chatModeRadioGroup.setVisibility(isChecked ? View.VISIBLE : View.GONE);
                
                if (isChecked) {
                    startTTSService();
                } else {
                    stopTTSService();
                }
            }
        });
        
        // Chat mode radio group listener
        chatModeRadioGroup.setOnCheckedChangeListener((group, checkedId) -> {
            String newMode;
            if (checkedId == R.id.radioNotificationMode) {
                newMode = "notification";
            } else {
                newMode = "tts";
            }
            
            // Save preference - service will pick it up on next message batch
            prefs.edit().putString("chat_notification_mode", newMode).apply();
        });
        
        // Load OpenAI state from server
        loadOpenAIState();
        
        // Update server when OpenAI toggle changes
        openaiSwitch.setOnCheckedChangeListener((buttonView, isChecked) -> {
            if (!isUpdatingOpenaiSwitch) {
                updateOpenAIState(isChecked);
            }
        });
        
        locationSharingSwitch.setOnCheckedChangeListener((buttonView, isChecked) -> {
            if (!isUpdatingLocationSharing) {
                // Show/hide location mode selector based on enabled state
                locationModeLayout.setVisibility(isChecked ? View.VISIBLE : View.GONE);
                
                // Show/hide send location button based on enabled state
                sendLocationButton.setVisibility(isChecked ? View.VISIBLE : View.GONE);
                
                // Update fixed location layout visibility based on current mode
                if (isChecked && "fixed".equals(currentLocationMode)) {
                    fixedLocationLayout.setVisibility(View.VISIBLE);
                } else {
                    fixedLocationLayout.setVisibility(View.GONE);
                }
                
                // Enable/disable controls based on location sharing state
                updateControlsState(isChecked);
                
                // Only call API if user actually interacted with the switch
                if (buttonView.isPressed()) {
                    updateLocationSharing(isChecked);
                }
            }
        });
        
        // Location mode radio group listener
        locationModeRadioGroup.setOnCheckedChangeListener((group, checkedId) -> {
            // Don't trigger updates during state restoration
            if (isUpdatingLocationSharing) {
                return;
            }
            
            if (checkedId == R.id.radioFixed) {
                currentLocationMode = "fixed";
                fixedLocationLayout.setVisibility(View.VISIBLE);
            } else {
                currentLocationMode = "gps";
                fixedLocationLayout.setVisibility(View.GONE);
            }
            
            // Save mode to preferences and notify LocationService if it's running
            SharedPreferences.Editor editor = prefs.edit();
            editor.putString("location_mode", currentLocationMode);
            editor.apply();
            
            // Sync mode to server if location sharing is enabled and user interacted with radio
            View selectedRadio = findViewById(checkedId);
            if (locationSharingSwitch.isChecked() && selectedRadio != null && selectedRadio.isPressed()) {
                isSilentUpdate = true;
                updateLocationSharing(true);
            }
            
            if (LocationService.isRunning) {
                Intent modeChangedIntent = new Intent(LocationService.ACTION_MODE_CHANGED);
                modeChangedIntent.setPackage(getPackageName());
                sendBroadcast(modeChangedIntent);
            }
        });
        
        // Map picker button listener
        pickOnMapButton.setOnClickListener(v -> showMapPicker());
        
        // Use current location button listener
        useCurrentLocationButton.setOnClickListener(v -> useCurrentLocation());
        
        // Save fixed location button listener
        saveFixedLocationButton.setOnClickListener(v -> {
            saveFixedLocationLocally();
        });
        
        // Add text change listeners to enable save button when user edits fields
        android.text.TextWatcher textWatcher = new android.text.TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            
            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {}
            
            @Override
            public void afterTextChanged(android.text.Editable s) {
                // Enable save button when user manually edits any field
                saveFixedLocationButton.setEnabled(true);
                saveFixedLocationButton.setAlpha(1.0f);
            }
        };
        
        latitudeInput.addTextChangedListener(textWatcher);
        longitudeInput.addTextChangedListener(textWatcher);
        locationNameInput.addTextChangedListener(textWatcher);
        
        // Initially disable save button (will be enabled after load or manual edit)
        saveFixedLocationButton.setEnabled(false);
        saveFixedLocationButton.setAlpha(0.5f);
        
        // Request permissions
        checkPermissions();
        
        // Restore last used location mode from local storage (authoritative)
        restoreLocationMode();
        
        // Load location sharing settings
        loadLocationSettings();
        
        // Load locally saved fixed location from SharedPreferences
        loadFixedLocationFromPreferences();
        
        // Initialize controls as disabled until settings are loaded
        updateControlsState(false);
    }
    
    @Override
    protected void onResume() {
        super.onResume();
        android.util.Log.d("PulseRelay", "MainActivity.onResume() - starting");
        
        // Update tracking switch state when activity resumes (important for app restart)
        // Use postDelayed to ensure service has started and updated its static flag
        trackingSwitch.postDelayed(() -> {
            isUpdatingTrackingSwitch = true;
            trackingSwitch.setChecked(LocationService.isRunning);
            isUpdatingTrackingSwitch = false;
        }, 100);
        
        // Reload location sharing settings (will auto-start if needed)
        loadLocationSettings();
        
        // Register broadcast receiver
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(
                serviceStoppedReceiver,
                new IntentFilter(LocationService.ACTION_SERVICE_STOPPED),
                android.content.Context.RECEIVER_NOT_EXPORTED
            );
            registerReceiver(
                ttsServiceStoppedReceiver,
                new IntentFilter(TTSService.ACTION_SERVICE_STOPPED),
                android.content.Context.RECEIVER_NOT_EXPORTED
            );
        } else {
            registerReceiver(
                serviceStoppedReceiver,
                new IntentFilter(LocationService.ACTION_SERVICE_STOPPED)
            );
            registerReceiver(
                ttsServiceStoppedReceiver,
                new IntentFilter(TTSService.ACTION_SERVICE_STOPPED)
            );
        }
        
        // Apply keep screen on setting
        applyKeepScreenOnSetting();
        
        android.util.Log.d("PulseRelay", "MainActivity.onResume() - complete");
    }
    
    @Override
    protected void onPause() {
        super.onPause();
        // Unregister broadcast receivers
        try {
            unregisterReceiver(serviceStoppedReceiver);
        } catch (IllegalArgumentException e) {
            // Receiver not registered, ignore
        }
        try {
            unregisterReceiver(ttsServiceStoppedReceiver);
        } catch (IllegalArgumentException e) {
            // Receiver not registered, ignore
        }
    }
    
    @Override
    protected void onDestroy() {
        super.onDestroy();
        android.util.Log.d("PulseRelay", "MainActivity destroyed");
    }
    
    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.main_menu, menu);
        // Hide dashboard item since we're already on the dashboard
        MenuItem dashboardItem = menu.findItem(R.id.action_dashboard);
        if (dashboardItem != null) {
            dashboardItem.setVisible(false);
        }
        return true;
    }
    
    @Override
    public boolean onOptionsItemSelected(@NonNull MenuItem item) {
        int id = item.getItemId();
        if (id == R.id.action_dashboard) {
            // Already in dashboard, do nothing
            return true;
        } else if (id == R.id.action_live_chat) {
            startActivity(new Intent(this, LiveChatActivity.class));
            return true;
        } else if (id == R.id.action_video_player) {
            startActivity(new Intent(this, VideoPlayerActivity.class));
            return true;
        } else if (id == R.id.action_stream_deck) {
            startActivity(new Intent(this, StreamDeckActivity.class));
            return true;
        } else if (id == R.id.action_settings) {
            startActivity(new Intent(this, SettingsActivity.class));
            return true;
        }
        return super.onOptionsItemSelected(item);
    }
    
    private void checkPermissions() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) 
                != PackageManager.PERMISSION_GRANTED) {
            // Request foreground location permissions first
            ActivityCompat.requestPermissions(this, 
                new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                }, PERMISSION_REQUEST_CODE);
        } else if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU 
                && ActivityCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) 
                != PackageManager.PERMISSION_GRANTED) {
            // Request notification permission for Android 13+ (required for foreground service)
            ActivityCompat.requestPermissions(this, 
                new String[]{Manifest.permission.POST_NOTIFICATIONS}, 
                PERMISSION_REQUEST_CODE + 1);
        } else if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q 
                && ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) 
                != PackageManager.PERMISSION_GRANTED) {
            // Request background location permission separately (Android 10+)
            ActivityCompat.requestPermissions(this, 
                new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, 
                PERMISSION_REQUEST_CODE + 2);
        }
    }
    
    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, 
                                          @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "Location permission granted", Toast.LENGTH_SHORT).show();
                // Request next permission in chain
                checkPermissions();
            } else {
                Toast.makeText(this, "Location permission denied - app won't work properly", Toast.LENGTH_LONG).show();
            }
        } else if (requestCode == PERMISSION_REQUEST_CODE + 1) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "Notification permission granted", Toast.LENGTH_SHORT).show();
                // Request next permission in chain
                checkPermissions();
            } else {
                Toast.makeText(this, "Notification permission denied - background tracking won't work", Toast.LENGTH_LONG).show();
            }
        } else if (requestCode == PERMISSION_REQUEST_CODE + 2) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "Background location permission granted", Toast.LENGTH_SHORT).show();
            } else {
                Toast.makeText(this, "Background permission denied - tracking may stop when app is closed", Toast.LENGTH_LONG).show();
            }
        } else if (requestCode == PHOTO_PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                // Permission granted, try opening picker again
                openImagePicker();
            } else {
                Toast.makeText(this, "Media permission denied - cannot select pictures/videos", Toast.LENGTH_LONG).show();
            }
        }
    }
    
    private void sendCurrentLocation() {
        String jwtToken = authManager.getToken() != null ? authManager.getToken() : "";
        if (jwtToken.isEmpty()) {
            Toast.makeText(this, "Please configure API Token in settings", Toast.LENGTH_LONG).show();
            startActivity(new Intent(this, SettingsActivity.class));
            return;
        }
        
        String apiUrl = prefs.getString("api_url", "https://pulse.brocosoup.fr");
        
        // Check if using fixed location mode
        if ("fixed".equals(currentLocationMode)) {
            sendFixedLocation(apiUrl);
            return;
        }
        
        // GPS mode - need location permission
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) 
                != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "Location permission not granted", Toast.LENGTH_SHORT).show();
            checkPermissions();
            return;
        }
        
        Toast.makeText(this, "Getting location...", Toast.LENGTH_SHORT).show();
        
        // Try to get last known location first
        fusedLocationClient.getLastLocation().addOnSuccessListener(this, location -> {
            if (location != null) {
                sendLocationToServer(location, apiUrl);
            } else {
                // If no last location, request a fresh location update
                requestFreshLocation(apiUrl);
            }
        }).addOnFailureListener(e -> {
            Toast.makeText(this, "Error getting location: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        });
    }
    
    private void sendFixedLocation(String apiUrl) {
        // Get fixed location from preferences
        if (!prefs.contains("fixed_latitude") || !prefs.contains("fixed_longitude")) {
            Toast.makeText(this, "Fixed location not set. Please configure it first.", Toast.LENGTH_LONG).show();
            return;
        }
        
        float fixedLat = 0f;
        float fixedLng = 0f;
        
        // Try Float first, fall back to String for migration
        try {
            fixedLat = prefs.getFloat("fixed_latitude", 0f);
            fixedLng = prefs.getFloat("fixed_longitude", 0f);
        } catch (ClassCastException e) {
            // Old data stored as String
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
                return;
            }
        }
        
        if (fixedLat == 0f && fixedLng == 0f) {
            Toast.makeText(this, "Fixed location not set. Please configure it first.", Toast.LENGTH_LONG).show();
            return;
        }
        
        // Create a fake Location object with fixed coordinates
        Location fixedLocation = new Location("fixed");
        fixedLocation.setLatitude(fixedLat);
        fixedLocation.setLongitude(fixedLng);
        fixedLocation.setAccuracy(0f);
        fixedLocation.setAltitude(0);
        fixedLocation.setSpeed(0f);
        fixedLocation.setBearing(0f);
        fixedLocation.setTime(System.currentTimeMillis());
        
        sendLocationToServer(fixedLocation, apiUrl);
    }
    
    private void requestFreshLocation(String apiUrl) {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) 
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        
        LocationRequest locationRequest = new LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY, 5000)
                .setMaxUpdates(1)
                .build();
        
        LocationCallback locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult locationResult) {
                if (locationResult != null && locationResult.getLastLocation() != null) {
                    Location location = locationResult.getLastLocation();
                    sendLocationToServer(location, apiUrl);
                    fusedLocationClient.removeLocationUpdates(this);
                }
            }
        };
        
        fusedLocationClient.requestLocationUpdates(locationRequest, locationCallback, getMainLooper());
    }
    
    private void sendLocationToServer(Location location, String apiUrl) {
        // Save last GPS location
        lastGpsLocation = location;
        
        String jwtToken = authManager.getToken() != null ? authManager.getToken() : "";
        String fullApiUrl = apiUrl + "/api/location/update";
        
        // Get GPS quality and GSM signal
        Integer gpsQuality = signalQualityHelper != null ? signalQualityHelper.getGpsQuality(location) : null;
        Integer gsmSignal = signalQualityHelper != null ? signalQualityHelper.getGsmSignal() : null;
        
        LocationSender.sendLocation(this, location, fullApiUrl, jwtToken, gpsQuality, gsmSignal, new LocationSender.Callback() {
            @Override
            public void onSuccess() {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, 
                    "Location sent: " + location.getLatitude() + ", " + location.getLongitude(), 
                    Toast.LENGTH_LONG).show());
            }
            
            @Override
            public void onError(String error, int statusCode) {
                runOnUiThread(() -> {
                    if (statusCode == 401) {
                        Toast.makeText(MainActivity.this, 
                            "Authentication failed. Please check your API Token in settings.", Toast.LENGTH_LONG).show();
                    } else if (statusCode == 403) {
                        Toast.makeText(MainActivity.this, 
                            "Unauthorized - Access forbidden", Toast.LENGTH_LONG).show();
                        // Stop tracking if it's running
                        if (LocationService.isRunning) {
                            stopLocationService();
                            isUpdatingTrackingSwitch = true;
                            trackingSwitch.setChecked(false);
                            isUpdatingTrackingSwitch = false;
                        }
                    } else {
                        Toast.makeText(MainActivity.this, 
                            "Error: " + error, Toast.LENGTH_SHORT).show();
                    }
                });
            }
        });
    }
    
    private void startLocationService() {
        String jwtToken = authManager.getToken() != null ? authManager.getToken() : "";
        if (jwtToken.isEmpty()) {
            Toast.makeText(this, "Please configure API Token in settings", Toast.LENGTH_LONG).show();
            isUpdatingTrackingSwitch = true;
            trackingSwitch.setChecked(false);
            isUpdatingTrackingSwitch = false;
            startActivity(new Intent(this, SettingsActivity.class));
            return;
        }
        
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) 
                != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "Location permission not granted", Toast.LENGTH_SHORT).show();
            isUpdatingTrackingSwitch = true;
            trackingSwitch.setChecked(false);
            isUpdatingTrackingSwitch = false;
            return;
        }
        
        Intent serviceIntent = new Intent(this, LocationService.class);
        startForegroundService(serviceIntent);
        Toast.makeText(this, "Location tracking started", Toast.LENGTH_SHORT).show();
    }
    
    private void stopLocationService() {
        Intent serviceIntent = new Intent(this, LocationService.class);
        stopService(serviceIntent);
        Toast.makeText(this, "Location tracking stopped", Toast.LENGTH_SHORT).show();
    }
    
    /**
     * Update enabled/disabled state of all location controls
     */
    private void updateControlsState(boolean enabled) {
        // Disable/enable send location button
        sendLocationButton.setEnabled(enabled);
        sendLocationButton.setAlpha(enabled ? 1.0f : 0.5f);
        
        // Disable/enable background tracking switch (but don't change its state)
        trackingSwitch.setEnabled(enabled);
        // Note: We don't stop the service here anymore - let user control it
        
        // Disable/enable location mode radio group
        locationModeRadioGroup.setEnabled(enabled);
        for (int i = 0; i < locationModeRadioGroup.getChildCount(); i++) {
            locationModeRadioGroup.getChildAt(i).setEnabled(enabled);
        }
        
        // Disable/enable fixed location inputs and buttons
        latitudeInput.setEnabled(enabled);
        longitudeInput.setEnabled(enabled);
        locationNameInput.setEnabled(enabled);
        pickOnMapButton.setEnabled(enabled);
        saveFixedLocationButton.setEnabled(enabled);
    }
    
    /**
     * Load location sharing settings from server
     */
    private void loadLocationSettings() {
        String jwtToken = authManager.getToken() != null ? authManager.getToken() : "";
        if (jwtToken.isEmpty()) {
            // No token, can't load settings
            locationSharingSwitch.setEnabled(false);
            return;
        }
        
        locationSharingSwitch.setEnabled(false);
        
        locationApiService.getSettings().enqueue(new Callback<LocationSettingsResponse>() {
            @Override
            public void onResponse(Call<LocationSettingsResponse> call, Response<LocationSettingsResponse> response) {
                runOnUiThread(() -> {
                    if (response.isSuccessful() && response.body() != null) {
                        LocationSettingsResponse settingsResponse = response.body();
                        if (settingsResponse.isSuccess() && settingsResponse.getSettings() != null) {
                            LocationSettings settings = settingsResponse.getSettings();
                            
                            // Set flag BEFORE updating UI to prevent triggering change listener
                            isUpdatingLocationSharing = true;
                            
                            // Update enabled switch
                            locationSharingSwitch.setChecked(settings.isEnabled());
                            
                            // Show/hide location mode selector based on switch state
                            locationModeLayout.setVisibility(settings.isEnabled() ? View.VISIBLE : View.GONE);
                            
                            // Show/hide send location button based on switch state
                            sendLocationButton.setVisibility(settings.isEnabled() ? View.VISIBLE : View.GONE);
                            
                            // Show/hide fixed location layout based on enabled state AND current mode
                            if (settings.isEnabled() && "fixed".equals(currentLocationMode)) {
                                fixedLocationLayout.setVisibility(View.VISIBLE);
                            } else {
                                fixedLocationLayout.setVisibility(View.GONE);
                            }
                            
                            // Update controls state
                            updateControlsState(settings.isEnabled());
                            
                            // Auto-start tracking by setting toggle switch (will trigger service start via listener)
                            boolean autoStart = prefs.getBoolean("auto_start", false);
                            if (settings.isEnabled() && autoStart && !LocationService.isRunning && !userStoppedService) {
                                android.util.Log.d("PulseRelay", "Auto-start enabled and server confirms tracking enabled - enabling tracking switch");
                                // Set the switch which will trigger startLocationService via the listener
                                trackingSwitch.setChecked(true);
                            }
                            
                            // Stop background tracking if location sharing is disabled
                            if (!settings.isEnabled() && LocationService.isRunning) {
                                android.util.Log.d("PulseRelay", "Location sharing disabled on server - stopping background tracking");
                                stopLocationService();
                                // Update switch state after stopping service
                                isUpdatingTrackingSwitch = true;
                                trackingSwitch.setChecked(false);
                                isUpdatingTrackingSwitch = false;
                            }
                            
                            // Reset flag AFTER all UI updates to prevent triggering listeners
                            isUpdatingLocationSharing = false;
                        } else {
                            // Settings load failed but request succeeded - show mode layout
                            locationModeLayout.setVisibility(View.VISIBLE);
                        }
                    } else if (response.code() == 401) {
                        Toast.makeText(MainActivity.this, "Authentication failed. Please check your API Token.", Toast.LENGTH_SHORT).show();
                        // Show mode layout even on auth failure
                        locationModeLayout.setVisibility(View.VISIBLE);
                    } else {
                        // Other error - show mode layout
                        locationModeLayout.setVisibility(View.VISIBLE);
                    }
                    // Always enable the switch regardless of response
                    locationSharingSwitch.setEnabled(true);
                });
            }
            
            @Override
            public void onFailure(Call<LocationSettingsResponse> call, Throwable t) {
                runOnUiThread(() -> {
                    // Show mode layout even on failure
                    locationModeLayout.setVisibility(View.VISIBLE);
                    locationSharingSwitch.setEnabled(true);
                    // Silently fail, don't show error on startup
                });
            }
        });
    }
    
    /**
     * Load fixed location from local SharedPreferences
     * Handles migration from String to Float storage
     */
    private void loadFixedLocationFromPreferences() {
        // Temporarily disable save button while loading (prevent TextWatcher from enabling it)
        saveFixedLocationButton.setEnabled(false);
        saveFixedLocationButton.setAlpha(0.5f);
        
        // Try to load latitude - handle both Float and String (for migration)
        if (prefs.contains("fixed_latitude")) {
            try {
                float lat = prefs.getFloat("fixed_latitude", 0f);
                latitudeInput.setText(String.valueOf(lat));
            } catch (ClassCastException e) {
                // Old data stored as String, migrate to Float
                String latStr = prefs.getString("fixed_latitude", "");
                if (!latStr.isEmpty()) {
                    latitudeInput.setText(latStr);
                    // Migrate to Float
                    try {
                        float lat = Float.parseFloat(latStr);
                        prefs.edit().putFloat("fixed_latitude", lat).apply();
                    } catch (NumberFormatException ignored) {}
                }
            }
        }
        
        // Try to load longitude - handle both Float and String (for migration)
        if (prefs.contains("fixed_longitude")) {
            try {
                float lng = prefs.getFloat("fixed_longitude", 0f);
                longitudeInput.setText(String.valueOf(lng));
            } catch (ClassCastException e) {
                // Old data stored as String, migrate to Float
                String lngStr = prefs.getString("fixed_longitude", "");
                if (!lngStr.isEmpty()) {
                    longitudeInput.setText(lngStr);
                    // Migrate to Float
                    try {
                        float lng = Float.parseFloat(lngStr);
                        prefs.edit().putFloat("fixed_longitude", lng).apply();
                    } catch (NumberFormatException ignored) {}
                }
            }
        }
        
        String locationName = prefs.getString("fixed_location_name", "");
        if (!locationName.isEmpty()) {
            locationNameInput.setText(locationName);
        }
        if (!locationName.isEmpty()) {
            locationNameInput.setText(locationName);
        }
        
        // Keep button disabled after loading - only enable when user manually edits
        saveFixedLocationButton.setEnabled(false);
        saveFixedLocationButton.setAlpha(0.5f);
    }
    
    /**
     * Restore location mode from SharedPreferences
     */
    private void restoreLocationMode() {
        String savedMode = prefs.getString("location_mode", "gps");
        currentLocationMode = savedMode;
        
        // Only set radio button selection, not visibility
        // Visibility will be controlled by location sharing enabled state
        if ("fixed".equals(savedMode)) {
            locationModeRadioGroup.check(R.id.radioFixed);
        } else {
            locationModeRadioGroup.check(R.id.radioGps);
        }
    }
    
    /**
     * Update location sharing setting on server
     */
    private void updateLocationSharing(boolean enabled) {
        String jwtToken = authManager.getToken() != null ? authManager.getToken() : "";
        if (jwtToken.isEmpty()) {
            Toast.makeText(this, "Please configure API Token in settings", Toast.LENGTH_LONG).show();
            isUpdatingLocationSharing = true;
            locationSharingSwitch.setChecked(!enabled);
            isUpdatingLocationSharing = false;
            return;
        }
        
        // Validate fixed location if in fixed mode and enabling
        if (enabled && "fixed".equals(currentLocationMode)) {
            String latStr = latitudeInput.getText() != null ? latitudeInput.getText().toString().trim() : "";
            String lngStr = longitudeInput.getText() != null ? longitudeInput.getText().toString().trim() : "";
            
            // Normalize decimal separator (replace comma with period)
            latStr = latStr.replace(',', '.');
            lngStr = lngStr.replace(',', '.');
            
            if (latStr.isEmpty() || lngStr.isEmpty()) {
                Toast.makeText(this, "Please enter latitude and longitude for fixed location mode", Toast.LENGTH_LONG).show();
                isUpdatingLocationSharing = true;
                locationSharingSwitch.setChecked(false);
                isUpdatingLocationSharing = false;
                return;
            }
            
            try {
                double lat = Double.parseDouble(latStr);
                double lng = Double.parseDouble(lngStr);
                if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                    Toast.makeText(this, "Invalid coordinates. Lat: -90 to 90, Lng: -180 to 180", Toast.LENGTH_LONG).show();
                    isUpdatingLocationSharing = true;
                    locationSharingSwitch.setChecked(false);
                    isUpdatingLocationSharing = false;
                    return;
                }
            } catch (NumberFormatException e) {
                Toast.makeText(this, getString(R.string.invalid_coordinates), Toast.LENGTH_SHORT).show();
                isUpdatingLocationSharing = true;
                locationSharingSwitch.setChecked(false);
                isUpdatingLocationSharing = false;
                return;
            }
        }
        
        locationSharingSwitch.setEnabled(false);
        
        // Get update interval from SharedPreferences
        SharedPreferences prefs = getSharedPreferences("LocationTracker", MODE_PRIVATE);
        int savedUpdateInterval = prefs.getInt("update_interval", 30);
        
        LocationSettings settings = new LocationSettings();
        settings.setEnabled(enabled);
        settings.setLocationMode(currentLocationMode);
        settings.setAccuracyThreshold(5000);
        settings.setUpdateInterval(savedUpdateInterval);
        settings.setAutoDisableAfter(3600);
        
        // Add fixed location data if in fixed mode
        if (enabled && "fixed".equals(currentLocationMode)) {
            try {
                String latStr = latitudeInput.getText() != null ? latitudeInput.getText().toString().trim() : "";
                String lngStr = longitudeInput.getText() != null ? longitudeInput.getText().toString().trim() : "";
                
                // Normalize decimal separator (replace comma with period)
                latStr = latStr.replace(',', '.');
                lngStr = lngStr.replace(',', '.');
                
                settings.setFixedLatitude(Double.parseDouble(latStr));
                settings.setFixedLongitude(Double.parseDouble(lngStr));
                
                String locationName = locationNameInput.getText() != null ? locationNameInput.getText().toString().trim() : "";
                if (!locationName.isEmpty()) {
                    settings.setFixedLocationName(locationName);
                }
            } catch (NumberFormatException e) {
                // Should not happen due to validation above
            }
        }
        
        locationApiService.updateSettings(settings).enqueue(new Callback<LocationSettingsResponse>() {
            @Override
            public void onResponse(Call<LocationSettingsResponse> call, Response<LocationSettingsResponse> response) {
                runOnUiThread(() -> {
                    if (response.isSuccessful() && response.body() != null) {
                        LocationSettingsResponse settingsResponse = response.body();
                        if (settingsResponse.isSuccess()) {
                            if (!isSilentUpdate) {
                                // Show specific message for fixed location save
                                if (enabled && "fixed".equals(currentLocationMode)) {
                                    Toast.makeText(MainActivity.this, 
                                        "Fixed location saved successfully", 
                                        Toast.LENGTH_SHORT).show();
                                } else {
                                    Toast.makeText(MainActivity.this, 
                                        enabled ? "Location sharing enabled" : "Location sharing disabled", 
                                        Toast.LENGTH_SHORT).show();
                                }
                            }
                            isSilentUpdate = false;
                            locationSharingSwitch.setEnabled(true);
                            
                            // Update controls state after save
                            updateControlsState(enabled);
                            
                            // Save fixed coordinates to preferences for LocationService
                            if (enabled && "fixed".equals(currentLocationMode)) {
                                try {
                                    String latStr = latitudeInput.getText() != null ? latitudeInput.getText().toString().trim() : "";
                                    String lngStr = longitudeInput.getText() != null ? longitudeInput.getText().toString().trim() : "";
                                    latStr = latStr.replace(',', '.');
                                    lngStr = lngStr.replace(',', '.');
                                    
                                    SharedPreferences.Editor editor = prefs.edit();
                                    editor.putFloat("fixed_latitude", Float.parseFloat(latStr));
                                    editor.putFloat("fixed_longitude", Float.parseFloat(lngStr));
                                    editor.apply();
                                    
                                    // Notify LocationService that fixed coordinates changed
                                    if (LocationService.isRunning) {
                                        Intent modeChangedIntent = new Intent(LocationService.ACTION_MODE_CHANGED);
                                        modeChangedIntent.setPackage(getPackageName());
                                        sendBroadcast(modeChangedIntent);
                                    }
                                } catch (NumberFormatException e) {
                                    // Ignore
                                }
                            }
                            
                            // If disabled, stop background tracking
                            if (!enabled && LocationService.isRunning) {
                                stopLocationService();
                                isUpdatingTrackingSwitch = true;
                                trackingSwitch.setChecked(false);
                                isUpdatingTrackingSwitch = false;
                            }
                        } else {
                            Toast.makeText(MainActivity.this, "Failed to update settings", Toast.LENGTH_SHORT).show();
                            // Revert the switch
                            isUpdatingLocationSharing = true;
                            locationSharingSwitch.setChecked(!enabled);
                            isUpdatingLocationSharing = false;
                            locationSharingSwitch.setEnabled(true);
                        }
                    } else {
                        String errorMsg = "Failed to update settings";
                        if (response.code() == 401) {
                            errorMsg = "Authentication failed. Please check your API Token.";
                        } else if (response.code() == 403) {
                            errorMsg = "Access forbidden";
                        }
                        Toast.makeText(MainActivity.this, errorMsg, Toast.LENGTH_SHORT).show();
                        // Revert the switch
                        isUpdatingLocationSharing = true;
                        locationSharingSwitch.setChecked(!enabled);
                        isUpdatingLocationSharing = false;
                        locationSharingSwitch.setEnabled(true);
                    }
                });
            }
            
            @Override
            public void onFailure(Call<LocationSettingsResponse> call, Throwable t) {
                runOnUiThread(() -> {
                    Toast.makeText(MainActivity.this, "Network error: " + t.getMessage(), Toast.LENGTH_SHORT).show();
                    // Revert the switch
                    isUpdatingLocationSharing = true;
                    locationSharingSwitch.setChecked(!enabled);
                    isUpdatingLocationSharing = false;
                    locationSharingSwitch.setEnabled(true);
                });
            }
        });
    }
    
    /**
     * Use current GPS location as fixed location
     */
    private void useCurrentLocation() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) 
                != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "Location permission not granted", Toast.LENGTH_SHORT).show();
            checkPermissions();
            return;
        }
        
        Toast.makeText(this, "Getting current location...", Toast.LENGTH_SHORT).show();
        
        // Try to get last known location first
        fusedLocationClient.getLastLocation().addOnSuccessListener(this, location -> {
            if (location != null) {
                lastGpsLocation = location;
                latitudeInput.setText(String.format(java.util.Locale.US, "%.6f", location.getLatitude()));
                longitudeInput.setText(String.format(java.util.Locale.US, "%.6f", location.getLongitude()));
                
                // Auto-save to storage
                saveFixedLocationLocally();
                
                Toast.makeText(this, "Current location loaded and saved", Toast.LENGTH_SHORT).show();
            } else {
                // Request fresh location
                requestCurrentLocationForFixed();
            }
        }).addOnFailureListener(e -> {
            Toast.makeText(this, "Error getting location: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        });
    }
    
    private void requestCurrentLocationForFixed() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) 
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        
        LocationRequest locationRequest = new LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY, 5000)
                .setMaxUpdates(1)
                .build();
        
        LocationCallback locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult locationResult) {
                if (locationResult != null && locationResult.getLastLocation() != null) {
                    Location location = locationResult.getLastLocation();
                    lastGpsLocation = location;
                    latitudeInput.setText(String.format(java.util.Locale.US, "%.6f", location.getLatitude()));
                    longitudeInput.setText(String.format(java.util.Locale.US, "%.6f", location.getLongitude()));
                    
                    // Auto-save to storage
                    saveFixedLocationLocally();
                    
                    Toast.makeText(MainActivity.this, "Current location loaded and saved", Toast.LENGTH_SHORT).show();
                    fusedLocationClient.removeLocationUpdates(this);
                }
            }
        };
        
        fusedLocationClient.requestLocationUpdates(locationRequest, locationCallback, getMainLooper());
    }
    
    /**
     * Show map picker dialog to select fixed location
     */
    private void showMapPicker() {
        // Get current values if any
        double initialLat = 48.8566; // Default to Paris
        double initialLng = 2.3522;
        
        try {
            String latStr = latitudeInput.getText() != null ? latitudeInput.getText().toString().trim() : "";
            String lngStr = longitudeInput.getText() != null ? longitudeInput.getText().toString().trim() : "";
            
            // Normalize decimal separator (replace comma with period)
            latStr = latStr.replace(',', '.');
            lngStr = lngStr.replace(',', '.');
            
            if (!latStr.isEmpty() && !lngStr.isEmpty()) {
                initialLat = Double.parseDouble(latStr);
                initialLng = Double.parseDouble(lngStr);
            }
        } catch (NumberFormatException e) {
            // Use defaults
        }
        
        MapPickerDialog dialog = new MapPickerDialog(this, initialLat, initialLng, (latitude, longitude) -> {
            // Use Locale.US to always format with period decimal separator
            latitudeInput.setText(String.format(java.util.Locale.US, "%.6f", latitude));
            longitudeInput.setText(String.format(java.util.Locale.US, "%.6f", longitude));
            
            // Auto-save to storage when location is picked from map
            saveFixedLocationLocally();
        });
        
        dialog.show();
    }
    
    /**
     * Save fixed location to local storage AND send to server
     */
    private void saveFixedLocationLocally() {
        String latStr = latitudeInput.getText() != null ? latitudeInput.getText().toString().trim() : "";
        String lngStr = longitudeInput.getText() != null ? longitudeInput.getText().toString().trim() : "";
        String locationName = locationNameInput.getText() != null ? locationNameInput.getText().toString().trim() : "";
        
        // Normalize decimal separator (replace comma with period)
        latStr = latStr.replace(',', '.');
        lngStr = lngStr.replace(',', '.');
        
        if (latStr.isEmpty() || lngStr.isEmpty()) {
            Toast.makeText(this, "Please enter latitude and longitude", Toast.LENGTH_SHORT).show();
            return;
        }
        
        try {
            double lat = Double.parseDouble(latStr);
            double lng = Double.parseDouble(lngStr);
            
            if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                Toast.makeText(this, "Invalid coordinates", Toast.LENGTH_SHORT).show();
                return;
            }
            
            // Save to SharedPreferences as Float
            SharedPreferences.Editor editor = prefs.edit();
            editor.putFloat("fixed_latitude", (float)lat);
            editor.putFloat("fixed_longitude", (float)lng);
            if (!locationName.isEmpty()) {
                editor.putString("fixed_location_name", locationName);
            }
            editor.apply();
            
            // Notify LocationService to reload fixed location if it's running in fixed mode
            Intent intent = new Intent(LocationService.ACTION_MODE_CHANGED);
            intent.setPackage(getPackageName());
            sendBroadcast(intent);
            
            // Send to server API if authenticated
            String jwtToken = authManager.getToken() != null ? authManager.getToken() : "";
            if (!jwtToken.isEmpty()) {
                // Build settings object with current values
                int savedUpdateInterval = prefs.getInt("update_interval", 30);
                boolean isEnabled = locationSharingSwitch.isChecked();
                
                LocationSettings settings = new LocationSettings();
                settings.setEnabled(isEnabled);
                settings.setLocationMode(currentLocationMode);
                settings.setAccuracyThreshold(5000);
                settings.setUpdateInterval(savedUpdateInterval);
                settings.setAutoDisableAfter(3600);
                settings.setFixedLatitude(lat);
                settings.setFixedLongitude(lng);
                if (!locationName.isEmpty()) {
                    settings.setFixedLocationName(locationName);
                }
                
                // Send to server
                locationApiService.updateSettings(settings).enqueue(new Callback<LocationSettingsResponse>() {
                    @Override
                    public void onResponse(Call<LocationSettingsResponse> call, Response<LocationSettingsResponse> response) {
                        runOnUiThread(() -> {
                            if (response.isSuccessful() && response.body() != null && response.body().isSuccess()) {
                                Toast.makeText(MainActivity.this, "Fixed location saved", Toast.LENGTH_SHORT).show();
                            } else {
                                Toast.makeText(MainActivity.this, "Fixed location saved locally only", Toast.LENGTH_SHORT).show();
                            }
                            
                            // Disable save button after saving (will re-enable on manual edit)
                            saveFixedLocationButton.setEnabled(false);
                            saveFixedLocationButton.setAlpha(0.5f);
                        });
                    }
                    
                    @Override
                    public void onFailure(Call<LocationSettingsResponse> call, Throwable t) {
                        runOnUiThread(() -> {
                            Toast.makeText(MainActivity.this, "Fixed location saved locally only", Toast.LENGTH_SHORT).show();
                            
                            // Disable save button after saving (will re-enable on manual edit)
                            saveFixedLocationButton.setEnabled(false);
                            saveFixedLocationButton.setAlpha(0.5f);
                        });
                    }
                });
            } else {
                Toast.makeText(this, "Fixed location saved locally", Toast.LENGTH_SHORT).show();
                
                // Disable save button after saving (will re-enable on manual edit)
                saveFixedLocationButton.setEnabled(false);
                saveFixedLocationButton.setAlpha(0.5f);
            }
        } catch (NumberFormatException e) {
            Toast.makeText(this, "Invalid coordinates format", Toast.LENGTH_SHORT).show();
        }
    }
    
    /**
     * Apply keep screen on setting from preferences
     */
    private void applyKeepScreenOnSetting() {
        boolean keepScreenOn = prefs.getBoolean("keep_screen_on", true);
        if (keepScreenOn) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
    }
    
    /**
     * Open media picker to select pictures or videos
     */
    private void openImagePicker() {
        // Check for photo permissions first
        if (!hasPhotoPermission()) {
            requestPhotoPermission();
            return;
        }
        
        Intent intent = new Intent(Intent.ACTION_PICK);
        intent.setType("*/*"); // Allow any type
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "video/*"}); // Accept images and videos
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true); // Enable multiple selection
        pickMediaLauncher.launch(Intent.createChooser(intent, "Select Pictures/Videos"));
    }
    
    /**
     * Handle media picker result
     */
    private void handleMediaPickerResult(Intent data) {
        // Check if multiple images were selected
        if (data.getClipData() != null) {
            // Multiple images selected
            int count = data.getClipData().getItemCount();
            Toast.makeText(this, "Uploading " + count + " media...", Toast.LENGTH_SHORT).show();
            
            for (int i = 0; i < count; i++) {
                Uri imageUri = data.getClipData().getItemAt(i).getUri();
                uploadPicture(imageUri, i + 1, count);
            }
        } else if (data.getData() != null) {
            // Single image selected
            Uri imageUri = data.getData();
            uploadPicture(imageUri, 1, 1);
        }
    }
    
    /**
     * Check if we have permission to read photos and videos
     */
    private boolean hasPhotoPermission() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            // Android 13+ requires READ_MEDIA_IMAGES and READ_MEDIA_VIDEO
            return ActivityCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_IMAGES) 
                    == PackageManager.PERMISSION_GRANTED
                && ActivityCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_VIDEO)
                    == PackageManager.PERMISSION_GRANTED;
        } else {
            // Older versions use READ_EXTERNAL_STORAGE
            return ActivityCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) 
                    == PackageManager.PERMISSION_GRANTED;
        }
    }
    
    /**
     * Request photo and video permission
     */
    private void requestPhotoPermission() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            ActivityCompat.requestPermissions(this, 
                new String[]{
                    Manifest.permission.READ_MEDIA_IMAGES,
                    Manifest.permission.READ_MEDIA_VIDEO
                }, 
                PHOTO_PERMISSION_REQUEST_CODE);
        } else {
            ActivityCompat.requestPermissions(this, 
                new String[]{Manifest.permission.READ_EXTERNAL_STORAGE}, 
                PHOTO_PERMISSION_REQUEST_CODE);
        }
    }
    
    /**
     * Upload selected media (picture or video) to the overlay
     */
    private void uploadPicture(Uri imageUri, int position, int total) {
        String jwtToken = authManager.getToken() != null ? authManager.getToken() : "";
        if (jwtToken.isEmpty()) {
            Toast.makeText(this, "Please configure API Token in settings", Toast.LENGTH_LONG).show();
            startActivity(new Intent(this, SettingsActivity.class));
            return;
        }
        
        // Disable button only on first upload
        if (position == 1) {
            uploadPictureButton.setEnabled(false);
        }
        
        try {
            // Get file from URI
            File imageFile = getFileFromUri(imageUri);
            if (imageFile == null) {
                Toast.makeText(this, R.string.picture_upload_error, Toast.LENGTH_SHORT).show();
                uploadPictureButton.setEnabled(true);
                return;
            }
            
            // Get actual MIME type from URI
            String mimeType = getContentResolver().getType(imageUri);
            if (mimeType == null || (!mimeType.startsWith("image/") && !mimeType.startsWith("video/"))) {
                mimeType = "image/jpeg"; // Default fallback
            }
            
            // Create request body with proper MIME type
            RequestBody requestFile = RequestBody.create(imageFile, MediaType.parse(mimeType));
            MultipartBody.Part body = MultipartBody.Part.createFormData("picture", imageFile.getName(), requestFile);
            
            // Upload picture
            pictureApiService.uploadPicture(body).enqueue(new Callback<PictureUploadResponse>() {
                @Override
                public void onResponse(Call<PictureUploadResponse> call, Response<PictureUploadResponse> response) {
                    // Re-enable button after last upload
                    if (position == total) {
                        uploadPictureButton.setEnabled(true);
                    }
                    
                    if (response.isSuccessful() && response.body() != null && response.body().isSuccess()) {
                        String message = total > 1 ? 
                            "Uploaded " + position + "/" + total : 
                            getString(R.string.picture_uploaded);
                        Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show();
                        
                        // Clean up temp file
                        if (imageFile.getAbsolutePath().contains(getCacheDir().getAbsolutePath())) {
                            imageFile.delete();
                        }
                    } else {
                        String error = response.body() != null ? response.body().getError() : "Unknown error";
                        String message = total > 1 ? 
                            "Failed " + position + "/" + total + ": " + error : 
                            getString(R.string.picture_upload_error) + ": " + error;
                        Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show();
                    }
                }
                
                @Override
                public void onFailure(Call<PictureUploadResponse> call, Throwable t) {
                    // Re-enable button after last upload attempt
                    if (position == total) {
                        uploadPictureButton.setEnabled(true);
                    }
                    String message = total > 1 ? 
                        "Failed " + position + "/" + total + ": " + t.getMessage() : 
                        getString(R.string.picture_upload_error) + ": " + t.getMessage();
                    Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show();
                    
                    // Clean up temp file
                    if (imageFile.getAbsolutePath().contains(getCacheDir().getAbsolutePath())) {
                        imageFile.delete();
                    }
                }
            });
            
        } catch (Exception e) {
            uploadPictureButton.setEnabled(true);
            Toast.makeText(this, getString(R.string.picture_upload_error) + ": " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }
    
    /**
     * Convert URI to File for upload
     */
    private File getFileFromUri(Uri uri) {
        try {
            InputStream inputStream = getContentResolver().openInputStream(uri);
            if (inputStream == null) {
                return null;
            }
            
            // Get original filename
            String filename = "picture.jpg";
            Cursor cursor = getContentResolver().query(uri, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (nameIndex != -1) {
                    filename = cursor.getString(nameIndex);
                }
                cursor.close();
            }
            
            // Create temp file
            File tempFile = new File(getCacheDir(), filename);
            FileOutputStream outputStream = new FileOutputStream(tempFile);
            
            // Copy data
            byte[] buffer = new byte[4096];
            int bytesRead;
            while ((bytesRead = inputStream.read(buffer)) != -1) {
                outputStream.write(buffer, 0, bytesRead);
            }
            
            outputStream.close();
            inputStream.close();
            
            return tempFile;
        } catch (IOException e) {
            e.printStackTrace();
            return null;
        }
    }
    
    /**
     * Clear all queued media from the overlay
     */
    private void clearMediaQueue() {
        String jwtToken = authManager.getToken() != null ? authManager.getToken() : "";
        if (jwtToken.isEmpty()) {
            Toast.makeText(this, "Please configure API Token in settings", Toast.LENGTH_LONG).show();
            startActivity(new Intent(this, SettingsActivity.class));
            return;
        }
        
        clearQueueButton.setEnabled(false);
        
        pictureApiService.clearQueue().enqueue(new Callback<ResponseBody>() {
            @Override
            public void onResponse(Call<ResponseBody> call, Response<ResponseBody> response) {
                clearQueueButton.setEnabled(true);
                
                if (response.isSuccessful()) {
                    Toast.makeText(MainActivity.this, "✓ Queue cleared", Toast.LENGTH_SHORT).show();
                } else {
                    Toast.makeText(MainActivity.this, "✗ Failed to clear queue", Toast.LENGTH_SHORT).show();
                }
            }
            
            @Override
            public void onFailure(Call<ResponseBody> call, Throwable t) {
                clearQueueButton.setEnabled(true);
                Toast.makeText(MainActivity.this, "✗ Error: " + t.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
    }
    
    private void startTTSService() {
        Intent serviceIntent = new Intent(this, TTSService.class);
        startForegroundService(serviceIntent);
        Toast.makeText(this, "TTS service started", Toast.LENGTH_SHORT).show();
    }
    
    private void stopTTSService() {
        Intent serviceIntent = new Intent(this, TTSService.class);
        stopService(serviceIntent);
        Toast.makeText(this, "TTS service stopped", Toast.LENGTH_SHORT).show();
    }
    
    private void loadOpenAIState() {
        userApiService.getTTSSettings().enqueue(new Callback<com.pulserelay.locationtracker.models.TTSSettingsResponse>() {
            @Override
            public void onResponse(@NonNull Call<com.pulserelay.locationtracker.models.TTSSettingsResponse> call, 
                                 @NonNull Response<com.pulserelay.locationtracker.models.TTSSettingsResponse> response) {
                if (response.isSuccessful() && response.body() != null) {
                    boolean enabled = response.body().isTtsOpenaiEnabled();
                    isUpdatingOpenaiSwitch = true;
                    openaiSwitch.setChecked(enabled);
                    isUpdatingOpenaiSwitch = false;
                }
            }
            
            @Override
            public void onFailure(@NonNull Call<com.pulserelay.locationtracker.models.TTSSettingsResponse> call, 
                                @NonNull Throwable t) {
                // On failure, use default
                isUpdatingOpenaiSwitch = true;
                openaiSwitch.setChecked(true);
                isUpdatingOpenaiSwitch = false;
            }
        });
    }
    
    private void updateOpenAIState(boolean enabled) {
        com.pulserelay.locationtracker.models.TTSSettings settings = 
            new com.pulserelay.locationtracker.models.TTSSettings(enabled);
        
        userApiService.updateTTSSettings(settings).enqueue(new Callback<com.pulserelay.locationtracker.models.TTSSettingsResponse>() {
            @Override
            public void onResponse(@NonNull Call<com.pulserelay.locationtracker.models.TTSSettingsResponse> call, 
                                 @NonNull Response<com.pulserelay.locationtracker.models.TTSSettingsResponse> response) {
                if (response.isSuccessful() && response.body() != null) {
                    boolean updatedState = response.body().isTtsOpenaiEnabled();
                    openaiSwitch.setChecked(updatedState);
                    Toast.makeText(MainActivity.this, 
                        "OpenAI " + (updatedState ? "enabled" : "disabled"), 
                        Toast.LENGTH_SHORT).show();
                } else {
                    Toast.makeText(MainActivity.this, "Failed to update OpenAI setting", Toast.LENGTH_SHORT).show();
                }
            }
            
            @Override
            public void onFailure(@NonNull Call<com.pulserelay.locationtracker.models.TTSSettingsResponse> call, 
                                @NonNull Throwable t) {
                Toast.makeText(MainActivity.this, "Error: " + t.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
    }
    
    @SuppressWarnings("deprecation")
    private boolean isServiceRunning(Class<?> serviceClass) {
        android.app.ActivityManager manager = (android.app.ActivityManager) getSystemService(android.content.Context.ACTIVITY_SERVICE);
        for (android.app.ActivityManager.RunningServiceInfo service : manager.getRunningServices(Integer.MAX_VALUE)) {
            if (serviceClass.getName().equals(service.service.getClassName())) {
                return true;
            }
        }
        return false;
    }
}
