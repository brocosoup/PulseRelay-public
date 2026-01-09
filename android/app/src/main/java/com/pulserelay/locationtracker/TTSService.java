package com.pulserelay.locationtracker;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.preference.PreferenceManager;

import com.pulserelay.locationtracker.api.ApiClient;
import com.pulserelay.locationtracker.api.TwitchApiService;
import com.pulserelay.locationtracker.models.ChatMessage;
import com.pulserelay.locationtracker.models.ChatResponse;

import java.util.List;
import java.util.Locale;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

/**
 * Foreground service for persistent TTS functionality
 * Based on LocationService architecture - no ViewModels, pure Service
 */
public class TTSService extends Service {
    private static final String TAG = "TTSService";
    private static final String CHANNEL_ID = "TTSServiceChannel";
    private static final String CHAT_CHANNEL_ID = "ChatNotificationChannel";
    private static final int NOTIFICATION_ID = 2001;
    private static final int CHAT_NOTIFICATION_BASE_ID = 3000;
    private static final String ACTION_STOP = "com.pulserelay.locationtracker.STOP_TTS";
    public static final String ACTION_SERVICE_STOPPED = "com.pulserelay.locationtracker.TTS_SERVICE_STOPPED";
    
    private static final long CHAT_POLL_INTERVAL = 3000; // 3 seconds
    
    private NotificationManager notificationManager;
    private SharedPreferences prefs;
    private TwitchApiService apiService;
    private Handler handler;
    private Runnable pollRunnable;
    private TextToSpeech tts;
    private boolean ttsInitialized = false;
    private long lastSpokenTimestamp = 0;
    private int messagesSpokenCount = 0;
    private int chatNotificationId = CHAT_NOTIFICATION_BASE_ID;
    
    @Override
    public void onCreate() {
        super.onCreate();
        
        prefs = PreferenceManager.getDefaultSharedPreferences(this);
        notificationManager = getSystemService(NotificationManager.class);
        apiService = ApiClient.getRetrofitInstance(this).create(TwitchApiService.class);
        handler = new Handler(Looper.getMainLooper());
        
        // Use current time as initial timestamp to only speak/notify new messages
        // This prevents reading old messages when service is first enabled
        lastSpokenTimestamp = System.currentTimeMillis();
        
        // Always initialize TTS (will only be used if mode is "tts")
        initializeTTS();
        
        Log.d(TAG, "TTSService created, lastSpokenTimestamp: " + lastSpokenTimestamp);
    }
    
    private void initializeTTS() {
        if (tts != null) {
            Log.d(TAG, "TTS already initialized");
            return;
        }
        
        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                ttsInitialized = true;
                
                // Get selected audio channel from preferences
                String selectedChannel = prefs.getString("tts_audio_channel", "navigation");
                int audioUsage;
                
                switch (selectedChannel) {
                    case "media":
                        audioUsage = android.media.AudioAttributes.USAGE_MEDIA;
                        break;
                    case "notification":
                        audioUsage = android.media.AudioAttributes.USAGE_NOTIFICATION;
                        break;
                    case "alarm":
                        audioUsage = android.media.AudioAttributes.USAGE_ALARM;
                        break;
                    case "voice":
                        audioUsage = android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION;
                        break;
                    case "navigation":
                    default:
                        audioUsage = android.media.AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE;
                        break;
                }
                
                tts.setAudioAttributes(new android.media.AudioAttributes.Builder()
                        .setUsage(audioUsage)
                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build());
                
                Log.d(TAG, "TTS initialized successfully with " + selectedChannel + " channel");
                
                // Auto-start polling now that TTS is ready
                startPolling();
            } else {
                Log.e(TAG, "TTS initialization failed");
            }
        });
    }
    
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Handle stop action from notification
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            Log.d(TAG, "Stop button pressed in notification");
            stopSelf();
            return START_NOT_STICKY;
        }
        
        createNotificationChannel();
        Notification notification = buildNotification();
        startForeground(NOTIFICATION_ID, notification);
        
        Log.d(TAG, "TTS Service started");
        return START_STICKY;
    }
    
    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null; // No binding needed - controlled via service start/stop only
    }
    
    @Override
    public void onDestroy() {
        super.onDestroy();
        
        Log.d(TAG, "TTSService onDestroy called");
        
        // Stop polling
        stopPolling();
        
        // Shutdown TTS engine
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
            ttsInitialized = false;
        }
        
        // Remove notification
        stopForeground(Service.STOP_FOREGROUND_REMOVE);
        if (notificationManager != null) {
            notificationManager.cancel(NOTIFICATION_ID);
        }
        
        // Notify MainActivity that service has stopped
        Intent broadcastIntent = new Intent(ACTION_SERVICE_STOPPED);
        broadcastIntent.setPackage(getPackageName());
        sendBroadcast(broadcastIntent);
        
        Log.d(TAG, "TTSService destroyed");
    }
    
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Service notification channel
            NotificationChannel serviceChannel = new NotificationChannel(
                    CHANNEL_ID,
                    "Chat Service",
                    NotificationManager.IMPORTANCE_LOW
            );
            serviceChannel.setDescription("Background chat monitoring service");
            serviceChannel.setSound(null, null);
            notificationManager.createNotificationChannel(serviceChannel);
            
            // Chat message notification channel
            NotificationChannel chatChannel = new NotificationChannel(
                    CHAT_CHANNEL_ID,
                    "Chat Messages",
                    NotificationManager.IMPORTANCE_HIGH
            );
            chatChannel.setDescription("Twitch chat message notifications");
            chatChannel.enableVibration(true);
            notificationManager.createNotificationChannel(chatChannel);
        }
    }
    
    private Notification buildNotification() {
        // Intent to open the app
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, notificationIntent,
                PendingIntent.FLAG_IMMUTABLE);
        
        // Intent to stop TTS
        Intent stopIntent = new Intent(this, TTSService.class);
        stopIntent.setAction(ACTION_STOP);
        
        // Use FLAG_MUTABLE for action buttons on Android 12+ to ensure intent is delivered
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_MUTABLE;
        } else {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        
        PendingIntent stopPendingIntent = PendingIntent.getService(this, 0, stopIntent, flags);
        
        // Build tracking status info
        String chatMode = prefs.getString("chat_notification_mode", "tts");
        String emoji = "tts".equals(chatMode) ? "🔊" : "💬";
        String action = "tts".equals(chatMode) ? "Reading" : "Monitoring";
        String statusInfo = String.format(Locale.getDefault(),
                "Messages processed: %d", messagesSpokenCount);
        
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(emoji + " PulseRelay Chat")
                .setContentText(action + " chat in background")
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setAutoCancel(false)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setSound(null)
                .setVibrate(null)
                .setOnlyAlertOnce(true)
                .setStyle(new NotificationCompat.BigTextStyle()
                        .bigText(statusInfo))
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPendingIntent)
                .build();
    }
    
    private void updateNotification() {
        if (notificationManager != null) {
            Notification notification = buildNotification();
            notificationManager.notify(NOTIFICATION_ID, notification);
        }
    }
    
    /**
     * Start polling for chat messages
     */
    private void startPolling() {
        if (!ttsInitialized) {
            Log.w(TAG, "TTS not initialized yet, cannot start polling");
            return;
        }
        
        // Use current time to only speak new messages
        lastSpokenTimestamp = System.currentTimeMillis();
        
        Log.d(TAG, "Starting TTS polling");
        
        pollRunnable = new Runnable() {
            @Override
            public void run() {
                fetchAndSpeakNewMessages();
                handler.postDelayed(this, CHAT_POLL_INTERVAL);
            }
        };
        
        handler.post(pollRunnable);
    }
    
    /**
     * Stop polling for chat messages
     */
    private void stopPolling() {
        if (handler != null && pollRunnable != null) {
            handler.removeCallbacks(pollRunnable);
        }
        
        // Stop any ongoing speech
        if (tts != null) {
            tts.stop();
        }
        
        Log.d(TAG, "Stopped TTS polling");
    }
    
    private void fetchAndSpeakNewMessages() {
        apiService.getChatMessages().enqueue(new Callback<ChatResponse>() {
            @Override
            public void onResponse(Call<ChatResponse> call, Response<ChatResponse> response) {
                if (response.isSuccessful() && response.body() != null && response.body().isSuccess()) {
                    List<ChatMessage> messages = response.body().getMessages();
                    speakNewMessages(messages);
                }
            }
            
            @Override
            public void onFailure(Call<ChatResponse> call, Throwable t) {
                Log.e(TAG, "Failed to fetch chat messages", t);
            }
        });
    }
    
    /**
     * Process and handle new messages with proper filtering
     * Either speaks them (TTS mode) or shows notifications (notification mode)
     */
    private void speakNewMessages(List<ChatMessage> allMessages) {
        String chatMode = prefs.getString("chat_notification_mode", "tts");
        boolean isTtsMode = "tts".equals(chatMode);
        
        // Get ignored users list from preferences
        String ignoredUsersStr = prefs.getString("tts_ignored_users", "");
        java.util.Set<String> ignoredUsers = new java.util.HashSet<>();
        if (!ignoredUsersStr.isEmpty()) {
            for (String user : ignoredUsersStr.split(",")) {
                ignoredUsers.add(user.trim().toLowerCase());
            }
        }
        
        long latestTimestamp = lastSpokenTimestamp;
        int newMessageCount = 0;
        
        // Process messages in order
        for (ChatMessage message : allMessages) {
            long messageTimestamp = message.getTimestamp();
            
            // Skip messages we've already processed
            if (messageTimestamp <= lastSpokenTimestamp) {
                continue;
            }
            
            // Update latest timestamp even if we skip the message
            if (messageTimestamp > latestTimestamp) {
                latestTimestamp = messageTimestamp;
            }
            
            // Skip ignored users
            if (ignoredUsers.contains(message.getUsername().toLowerCase())) {
                Log.d(TAG, "Skipping ignored user: " + message.getUsername());
                continue;
            }
            
            // Skip commands (messages starting with !)
            if (message.getMessage() != null && message.getMessage().trim().startsWith("!")) {
                Log.d(TAG, "Skipping command message: " + message.getMessage());
                continue;
            }
            
            // Handle this message based on mode
            if (isTtsMode) {
                speakMessage(message);
            } else {
                showChatNotification(message);
            }
            newMessageCount++;
        }
        
        // Update and persist timestamp if we processed any messages
        if (latestTimestamp > lastSpokenTimestamp) {
            lastSpokenTimestamp = latestTimestamp;
            Log.d(TAG, "Updated lastSpokenTimestamp to " + lastSpokenTimestamp + " (spoke " + newMessageCount + " new messages)");
        }
    }
    
    private void speakMessage(ChatMessage message) {
        if (!ttsInitialized || tts == null) {
            Log.w(TAG, "TTS not ready yet, cannot speak");
            return;
        }
        
        // Use getTtsMessage() which returns the server-prepared message
        // Server handles username/alias prepending and OpenAI enhancement
        String textToSpeak = message.getTtsMessage();
        
        tts.speak(textToSpeak, TextToSpeech.QUEUE_ADD, null, String.valueOf(message.getTimestamp()));
        
        messagesSpokenCount++;
        updateNotification();
        
        Log.d(TAG, "Speaking message from " + message.getDisplayName() + ": " + textToSpeak);
    }
    
    /**
     * Show a notification for a chat message
     */
    private void showChatNotification(ChatMessage message) {
        // Intent to open the app
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, notificationIntent,
                PendingIntent.FLAG_IMMUTABLE);
        
        String displayName = message.getDisplayName();
        String messageText = message.getMessage();
        
        // Use incrementing notification ID so multiple messages can stack
        int notificationId = chatNotificationId++;
        
        // Reset counter if it gets too high
        if (chatNotificationId > CHAT_NOTIFICATION_BASE_ID + 1000) {
            chatNotificationId = CHAT_NOTIFICATION_BASE_ID;
        }
        
        Notification notification = new NotificationCompat.Builder(this, CHAT_CHANNEL_ID)
                .setContentTitle(displayName)
                .setContentText(messageText)
                .setSmallIcon(android.R.drawable.sym_action_chat)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setStyle(new NotificationCompat.BigTextStyle()
                        .bigText(messageText))
                .build();
        
        notificationManager.notify(notificationId, notification);
        
        messagesSpokenCount++;
        updateNotification();
        
        Log.d(TAG, "Showing notification from " + displayName + ": " + messageText);
    }
}
