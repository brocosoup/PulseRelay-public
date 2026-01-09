package com.pulserelay.locationtracker.fragments;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.text.TextUtils;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.Spinner;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.Fragment;
import androidx.preference.PreferenceManager;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.android.material.floatingactionbutton.FloatingActionButton;
import com.google.gson.Gson;
import com.pulserelay.locationtracker.R;
import com.pulserelay.locationtracker.TTSService;
import com.pulserelay.locationtracker.adapters.ChatAdapter;
import com.pulserelay.locationtracker.api.ApiClient;
import com.pulserelay.locationtracker.api.TwitchApiService;
import com.pulserelay.locationtracker.api.UserApiService;
import com.pulserelay.locationtracker.models.ChatMessage;
import com.pulserelay.locationtracker.models.ChatResponse;
import com.pulserelay.locationtracker.models.CommandRequest;
import com.pulserelay.locationtracker.models.CommandResponse;

import java.util.ArrayList;
import java.util.List;

import okhttp3.ResponseBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class LiveChatFragment extends Fragment {
    
    private static final long CHAT_POLL_INTERVAL = 5000; // 5 seconds
    
    private RecyclerView chatRecyclerView;
    private ChatAdapter chatAdapter;
    private FloatingActionButton fabScroll;
    private FloatingActionButton fabClearChat;
    private Handler chatHandler;
    private Runnable chatPollRunnable;
    private TwitchApiService apiService;
    private SharedPreferences prefs;
    private long lastReadTimestamp = 0;
    private View chatPlaceholder;
    private Spinner spinnerChannel;
    private EditText editChatMessage;
    private ImageButton btnSendMessage;
    private boolean autoScrollEnabled = true;
    
    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_live_chat, container, false);
    }
    
    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        
        prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
        apiService = ApiClient.getRetrofitInstance(requireContext()).create(TwitchApiService.class);
        chatHandler = new Handler(Looper.getMainLooper());
        
        // Initialize views
        chatRecyclerView = view.findViewById(R.id.recyclerChatMessages);
        chatPlaceholder = view.findViewById(R.id.chatPlaceholder);
        fabScroll = view.findViewById(R.id.fabScrollToBottom);
        fabClearChat = view.findViewById(R.id.fabClearChat);
        spinnerChannel = view.findViewById(R.id.spinnerChannel);
        editChatMessage = view.findViewById(R.id.editChatMessage);
        btnSendMessage = view.findViewById(R.id.btnSendMessage);
        
        // Setup RecyclerView
        chatRecyclerView.setLayoutManager(new LinearLayoutManager(requireContext()));
        chatAdapter = new ChatAdapter(requireContext());
        chatRecyclerView.setAdapter(chatAdapter);
        
        chatAdapter.setOnMessageActionListener(new ChatAdapter.OnMessageActionListener() {
            @Override
            public void onDeleteMessage(ChatMessage message) {
                deleteChatMessage(message);
            }
            
            @Override
            public void onTimeoutUser(ChatMessage message) {
                timeoutUser(message);
            }
            
            @Override
            public void onToggleTTSBan(ChatMessage message, boolean currentlyBanned) {
                if (currentlyBanned) {
                    removeUserFromIgnoreList(message.getUsername());
                } else {
                    addUserToIgnoreList(message.getUsername());
                }
                updateTTSBannedUsersInAdapter();
            }
            
            @Override
            public void onSetAlias(ChatMessage message) {
                showSetAliasDialog(message);
            }
            
            @Override
            public void onUsernameClick(String username) {
                insertUsernameIntoMessageInput(username);
            }
        });
        
        updateTTSBannedUsersInAdapter();
        
        // Clear chat FAB
        fabClearChat.setOnClickListener(v -> clearAllChatMessages());
        
        // Setup channel spinner
        setupChannelSpinner();
        
        // Send message button
        btnSendMessage.setOnClickListener(v -> sendMessage());
        
        // Send message on IME action (Enter key)
        editChatMessage.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_SEND) {
                sendMessage();
                return true;
            }
            return false;
        });
        
        fabScroll.setOnClickListener(v -> {
            if (chatAdapter.getMessageCount() > 0) {
                autoScrollEnabled = true;
                chatRecyclerView.smoothScrollToPosition(chatAdapter.getMessageCount() - 1);
                fabScroll.hide();
            }
        });
        
        chatRecyclerView.addOnScrollListener(new RecyclerView.OnScrollListener() {
            @Override
            public void onScrolled(@NonNull RecyclerView recyclerView, int dx, int dy) {
                super.onScrolled(recyclerView, dx, dy);
                
                LinearLayoutManager layoutManager = (LinearLayoutManager) recyclerView.getLayoutManager();
                if (layoutManager != null) {
                    int lastVisiblePosition = layoutManager.findLastCompletelyVisibleItemPosition();
                    int totalItems = chatAdapter.getMessageCount();
                    
                    if (totalItems > 0) {
                        // User is at bottom - enable auto-scroll and hide FAB
                        if (lastVisiblePosition == totalItems - 1) {
                            autoScrollEnabled = true;
                            fabScroll.hide();
                        } 
                        // User scrolled up - disable auto-scroll and show resume FAB
                        else if (dy < 0) { // Scrolling up
                            autoScrollEnabled = false;
                            fabScroll.show();
                        }
                        // Not at bottom but not scrolling up - show FAB
                        else if (lastVisiblePosition < totalItems - 1) {
                            fabScroll.show();
                        }
                    }
                }
            }
        });
        
        startChatPolling();
    }
    
    @Override
    public void onResume() {
        super.onResume();
        lastReadTimestamp = System.currentTimeMillis();
    }
    
    @Override
    public void onDestroyView() {
        super.onDestroyView();
        stopChatPolling();
    }
    
    private void startChatPolling() {
        chatPollRunnable = new Runnable() {
            @Override
            public void run() {
                loadChatMessages();
                chatHandler.postDelayed(this, CHAT_POLL_INTERVAL);
            }
        };
        chatHandler.post(chatPollRunnable);
    }
    
    private void stopChatPolling() {
        if (chatHandler != null && chatPollRunnable != null) {
            chatHandler.removeCallbacks(chatPollRunnable);
        }
    }
    
    private void loadChatMessages() {
        apiService.getChatMessages().enqueue(new Callback<ChatResponse>() {
            @Override
            public void onResponse(@NonNull Call<ChatResponse> call, @NonNull Response<ChatResponse> response) {
                if (response.isSuccessful() && response.body() != null && response.body().isSuccess()) {
                    List<ChatMessage> messages = response.body().getMessages();
                    if (messages == null) {
                        messages = new ArrayList<>();
                    }
                    
                    // Debug logging for message IDs
                    for (ChatMessage msg : messages) {
                        android.util.Log.d("LiveChat", String.format("Message from %s: ID=%s, Text=%s",
                            msg.getUsername(),
                            msg.getId() != null ? msg.getId() : "NULL",
                            msg.getMessage()));
                    }
                    
                    chatAdapter.setMessages(messages);
                    
                    if (chatAdapter.getMessageCount() > 0) {
                        chatPlaceholder.setVisibility(View.GONE);
                        // Auto-scroll to bottom only if enabled
                        if (autoScrollEnabled) {
                            chatRecyclerView.post(() -> {
                                chatRecyclerView.scrollToPosition(chatAdapter.getMessageCount() - 1);
                            });
                        }
                    } else {
                        chatPlaceholder.setVisibility(View.VISIBLE);
                    }
                }
            }
            
            @Override
            public void onFailure(@NonNull Call<ChatResponse> call, @NonNull Throwable t) {
                // Silent failure
            }
        });
    }
    
    private boolean shouldAutoScroll() {
        LinearLayoutManager layoutManager = (LinearLayoutManager) chatRecyclerView.getLayoutManager();
        if (layoutManager != null) {
            int lastVisiblePosition = layoutManager.findLastCompletelyVisibleItemPosition();
            int totalItems = chatAdapter.getMessageCount();
            return totalItems > 0 && (lastVisiblePosition == totalItems - 1 || lastVisiblePosition == totalItems - 2);
        }
        return false;
    }
    
    private void deleteChatMessage(ChatMessage message) {
        android.util.Log.d("LiveChat", String.format("Delete request for message: ID=%s, User=%s, Text=%s",
            message.getId() != null ? message.getId() : "NULL",
            message.getUsername(),
            message.getMessage()));
        
        if (message.getId() == null || message.getId().isEmpty()) {
            Toast.makeText(requireContext(), "Message not ready for deletion yet. Wait a moment and try again.", Toast.LENGTH_LONG).show();
            return;
        }
        
        // Store the message ID for the API call
        final String messageIdToDelete = message.getId();
        
        apiService.deleteMessage(new TwitchApiService.MessageActionRequest(messageIdToDelete))
                .enqueue(new Callback<CommandResponse>() {
                    @Override
                    public void onResponse(@NonNull Call<CommandResponse> call, @NonNull Response<CommandResponse> response) {
                        if (response.isSuccessful() && response.body() != null) {
                            if (response.body().isSuccess()) {
                                // Mark message as deleted - find it in current list by ID
                                for (ChatMessage msg : chatAdapter.getMessages()) {
                                    if (msg.getId() != null && msg.getId().equals(messageIdToDelete)) {
                                        msg.setDeleted(true);
                                        break;
                                    }
                                }
                                chatAdapter.notifyDataSetChanged();
                                Toast.makeText(requireContext(), "Message deleted", Toast.LENGTH_SHORT).show();
                            } else {
                                handleModeratorError(response.body().getMessage());
                            }
                        } else if (response.code() == 403) {
                            handleModeratorError("Permission denied - please re-login");
                        } else {
                            Toast.makeText(requireContext(), "Failed to delete message", Toast.LENGTH_SHORT).show();
                        }
                    }
                    
                    @Override
                    public void onFailure(@NonNull Call<CommandResponse> call, @NonNull Throwable t) {
                        Toast.makeText(requireContext(), "Error: " + t.getMessage(), Toast.LENGTH_SHORT).show();
                    }
                });
    }
    
    private void timeoutUser(ChatMessage message) {
        apiService.timeoutUser(new TwitchApiService.TimeoutRequest(message.getUsername()))
                .enqueue(new Callback<CommandResponse>() {
                    @Override
                    public void onResponse(@NonNull Call<CommandResponse> call, @NonNull Response<CommandResponse> response) {
                        if (response.isSuccessful() && response.body() != null) {
                            if (response.body().isSuccess()) {
                                Toast.makeText(requireContext(), message.getUsername() + " timed out for 60 seconds", Toast.LENGTH_SHORT).show();
                            } else {
                                handleModeratorError(response.body().getMessage());
                            }
                        } else if (response.code() == 403) {
                            handleModeratorError("Permission denied - please re-login");
                        } else {
                            Toast.makeText(requireContext(), "Failed to timeout user", Toast.LENGTH_SHORT).show();
                        }
                    }
                    
                    @Override
                    public void onFailure(@NonNull Call<CommandResponse> call, @NonNull Throwable t) {
                        Toast.makeText(requireContext(), "Error: " + t.getMessage(), Toast.LENGTH_SHORT).show();
                    }
                });
    }
    
    private void addUserToIgnoreList(String username) {
        if (username == null || username.trim().isEmpty()) {
            return;
        }
        
        String currentIgnored = prefs.getString("tts_ignored_users", "");
        String[] ignoredUsers = currentIgnored.isEmpty() ? new String[0] : currentIgnored.split(",");
        
        for (String ignored : ignoredUsers) {
            if (ignored.trim().equalsIgnoreCase(username.trim())) {
                Toast.makeText(requireContext(), username + " is already ignored for TTS", Toast.LENGTH_SHORT).show();
                return;
            }
        }
        
        String newIgnored = currentIgnored.isEmpty() ? username.trim() : currentIgnored + "," + username.trim();
        prefs.edit().putString("tts_ignored_users", newIgnored).apply();
        
        syncIgnoredUsersToServer();
        Toast.makeText(requireContext(), "Added " + username + " to TTS ignore list", Toast.LENGTH_SHORT).show();
    }
    
    private void removeUserFromIgnoreList(String username) {
        if (username == null || username.trim().isEmpty()) {
            return;
        }
        
        String currentIgnored = prefs.getString("tts_ignored_users", "");
        if (currentIgnored.isEmpty()) {
            return;
        }
        
        String[] ignoredUsers = currentIgnored.split(",");
        List<String> newIgnoredList = new ArrayList<>();
        boolean found = false;
        
        for (String ignored : ignoredUsers) {
            if (!ignored.trim().equalsIgnoreCase(username.trim())) {
                newIgnoredList.add(ignored.trim());
            } else {
                found = true;
            }
        }
        
        if (!found) {
            Toast.makeText(requireContext(), username + " was not in TTS ignore list", Toast.LENGTH_SHORT).show();
            return;
        }
        
        String newIgnored = TextUtils.join(",", newIgnoredList);
        prefs.edit().putString("tts_ignored_users", newIgnored).apply();
        
        syncIgnoredUsersToServer();
        Toast.makeText(requireContext(), "Removed " + username + " from TTS ignore list", Toast.LENGTH_SHORT).show();
    }
    
    private void syncIgnoredUsersToServer() {
        String ignoredUsersStr = prefs.getString("tts_ignored_users", "");
        List<String> ignoredUsersList = new ArrayList<>();
        
        if (!ignoredUsersStr.isEmpty()) {
            for (String user : ignoredUsersStr.split(",")) {
                ignoredUsersList.add(user.trim());
            }
        }
        
        UserApiService userApiService = ApiClient.getRetrofitInstance(requireContext()).create(UserApiService.class);
        UserApiService.TTSIgnoredUsersRequest request = new UserApiService.TTSIgnoredUsersRequest(ignoredUsersList);
        
        userApiService.updateTTSIgnoredUsers(request).enqueue(new Callback<UserApiService.TTSIgnoredUsersResponse>() {
            @Override
            public void onResponse(@NonNull Call<UserApiService.TTSIgnoredUsersResponse> call,
                                 @NonNull Response<UserApiService.TTSIgnoredUsersResponse> response) {
                // Silent success
            }
            
            @Override
            public void onFailure(@NonNull Call<UserApiService.TTSIgnoredUsersResponse> call, @NonNull Throwable t) {
                // Silent failure
            }
        });
    }
    
    private void updateTTSBannedUsersInAdapter() {
        String ignoredUsersStr = prefs.getString("tts_ignored_users", "");
        List<String> ignoredUsersList = new ArrayList<>();
        
        if (!ignoredUsersStr.isEmpty()) {
            for (String user : ignoredUsersStr.split(",")) {
                if (!user.trim().isEmpty()) {
                    ignoredUsersList.add(user.trim().toLowerCase());
                }
            }
        }
        
        chatAdapter.setTTSBannedUsers(new java.util.HashSet<>(ignoredUsersList));
    }
    
    private void showSetAliasDialog(ChatMessage message) {
        String username = message.getUsername();
        if (username == null || username.trim().isEmpty()) {
            return;
        }
        
        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
        builder.setTitle("Set TTS Alias for " + username);
        builder.setMessage("Enter pronunciation alias for TTS:");
        
        final EditText input = new EditText(requireContext());
        input.setInputType(InputType.TYPE_CLASS_TEXT);
        input.setHint("e.g., Brook Oh Soup");
        builder.setView(input);
        
        builder.setPositiveButton("Save", (dialog, which) -> {
            String alias = input.getText().toString().trim();
            if (!alias.isEmpty()) {
                setUserAlias(username, alias);
            }
        });
        
        builder.setNegativeButton("Cancel", null);
        builder.show();
    }
    
    private void setUserAlias(String username, String alias) {
        TwitchApiService.AliasRequest request = new TwitchApiService.AliasRequest(alias);
        
        apiService.setAlias(username, request).enqueue(new Callback<CommandResponse>() {
            @Override
            public void onResponse(@NonNull Call<CommandResponse> call, @NonNull Response<CommandResponse> response) {
                if (response.isSuccessful() && response.body() != null && response.body().isSuccess()) {
                    Toast.makeText(requireContext(), "Alias set for " + username, Toast.LENGTH_SHORT).show();
                    loadChatMessages();
                } else {
                    Toast.makeText(requireContext(), "Failed to set alias", Toast.LENGTH_SHORT).show();
                }
            }
            
            @Override
            public void onFailure(@NonNull Call<CommandResponse> call, @NonNull Throwable t) {
                Toast.makeText(requireContext(), "Error: " + t.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
    }
    
    
    private void insertUsernameIntoMessageInput(String username) {
        if (editChatMessage != null && username != null) {
            String currentText = editChatMessage.getText().toString();
            String newText = currentText.isEmpty() ? "@" + username + " " : currentText + " @" + username + " ";
            editChatMessage.setText(newText);
            editChatMessage.setSelection(newText.length());
            editChatMessage.requestFocus();
        }
    }
    
    
    private void clearAllChatMessages() {
        new AlertDialog.Builder(requireContext())
                .setTitle("Clear All Chat")
                .setMessage("Are you sure you want to clear all chat messages?")
                .setPositiveButton("Clear", (dialog, which) -> {
                    apiService.clearChatMessages().enqueue(new Callback<CommandResponse>() {
                        @Override
                        public void onResponse(@NonNull Call<CommandResponse> call, @NonNull Response<CommandResponse> response) {
                            if (response.isSuccessful() && response.body() != null && response.body().isSuccess()) {
                                chatAdapter.setMessages(new ArrayList<>());
                                chatPlaceholder.setVisibility(View.VISIBLE);
                                Toast.makeText(requireContext(), "Chat cleared", Toast.LENGTH_SHORT).show();
                            } else {
                                Toast.makeText(requireContext(), "Failed to clear chat", Toast.LENGTH_SHORT).show();
                            }
                        }
                        
                        @Override
                        public void onFailure(@NonNull Call<CommandResponse> call, @NonNull Throwable t) {
                            Toast.makeText(requireContext(), "Error: " + t.getMessage(), Toast.LENGTH_SHORT).show();
                        }
                    });
                })
                .setNegativeButton("Cancel", null)
                .show();
    }
    
    private void setupChannelSpinner() {
        UserApiService userApi = ApiClient.getRetrofitInstance(requireContext()).create(UserApiService.class);
        
        userApi.getUserChannels().enqueue(new Callback<UserApiService.UserChannelsResponse>() {
            @Override
            public void onResponse(@NonNull Call<UserApiService.UserChannelsResponse> call,
                                 @NonNull Response<UserApiService.UserChannelsResponse> response) {
                List<String> channels = new ArrayList<>();
                
                if (response.isSuccessful() && response.body() != null && response.body().isSuccess()) {
                    String username = response.body().getUsername();
                    if (username != null && !username.isEmpty()) {
                        channels.add(username);
                    }
                    
                    List<String> additionalChannels = response.body().getChannels();
                    if (additionalChannels != null) {
                        channels.addAll(additionalChannels);
                    }
                }
                
                if (channels.isEmpty()) {
                    channels.add("(No channels configured)");
                }
                
                ArrayAdapter<String> adapter = new ArrayAdapter<>(requireContext(),
                        android.R.layout.simple_list_item_1, channels);
                adapter.setDropDownViewResource(android.R.layout.simple_list_item_1);
                spinnerChannel.setAdapter(adapter);
                
                // Hide spinner if only one channel to save space
                if (channels.size() == 1) {
                    spinnerChannel.setVisibility(View.GONE);
                } else {
                    spinnerChannel.setVisibility(View.VISIBLE);
                }
            }
            
            @Override
            public void onFailure(@NonNull Call<UserApiService.UserChannelsResponse> call, @NonNull Throwable t) {
                // Silent failure
            }
        });
    }
    
    private void sendMessage() {
        String message = editChatMessage.getText().toString().trim();
        String selectedChannel = (String) spinnerChannel.getSelectedItem();
        
        if (message.isEmpty()) {
            Toast.makeText(requireContext(), "Message cannot be empty", Toast.LENGTH_SHORT).show();
            return;
        }
        
        if (selectedChannel == null) {
            Toast.makeText(requireContext(), "No channel selected", Toast.LENGTH_SHORT).show();
            return;
        }
        
        CommandRequest request = new CommandRequest(message, selectedChannel);
        apiService.sendCommand(request).enqueue(new Callback<CommandResponse>() {
            @Override
            public void onResponse(@NonNull Call<CommandResponse> call, @NonNull Response<CommandResponse> response) {
                if (response.isSuccessful() && response.body() != null && response.body().isSuccess()) {
                    editChatMessage.setText("");
                    Toast.makeText(requireContext(), "Message sent", Toast.LENGTH_SHORT).show();
                } else {
                    Toast.makeText(requireContext(), "Failed to send message", Toast.LENGTH_SHORT).show();
                }
            }
            
            @Override
            public void onFailure(@NonNull Call<CommandResponse> call, @NonNull Throwable t) {
                Toast.makeText(requireContext(), "Error: " + t.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
    }
    
    private void handleModeratorError(String errorMessage) {
        if (errorMessage != null && (errorMessage.contains("log out and log back in") || errorMessage.contains("required scopes"))) {
            new AlertDialog.Builder(requireContext())
                    .setTitle("Moderator Permissions Required")
                    .setMessage("To delete messages or timeout users, you need moderator permissions. Please log out and log back in to grant the required scopes.")
                    .setPositiveButton("OK", null)
                    .setIcon(android.R.drawable.ic_dialog_alert)
                    .show();
        } else {
            Toast.makeText(requireContext(), "Permission error: " + errorMessage, Toast.LENGTH_LONG).show();
        }
    }
}
