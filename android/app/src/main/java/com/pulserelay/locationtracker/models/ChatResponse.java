package com.pulserelay.locationtracker.models;

import java.util.List;

/**
 * Wrapper for chat API response
 */
public class ChatResponse {
    private boolean success;
    private List<ChatMessage> messages;
    private String channel;
    
    public boolean isSuccess() {
        return success;
    }
    
    public void setSuccess(boolean success) {
        this.success = success;
    }
    
    public List<ChatMessage> getMessages() {
        return messages;
    }
    
    public void setMessages(List<ChatMessage> messages) {
        this.messages = messages;
    }
    
    public String getChannel() {
        return channel;
    }
    
    public void setChannel(String channel) {
        this.channel = channel;
    }
}
