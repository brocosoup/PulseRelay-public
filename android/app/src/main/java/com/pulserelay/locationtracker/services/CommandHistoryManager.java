package com.pulserelay.locationtracker.services;

import android.content.Context;
import android.content.SharedPreferences;
import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.LinkedList;
import java.util.List;

/**
 * Manages command history storage (last 10 commands with timestamps)
 */
public class CommandHistoryManager {
    private static final String PREFS_NAME = "command_history";
    private static final String KEY_HISTORY = "history";
    private static final int MAX_HISTORY_SIZE = 10;
    
    private static CommandHistoryManager instance;
    private final SharedPreferences prefs;
    private final Gson gson;
    private LinkedList<CommandHistoryItem> history;
    
    public static class CommandHistoryItem {
        public String command;
        public String channel;
        public long timestamp;
        public boolean success;
        
        public CommandHistoryItem(String command, String channel, long timestamp, boolean success) {
            this.command = command;
            this.channel = channel;
            this.timestamp = timestamp;
            this.success = success;
        }
    }
    
    private CommandHistoryManager(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        gson = new Gson();
        loadHistory();
    }
    
    public static synchronized CommandHistoryManager getInstance(Context context) {
        if (instance == null) {
            instance = new CommandHistoryManager(context);
        }
        return instance;
    }
    
    /**
     * Add a command to history
     */
    public void addCommand(String command, String channel, boolean success) {
        CommandHistoryItem item = new CommandHistoryItem(
            command, 
            channel, 
            System.currentTimeMillis(), 
            success
        );
        
        history.addFirst(item);
        
        // Keep only last 10 commands
        if (history.size() > MAX_HISTORY_SIZE) {
            history.removeLast();
        }
        
        saveHistory();
    }
    
    /**
     * Get all command history
     */
    public List<CommandHistoryItem> getHistory() {
        return new ArrayList<>(history);
    }
    
    /**
     * Clear all command history
     */
    public void clearHistory() {
        history.clear();
        saveHistory();
    }
    
    /**
     * Get the most recent command
     */
    public CommandHistoryItem getLastCommand() {
        return history.isEmpty() ? null : history.getFirst();
    }
    
    private void loadHistory() {
        String json = prefs.getString(KEY_HISTORY, null);
        if (json != null) {
            Type type = new TypeToken<LinkedList<CommandHistoryItem>>(){}.getType();
            history = gson.fromJson(json, type);
        } else {
            history = new LinkedList<>();
        }
    }
    
    private void saveHistory() {
        String json = gson.toJson(history);
        prefs.edit().putString(KEY_HISTORY, json).apply();
    }
}
