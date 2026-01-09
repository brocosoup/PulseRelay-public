package com.pulserelay.locationtracker.models;

import com.google.gson.annotations.SerializedName;

/**
 * Model for location sharing settings from server
 */
public class LocationSettings {
    
    @SerializedName("enabled")
    private boolean enabled;
    
    @SerializedName("locationMode")
    private String locationMode;
    
    @SerializedName("accuracyThreshold")
    private int accuracyThreshold;
    
    @SerializedName("updateInterval")
    private int updateInterval;
    
    @SerializedName("autoDisableAfter")
    private int autoDisableAfter;
    
    @SerializedName("fixedLatitude")
    private Double fixedLatitude;
    
    @SerializedName("fixedLongitude")
    private Double fixedLongitude;
    
    @SerializedName("fixedLocationName")
    private String fixedLocationName;
    
    public LocationSettings() {
        // Default constructor
    }
    
    public boolean isEnabled() {
        return enabled;
    }
    
    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }
    
    public String getLocationMode() {
        return locationMode;
    }
    
    public void setLocationMode(String locationMode) {
        this.locationMode = locationMode;
    }
    
    public int getAccuracyThreshold() {
        return accuracyThreshold;
    }
    
    public void setAccuracyThreshold(int accuracyThreshold) {
        this.accuracyThreshold = accuracyThreshold;
    }
    
    public int getUpdateInterval() {
        return updateInterval;
    }
    
    public void setUpdateInterval(int updateInterval) {
        this.updateInterval = updateInterval;
    }
    
    public int getAutoDisableAfter() {
        return autoDisableAfter;
    }
    
    public void setAutoDisableAfter(int autoDisableAfter) {
        this.autoDisableAfter = autoDisableAfter;
    }
    
    public Double getFixedLatitude() {
        return fixedLatitude;
    }
    
    public void setFixedLatitude(Double fixedLatitude) {
        this.fixedLatitude = fixedLatitude;
    }
    
    public Double getFixedLongitude() {
        return fixedLongitude;
    }
    
    public void setFixedLongitude(Double fixedLongitude) {
        this.fixedLongitude = fixedLongitude;
    }
    
    public String getFixedLocationName() {
        return fixedLocationName;
    }
    
    public void setFixedLocationName(String fixedLocationName) {
        this.fixedLocationName = fixedLocationName;
    }
}
