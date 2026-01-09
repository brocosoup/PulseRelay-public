package com.pulserelay.locationtracker.models;

import com.google.gson.annotations.SerializedName;

/**
 * Model for stream status information
 */
public class StreamStatus {
    @SerializedName("is_live")
    private boolean isLive;
    
    private String title;
    private String game;
    
    @SerializedName("viewer_count")
    private int viewerCount;
    
    @SerializedName("started_at")
    private String startedAt;
    
    private String thumbnail;
    
    @SerializedName("stream_key")
    private String streamKey;
    
    public boolean isLive() {
        return isLive;
    }
    
    public void setLive(boolean live) {
        isLive = live;
    }
    
    public String getTitle() {
        return title;
    }
    
    public void setTitle(String title) {
        this.title = title;
    }
    
    public String getGame() {
        return game;
    }
    
    public void setGame(String game) {
        this.game = game;
    }
    
    public int getViewerCount() {
        return viewerCount;
    }
    
    public void setViewerCount(int viewerCount) {
        this.viewerCount = viewerCount;
    }
    
    public String getStartedAt() {
        return startedAt;
    }
    
    public void setStartedAt(String startedAt) {
        this.startedAt = startedAt;
    }
    
    public String getThumbnail() {
        return thumbnail;
    }
    
    public void setThumbnail(String thumbnail) {
        this.thumbnail = thumbnail;
    }
    
    public String getStreamKey() {
        return streamKey;
    }
    
    public void setStreamKey(String streamKey) {
        this.streamKey = streamKey;
    }
}
