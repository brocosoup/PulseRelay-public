package com.pulserelay.locationtracker.models;

import com.google.gson.annotations.SerializedName;

import java.util.Map;

/**
 * Model for Twitch chat messages
 */
public class ChatMessage {
    private String id;
    private String username;
    
    @SerializedName("display_name")
    private String displayName;
    
    private String message;
    
    @SerializedName("ttsMessage")
    private String ttsMessage;
    
    private long timestamp;
    
    @SerializedName("userColor")
    private String userColor;
    
    private boolean mod;
    private boolean subscriber;
    private boolean vip;
    private boolean broadcaster;
    
    @SerializedName("badge_info")
    private String badgeInfo;
    
    private Map<String, String> badges;
    
    // Server-side state for moderation actions
    @SerializedName("deleted")
    private boolean deleted = false;
    
    @SerializedName("userTimedOut")
    private boolean userTimedOut = false;
    
    @SerializedName("isSelf")
    private boolean isSelf = false;
    
    public String getId() {
        return id;
    }
    
    public void setId(String id) {
        this.id = id;
    }
    
    public String getUsername() {
        return username;
    }
    
    public void setUsername(String username) {
        this.username = username;
    }
    
    public String getDisplayName() {
        return displayName != null ? displayName : username;
    }
    
    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }
    
    public String getMessage() {
        return message;
    }
    
    public void setMessage(String message) {
        this.message = message;
    }
    
    public String getTtsMessage() {
        // Return TTS version if available, otherwise fall back to original
        return ttsMessage != null && !ttsMessage.isEmpty() ? ttsMessage : message;
    }
    
    public void setTtsMessage(String ttsMessage) {
        this.ttsMessage = ttsMessage;
    }
    
    public long getTimestamp() {
        return timestamp;
    }
    
    public void setTimestamp(long timestamp) {
        this.timestamp = timestamp;
    }
    
    public String getUserColor() {
        return userColor;
    }
    
    public void setUserColor(String userColor) {
        this.userColor = userColor;
    }
    
    public boolean isMod() {
        return mod;
    }
    
    public void setMod(boolean mod) {
        this.mod = mod;
    }
    
    public boolean isSubscriber() {
        return subscriber;
    }
    
    public void setSubscriber(boolean subscriber) {
        this.subscriber = subscriber;
    }
    
    public boolean isVip() {
        return vip;
    }
    
    public void setVip(boolean vip) {
        this.vip = vip;
    }
    
    public boolean isBroadcaster() {
        return broadcaster;
    }
    
    public void setBroadcaster(boolean broadcaster) {
        this.broadcaster = broadcaster;
    }
    
    public String getBadgeInfo() {
        return badgeInfo;
    }
    
    public void setBadgeInfo(String badgeInfo) {
        this.badgeInfo = badgeInfo;
    }
    
    public Map<String, String> getBadges() {
        return badges;
    }
    
    public void setBadges(Map<String, String> badges) {
        this.badges = badges;
    }
    
    public boolean isDeleted() {
        return deleted;
    }
    
    public void setDeleted(boolean deleted) {
        this.deleted = deleted;
    }
    
    public boolean isUserTimedOut() {
        return userTimedOut;
    }
    
    public void setUserTimedOut(boolean userTimedOut) {
        this.userTimedOut = userTimedOut;
    }
    
    public boolean isSelf() {
        return isSelf;
    }
    
    public void setSelf(boolean isSelf) {
        this.isSelf = isSelf;
    }
}
