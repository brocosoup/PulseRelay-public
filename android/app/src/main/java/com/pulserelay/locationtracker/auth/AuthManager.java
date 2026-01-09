package com.pulserelay.locationtracker.auth;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import java.io.IOException;
import java.security.GeneralSecurityException;

/**
 * Singleton manager for JWT authentication token storage and retrieval
 * Uses EncryptedSharedPreferences for secure token storage
 */
public class AuthManager {
    private static final String TAG = "AuthManager";
    private static final String PREFS_NAME = "pulserelay_auth";
    private static final String KEY_JWT_TOKEN = "jwt_token";
    
    private static AuthManager instance;
    private SharedPreferences encryptedPrefs;
    private Context context;
    
    private AuthManager(Context context) {
        this.context = context.getApplicationContext();
        initEncryptedPrefs();
    }
    
    /**
     * Get singleton instance
     */
    public static synchronized AuthManager getInstance(Context context) {
        if (instance == null && context != null) {
            instance = new AuthManager(context);
        }
        return instance;
    }
    
    /**
     * Initialize encrypted shared preferences
     */
    private void initEncryptedPrefs() {
        try {
            MasterKey masterKey = new MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build();
            
            encryptedPrefs = EncryptedSharedPreferences.create(
                    context,
                    PREFS_NAME,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (GeneralSecurityException | IOException e) {
            Log.e(TAG, "Failed to create encrypted preferences", e);
            // Fallback to regular SharedPreferences if encryption fails
            encryptedPrefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        }
    }
    
    /**
     * Save JWT token securely
     */
    public void saveToken(String token) {
        if (encryptedPrefs != null) {
            encryptedPrefs.edit()
                    .putString(KEY_JWT_TOKEN, token)
                    .apply();
            Log.d(TAG, "JWT token saved securely");
        }
    }
    
    /**
     * Get stored JWT token
     */
    public String getToken() {
        if (encryptedPrefs != null) {
            return encryptedPrefs.getString(KEY_JWT_TOKEN, null);
        }
        return null;
    }
    
    /**
     * Check if token exists
     */
    public boolean hasToken() {
        String token = getToken();
        return token != null && !token.isEmpty();
    }
    
    /**
     * Delete stored token (logout)
     */
    public void deleteToken() {
        if (encryptedPrefs != null) {
            encryptedPrefs.edit()
                    .remove(KEY_JWT_TOKEN)
                    .apply();
            Log.d(TAG, "JWT token deleted");
        }
    }
    
    /**
     * Validate token format (basic check)
     */
    public boolean isTokenValid(String token) {
        if (token == null || token.isEmpty()) {
            return false;
        }
        
        // Clean token - remove any whitespace
        String cleanToken = token.replaceAll("\\s+", "");
        
        // JWT tokens have 3 parts separated by dots
        // Use Pattern.quote to avoid regex issues, but for dots we need literal split
        String[] parts = cleanToken.split("\\.");
        
        // Debug logging
        Log.d(TAG, "Token validation - parts count: " + parts.length);
        
        return parts.length == 3;
    }
}
