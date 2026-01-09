package com.pulserelay.locationtracker.models;

import com.google.gson.annotations.SerializedName;

/**
 * Response wrapper for location settings API
 */
public class LocationSettingsResponse {
    
    @SerializedName("success")
    private boolean success;
    
    @SerializedName("settings")
    private LocationSettings settings;
    
    @SerializedName("message")
    private String message;
    
    public boolean isSuccess() {
        return success;
    }
    
    public void setSuccess(boolean success) {
        this.success = success;
    }
    
    public LocationSettings getSettings() {
        return settings;
    }
    
    public void setSettings(LocationSettings settings) {
        this.settings = settings;
    }
    
    public String getMessage() {
        return message;
    }
    
    public void setMessage(String message) {
        this.message = message;
    }
}
