package com.pulserelay.locationtracker.models;

import java.util.List;

/**
 * Configuration container for pulse deck buttons
 */
public class StreamDeckConfig {
    public List<StreamDeckButton> buttons;
    public long lastModified;
    
    public StreamDeckConfig() {
        this.lastModified = System.currentTimeMillis();
    }
    
    public StreamDeckConfig(List<StreamDeckButton> buttons) {
        this.buttons = buttons;
        this.lastModified = System.currentTimeMillis();
    }
    
    public List<StreamDeckButton> getButtons() {
        return buttons;
    }
    
    public void setButtons(List<StreamDeckButton> buttons) {
        this.buttons = buttons;
        this.lastModified = System.currentTimeMillis();
    }
    
    public long getLastModified() {
        return lastModified;
    }
}
