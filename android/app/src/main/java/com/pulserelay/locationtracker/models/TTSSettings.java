package com.pulserelay.locationtracker.models;

/**
 * Model for TTS OpenAI settings
 */
public class TTSSettings {
    private boolean ttsOpenaiEnabled;
    
    public TTSSettings(boolean ttsOpenaiEnabled) {
        this.ttsOpenaiEnabled = ttsOpenaiEnabled;
    }
    
    public boolean isTtsOpenaiEnabled() {
        return ttsOpenaiEnabled;
    }
    
    public void setTtsOpenaiEnabled(boolean ttsOpenaiEnabled) {
        this.ttsOpenaiEnabled = ttsOpenaiEnabled;
    }
}
