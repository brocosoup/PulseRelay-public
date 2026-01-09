package com.pulserelay.locationtracker.models;

import com.google.gson.annotations.SerializedName;

/**
 * Model for Twitch bot status information
 */
public class TwitchStatus {
    private boolean connected;
    private String channel;
    
    @SerializedName("bot_username")
    private String botUsername;
    
    @SerializedName("last_command")
    private String lastCommand;
    
    @SerializedName("last_command_time")
    private long lastCommandTime;
    
    @SerializedName("commands_sent")
    private int commandsSent;
    
    public boolean isConnected() {
        return connected;
    }
    
    public void setConnected(boolean connected) {
        this.connected = connected;
    }
    
    public String getChannel() {
        return channel;
    }
    
    public void setChannel(String channel) {
        this.channel = channel;
    }
    
    public String getBotUsername() {
        return botUsername;
    }
    
    public void setBotUsername(String botUsername) {
        this.botUsername = botUsername;
    }
    
    public String getLastCommand() {
        return lastCommand;
    }
    
    public void setLastCommand(String lastCommand) {
        this.lastCommand = lastCommand;
    }
    
    public long getLastCommandTime() {
        return lastCommandTime;
    }
    
    public void setLastCommandTime(long lastCommandTime) {
        this.lastCommandTime = lastCommandTime;
    }
    
    public int getCommandsSent() {
        return commandsSent;
    }
    
    public void setCommandsSent(int commandsSent) {
        this.commandsSent = commandsSent;
    }
}
