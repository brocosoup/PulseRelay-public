package com.pulserelay.locationtracker.models;

/**
 * Response model for TTS settings API calls
 */
public class TTSSettingsResponse {
    private boolean ttsOpenaiEnabled;
    private String message;
    
    public boolean isTtsOpenaiEnabled() {
        return ttsOpenaiEnabled;
    }
    
    public void setTtsOpenaiEnabled(boolean ttsOpenaiEnabled) {
        this.ttsOpenaiEnabled = ttsOpenaiEnabled;
    }
    
    public String getMessage() {
        return message;
    }
    
    public void setMessage(String message) {
        this.message = message;
    }
}
