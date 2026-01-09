package com.pulserelay.locationtracker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.preference.PreferenceManager;

import com.pulserelay.locationtracker.api.ApiClient;
import com.pulserelay.locationtracker.api.LocationApiService;
import com.pulserelay.locationtracker.auth.AuthManager;
import com.pulserelay.locationtracker.models.LocationSettings;
import com.pulserelay.locationtracker.models.LocationSettingsResponse;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class BootReceiver extends BroadcastReceiver {
    
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(context);
            boolean autoStart = prefs.getBoolean("auto_start", false);
            
            if (!autoStart) {
                android.util.Log.d("BootReceiver", "Auto-start disabled in preferences");
                return;
            }
            
            // Check with server if location sharing is enabled before starting
            AuthManager authManager = AuthManager.getInstance(context);
            String jwtToken = authManager.getToken();
            
            if (jwtToken == null || jwtToken.isEmpty()) {
                android.util.Log.d("BootReceiver", "No API token configured - skipping auto-start");
                return;
            }
            
            LocationApiService apiService = ApiClient.getRetrofitInstance(context).create(LocationApiService.class);
            
            apiService.getSettings().enqueue(new Callback<LocationSettingsResponse>() {
                @Override
                public void onResponse(Call<LocationSettingsResponse> call, Response<LocationSettingsResponse> response) {
                    if (response.isSuccessful() && response.body() != null) {
                        LocationSettingsResponse settingsResponse = response.body();
                        if (settingsResponse.isSuccess() && settingsResponse.getSettings() != null) {
                            LocationSettings settings = settingsResponse.getSettings();
                            
                            if (settings.isEnabled()) {
                                android.util.Log.d("BootReceiver", "Server confirms tracking enabled - starting LocationService");
                                Intent serviceIntent = new Intent(context, LocationService.class);
                                
                                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                    context.startForegroundService(serviceIntent);
                                } else {
                                    context.startService(serviceIntent);
                                }
                            } else {
                                android.util.Log.d("BootReceiver", "Location sharing disabled on server - not starting service");
                            }
                        }
                    } else {
                        android.util.Log.d("BootReceiver", "Failed to get settings from server - not starting service");
                    }
                }
                
                @Override
                public void onFailure(Call<LocationSettingsResponse> call, Throwable t) {
                    android.util.Log.d("BootReceiver", "Error checking server settings - not starting service: " + t.getMessage());
                }
            });
            
            // TTS service is NOT auto-started on boot
            // Service running state is the source of truth - if it was running before shutdown,
            // the system may restart it (START_STICKY), but we don't force it here
        }
    }
}
