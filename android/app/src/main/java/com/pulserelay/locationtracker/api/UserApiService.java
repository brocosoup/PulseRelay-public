package com.pulserelay.locationtracker.api;

import com.pulserelay.locationtracker.models.TTSSettings;
import com.pulserelay.locationtracker.models.TTSSettingsResponse;

import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.GET;
import retrofit2.http.PUT;

/**
 * Retrofit service interface for user settings API endpoints
 */
public interface UserApiService {
    
    /**
     * Get user's TTS OpenAI settings
     * @return TTSSettingsResponse containing current settings
     */
    @GET("/api/user/tts-settings")
    Call<TTSSettingsResponse> getTTSSettings();
    
    /**
     * Update user's TTS OpenAI settings
     * @param settings Updated settings
     * @return TTSSettingsResponse with success status
     */
    @PUT("/api/user/tts-settings")
    Call<TTSSettingsResponse> updateTTSSettings(@Body TTSSettings settings);
    
    /**
     * Get user's TTS ignored users list
     * @return TTSIgnoredUsersResponse containing ignored users
     */
    @GET("/api/user/tts-ignored-users")
    Call<TTSIgnoredUsersResponse> getTTSIgnoredUsers();
    
    /**
     * Update user's TTS ignored users list
     * @param request Request containing ignored users list
     * @return TTSIgnoredUsersResponse with success status
     */
    @PUT("/api/user/tts-ignored-users")
    Call<TTSIgnoredUsersResponse> updateTTSIgnoredUsers(@Body TTSIgnoredUsersRequest request);
    
    /**
     * Get user's channels (own channel + additional monitored channels)
     * @return UserChannelsResponse containing channels list
     */
    @GET("/api/user/channels")
    Call<UserChannelsResponse> getUserChannels();
    
    /**
     * Request for updating TTS ignored users
     */
    class TTSIgnoredUsersRequest {
        private java.util.List<String> ignoredUsers;
        
        public TTSIgnoredUsersRequest(java.util.List<String> ignoredUsers) {
            this.ignoredUsers = ignoredUsers;
        }
        
        public java.util.List<String> getIgnoredUsers() {
            return ignoredUsers;
        }
    }
    
    /**
     * Response for TTS ignored users
     */
    class TTSIgnoredUsersResponse {
        private java.util.List<String> ignoredUsers;
        private String message;
        
        public java.util.List<String> getIgnoredUsers() {
            return ignoredUsers;
        }
        
        public String getMessage() {
            return message;
        }
    }
    
    /**
     * Response for user channels
     */
    class UserChannelsResponse {
        private boolean success;
        private String username;
        private java.util.List<String> channels;
        
        public boolean isSuccess() {
            return success;
        }
        
        public String getUsername() {
            return username;
        }
        
        public java.util.List<String> getChannels() {
            return channels;
        }
    }
}
