package com.pulserelay.locationtracker.fragments;

import android.app.Dialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Vibrator;
import android.os.VibrationEffect;
import android.text.InputType;
import android.text.TextUtils;
import android.view.LayoutInflater;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.ViewModelProvider;
import androidx.preference.PreferenceManager;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.ItemTouchHelper;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.android.material.floatingactionbutton.FloatingActionButton;
import com.google.gson.Gson;
import com.pulserelay.locationtracker.MainActivity;
import com.pulserelay.locationtracker.StreamDeckActivity;
import com.pulserelay.locationtracker.R;
import com.pulserelay.locationtracker.adapters.CategoryItemTouchHelper;
import com.pulserelay.locationtracker.adapters.ChatAdapter;
import com.pulserelay.locationtracker.adapters.IconPickerAdapter;
import com.pulserelay.locationtracker.adapters.SortableCategoryAdapter;
import com.pulserelay.locationtracker.adapters.SortableButtonAdapter;
import com.pulserelay.locationtracker.adapters.ButtonItemTouchHelper;
import com.pulserelay.locationtracker.adapters.StreamDeckAdapter;
import com.pulserelay.locationtracker.api.ApiClient;
import com.pulserelay.locationtracker.api.TwitchApiService;
import com.pulserelay.locationtracker.models.ChatMessage;
import com.pulserelay.locationtracker.models.ChatResponse;
import com.pulserelay.locationtracker.models.CommandRequest;
import com.pulserelay.locationtracker.models.CommandResponse;
import com.pulserelay.locationtracker.models.StreamDeckButton;
import com.pulserelay.locationtracker.services.CommandHistoryManager;
import com.pulserelay.locationtracker.services.StreamDeckConfigManager;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

/**
 * Fragment for Pulse Deck control interface
 */
public class StreamDeckFragment extends Fragment {
    
    private static final long VIBRATION_DURATION = 50; // milliseconds
    private static final long CHAT_POLL_INTERVAL = 5000; // 5 seconds
    private static final long HEALTH_CHECK_INTERVAL = 10000; // 10 seconds
    
    private RecyclerView recyclerView;
    private StreamDeckAdapter adapter;
    private TextView connectionStatusText;
    private View connectionIndicator;
    private ProgressBar loadingIndicator;
    private SharedPreferences prefs;
    private TwitchApiService apiService;
    private com.google.android.material.floatingactionbutton.FloatingActionButton fabEditMode;
    private com.google.android.material.floatingactionbutton.FloatingActionButton btnEditMenu;
    private StreamDeckConfigManager configManager;
    private boolean isEditMode = false;
    private int selectedIconResId = R.drawable.ic_settings;
    private CommandHistoryManager historyManager;
    private Vibrator vibrator;
    private boolean isLoading = false;
    private View connectionStatusGroup;
    
    // Chat-related fields
    private Dialog chatDialog;
    private ChatAdapter chatAdapter;
    private RecyclerView chatRecyclerView;
    private ImageButton btnChat;
    private Handler chatHandler;
    private Runnable chatPollRunnable;
    private long lastReadTimestamp = 0; // Track when user last opened chat
    private boolean wasChatDialogShowing = false; // Track dialog state across config changes
    
    // Health check fields
    private Handler healthCheckHandler;
    private Runnable healthCheckRunnable;
    private int consecutiveFailures = 0;
    private static final int MAX_CONSECUTIVE_FAILURES = 3;
    
    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_stream_deck, container, false);
    }
    
    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        
        prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
        apiService = ApiClient.getRetrofitInstance(requireContext()).create(TwitchApiService.class);
        historyManager = CommandHistoryManager.getInstance(requireContext());
        vibrator = (Vibrator) requireContext().getSystemService(Context.VIBRATOR_SERVICE);
        configManager = new StreamDeckConfigManager(requireContext());
        
        // Initialize views
        recyclerView = view.findViewById(R.id.streamDeckRecyclerView);
        connectionStatusText = view.findViewById(R.id.connectionStatusText);
        connectionIndicator = view.findViewById(R.id.connectionIndicator);
        loadingIndicator = view.findViewById(R.id.loadingIndicator);
        fabEditMode = view.findViewById(R.id.fabEditMode);
        btnEditMenu = view.findViewById(R.id.btnEditMenu);
        connectionStatusGroup = view.findViewById(R.id.connectionStatusGroup);
        
        // Initialize chat
        chatHandler = new Handler(Looper.getMainLooper());
        
        // Initialize health check
        healthCheckHandler = new Handler(Looper.getMainLooper());
        setupHealthCheck();
        
        // Restore last read timestamp for badge counting
        lastReadTimestamp = prefs.getLong("last_read_timestamp", 0);
        android.util.Log.d("PulseRelay", "Badge: Restored lastReadTimestamp from prefs: " + lastReadTimestamp);
        
        // TTS is now handled globally by TTSManager in MainActivity
        
        setupChatDialog();
        
        // Start background polling for badge updates
        startBackgroundChatPolling();
        
        // Use 12-column grid system for flexible layouts (LCM of 1,2,3,4)
        // This allows categories to use 1, 2, 3, or 4 columns per row
        // Same layout behavior for both portrait and landscape
        GridLayoutManager layoutManager = new GridLayoutManager(requireContext(), 12);
        recyclerView.setLayoutManager(layoutManager);
        
        // Create adapter
        adapter = new StreamDeckAdapter(requireContext(), this::onButtonClick);
        adapter.setCategoryLongClickListener(this::onCategoryLongClick);
        recyclerView.setAdapter(adapter);
        
        // Configure span size based on button count per category
        layoutManager.setSpanSizeLookup(new GridLayoutManager.SpanSizeLookup() {
            @Override
            public int getSpanSize(int position) {
                // Headers take full width
                if (adapter.isHeader(position)) {
                    return 12;
                }
                
                // Get button and count buttons in its category
                StreamDeckButton button = adapter.getButtonAt(position);
                if (button != null) {
                    String category = button.getCategory();
                    
                    // Count buttons in this category
                    int buttonCount = 0;
                    for (StreamDeckButton btn : adapter.getAllButtons()) {
                        if (btn.getCategory().equals(category)) {
                            buttonCount++;
                        }
                    }
                    
                    // Dynamic column calculation based on button count and orientation
                    // Portrait mode: max 2 columns
                    // Landscape mode: max 4 columns
                    int orientation = getResources().getConfiguration().orientation;
                    boolean isPortrait = orientation == Configuration.ORIENTATION_PORTRAIT;
                    int maxColumns = isPortrait ? 2 : 4;
                    
                    int columns;
                    switch (buttonCount) {
                        case 1:
                            columns = 1;
                            break;
                        case 2:
                            columns = 2;
                            break;
                        case 3:
                            columns = 3;
                            break;
                        case 4:
                            columns = isPortrait ? 2 : 4;
                            break;
                        case 5:
                        case 6:
                            columns = isPortrait ? 2 : 3;
                            break;
                        default:
                            columns = maxColumns;
                            break;
                    }
                    
                    return 12 / columns;
                }
                
                // Fallback: default 3 columns (4 span each)
                return 4;
            }
        });
        
        // Initialize buttons
        setupButtons();
        
        // Setup edit mode FABs
        setupEditMode();
        
        // Set connection status
        updateConnectionStatus(true, "Checking...");
        
        // Restore chat dialog state if it was showing before config change
        if (savedInstanceState != null && savedInstanceState.getBoolean("chatDialogShowing", false)) {
            // Post to handler to ensure view is fully initialized
            new Handler(Looper.getMainLooper()).post(() -> showChatDialog());
        }
    }
    
    private void setupButtons() {
        // Load from config or use defaults
        List<StreamDeckButton> buttons = configManager.loadConfig();
        if (buttons == null || buttons.isEmpty()) {
            buttons = getDefaultButtons();
            configManager.saveConfig(buttons);
            
            // Set default category order matching the default layout
            List<String> defaultOrder = Arrays.asList(
                "Default",      // Top-level control buttons (4 buttons)
                "Scene",        // Scene management (6 buttons)
                "Audio",        // Audio control (2 buttons)
                "Camera",       // Camera control (6 buttons)
                "Camera Select", // Camera selection (4 buttons)
                "Chat",         // Chat commands (1 button)
                "Message",      // Custom messages (4 buttons)
                "Music",        // Music control (2 buttons)
                "Volume",       // Volume control (2 buttons)
                "Capture",      // Capture control (4 buttons)
                "Record",       // Record control (2 buttons)
                "Screen",       // Screen control (3 buttons)
                "Asset",        // Custom assets (8 buttons)
                "Overlay"       // Map/Telemetry overlays (4 buttons)
            );
            configManager.saveCategoryOrder(defaultOrder);
            adapter.setCategoryOrder(defaultOrder);
        } else {
            // Load category order if available
            List<String> categoryOrder = configManager.loadCategoryOrder();
            if (categoryOrder != null) {
                adapter.setCategoryOrder(categoryOrder);
            }
        }
        
        // Load button orders for all categories
        loadButtonOrders(buttons);
        
        adapter.setButtons(buttons);
    }
    
    private List<StreamDeckButton> getDefaultButtons() {
        List<StreamDeckButton> buttons = new ArrayList<>();
        
        try {
            // Load default layout from assets
            java.io.InputStream is = requireContext().getAssets().open("default_layout.json");
            java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(is));
            StringBuilder jsonBuilder = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                jsonBuilder.append(line);
            }
            reader.close();
            
            String json = jsonBuilder.toString();
            org.json.JSONObject root = new org.json.JSONObject(json);
            org.json.JSONObject buttonsWrapper = root.getJSONObject("buttons");
            org.json.JSONArray buttonsArray = buttonsWrapper.getJSONArray("buttons");
            
            for (int i = 0; i < buttonsArray.length(); i++) {
                org.json.JSONObject btnObj = buttonsArray.getJSONObject(i);
                
                String command = btnObj.getString("command");
                String title = btnObj.getString("title");
                String subtitle = btnObj.optString("subtitle", "");
                int iconResId = btnObj.getInt("iconResId");
                String colorStr = btnObj.getString("color");
                String category = btnObj.getString("category");
                boolean requiresInput = btnObj.optBoolean("requiresInput", false);
                String inputHint = btnObj.optString("inputHint", null);
                boolean requiresConfirmation = btnObj.optBoolean("requiresConfirmation", false);
                String confirmationMessage = btnObj.optString("confirmationMessage", null);
                
                // Validate the icon resource ID is actually a drawable
                int validatedIconResId = validateDrawableResource(iconResId);
                
                StreamDeckButton.ButtonColor color = StreamDeckButton.ButtonColor.valueOf(colorStr);
                
                buttons.add(new StreamDeckButton(command, title, subtitle, validatedIconResId, color, category,
                        requiresInput, inputHint, requiresConfirmation, confirmationMessage));
            }
            
            // Load category order if present in JSON
            if (root.has("categoryOrder")) {
                org.json.JSONArray categoryOrderArray = root.getJSONArray("categoryOrder");
                List<String> categoryOrder = new ArrayList<>();
                for (int i = 0; i < categoryOrderArray.length(); i++) {
                    categoryOrder.add(categoryOrderArray.getString(i));
                }
                // Save and apply the category order
                configManager.saveCategoryOrder(categoryOrder);
                adapter.setCategoryOrder(categoryOrder);
            }
            
        } catch (Exception e) {
            // Fallback to empty list if file can't be loaded
            Toast.makeText(requireContext(), "Error loading default layout: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
        
        return buttons;
    }
    
    /**
     * Validates that a resource ID is actually a drawable resource.
     * Returns a fallback icon if the resource is invalid or not a drawable.
     */
    private int validateDrawableResource(int resId) {
        if (resId == 0) {
            return android.R.drawable.ic_menu_help;
        }
        
        try {
            String resourceTypeName = getResources().getResourceTypeName(resId);
            if (!"drawable".equals(resourceTypeName) && !"mipmap".equals(resourceTypeName)) {
                android.util.Log.w("StreamDeckFragment", 
                    "Resource " + resId + " is type '" + resourceTypeName + "', not drawable. Using fallback icon.");
                return android.R.drawable.ic_menu_help;
            }
            return resId;
        } catch (android.content.res.Resources.NotFoundException e) {
            android.util.Log.w("StreamDeckFragment", 
                "Resource " + resId + " not found. Using fallback icon.", e);
            return android.R.drawable.ic_menu_help;
        }
    }
    
    private void setupEditMode() {
        fabEditMode.setOnClickListener(v -> toggleEditMode());
        btnEditMenu.setVisibility(View.GONE); // Hidden by default
        
        // Edit menu button shows popup menu
        btnEditMenu.setOnClickListener(v -> showEditMenu());
        
        // Long press edit mode button to reset to defaults
        fabEditMode.setOnLongClickListener(v -> {
            new AlertDialog.Builder(requireContext())
                    .setTitle("Reset to Defaults")
                    .setMessage("This will delete all custom buttons and categories and restore the default layout. This cannot be undone.")
                    .setPositiveButton("Reset", (d, w) -> {
                        configManager.resetToDefaults();
                        
                        // Reset category order to default
                        List<String> defaultOrder = Arrays.asList(
                            "Default", "Scene", "Audio", "Camera", "Camera Select",
                            "Chat", "Message", "Music", "Volume", "Capture",
                            "Record", "Screen", "Asset", "Overlay"
                        );
                        configManager.saveCategoryOrder(defaultOrder);
                        adapter.setCategoryOrder(defaultOrder);
                        
                        adapter.setButtons(getDefaultButtons());
                        saveCurrentConfig();
                        Toast.makeText(requireContext(), "Reset to default layout", Toast.LENGTH_SHORT).show();
                    })
                    .setNegativeButton("Cancel", null)
                    .show();
            return true;
        });
    }
    
    private void toggleEditMode() {
        isEditMode = !isEditMode;
        adapter.setEditMode(isEditMode);
        btnEditMenu.setVisibility(isEditMode ? View.VISIBLE : View.GONE);
        fabEditMode.setImageResource(isEditMode ? android.R.drawable.ic_menu_close_clear_cancel : android.R.drawable.ic_menu_edit);
    }
    
    private void showEditMenu() {
        PopupMenu popup = new PopupMenu(requireContext(), btnEditMenu);
        popup.getMenuInflater().inflate(R.menu.edit_mode_menu, popup.getMenu());
        
        popup.setOnMenuItemClickListener(item -> {
            int id = item.getItemId();
            if (id == R.id.menu_add_button) {
                showAddButtonDialog();
                return true;
            } else if (id == R.id.menu_create_category) {
                showCreateCategoryDialog();
                return true;
            } else if (id == R.id.menu_sort_categories) {
                showSortCategoriesDialog();
                return true;
            }
            return false;
        });
        
        popup.show();
    }
    
    private void onCategoryLongClick(String categoryName) {
        // Don't allow editing "Default" category
        if (categoryName.equals(StreamDeckButton.CATEGORY_NONE)) {
            Toast.makeText(requireContext(), "Cannot edit Default category", Toast.LENGTH_SHORT).show();
            return;
        }
        
        // Show options dialog: Rename, Delete, or Order Buttons
        String[] options = new String[]{"Rename", "Delete", "Order Buttons"};
        ArrayAdapter<String> adapter = new ArrayAdapter<>(requireContext(), R.layout.dialog_list_item, options);
        
        new AlertDialog.Builder(requireContext())
                .setTitle("Edit Category: " + categoryName)
                .setAdapter(adapter, (dialog, which) -> {
                    if (which == 0) {
                        // Rename
                        showRenameCategoryDialog(categoryName);
                    } else if (which == 1) {
                        // Delete
                        showDeleteCategoryConfirmation(categoryName);
                    } else {
                        // Order Buttons
                        showSortButtonsDialog(categoryName);
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }
    
    private void showRenameCategoryDialog(String categoryName) {
        // Show rename dialog directly for this category
        EditText input = new EditText(requireContext());
        input.setText(categoryName);
        input.setTextColor(getResources().getColor(R.color.text_primary, null));
        input.setHintTextColor(getResources().getColor(R.color.text_secondary, null));
        input.setBackgroundResource(R.drawable.edittext_background);
        input.setSelection(categoryName.length()); // Cursor at end
        
        new AlertDialog.Builder(requireContext())
                .setTitle("Rename Category")
                .setView(input)
                .setPositiveButton("Rename", (d, w) -> {
                    String newName = input.getText().toString().trim();
                    if (newName.isEmpty()) {
                        Toast.makeText(requireContext(), "Category name cannot be empty", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    
                    if (newName.equals(categoryName)) {
                        return; // No change
                    }
                    
                    // Check for duplicates (case-insensitive)
                    String[] existingCategories = getCategoryNames();
                    for (String existing : existingCategories) {
                        if (existing.equalsIgnoreCase(newName) && !existing.equals(categoryName)) {
                            Toast.makeText(requireContext(), "Category already exists: " + existing, Toast.LENGTH_SHORT).show();
                            return;
                        }
                    }
                    
                    // Rename all buttons using this category
                    List<StreamDeckButton> buttons = adapter.getAllButtons();
                    for (StreamDeckButton btn : buttons) {
                        if (btn.getCategory().equals(categoryName)) {
                            btn.setCategory(newName);
                        }
                    }
                    
                    // Update category order
                    List<String> currentOrder = adapter.getCategoryOrder();
                    if (currentOrder != null) {
                        for (int i = 0; i < currentOrder.size(); i++) {
                            if (currentOrder.get(i).equals(categoryName)) {
                                currentOrder.set(i, newName);
                                break;
                            }
                        }
                        adapter.setCategoryOrder(currentOrder);
                        configManager.saveCategoryOrder(currentOrder);
                    }
                    
                    adapter.setButtons(buttons);
                    saveCurrentConfig();
                    Toast.makeText(requireContext(), "Category renamed to: " + newName, Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }
    
    private void showDeleteCategoryConfirmation(String categoryName) {
        // Count buttons in category
        List<StreamDeckButton> buttons = adapter.getAllButtons();
        int buttonCount = 0;
        for (StreamDeckButton btn : buttons) {
            if (btn.getCategory().equals(categoryName)) {
                buttonCount++;
            }
        }
        
        String message = "Delete category '" + categoryName + "' and its " + buttonCount + " button(s)?";
        
        new AlertDialog.Builder(requireContext())
                .setTitle("Delete Category")
                .setMessage(message)
                .setPositiveButton("Delete", (d, w) -> {
                    // Remove all buttons in this category
                    List<StreamDeckButton> remainingButtons = new ArrayList<>();
                    for (StreamDeckButton btn : buttons) {
                        if (!btn.getCategory().equals(categoryName)) {
                            remainingButtons.add(btn);
                        }
                    }
                    
                    // Update category order
                    List<String> currentOrder = adapter.getCategoryOrder();
                    if (currentOrder != null) {
                        currentOrder.remove(categoryName);
                        adapter.setCategoryOrder(currentOrder);
                        configManager.saveCategoryOrder(currentOrder);
                    }
                    
                    adapter.setButtons(remainingButtons);
                    saveCurrentConfig();
                    Toast.makeText(requireContext(), "Category deleted: " + categoryName, Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }
    
    private void onButtonClick(StreamDeckButton button) {
        // In edit mode, show editor instead of executing command
        if (isEditMode) {
            showEditButtonDialog(button);
            return;
        }
        
        if (isLoading) {
            Toast.makeText(requireContext(), "Please wait for previous command to complete", Toast.LENGTH_SHORT).show();
            return;
        }
        
        // Check if button requires confirmation
        if (button.requiresConfirmation()) {
            showConfirmationDialog(button);
        }
        // Check if button requires user input
        else if (button.requiresInput()) {
            showInputDialog(button);
        } else {
            // Use custom channel if specified, otherwise use target channel from settings
            String targetChannel = button.useCustomChannel() && button.getCustomChannel() != null && !button.getCustomChannel().isEmpty()
                    ? button.getCustomChannel()
                    : prefs.getString("target_channel", "");
            sendCommand(button.getCommand(), targetChannel, button.getTitle());
        }
    }
    
    /**
     * Show confirmation dialog for critical commands
     */
    private void showConfirmationDialog(StreamDeckButton button) {
        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
        builder.setTitle("Confirm " + button.getTitle());
        builder.setMessage(button.getConfirmationMessage());
        builder.setIcon(android.R.drawable.ic_dialog_alert);
        
        builder.setPositiveButton("Confirm", (dialog, which) -> {
            // Use custom channel if specified, otherwise use target channel from settings
            String targetChannel = button.useCustomChannel() && button.getCustomChannel() != null && !button.getCustomChannel().isEmpty()
                    ? button.getCustomChannel()
                    : prefs.getString("target_channel", "");
            sendCommand(button.getCommand(), targetChannel, button.getTitle());
        });
        builder.setNegativeButton("Cancel", (dialog, which) -> dialog.cancel());
        
        builder.show();
    }
    
    /**
     * Show input dialog for commands that require user text
     */
    private void showInputDialog(StreamDeckButton button) {
        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
        builder.setTitle(button.getTitle() + " " + button.getSubtitle());
        
        // Set up the input
        final EditText input = new EditText(requireContext());
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        input.setHint(button.getInputHint());
        input.setMaxLines(3);
        input.setPadding(50, 30, 50, 30);
        builder.setView(input);
        
        // Set up buttons
        builder.setPositiveButton("Send", (dialog, which) -> {
            String userInput = input.getText().toString().trim();
            if (!userInput.isEmpty()) {
                // Use custom channel if specified, otherwise use target channel from settings
                String targetChannel = button.useCustomChannel() && button.getCustomChannel() != null && !button.getCustomChannel().isEmpty()
                        ? button.getCustomChannel()
                        : prefs.getString("target_channel", "");
                String fullCommand = button.getCommand() + " " + userInput;
                sendCommand(fullCommand, targetChannel, button.getTitle());
            } else {
                Toast.makeText(requireContext(), "Message cannot be empty", Toast.LENGTH_SHORT).show();
            }
        });
        builder.setNegativeButton("Cancel", (dialog, which) -> dialog.cancel());
        
        AlertDialog dialog = builder.create();
        dialog.show();
        
        // Show keyboard
        input.requestFocus();
    }
    
    /**
     * Send a command to the Twitch bot via API
     */
    private void sendCommand(String command, String channel, String buttonTitle) {
        isLoading = true;
        updateLoadingState(true);
        
        // Haptic feedback
        if (vibrator != null && vibrator.hasVibrator()) {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(VIBRATION_DURATION, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                vibrator.vibrate(VIBRATION_DURATION);
            }
        }
        
        CommandRequest request = new CommandRequest(command, channel);
        
        apiService.sendCommand(request).enqueue(new Callback<CommandResponse>() {
            @Override
            public void onResponse(Call<CommandResponse> call, Response<CommandResponse> response) {
                isLoading = false;
                updateLoadingState(false);
                
                if (response.isSuccessful() && response.body() != null) {
                    CommandResponse cmdResponse = response.body();
                    
                    // Add to history
                    historyManager.addCommand(command, channel, cmdResponse.isSuccess());
                    
                    if (cmdResponse.isSuccess()) {
                        consecutiveFailures = 0; // Reset on successful command
                        updateConnectionStatus(true, "Connected");
                        Toast.makeText(requireContext(), 
                            buttonTitle + " sent successfully", 
                            Toast.LENGTH_SHORT).show();
                    } else {
                        updateConnectionStatus(false, "Failed");
                        Toast.makeText(requireContext(), 
                            "Failed: " + cmdResponse.getMessage(), 
                            Toast.LENGTH_LONG).show();
                    }
                } else if (response.code() == 401) {
                    updateConnectionStatus(false, "Unauthorized");
                    Toast.makeText(requireContext(), 
                        "Authentication failed. Please check your token in settings.", 
                        Toast.LENGTH_LONG).show();
                    historyManager.addCommand(command, channel, false);
                } else {
                    updateConnectionStatus(false, "Error");
                    Toast.makeText(requireContext(), 
                        "Error: " + response.code() + " - " + response.message(), 
                        Toast.LENGTH_LONG).show();
                    historyManager.addCommand(command, channel, false);
                }
            }
            
            @Override
            public void onFailure(Call<CommandResponse> call, Throwable t) {
                isLoading = false;
                updateLoadingState(false);
                updateConnectionStatus(false, "Disconnected");
                
                String errorMessage = "Network error: " + t.getMessage();
                Toast.makeText(requireContext(), errorMessage, Toast.LENGTH_LONG).show();
                
                historyManager.addCommand(command, channel, false);
            }
        });
    }
    
    /**
     * Update loading indicator visibility
     */
    private void updateLoadingState(boolean loading) {
        if (loadingIndicator != null) {
            loadingIndicator.setVisibility(loading ? View.VISIBLE : View.GONE);
        }
        if (adapter != null) {
            adapter.setEnabled(!loading);
        }
    }
    
    private void updateConnectionStatus(boolean connected, String message) {
        if (connectionStatusText != null) {
            connectionStatusText.setText(message);
        }
        if (connectionIndicator != null && getContext() != null) {
            int color = connected ? 
                    getContext().getColor(R.color.success_color) : 
                    getContext().getColor(R.color.danger_color);
            connectionIndicator.setBackgroundTintList(android.content.res.ColorStateList.valueOf(color));
        }
    }
    
    // ==================== HEALTH CHECK METHODS ====================
    
    /**
     * Setup health check polling
     */
    private void setupHealthCheck() {
        healthCheckRunnable = new Runnable() {
            @Override
            public void run() {
                performHealthCheck();
                // Schedule next check
                healthCheckHandler.postDelayed(this, HEALTH_CHECK_INTERVAL);
            }
        };
        // Start immediately
        healthCheckHandler.post(healthCheckRunnable);
    }
    
    /**
     * Perform a health check ping to the server
     */
    private void performHealthCheck() {
        if (apiService == null || getContext() == null) {
            return;
        }
        
        apiService.ping().enqueue(new Callback<TwitchApiService.PingResponse>() {
            @Override
            public void onResponse(Call<TwitchApiService.PingResponse> call, Response<TwitchApiService.PingResponse> response) {
                if (!isAdded() || getContext() == null) {
                    return;
                }
                
                if (response.isSuccessful() && response.body() != null && response.body().isOk()) {
                    consecutiveFailures = 0;
                    // Only update to "Connected" if we're not currently sending a command
                    if (!isLoading) {
                        updateConnectionStatus(true, "Connected");
                    }
                } else {
                    handleHealthCheckFailure("Server error: " + response.code());
                }
            }
            
            @Override
            public void onFailure(Call<TwitchApiService.PingResponse> call, Throwable t) {
                if (!isAdded() || getContext() == null) {
                    return;
                }
                handleHealthCheckFailure("Network error");
            }
        });
    }
    
    /**
     * Handle health check failure with consecutive failure tracking
     */
    private void handleHealthCheckFailure(String reason) {
        consecutiveFailures++;
        
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            // Only show disconnected after multiple failures
            if (!isLoading) {
                updateConnectionStatus(false, "Disconnected");
            }
        } else {
            // Show warning but keep trying
            if (!isLoading) {
                updateConnectionStatus(true, "Checking...");
            }
        }
        
        android.util.Log.w("PulseRelay", "Health check failed (" + consecutiveFailures + "/" + MAX_CONSECUTIVE_FAILURES + "): " + reason);
    }
    
    /**
     * Stop health check polling
     */
    private void stopHealthCheck() {
        if (healthCheckHandler != null && healthCheckRunnable != null) {
            healthCheckHandler.removeCallbacks(healthCheckRunnable);
        }
    }
    
    // ==================== BUTTON EDITOR METHODS ====================
    
    private void showAddButtonDialog() {
        StreamDeckButton newButton = new StreamDeckButton(
                "", "", "",
                android.R.drawable.ic_menu_add, 
                StreamDeckButton.ButtonColor.PRIMARY,
                StreamDeckButton.CATEGORY_NONE,
                false, null, false, null
        );
        showEditButtonDialog(newButton);
    }
    
    private void showCreateCategoryDialog() {
        EditText input = new EditText(requireContext());
        input.setHint("Category name");
        input.setTextColor(getResources().getColor(R.color.text_primary, null));
        input.setHintTextColor(getResources().getColor(R.color.text_secondary, null));
        input.setBackgroundResource(R.drawable.edittext_background);
        
        new AlertDialog.Builder(requireContext())
                .setTitle("Create New Category")
                .setView(input)
                .setPositiveButton("Create", (d, w) -> {
                    String categoryName = input.getText().toString().trim();
                    if (categoryName.isEmpty()) {
                        Toast.makeText(requireContext(), "Category name cannot be empty", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    
                    // Check for duplicates (case-insensitive)
                    String[] existingCategories = getCategoryNames();
                    for (String existing : existingCategories) {
                        if (existing.equalsIgnoreCase(categoryName)) {
                            Toast.makeText(requireContext(), "Category already exists: " + existing, Toast.LENGTH_SHORT).show();
                            return;
                        }
                    }
                    
                    // Add to category order (empty category)
                    List<String> currentOrder = adapter.getCategoryOrder();
                    if (currentOrder == null) {
                        currentOrder = new ArrayList<>(Arrays.asList(getCategoryNames()));
                    } else {
                        currentOrder = new ArrayList<>(currentOrder);
                    }
                    currentOrder.add(categoryName);
                    
                    adapter.setCategoryOrder(currentOrder);
                    configManager.saveCategoryOrder(currentOrder);
                    
                    Toast.makeText(requireContext(), "Category created: " + categoryName + ". Add buttons to it using 'Add Button'.", Toast.LENGTH_LONG).show();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }
    
    private void showEditButtonDialog(StreamDeckButton button) {
        View dialogView = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_edit_button, null);
        
        // Initialize views
        EditText etCommand = dialogView.findViewById(R.id.et_command);
        EditText etTitle = dialogView.findViewById(R.id.et_title);
        EditText etSubtitle = dialogView.findViewById(R.id.et_subtitle);
        Spinner spinnerCategory = dialogView.findViewById(R.id.spinner_category);
        Spinner spinnerColor = dialogView.findViewById(R.id.spinner_color);
        ImageView ivIconPreview = dialogView.findViewById(R.id.iv_icon_preview);
        View btnPickIcon = dialogView.findViewById(R.id.btn_pick_icon);
        com.google.android.material.checkbox.MaterialCheckBox cbRequiresConfirmation = dialogView.findViewById(R.id.cb_requires_confirmation);
        TextView tvConfirmationMessageLabel = dialogView.findViewById(R.id.tv_confirmation_message_label);
        EditText etConfirmationMessage = dialogView.findViewById(R.id.et_confirmation_message);
        com.google.android.material.checkbox.MaterialCheckBox cbRequiresInput = dialogView.findViewById(R.id.cb_requires_input);
        TextView tvInputHintLabel = dialogView.findViewById(R.id.tv_input_hint_label);
        EditText etInputHint = dialogView.findViewById(R.id.et_input_hint);
        com.google.android.material.checkbox.MaterialCheckBox cbUseCustomChannel = dialogView.findViewById(R.id.cb_use_custom_channel);
        TextView tvCustomChannelLabel = dialogView.findViewById(R.id.tv_custom_channel_label);
        EditText etCustomChannel = dialogView.findViewById(R.id.et_custom_channel);
        
        // Set current values
        etCommand.setText(button.getCommand());
        etTitle.setText(button.getTitle());
        etSubtitle.setText(button.getSubtitle());
        selectedIconResId = button.getIconResId();
        // Validate and set icon with fallback
        int validatedIconId = validateDrawableResource(selectedIconResId);
        selectedIconResId = validatedIconId; // Update to validated ID
        ivIconPreview.setImageResource(validatedIconId);
        cbRequiresConfirmation.setChecked(button.requiresConfirmation());
        etConfirmationMessage.setText(button.getConfirmationMessage() != null ? button.getConfirmationMessage() : "");
        cbRequiresInput.setChecked(button.requiresInput());
        etInputHint.setText(button.getInputHint() != null ? button.getInputHint() : "");
        cbUseCustomChannel.setChecked(button.useCustomChannel());
        etCustomChannel.setText(button.getCustomChannel() != null ? button.getCustomChannel() : "");
        
        // Show/hide confirmation message based on checkbox
        tvConfirmationMessageLabel.setVisibility(button.requiresConfirmation() ? View.VISIBLE : View.GONE);
        etConfirmationMessage.setVisibility(button.requiresConfirmation() ? View.VISIBLE : View.GONE);
        
        // Show/hide input hint based on checkbox
        tvInputHintLabel.setVisibility(button.requiresInput() ? View.VISIBLE : View.GONE);
        etInputHint.setVisibility(button.requiresInput() ? View.VISIBLE : View.GONE);
        
        // Show/hide custom channel based on checkbox
        tvCustomChannelLabel.setVisibility(button.useCustomChannel() ? View.VISIBLE : View.GONE);
        etCustomChannel.setVisibility(button.useCustomChannel() ? View.VISIBLE : View.GONE);
        
        cbRequiresConfirmation.setOnCheckedChangeListener((buttonView, isChecked) -> {
            tvConfirmationMessageLabel.setVisibility(isChecked ? View.VISIBLE : View.GONE);
            etConfirmationMessage.setVisibility(isChecked ? View.VISIBLE : View.GONE);
        });
        
        cbRequiresInput.setOnCheckedChangeListener((buttonView, isChecked) -> {
            tvInputHintLabel.setVisibility(isChecked ? View.VISIBLE : View.GONE);
            etInputHint.setVisibility(isChecked ? View.VISIBLE : View.GONE);
        });
        
        cbUseCustomChannel.setOnCheckedChangeListener((buttonView, isChecked) -> {
            tvCustomChannelLabel.setVisibility(isChecked ? View.VISIBLE : View.GONE);
            etCustomChannel.setVisibility(isChecked ? View.VISIBLE : View.GONE);
        });
        
        // Setup category spinner
        String[] categories = getCategoryNames();
        ArrayAdapter<String> categoryAdapter = new ArrayAdapter<>(requireContext(),
                R.layout.spinner_item, categories);
        categoryAdapter.setDropDownViewResource(R.layout.spinner_dropdown_item);
        spinnerCategory.setAdapter(categoryAdapter);
        
        // Set current category selection
        String currentCategory = button.getCategory();
        int categoryIndex = 0;
        for (int i = 0; i < categories.length; i++) {
            if (categories[i].equals(currentCategory)) {
                categoryIndex = i;
                break;
            }
        }
        spinnerCategory.setSelection(categoryIndex);
        
        // Setup color spinner with colored indicators
        StreamDeckButton.ButtonColor[] colors = StreamDeckButton.ButtonColor.values();
        ColorSpinnerAdapter colorAdapter = new ColorSpinnerAdapter(requireContext(), colors, getColorNames());
        spinnerColor.setAdapter(colorAdapter);
        spinnerColor.setSelection(button.getColor().ordinal());
        
        // Icon picker
        btnPickIcon.setOnClickListener(v -> showIconPicker(ivIconPreview));
        
        // Store original command to determine if this is a new button
        final boolean isNewButton = button.getCommand().isEmpty();
        
        // Create dialog
        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext())
                .setTitle(isNewButton ? "Add New Button" : "Edit Button")
                .setView(dialogView)
                .setPositiveButton("Save", null) // Set to null, we'll override in setOnShowListener
                .setNegativeButton("Cancel", null);
        
        // Add delete button for existing buttons (not new ones)
        if (!isNewButton) {
            builder.setNeutralButton("Delete", (d, w) -> {
                new AlertDialog.Builder(requireContext())
                        .setTitle("Delete Button")
                        .setMessage("Are you sure you want to delete this button?")
                        .setPositiveButton("Delete", (d2, w2) -> {
                            adapter.removeButton(button);
                            saveCurrentConfig();
                            Toast.makeText(requireContext(), "Button deleted", Toast.LENGTH_SHORT).show();
                        })
                        .setNegativeButton("Cancel", null)
                        .show();
            });
        }
        
        AlertDialog dialog = builder.create();
        
        // Override positive button to prevent auto-dismiss on validation failure
        dialog.setOnShowListener(d -> {
            android.widget.Button saveButton = dialog.getButton(AlertDialog.BUTTON_POSITIVE);
            saveButton.setOnClickListener(v -> {
                String command = etCommand.getText().toString().trim();
                String title = etTitle.getText().toString().trim();
                String subtitle = etSubtitle.getText().toString().trim();
                
                if (command.isEmpty() || title.isEmpty()) {
                    Toast.makeText(requireContext(), "Command and title are required", Toast.LENGTH_SHORT).show();
                    return; // Don't dismiss dialog
                }
                
                // Check for duplicate command (except when editing the same button)
                for (StreamDeckButton existing : adapter.getAllButtons()) {
                    if (!isNewButton && existing == button) {
                        continue; // Skip the button being edited
                    }
                    if (existing.getCommand().equals(command)) {
                        Toast.makeText(requireContext(), "Command already exists: " + command, Toast.LENGTH_LONG).show();
                        return; // Don't dismiss dialog
                    }
                }
                
                // Get selected category (might be new custom one)
                String selectedCategory = categories[spinnerCategory.getSelectedItemPosition()];
                
                // Update button
                button.setCommand(command);
                button.setTitle(title);
                button.setSubtitle(subtitle);
                button.setIconResId(selectedIconResId);
                button.setCategory(selectedCategory);
                button.setColor(StreamDeckButton.ButtonColor.values()[spinnerColor.getSelectedItemPosition()]);
                button.setRequiresConfirmation(cbRequiresConfirmation.isChecked());
                button.setConfirmationMessage(cbRequiresConfirmation.isChecked() ? etConfirmationMessage.getText().toString().trim() : null);
                button.setRequiresInput(cbRequiresInput.isChecked());
                button.setInputHint(cbRequiresInput.isChecked() ? etInputHint.getText().toString().trim() : null);
                button.setUseCustomChannel(cbUseCustomChannel.isChecked());
                button.setCustomChannel(cbUseCustomChannel.isChecked() ? etCustomChannel.getText().toString().trim() : null);
                
                // If new button, add it
                if (isNewButton) {
                    adapter.addButton(button);
                } else {
                    // For existing buttons, rebuild the view to reflect changes
                    adapter.setButtons(adapter.getAllButtons());
                }
                
                // Save configuration
                saveCurrentConfig();
                
                // Dismiss dialog only on success
                dialog.dismiss();
            });
        });
        
        dialog.show();
    }
    
    private void showIconPicker(ImageView previewView) {
        View dialogView = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_icon_picker, null);
        RecyclerView recyclerIcons = dialogView.findViewById(R.id.recycler_icons);
        
        recyclerIcons.setLayoutManager(new GridLayoutManager(requireContext(), 4));
        IconPickerAdapter iconAdapter = new IconPickerAdapter(iconResId -> {
            int validatedIconId = validateDrawableResource(iconResId);
            selectedIconResId = validatedIconId;
            previewView.setImageResource(validatedIconId);
        });
        iconAdapter.setSelectedIcon(selectedIconResId);
        recyclerIcons.setAdapter(iconAdapter);
        
        new AlertDialog.Builder(requireContext())
                .setTitle("Select Icon")
                .setView(dialogView)
                .setPositiveButton("OK", null)
                .show();
    }
    
    public void onOrientationChanged(int orientation) {
        // Refresh adapter to recalculate column spans for new orientation
        if (adapter != null) {
            adapter.notifyDataSetChanged();
        }
    }
    
    private int dpToPx(int dp) {
        float density = getResources().getDisplayMetrics().density;
        return Math.round(dp * density);
    }
    
    private void loadButtonOrders(List<StreamDeckButton> buttons) {
        // Get all unique category names
        Set<String> categoryNames = new HashSet<>();
        for (StreamDeckButton btn : buttons) {
            categoryNames.add(btn.getCategory());
        }
        
        // Load button order for each category
        for (String categoryName : categoryNames) {
            List<String> buttonOrder = configManager.loadButtonOrder(categoryName);
            if (buttonOrder != null) {
                adapter.setButtonOrder(categoryName, buttonOrder);
            }
        }
    }
    
    private String[] getCategoryNames() {
        // Get all unique categories from current buttons plus default categories
        List<String> categories = new ArrayList<>();
        categories.add(StreamDeckButton.CATEGORY_NONE);
        categories.add(StreamDeckButton.CATEGORY_SCENE);
        categories.add(StreamDeckButton.CATEGORY_AUDIO);
        categories.add(StreamDeckButton.CATEGORY_CAMERA);
        categories.add(StreamDeckButton.CATEGORY_CHAT);
        categories.add(StreamDeckButton.CATEGORY_STREAM);
        categories.add(StreamDeckButton.CATEGORY_LOCATION);
        
        // Add categories from existing buttons (case-insensitive check)
        for (StreamDeckButton btn : adapter.getAllButtons()) {
            String category = btn.getCategory();
            if (category != null) {
                boolean exists = false;
                for (String existing : categories) {
                    if (existing.equalsIgnoreCase(category)) {
                        exists = true;
                        break;
                    }
                }
                if (!exists) {
                    categories.add(category);
                }
            }
        }
        
        // Add categories from category order (for empty categories)
        List<String> categoryOrder = adapter.getCategoryOrder();
        if (categoryOrder != null) {
            for (String category : categoryOrder) {
                boolean exists = false;
                for (String existing : categories) {
                    if (existing.equalsIgnoreCase(category)) {
                        exists = true;
                        break;
                    }
                }
                if (!exists) {
                    categories.add(category);
                }
            }
        }
        
        return categories.toArray(new String[0]);
    }
    
    private String[] getColorNames() {
        StreamDeckButton.ButtonColor[] colors = StreamDeckButton.ButtonColor.values();
        String[] names = new String[colors.length];
        for (int i = 0; i < colors.length; i++) {
            names[i] = colors[i].name();
        }
        return names;
    }
    
    private void saveCurrentConfig() {
        List<StreamDeckButton> buttons = adapter.getAllButtons();
        configManager.saveConfig(buttons);
    }
    
    private void showEditCategoryDialog() {
        String[] allCategories = getCategoryNames();
        List<String> editableCategories = new ArrayList<>();
        
        // Exclude "Default" category from editing
        for (String cat : allCategories) {
            if (!cat.equals(StreamDeckButton.CATEGORY_NONE)) {
                editableCategories.add(cat);
            }
        }
        
        if (editableCategories.isEmpty()) {
            Toast.makeText(requireContext(), "No categories to edit", Toast.LENGTH_SHORT).show();
            return;
        }
        
        String[] categoryArray = editableCategories.toArray(new String[0]);
        ArrayAdapter<String> listAdapter = new ArrayAdapter<>(requireContext(), R.layout.dialog_list_item, categoryArray);
        
        new AlertDialog.Builder(requireContext())
                .setTitle("Select Category to Edit")
                .setAdapter(listAdapter, (di, which) -> {
                    String oldCategory = categoryArray[which];
                    
                    // Show rename dialog
                    EditText input = new EditText(requireContext());
                    input.setText(oldCategory);
                    input.setTextColor(getResources().getColor(R.color.text_primary, null));
                    input.setHintTextColor(getResources().getColor(R.color.text_secondary, null));
                    input.setBackgroundResource(R.drawable.edittext_background);
                    input.setSelection(oldCategory.length()); // Cursor at end
                    
                    new AlertDialog.Builder(requireContext())
                            .setTitle("Rename Category")
                            .setView(input)
                            .setPositiveButton("Rename", (d2, w2) -> {
                                String newName = input.getText().toString().trim();
                                if (newName.isEmpty()) {
                                    Toast.makeText(requireContext(), "Category name cannot be empty", Toast.LENGTH_SHORT).show();
                                    return;
                                }
                                
                                if (newName.equals(oldCategory)) {
                                    return; // No change
                                }
                                
                                // Check for duplicates (case-insensitive)
                                String[] existingCategories = getCategoryNames();
                                for (String existing : existingCategories) {
                                    if (existing.equalsIgnoreCase(newName) && !existing.equals(oldCategory)) {
                                        Toast.makeText(requireContext(), "Category already exists: " + existing, Toast.LENGTH_SHORT).show();
                                        return;
                                    }
                                }
                                
                                // Rename all buttons using this category
                                List<StreamDeckButton> allButtons = adapter.getAllButtons();
                                int renamed = 0;
                                for (StreamDeckButton btn : allButtons) {
                                    if (oldCategory.equals(btn.getCategory())) {
                                        btn.setCategory(newName);
                                        renamed++;
                                    }
                                }
                                
                                saveCurrentConfig();
                                adapter.setButtons(allButtons); // Rebuild adapter with updated categories
                                
                                Toast.makeText(requireContext(), "Category renamed (" + renamed + " buttons updated)", Toast.LENGTH_SHORT).show();
                            })
                            .setNegativeButton("Cancel", null)
                            .show();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }
    
    private void showDeleteCategoryDialog() {
        String[] allCategories = getCategoryNames();
        List<String> deletableCategories = new ArrayList<>();
        
        // Exclude "Default" category from deletion
        for (String cat : allCategories) {
            if (!cat.equals(StreamDeckButton.CATEGORY_NONE)) {
                deletableCategories.add(cat);
            }
        }
        
        if (deletableCategories.isEmpty()) {
            Toast.makeText(requireContext(), "No categories to delete", Toast.LENGTH_SHORT).show();
            return;
        }
        
        String[] categoryArray = deletableCategories.toArray(new String[0]);
        ArrayAdapter<String> listAdapter = new ArrayAdapter<>(requireContext(), R.layout.dialog_list_item, categoryArray);
        
        new AlertDialog.Builder(requireContext())
                .setTitle("Delete Category")
                .setAdapter(listAdapter, (di, which) -> {
                    String categoryToDelete = categoryArray[which];
                    
                    // Check if any buttons use this category
                    int count = 0;
                    for (StreamDeckButton btn : adapter.getAllButtons()) {
                        if (categoryToDelete.equals(btn.getCategory())) {
                            count++;
                        }
                    }
                    
                    final int buttonCount = count; // Make final for lambda
                    
                    if (buttonCount > 0) {
                        new AlertDialog.Builder(requireContext())
                                .setTitle("Category In Use")
                                .setMessage(buttonCount + " button(s) use this category. Delete anyway? Those buttons will be moved to 'Default' category.")
                                .setPositiveButton("Delete", (d2, w2) -> {
                                    // Move buttons to None category
                                    List<StreamDeckButton> allButtons = adapter.getAllButtons();
                                    int movedCount = 0;
                                    for (StreamDeckButton btn : allButtons) {
                                        if (categoryToDelete.equals(btn.getCategory())) {
                                            btn.setCategory(StreamDeckButton.CATEGORY_NONE);
                                            movedCount++;
                                        }
                                    }
                                    
                                    // Rebuild adapter with updated categories
                                    adapter.setButtons(allButtons);
                                    saveCurrentConfig();
                                    
                                    Toast.makeText(requireContext(), "Category deleted - " + movedCount + " buttons moved to Default (total: " + allButtons.size() + ")", Toast.LENGTH_LONG).show();
                                })
                                .setNegativeButton("Cancel", null)
                                .show();
                    } else {
                        // No buttons use it, just show confirmation
                        Toast.makeText(requireContext(), "Category deleted", Toast.LENGTH_SHORT).show();
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }
    
    private void showSortCategoriesDialog() {
        View dialogView = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_sort_categories, null);
        RecyclerView recyclerCategories = dialogView.findViewById(R.id.recycler_categories);
        
        // Get all categories with button counts
        List<SortableCategoryAdapter.CategoryItem> categoryItems = new ArrayList<>();
        Map<String, Integer> categoryCounts = new HashMap<>();
        
        for (StreamDeckButton btn : adapter.getAllButtons()) {
            String category = btn.getCategory();
            categoryCounts.put(category, categoryCounts.getOrDefault(category, 0) + 1);
        }
        
        // Load saved order or use default alphabetical
        List<String> categoryOrder = configManager.loadCategoryOrder();
        if (categoryOrder != null) {
            // Use saved order, adding any new categories at the end
            Set<String> orderedSet = new HashSet<>(categoryOrder);
            for (String category : categoryCounts.keySet()) {
                if (!orderedSet.contains(category)) {
                    categoryOrder.add(category);
                }
            }
        } else {
            // Default alphabetical order
            categoryOrder = new ArrayList<>(categoryCounts.keySet());
            Collections.sort(categoryOrder);
        }
        
        // Create category items in order
        for (String category : categoryOrder) {
            Integer count = categoryCounts.get(category);
            if (count != null) {
                categoryItems.add(new SortableCategoryAdapter.CategoryItem(category, count));
            }
        }
        
        // Setup recycler view with drag-and-drop
        recyclerCategories.setLayoutManager(new LinearLayoutManager(requireContext()));
        
        final ItemTouchHelper[] helperWrapper = new ItemTouchHelper[1];
        
        SortableCategoryAdapter sortAdapter = new SortableCategoryAdapter(categoryItems, viewHolder -> {
            if (helperWrapper[0] != null) {
                helperWrapper[0].startDrag(viewHolder);
            }
        });
        
        recyclerCategories.setAdapter(sortAdapter);
        helperWrapper[0] = new ItemTouchHelper(new CategoryItemTouchHelper(sortAdapter));
        helperWrapper[0].attachToRecyclerView(recyclerCategories);
        
        new AlertDialog.Builder(requireContext())
                .setTitle("Sort Categories")
                .setView(dialogView)
                .setPositiveButton("Save", (d, w) -> {
                    // Save new category order
                    List<String> newOrder = new ArrayList<>();
                    for (SortableCategoryAdapter.CategoryItem item : sortAdapter.getCategories()) {
                        newOrder.add(item.name);
                    }
                    configManager.saveCategoryOrder(newOrder);
                    adapter.setCategoryOrder(newOrder);
                    Toast.makeText(requireContext(), "Category order saved", Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }
    
    private void showSortButtonsDialog(String categoryName) {
        View dialogView = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_sort_buttons, null);
        RecyclerView recyclerButtons = dialogView.findViewById(R.id.recycler_buttons);
        
        // Get all buttons in this category
        List<StreamDeckButton> categoryButtons = new ArrayList<>();
        for (StreamDeckButton btn : adapter.getAllButtons()) {
            if (btn.getCategory().equals(categoryName)) {
                categoryButtons.add(btn);
            }
        }
        
        // Check if category has buttons
        if (categoryButtons.isEmpty()) {
            Toast.makeText(requireContext(), "No buttons in this category", Toast.LENGTH_SHORT).show();
            return;
        }
        
        // Load saved order or use current order
        List<String> buttonOrder = configManager.loadButtonOrder(categoryName);
        if (buttonOrder != null) {
            // Reorder buttons based on saved order
            List<StreamDeckButton> orderedButtons = new ArrayList<>();
            Set<StreamDeckButton> addedButtons = new HashSet<>();
            
            for (String title : buttonOrder) {
                for (StreamDeckButton btn : categoryButtons) {
                    if (btn.getTitle().equals(title) && !addedButtons.contains(btn)) {
                        orderedButtons.add(btn);
                        addedButtons.add(btn);
                        break;
                    }
                }
            }
            
            // Add any new buttons not in saved order
            for (StreamDeckButton btn : categoryButtons) {
                if (!addedButtons.contains(btn)) {
                    orderedButtons.add(btn);
                }
            }
            
            categoryButtons = orderedButtons;
        }
        
        // Setup recycler view with drag-and-drop
        recyclerButtons.setLayoutManager(new LinearLayoutManager(requireContext()));
        
        final ItemTouchHelper[] helperWrapper = new ItemTouchHelper[1];
        
        SortableButtonAdapter sortAdapter = new SortableButtonAdapter(categoryButtons, viewHolder -> {
            if (helperWrapper[0] != null) {
                helperWrapper[0].startDrag(viewHolder);
            }
        });
        
        recyclerButtons.setAdapter(sortAdapter);
        helperWrapper[0] = new ItemTouchHelper(new ButtonItemTouchHelper(sortAdapter));
        helperWrapper[0].attachToRecyclerView(recyclerButtons);
        
        new AlertDialog.Builder(requireContext())
                .setTitle("Order Buttons in " + categoryName)
                .setView(dialogView)
                .setPositiveButton("Save", (d, w) -> {
                    // Save new button order (using button titles)
                    List<String> newOrder = new ArrayList<>();
                    for (StreamDeckButton btn : sortAdapter.getButtons()) {
                        newOrder.add(btn.getTitle());
                    }
                    configManager.saveButtonOrder(categoryName, newOrder);
                    adapter.setButtonOrder(categoryName, newOrder);
                    Toast.makeText(requireContext(), "Button order saved", Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }
    
    // ==================== Chat Methods ====================
    
    /**
     * Setup the chat dialog with RecyclerView and adapter
     */
    private void setupChatDialog() {
        chatDialog = new Dialog(requireContext(), android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        chatDialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        chatDialog.setContentView(R.layout.dialog_chat);
        
        // Initialize chat RecyclerView
        chatRecyclerView = chatDialog.findViewById(R.id.recyclerChatMessages);
        chatRecyclerView.setLayoutManager(new LinearLayoutManager(requireContext()));
        chatAdapter = new ChatAdapter(requireContext());
        chatRecyclerView.setAdapter(chatAdapter);
        
        // Setup action listeners for message buttons
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
                // Update the adapter with new banned users list
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
        
        // Update banned users in adapter on setup
        updateTTSBannedUsersInAdapter();
        
        // Setup close button
        ImageButton btnClose = chatDialog.findViewById(R.id.btnCloseChat);
        btnClose.setOnClickListener(v -> chatDialog.dismiss());
        
        // Setup clear button - calls API to clear on server
        ImageButton btnClear = chatDialog.findViewById(R.id.btnClearChat);
        btnClear.setOnClickListener(v -> clearAllChatMessages());
        
        // Setup Toggle OpenAI button
        ImageButton btnToggleOpenAI = chatDialog.findViewById(R.id.btnToggleOpenAI);
        loadOpenAIState(btnToggleOpenAI);
        btnToggleOpenAI.setOnClickListener(v -> {
            // Toggle OpenAI on server
            toggleOpenAI(btnToggleOpenAI);
        });
        
        // Setup scroll-to-bottom FAB
        FloatingActionButton fabScroll = chatDialog.findViewById(R.id.fabScrollToBottom);
        fabScroll.setOnClickListener(v -> {
            if (chatAdapter.getMessageCount() > 0) {
                chatRecyclerView.smoothScrollToPosition(chatAdapter.getMessageCount() - 1);
            }
        });
        
        // Auto-hide FAB when scrolled to bottom
        chatRecyclerView.addOnScrollListener(new RecyclerView.OnScrollListener() {
            @Override
            public void onScrolled(@NonNull RecyclerView recyclerView, int dx, int dy) {
                LinearLayoutManager layoutManager = (LinearLayoutManager) recyclerView.getLayoutManager();
                if (layoutManager != null) {
                    int lastVisiblePosition = layoutManager.findLastCompletelyVisibleItemPosition();
                    int totalItems = chatAdapter.getMessageCount();
                    
                    if (lastVisiblePosition >= totalItems - 1) {
                        fabScroll.hide();
                    } else {
                        fabScroll.show();
                    }
                }
            }
        });
        
        // Setup message input
        Spinner spinnerChannel = chatDialog.findViewById(R.id.spinnerChannel);
        EditText editChatMessage = chatDialog.findViewById(R.id.editChatMessage);
        ImageButton btnSendMessage = chatDialog.findViewById(R.id.btnSendMessage);
        
        // Populate channel spinner with user's channels
        setupChannelSpinner(spinnerChannel);
        
        // Send message on button click
        btnSendMessage.setOnClickListener(v -> {
            String message = editChatMessage.getText().toString().trim();
            String selectedChannel = (String) spinnerChannel.getSelectedItem();
            
            if (!message.isEmpty() && selectedChannel != null) {
                sendChatMessage(message, selectedChannel);
                editChatMessage.setText("");
            } else if (message.isEmpty()) {
                Toast.makeText(requireContext(), "Message cannot be empty", Toast.LENGTH_SHORT).show();
            }
        });
        
        // Send message on IME action (Enter key)
        editChatMessage.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_SEND) {
                btnSendMessage.performClick();
                return true;
            }
            return false;
        });
        
        // Load messages when dialog is shown
        chatDialog.setOnShowListener(d -> {
            fetchChatMessages(); // Load messages immediately when opened
            // Mark current time as last read timestamp
            lastReadTimestamp = System.currentTimeMillis();
            prefs.edit().putLong("last_read_timestamp", lastReadTimestamp).apply();
            android.util.Log.d("PulseRelay", "Badge: Chat opened, updated lastReadTimestamp to " + lastReadTimestamp);
        });
        
        // Mark messages as read when dialog is dismissed
        chatDialog.setOnDismissListener(d -> {
            wasChatDialogShowing = false; // Update state flag
            markMessagesAsRead(); // Mark as read (already updates timestamp)
            // TTS continues running globally
        });
    }
    
    /**
     * Show the chat dialog (public method for external access)
     */
    public void showChat() {
        showChatDialog();
    }
    
    /**
     * Show the chat dialog
     */
    private void showChatDialog() {
        if (chatDialog != null) {
            wasChatDialogShowing = true; // Update state flag
            chatDialog.show();
        }
    }
    
    /**
     * Start background polling for badge updates (runs even when dialog is closed)
     */
    private void startBackgroundChatPolling() {
        android.util.Log.d("PulseRelay", "startBackgroundChatPolling called");
        chatPollRunnable = new Runnable() {
            @Override
            public void run() {
                android.util.Log.d("PulseRelay", "Chat poll runnable executing...");
                // Fetch messages - will update timestamp automatically
                fetchChatMessages();
                chatHandler.postDelayed(this, CHAT_POLL_INTERVAL);
            }
        };
        chatHandler.post(chatPollRunnable);
    }
    
    /**
     * Stop polling for chat messages
     */
    private void stopChatPolling() {
        if (chatHandler != null && chatPollRunnable != null) {
            chatHandler.removeCallbacks(chatPollRunnable);
        }
    }
    
    /**
     * Unified function to fetch chat messages and update timestamp
     * This is the ONLY place that fetches messages from the API
     */
    private void fetchChatMessages() {
        android.util.Log.d("PulseRelay", "fetchChatMessages called, apiService is null: " + (apiService == null));
        apiService.getChatMessages().enqueue(new Callback<ChatResponse>() {
            @Override
            public void onResponse(@NonNull Call<ChatResponse> call, @NonNull Response<ChatResponse> response) {
                android.util.Log.d("PulseRelay", "Chat response received - isSuccessful: " + response.isSuccessful());
                if (response.isSuccessful() && response.body() != null) {
                    android.util.Log.d("PulseRelay", "Chat body not null - isSuccess: " + response.body().isSuccess());
                    if (response.body().isSuccess()) {
                        List<ChatMessage> messages = response.body().getMessages();
                        if (messages == null) {
                            messages = new ArrayList<>();
                        }
                        android.util.Log.d("PulseRelay", "Chat messages count: " + messages.size());
                        
                        // ALWAYS update last_read_timestamp to latest message timestamp
                        if (!messages.isEmpty()) {
                            long latestTimestamp = 0;
                            for (ChatMessage msg : messages) {
                                if (msg.getTimestamp() > latestTimestamp) {
                                    latestTimestamp = msg.getTimestamp();
                                }
                            }
                            if (latestTimestamp > lastReadTimestamp) {
                                lastReadTimestamp = latestTimestamp;
                                prefs.edit().putLong("last_read_timestamp", lastReadTimestamp).apply();
                                android.util.Log.d("PulseRelay", "Updated last_read_timestamp to: " + lastReadTimestamp);
                            }
                        }
                        
                        // If chat dialog is showing, update the adapter
                        if (chatDialog != null && chatDialog.isShowing()) {
                            if (chatAdapter != null) {
                                android.util.Log.d("PulseRelay", "Setting messages on chatAdapter");
                                chatAdapter.setMessages(messages);
                                // Update TTS banned users after loading messages
                                updateTTSBannedUsersInAdapter();
                            } else {
                                android.util.Log.e("PulseRelay", "chatAdapter is NULL!");
                            }
                            
                            // Show/hide empty state
                            View emptyState = chatDialog.findViewById(R.id.chatPlaceholder);
                            if (emptyState != null) {
                                emptyState.setVisibility(messages.isEmpty() ? View.VISIBLE : View.GONE);
                            }
                            
                            // Scroll to bottom if new messages arrived
                            if (!messages.isEmpty() && chatRecyclerView != null) {
                                chatRecyclerView.smoothScrollToPosition(messages.size() - 1);
                            }
                        }
                    }
                }
            }
            
            @Override
            public void onFailure(@NonNull Call<ChatResponse> call, @NonNull Throwable t) {
                // Silently fail - don't spam user with errors during polling
                android.util.Log.e("PulseRelay", "Chat API call failed: " + t.getMessage(), t);
            }
        });
    }
    

    
    /**
     * Mark messages as read (now handled locally via timestamp)
     */
    private void markMessagesAsRead() {
        // Update lastReadTimestamp to current time to mark all messages as read
        lastReadTimestamp = System.currentTimeMillis();
        prefs.edit().putLong("last_read_timestamp", lastReadTimestamp).apply();
        android.util.Log.d("PulseRelay", "Badge: Marked messages as read, updated lastReadTimestamp to " + lastReadTimestamp);
        // Badge removed - now handled by menu item
    }
    
    /**
     * Handle moderator permission errors by showing appropriate message
     */
    private void handleModeratorError(String errorMessage) {
        if (errorMessage != null && (errorMessage.contains("log out and log back in") || errorMessage.contains("required scopes"))) {
            // Show alert dialog for re-authentication
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
    
    /**
     * Delete a specific chat message
     */
    private void deleteChatMessage(ChatMessage message) {
        // Check if message has an ID
        if (message.getId() == null || message.getId().isEmpty()) {
            Toast.makeText(requireContext(), "Cannot delete: Message has no ID", Toast.LENGTH_SHORT).show();
            return;
        }
        
        apiService.deleteMessage(new TwitchApiService.MessageActionRequest(message.getId()))
                .enqueue(new Callback<CommandResponse>() {
                    @Override
                    public void onResponse(@NonNull Call<CommandResponse> call, @NonNull Response<CommandResponse> response) {
                        if (response.isSuccessful() && response.body() != null) {
                            if (response.body().isSuccess()) {
                                // Mark message as deleted and update UI
                                message.setDeleted(true);
                                chatAdapter.notifyDataSetChanged();
                                Toast.makeText(requireContext(), "Message deleted", Toast.LENGTH_SHORT).show();
                            } else {
                                handleModeratorError(response.body().getMessage());
                            }
                        } else if (response.code() == 403) {
                            // Try to parse error body for 403 responses
                            try {
                                Gson gson = new Gson();
                                String errorBody = response.errorBody() != null ? response.errorBody().string() : null;
                                if (errorBody != null) {
                                    CommandResponse errorResponse = gson.fromJson(errorBody, CommandResponse.class);
                                    handleModeratorError(errorResponse.getMessage());
                                } else {
                                    Toast.makeText(requireContext(), "Permission denied - please re-login", Toast.LENGTH_LONG).show();
                                }
                            } catch (Exception e) {
                                Toast.makeText(requireContext(), "Permission denied - please re-login", Toast.LENGTH_LONG).show();
                            }
                        } else {
                            Toast.makeText(requireContext(), "Failed to delete (HTTP " + response.code() + ")", Toast.LENGTH_SHORT).show();
                        }
                    }
                    
                    @Override
                    public void onFailure(@NonNull Call<CommandResponse> call, @NonNull Throwable t) {
                        Toast.makeText(requireContext(), "Network error: " + t.getMessage(), Toast.LENGTH_LONG).show();
                    }
                });
    }
    
    /**
     * Timeout a user for 60 seconds
     */
    private void timeoutUser(ChatMessage message) {
        apiService.timeoutUser(new TwitchApiService.TimeoutRequest(message.getUsername()))
                .enqueue(new Callback<CommandResponse>() {
                    @Override
                    public void onResponse(@NonNull Call<CommandResponse> call, @NonNull Response<CommandResponse> response) {
                        if (response.isSuccessful() && response.body() != null) {
                            if (response.body().isSuccess()) {
                                // Mark all messages from this user as timed out
                                String username = message.getUsername();
                                List<ChatMessage> allMessages = chatAdapter.getMessages();
                                for (ChatMessage msg : allMessages) {
                                    if (msg.getUsername().equalsIgnoreCase(username)) {
                                        msg.setUserTimedOut(true);
                                    }
                                }
                                chatAdapter.notifyDataSetChanged();
                                
                                Toast.makeText(requireContext(), 
                                        message.getUsername() + " timed out for 60 seconds", 
                                        Toast.LENGTH_SHORT).show();
                            } else {
                                handleModeratorError(response.body().getMessage());
                            }
                        } else if (response.code() == 403) {
                            // Try to parse error body for 403 responses
                            try {
                                Gson gson = new Gson();
                                String errorBody = response.errorBody() != null ? response.errorBody().string() : null;
                                if (errorBody != null) {
                                    CommandResponse errorResponse = gson.fromJson(errorBody, CommandResponse.class);
                                    handleModeratorError(errorResponse.getMessage());
                                } else {
                                    Toast.makeText(requireContext(), "Permission denied - please re-login", Toast.LENGTH_LONG).show();
                                }
                            } catch (Exception e) {
                                Toast.makeText(requireContext(), "Permission denied - please re-login", Toast.LENGTH_LONG).show();
                            }
                        } else {
                            Toast.makeText(requireContext(), "Failed to timeout (HTTP " + response.code() + ")", Toast.LENGTH_SHORT).show();
                        }
                    }
                    
                    @Override
                    public void onFailure(@NonNull Call<CommandResponse> call, @NonNull Throwable t) {
                        Toast.makeText(requireContext(), "Network error: " + t.getMessage(), Toast.LENGTH_LONG).show();
                    }
                });
    }
    
    /**
     * Add a user to the TTS ignore list
     */
    private void addUserToIgnoreList(String username) {
        if (username == null || username.trim().isEmpty()) {
            return;
        }
        
        // Get current ignore list
        String currentIgnored = prefs.getString("tts_ignored_users", "");
        
        // Check if user is already ignored
        String[] ignoredUsers = currentIgnored.isEmpty() ? new String[0] : currentIgnored.split(",");
        for (String ignored : ignoredUsers) {
            if (ignored.trim().equalsIgnoreCase(username.trim())) {
                Toast.makeText(requireContext(), username + " is already ignored for TTS", Toast.LENGTH_SHORT).show();
                return;
            }
        }
        
        // Add user to ignore list
        String newIgnored = currentIgnored.isEmpty() 
                ? username.trim() 
                : currentIgnored + "," + username.trim();
        
        prefs.edit().putString("tts_ignored_users", newIgnored).apply();
        
        // Sync to server
        syncIgnoredUsersToServer();
        
        Toast.makeText(requireContext(), 
                "Added " + username + " to TTS ignore list", 
                Toast.LENGTH_SHORT).show();
        
        android.util.Log.d("PulseRelay", "User added to TTS ignore list: " + username);
    }
    
    /**
     * Remove a user from the TTS ignore list
     */
    private void removeUserFromIgnoreList(String username) {
        if (username == null || username.trim().isEmpty()) {
            return;
        }
        
        // Get current ignore list
        String currentIgnored = prefs.getString("tts_ignored_users", "");
        
        if (currentIgnored.isEmpty()) {
            return;
        }
        
        // Remove user from ignore list
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
        
        // Update preferences
        String newIgnored = TextUtils.join(",", newIgnoredList);
        prefs.edit().putString("tts_ignored_users", newIgnored).apply();
        
        // Sync to server
        syncIgnoredUsersToServer();
        
        Toast.makeText(requireContext(), 
                "Removed " + username + " from TTS ignore list", 
                Toast.LENGTH_SHORT).show();
        
        android.util.Log.d("PulseRelay", "User removed from TTS ignore list: " + username);
    }
    
    /**
     * Sync ignored users list to server
     */
    private void syncIgnoredUsersToServer() {
        String ignoredUsersStr = prefs.getString("tts_ignored_users", "");
        List<String> ignoredUsersList = new ArrayList<>();
        
        if (!ignoredUsersStr.isEmpty()) {
            for (String user : ignoredUsersStr.split(",")) {
                ignoredUsersList.add(user.trim());
            }
        }
        
        com.pulserelay.locationtracker.api.UserApiService userApiService = 
            com.pulserelay.locationtracker.api.ApiClient.getRetrofitInstance(requireContext())
                .create(com.pulserelay.locationtracker.api.UserApiService.class);
        
        com.pulserelay.locationtracker.api.UserApiService.TTSIgnoredUsersRequest request = 
            new com.pulserelay.locationtracker.api.UserApiService.TTSIgnoredUsersRequest(ignoredUsersList);
        
        userApiService.updateTTSIgnoredUsers(request).enqueue(new Callback<com.pulserelay.locationtracker.api.UserApiService.TTSIgnoredUsersResponse>() {
            @Override
            public void onResponse(@NonNull Call<com.pulserelay.locationtracker.api.UserApiService.TTSIgnoredUsersResponse> call,
                                 @NonNull Response<com.pulserelay.locationtracker.api.UserApiService.TTSIgnoredUsersResponse> response) {
                if (response.isSuccessful()) {
                    android.util.Log.d("PulseRelay", "TTS ignored users synced to server");
                } else {
                    android.util.Log.e("PulseRelay", "Failed to sync TTS ignored users: " + response.code());
                }
            }
            
            @Override
            public void onFailure(@NonNull Call<com.pulserelay.locationtracker.api.UserApiService.TTSIgnoredUsersResponse> call,
                                @NonNull Throwable t) {
                android.util.Log.e("PulseRelay", "Error syncing TTS ignored users to server", t);
            }
        });
    }
    
    /**
     * Show dialog to set TTS alias for a username
     */
    private void showSetAliasDialog(ChatMessage message) {
        String username = message.getUsername();
        
        if (username == null || username.trim().isEmpty()) {
            return;
        }
        
        // Create input dialog
        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
        builder.setTitle("Set TTS Alias for " + username);
        builder.setMessage("Enter pronunciation alias for TTS:");
        
        // Add input field
        final EditText input = new EditText(requireContext());
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT);
        input.setHint("e.g., Brook Oh Soup");
        builder.setView(input);
        
        // Set up buttons
        builder.setPositiveButton("Save", (dialog, which) -> {
            String alias = input.getText().toString().trim();
            
            if (alias.isEmpty()) {
                Toast.makeText(requireContext(), "Alias cannot be empty", Toast.LENGTH_SHORT).show();
                return;
            }
            
            // Call API to set alias
            setUsernameAlias(username, alias);
        });
        
        builder.setNegativeButton("Cancel", (dialog, which) -> dialog.cancel());
        
        builder.show();
    }
    
    /**
     * Set TTS alias for a username via API
     */
    private void setUsernameAlias(String username, String alias) {
        TwitchApiService.AliasRequest request = new TwitchApiService.AliasRequest(alias);
        
        apiService.setAlias(username, request).enqueue(new Callback<CommandResponse>() {
            @Override
            public void onResponse(@NonNull Call<CommandResponse> call, @NonNull Response<CommandResponse> response) {
                if (response.isSuccessful() && response.body() != null && response.body().isSuccess()) {
                    Toast.makeText(requireContext(), 
                            "Alias set: " + username + " → " + alias, 
                            Toast.LENGTH_SHORT).show();
                    android.util.Log.d("PulseRelay", "Alias set for " + username + ": " + alias);
                } else {
                    Toast.makeText(requireContext(), 
                            "Failed to set alias", 
                            Toast.LENGTH_SHORT).show();
                    android.util.Log.e("PulseRelay", "Failed to set alias - Response: " + response.code());
                }
            }
            
            @Override
            public void onFailure(@NonNull Call<CommandResponse> call, @NonNull Throwable t) {
                Toast.makeText(requireContext(), 
                        "Error setting alias: " + t.getMessage(), 
                        Toast.LENGTH_SHORT).show();
                android.util.Log.e("PulseRelay", "Error setting alias", t);
            }
        });
    }
    
    /**
     * Setup channel spinner with user's channels
     */
    private void setupChannelSpinner(Spinner spinner) {
        // Fetch channels from API
        com.pulserelay.locationtracker.api.UserApiService userApi = 
            ApiClient.getRetrofitInstance(requireContext()).create(com.pulserelay.locationtracker.api.UserApiService.class);
        
        userApi.getUserChannels().enqueue(new Callback<com.pulserelay.locationtracker.api.UserApiService.UserChannelsResponse>() {
            @Override
            public void onResponse(@NonNull Call<com.pulserelay.locationtracker.api.UserApiService.UserChannelsResponse> call, 
                                 @NonNull Response<com.pulserelay.locationtracker.api.UserApiService.UserChannelsResponse> response) {
                List<String> channels = new ArrayList<>();
                
                if (response.isSuccessful() && response.body() != null && response.body().isSuccess()) {
                    // Add user's own channel
                    String username = response.body().getUsername();
                    if (username != null && !username.isEmpty()) {
                        channels.add(username);
                    }
                    
                    // Add additional channels
                    List<String> additionalChannels = response.body().getChannels();
                    if (additionalChannels != null) {
                        channels.addAll(additionalChannels);
                    }
                }
                
                // Fallback if no channels
                if (channels.isEmpty()) {
                    channels.add("(No channels configured)");
                }
                
                // Update spinner on UI thread
                requireActivity().runOnUiThread(() -> {
                    ArrayAdapter<String> adapter = new ArrayAdapter<>(
                        requireContext(),
                        R.layout.spinner_item,
                        channels
                    );
                    adapter.setDropDownViewResource(R.layout.spinner_dropdown_item);
                    spinner.setAdapter(adapter);
                });
            }
            
            @Override
            public void onFailure(@NonNull Call<com.pulserelay.locationtracker.api.UserApiService.UserChannelsResponse> call, 
                                @NonNull Throwable t) {
                android.util.Log.e("PulseRelay", "Failed to fetch user channels", t);
                
                // Fallback to empty list
                requireActivity().runOnUiThread(() -> {
                    List<String> channels = new ArrayList<>();
                    channels.add("(Failed to load channels)");
                    
                    ArrayAdapter<String> adapter = new ArrayAdapter<>(
                        requireContext(),
                        R.layout.spinner_item,
                        channels
                    );
                    adapter.setDropDownViewResource(R.layout.spinner_dropdown_item);
                    spinner.setAdapter(adapter);
                });
            }
        });
    }
    
    /**
     * Send a chat message to a channel
     */
    private void sendChatMessage(String message, String channel) {
        // Remove leading # if present
        String cleanChannel = channel.startsWith("#") ? channel.substring(1) : channel;
        
        android.util.Log.d("PulseRelay", "Sending message to channel " + cleanChannel + ": " + message);
        
        CommandRequest request = new CommandRequest(message, cleanChannel);
        
        apiService.sendCommand(request).enqueue(new Callback<CommandResponse>() {
            @Override
            public void onResponse(@NonNull Call<CommandResponse> call, @NonNull Response<CommandResponse> response) {
                if (response.isSuccessful() && response.body() != null && response.body().isSuccess()) {
                    Toast.makeText(requireContext(), "Message sent!", Toast.LENGTH_SHORT).show();
                    android.util.Log.d("PulseRelay", "Message sent successfully");
                    
                    // Clear input field - message will appear when server returns it
                    EditText editMessage = chatDialog.findViewById(R.id.editChatMessage);
                    if (editMessage != null) {
                        editMessage.setText("");
                        editMessage.clearFocus();
                        
                        // Hide keyboard
                        android.view.inputmethod.InputMethodManager imm = 
                            (android.view.inputmethod.InputMethodManager) requireContext().getSystemService(android.content.Context.INPUT_METHOD_SERVICE);
                        if (imm != null) {
                            imm.hideSoftInputFromWindow(editMessage.getWindowToken(), 0);
                        }
                    }
                    
                    // Scroll to end of list
                    if (chatRecyclerView != null && chatAdapter != null && chatAdapter.getItemCount() > 0) {
                        chatRecyclerView.smoothScrollToPosition(chatAdapter.getItemCount() - 1);
                    }
                } else {
                    Toast.makeText(requireContext(), 
                            "Failed to send message", 
                            Toast.LENGTH_SHORT).show();
                    android.util.Log.e("PulseRelay", "Failed to send message - Response: " + response.code());
                }
            }
            
            @Override
            public void onFailure(@NonNull Call<CommandResponse> call, @NonNull Throwable t) {
                Toast.makeText(requireContext(), 
                        "Error sending message: " + t.getMessage(), 
                        Toast.LENGTH_SHORT).show();
                android.util.Log.e("PulseRelay", "Error sending message", t);
            }
        });
    }
    
    /**
     * Insert @username into the message input field at cursor position
     */
    private void insertUsernameIntoMessageInput(String username) {
        if (chatDialog == null) {
            return;
        }
        
        EditText editMessage = chatDialog.findViewById(R.id.editChatMessage);
        if (editMessage == null) {
            return;
        }
        
        // Get current cursor position
        int cursorPos = editMessage.getSelectionStart();
        String currentText = editMessage.getText().toString();
        
        // Build mention text with proper spacing
        String mention = "@" + username;
        
        // Add space before if needed (not at start and previous char isn't space)
        if (cursorPos > 0 && currentText.charAt(cursorPos - 1) != ' ') {
            mention = " " + mention;
        }
        
        // Add space after
        mention = mention + " ";
        
        // Insert mention at cursor position
        String newText = currentText.substring(0, cursorPos) + mention + currentText.substring(cursorPos);
        editMessage.setText(newText);
        
        // Move cursor after the inserted mention
        editMessage.setSelection(cursorPos + mention.length());
        
        // Request focus
        editMessage.requestFocus();
        
        android.util.Log.d("PulseRelay", "Inserted @" + username + " at position " + cursorPos);
    }
    
    /**
     * Update the TTS banned users in the chat adapter
     */
    private void updateTTSBannedUsersInAdapter() {
        String ignoredUsersStr = prefs.getString("tts_ignored_users", "");
        Set<String> bannedUsers = new HashSet<>();
        
        if (!ignoredUsersStr.isEmpty()) {
            for (String user : ignoredUsersStr.split(",")) {
                bannedUsers.add(user.trim().toLowerCase());
            }
        }
        
        if (chatAdapter != null) {
            chatAdapter.setTTSBannedUsers(bannedUsers);
        }
    }
    
    /**
     * Clear all chat messages from the server
     */
    private void clearAllChatMessages() {
        apiService.clearChatMessages().enqueue(new Callback<CommandResponse>() {
            @Override
            public void onResponse(@NonNull Call<CommandResponse> call, @NonNull Response<CommandResponse> response) {
                if (response.isSuccessful() && response.body() != null) {
                    if (response.body().isSuccess()) {
                        chatAdapter.clearMessages();
                        // Reset TTS timestamp globally
                        prefs.edit().putLong("last_spoken_timestamp", 0).apply();
                        Toast.makeText(requireContext(), "Chat cleared", Toast.LENGTH_SHORT).show();
                    } else {
                        Toast.makeText(requireContext(), "Failed: " + response.body().getMessage(), Toast.LENGTH_SHORT).show();
                    }
                } else {
                    Toast.makeText(requireContext(), "Failed to clear chat", Toast.LENGTH_SHORT).show();
                }
            }
            
            @Override
            public void onFailure(@NonNull Call<CommandResponse> call, @NonNull Throwable t) {
                Toast.makeText(requireContext(), "Error: " + t.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
    }
    
    @Override
    public void onDestroyView() {
        super.onDestroyView();
        stopChatPolling();
        stopHealthCheck();
        // Save chat dialog state before view is destroyed
        if (chatDialog != null) {
            wasChatDialogShowing = chatDialog.isShowing();
        }
        // TTS is managed by ViewModel and survives configuration changes
    }
    
    @Override
    public void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        // Save whether chat dialog was showing
        if (chatDialog != null) {
            outState.putBoolean("chatDialogShowing", chatDialog.isShowing());
        } else {
            outState.putBoolean("chatDialogShowing", wasChatDialogShowing);
        }
        android.util.Log.d("PulseRelay", "Saving chat dialog state: " + (chatDialog != null && chatDialog.isShowing()));
    }
    
    // ==================== End Chat Methods ====================
    
    // Custom adapter for color spinner with colored indicators
    private class ColorSpinnerAdapter extends ArrayAdapter<String> {
        private final StreamDeckButton.ButtonColor[] colors;
        
        public ColorSpinnerAdapter(Context context, StreamDeckButton.ButtonColor[] colors, String[] colorNames) {
            super(context, R.layout.color_spinner_item, R.id.color_name, colorNames);
            this.colors = colors;
        }
        
        @NonNull
        @Override
        public View getView(int position, View convertView, @NonNull ViewGroup parent) {
            return createView(position, convertView, parent, R.layout.color_spinner_item);
        }
        
        @Override
        public View getDropDownView(int position, View convertView, @NonNull ViewGroup parent) {
            return createView(position, convertView, parent, R.layout.color_spinner_dropdown_item);
        }
        
        private View createView(int position, View convertView, ViewGroup parent, int layoutResId) {
            View view = convertView;
            if (view == null) {
                LayoutInflater inflater = LayoutInflater.from(getContext());
                view = inflater.inflate(layoutResId, parent, false);
            }
            
            TextView colorName = view.findViewById(R.id.color_name);
            View colorIndicator = view.findViewById(R.id.color_indicator);
            
            colorName.setText(getItem(position));
            colorIndicator.setBackgroundColor(getResources().getColor(getColorResource(colors[position]), null));
            
            return view;
        }
        
        private int getColorResource(StreamDeckButton.ButtonColor color) {
            switch (color) {
                case PRIMARY:
                    return R.color.twitch_purple;
                case SUCCESS:
                    return R.color.success_color;
                case DANGER:
                    return R.color.danger_color;
                case WARNING:
                    return R.color.warning_color;
                case INFO:
                    return R.color.info_color;
                case SECONDARY:
                    return R.color.bg_tertiary;
                case PURPLE:
                    return R.color.twitch_purple_dark;
                default:
                    return R.color.twitch_purple;
            }
        }
    }
    
    private void loadOpenAIState(ImageButton btnToggleOpenAI) {
        com.pulserelay.locationtracker.api.UserApiService userApiService = 
            com.pulserelay.locationtracker.api.ApiClient.getRetrofitInstance(requireContext())
                .create(com.pulserelay.locationtracker.api.UserApiService.class);
        
        userApiService.getTTSSettings().enqueue(new Callback<com.pulserelay.locationtracker.models.TTSSettingsResponse>() {
            @Override
            public void onResponse(@NonNull Call<com.pulserelay.locationtracker.models.TTSSettingsResponse> call, 
                                 @NonNull Response<com.pulserelay.locationtracker.models.TTSSettingsResponse> response) {
                if (response.isSuccessful() && response.body() != null) {
                    boolean enabled = response.body().isTtsOpenaiEnabled();
                    updateOpenAIButtonState(btnToggleOpenAI, enabled);
                }
            }
            
            @Override
            public void onFailure(@NonNull Call<com.pulserelay.locationtracker.models.TTSSettingsResponse> call, 
                                @NonNull Throwable t) {
                // On failure, assume disabled
                updateOpenAIButtonState(btnToggleOpenAI, false);
            }
        });
    }
    
    private void toggleOpenAI(ImageButton btnToggleOpenAI) {
        com.pulserelay.locationtracker.api.UserApiService userApiService = 
            com.pulserelay.locationtracker.api.ApiClient.getRetrofitInstance(requireContext())
                .create(com.pulserelay.locationtracker.api.UserApiService.class);
        
        // First get current state
        userApiService.getTTSSettings().enqueue(new Callback<com.pulserelay.locationtracker.models.TTSSettingsResponse>() {
            @Override
            public void onResponse(@NonNull Call<com.pulserelay.locationtracker.models.TTSSettingsResponse> call, 
                                 @NonNull Response<com.pulserelay.locationtracker.models.TTSSettingsResponse> response) {
                if (response.isSuccessful() && response.body() != null) {
                    boolean currentState = response.body().isTtsOpenaiEnabled();
                    boolean newState = !currentState;
                    
                    // Update on server
                    com.pulserelay.locationtracker.models.TTSSettings settings = 
                        new com.pulserelay.locationtracker.models.TTSSettings(newState);
                    
                    userApiService.updateTTSSettings(settings).enqueue(new Callback<com.pulserelay.locationtracker.models.TTSSettingsResponse>() {
                        @Override
                        public void onResponse(@NonNull Call<com.pulserelay.locationtracker.models.TTSSettingsResponse> call, 
                                             @NonNull Response<com.pulserelay.locationtracker.models.TTSSettingsResponse> response) {
                            if (response.isSuccessful() && response.body() != null) {
                                boolean updatedState = response.body().isTtsOpenaiEnabled();
                                updateOpenAIButtonState(btnToggleOpenAI, updatedState);
                                Toast.makeText(requireContext(), 
                                    "OpenAI " + (updatedState ? "enabled" : "disabled"), 
                                    Toast.LENGTH_SHORT).show();
                            } else {
                                Toast.makeText(requireContext(), "Failed to update OpenAI setting", Toast.LENGTH_SHORT).show();
                            }
                        }
                        
                        @Override
                        public void onFailure(@NonNull Call<com.pulserelay.locationtracker.models.TTSSettingsResponse> call, 
                                            @NonNull Throwable t) {
                            Toast.makeText(requireContext(), "Error: " + t.getMessage(), Toast.LENGTH_SHORT).show();
                        }
                    });
                }
            }
            
            @Override
            public void onFailure(@NonNull Call<com.pulserelay.locationtracker.models.TTSSettingsResponse> call, 
                                @NonNull Throwable t) {
                Toast.makeText(requireContext(), "Error getting current state: " + t.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
    }
    
    private void updateOpenAIButtonState(ImageButton btnToggleOpenAI, boolean enabled) {
        if (enabled) {
            // OpenAI is ON - green robot icon
            btnToggleOpenAI.setImageResource(R.drawable.ic_robot);
            btnToggleOpenAI.setColorFilter(getResources().getColor(R.color.success_color, null));
        } else {
            // OpenAI is OFF - red robot icon
            btnToggleOpenAI.setImageResource(R.drawable.ic_robot);
            btnToggleOpenAI.setColorFilter(getResources().getColor(R.color.danger_color, null));
        }
    }
    
    // TTS functionality is now handled globally by TTSManager in MainActivity
}
