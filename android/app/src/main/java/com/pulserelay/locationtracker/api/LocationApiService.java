package com.pulserelay.locationtracker.api;

import com.pulserelay.locationtracker.models.LocationSettings;
import com.pulserelay.locationtracker.models.LocationSettingsResponse;

import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.GET;
import retrofit2.http.PUT;

/**
 * Retrofit service interface for location settings API endpoints
 */
public interface LocationApiService {
    
    /**
     * Get user's location sharing settings
     * @return LocationSettingsResponse containing current settings
     */
    @GET("/api/location/settings")
    Call<LocationSettingsResponse> getSettings();
    
    /**
     * Update user's location sharing settings
     * @param settings Updated settings
     * @return LocationSettingsResponse with success status
     */
    @PUT("/api/location/settings")
    Call<LocationSettingsResponse> updateSettings(@Body LocationSettings settings);
}
