package com.pulserelay.locationtracker.models;

/**
 * Request model for sending Twitch bot commands
 */
public class CommandRequest {
    private String command;
    private String targetChannel; // Optional - defaults to user's own channel
    
    public CommandRequest(String command) {
        this.command = command;
    }
    
    public CommandRequest(String command, String targetChannel) {
        this.command = command;
        this.targetChannel = targetChannel;
    }
    
    public String getCommand() {
        return command;
    }
    
    public void setCommand(String command) {
        this.command = command;
    }
    
    public String getTargetChannel() {
        return targetChannel;
    }
    
    public void setTargetChannel(String targetChannel) {
        this.targetChannel = targetChannel;
    }
}
