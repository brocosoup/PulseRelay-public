package com.pulserelay.locationtracker.api;

import com.pulserelay.locationtracker.models.ChatMessage;
import com.pulserelay.locationtracker.models.ChatResponse;
import com.pulserelay.locationtracker.models.CommandRequest;
import com.pulserelay.locationtracker.models.CommandResponse;

import java.util.List;

import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.DELETE;
import retrofit2.http.GET;
import retrofit2.http.POST;
import retrofit2.http.PUT;
import retrofit2.http.Path;

/**
 * Retrofit service interface for Twitch-related API endpoints
 */
public interface TwitchApiService {
    
    /**
     * Send a command to the Twitch bot
     * @param request Command request containing the command and target channel
     * @return CommandResponse with success status and message
     */
    @POST("/api/twitch/send-command")
    Call<CommandResponse> sendCommand(@Body CommandRequest request);
    
    /**
     * Get recent chat messages from Twitch
     * @return ChatResponse containing list of messages
     */
    @GET("/api/twitch/chat/recent")
    Call<ChatResponse> getChatMessages();
    
    /**
     * Clear all chat messages
     * @return CommandResponse with success status
     */
    @DELETE("/api/twitch/chat/clear")
    Call<CommandResponse> clearChatMessages();
    
    /**
     * Delete a specific message by ID
     * @param request Request with messageId
     * @return CommandResponse with success status
     */
    @POST("/api/twitch/delete-message")
    Call<CommandResponse> deleteMessage(@Body MessageActionRequest request);
    
    /**
     * Timeout a user for 60 seconds
     * @param request Request with username and optional duration
     * @return CommandResponse with success status
     */
    @POST("/api/twitch/timeout")
    Call<CommandResponse> timeoutUser(@Body TimeoutRequest request);
    
    /**
     * Mark chat messages as read
     * @return CommandResponse with success status
     */
    @POST("/api/twitch/chat/mark-read")
    Call<CommandResponse> markMessagesAsRead();
    
    /**
     * Get unread message count
     * @return UnreadCountResponse with count
     */
    @GET("/api/twitch/chat/unread-count")
    Call<UnreadCountResponse> getUnreadCount();
    
    /**
     * Set or update TTS alias for a username
     * @param username Twitch username
     * @param request Request with alias
     * @return CommandResponse with success status
     */
    @PUT("/api/user/aliases/{username}")
    Call<CommandResponse> setAlias(@Path("username") String username, @Body AliasRequest request);
    
    /**
     * Health check endpoint to verify server connectivity
     * @return PingResponse with status and timestamp
     */
    @GET("/api/stats/ping")
    Call<PingResponse> ping();
    
    /**
     * Response for unread count
     */
    class UnreadCountResponse {
        private boolean success;
        private int unreadCount;
        private String channel;
        private String note;
        
        public boolean isSuccess() {
            return success;
        }
        
        public int getUnreadCount() {
            return unreadCount;
        }
        
        public String getChannel() {
            return channel;
        }
        
        public String getNote() {
            return note;
        }
    }
    
    /**
     * Request body for message deletion
     */
    class MessageActionRequest {
        private String messageId;
        
        public MessageActionRequest(String messageId) {
            this.messageId = messageId;
        }
        
        public String getMessageId() {
            return messageId;
        }
    }
    
    /**
     * Request body for user timeout
     */
    class TimeoutRequest {
        private String username;
        private int duration;
        
        public TimeoutRequest(String username) {
            this.username = username;
            this.duration = 60; // Default 60 seconds
        }
        
        public TimeoutRequest(String username, int duration) {
            this.username = username;
            this.duration = duration;
        }
        
        public String getUsername() {
            return username;
        }
        
        public int getDuration() {
            return duration;
        }
    }
    
    /**
     * Request body for setting alias
     */
    class AliasRequest {
        private String alias;
        
        public AliasRequest(String alias) {
            this.alias = alias;
        }
        
        public String getAlias() {
            return alias;
        }
    }
    
    /**
     * Response for ping health check
     */
    class PingResponse {
        private String status;
        private long timestamp;
        
        public String getStatus() {
            return status;
        }
        
        public long getTimestamp() {
            return timestamp;
        }
        
        public boolean isOk() {
            return "ok".equals(status);
        }
    }
}

