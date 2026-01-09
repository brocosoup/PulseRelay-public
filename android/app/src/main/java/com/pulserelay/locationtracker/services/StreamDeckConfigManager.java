package com.pulserelay.locationtracker.services;

import android.content.Context;
import android.content.SharedPreferences;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;
import com.pulserelay.locationtracker.models.StreamDeckButton;
import com.pulserelay.locationtracker.models.StreamDeckConfig;

import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.List;

/**
 * Manager for persisting and loading pulse deck configurations
 */
public class StreamDeckConfigManager {
    private static final String PREFS_NAME = "stream_deck_config";
    private static final String KEY_CONFIG = "button_config";
    private static final String KEY_USE_CUSTOM = "use_custom_config";
    private static final String KEY_CATEGORY_ORDER = "category_order";
    private static final String KEY_BUTTON_ORDER_PREFIX = "button_order_";
    
    private final SharedPreferences prefs;
    private final Gson gson;
    
    public StreamDeckConfigManager(Context context) {
        this.prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        this.gson = new GsonBuilder().setPrettyPrinting().create();
    }
    
    /**
     * Save button configuration
     */
    public void saveConfig(List<StreamDeckButton> buttons) {
        StreamDeckConfig config = new StreamDeckConfig();
        config.buttons = buttons;
        config.lastModified = System.currentTimeMillis();
        
        String json = gson.toJson(config);
        prefs.edit()
            .putString(KEY_CONFIG, json)
            .putBoolean(KEY_USE_CUSTOM, true)
            .apply();
    }
    
    /**
     * Load saved configuration, or null if none exists
     */
    public List<StreamDeckButton> loadConfig() {
        if (!prefs.getBoolean(KEY_USE_CUSTOM, false)) {
            return null; // Use default buttons
        }
        
        String json = prefs.getString(KEY_CONFIG, null);
        if (json == null) {
            return null;
        }
        
        try {
            StreamDeckConfig config = gson.fromJson(json, StreamDeckConfig.class);
            return config != null ? config.buttons : null;
        } catch (Exception e) {
            return null;
        }
    }
    
    /**
     * Reset to default configuration
     */
    public void resetToDefaults() {
        prefs.edit()
            .remove(KEY_CONFIG)
            .remove(KEY_CATEGORY_ORDER)
            .putBoolean(KEY_USE_CUSTOM, false)
            .apply();
    }
    
    /**
     * Check if using custom configuration
     */
    public boolean isUsingCustomConfig() {
        return prefs.getBoolean(KEY_USE_CUSTOM, false);
    }
    
    /**
     * Save category sort order
     */
    public void saveCategoryOrder(List<String> categoryOrder) {
        String json = gson.toJson(categoryOrder);
        prefs.edit().putString(KEY_CATEGORY_ORDER, json).apply();
    }
    
    /**
     * Load category sort order, or null if none exists
     */
    public List<String> loadCategoryOrder() {
        String json = prefs.getString(KEY_CATEGORY_ORDER, null);
        if (json == null) {
            return null;
        }
        
        try {
            Type listType = new TypeToken<ArrayList<String>>(){}.getType();
            return gson.fromJson(json, listType);
        } catch (Exception e) {
            return null;
        }
    }
    
    /**
     * Save button order for a specific category (stores button titles in order)
     */
    public void saveButtonOrder(String categoryName, List<String> buttonTitles) {
        String key = KEY_BUTTON_ORDER_PREFIX + categoryName;
        String json = gson.toJson(buttonTitles);
        prefs.edit().putString(key, json).apply();
    }
    
    /**
     * Load button order for a specific category, or null if none exists
     */
    public List<String> loadButtonOrder(String categoryName) {
        String key = KEY_BUTTON_ORDER_PREFIX + categoryName;
        String json = prefs.getString(key, null);
        if (json == null) {
            return null;
        }
        
        try {
            Type listType = new TypeToken<ArrayList<String>>(){}.getType();
            return gson.fromJson(json, listType);
        } catch (Exception e) {
            return null;
        }
    }
}
