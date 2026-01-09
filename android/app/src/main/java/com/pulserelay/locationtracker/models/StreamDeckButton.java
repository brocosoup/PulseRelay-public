package com.pulserelay.locationtracker.models;

/**
 * Model for pulse deck button configuration
 */
public class StreamDeckButton {
    private String command;
    private String title;
    private String subtitle;
    private int iconResId;
    private ButtonColor color;
    private String category;  // Changed from enum to String for dynamic categories
    private boolean requiresInput;
    private String inputHint;
    private boolean requiresConfirmation;
    private String confirmationMessage;
    private boolean useCustomChannel;
    private String customChannel;
    
    public enum ButtonColor {
        PRIMARY,    // Twitch Purple
        SUCCESS,    // Green
        DANGER,     // Red
        WARNING,    // Orange
        INFO,       // Blue
        SECONDARY,  // Gray
        PURPLE      // Purple variant
    }
    
    // Category is now a String to allow dynamic categories
    // Reserved categories for backward compatibility
    public static final String CATEGORY_NONE = "Default";
    public static final String CATEGORY_SCENE = "Scene";
    public static final String CATEGORY_AUDIO = "Audio";
    public static final String CATEGORY_CAMERA = "Camera";
    public static final String CATEGORY_CHAT = "Chat";
    public static final String CATEGORY_STREAM = "Stream";
    public static final String CATEGORY_LOCATION = "Location";
    
    public StreamDeckButton(String command, String title, String subtitle, int iconResId, ButtonColor color, String category) {
        this(command, title, subtitle, iconResId, color, category, false, null, false, null, false, null);
    }
    
    public StreamDeckButton(String command, String title, String subtitle, int iconResId, ButtonColor color, String category, boolean requiresInput, String inputHint) {
        this(command, title, subtitle, iconResId, color, category, requiresInput, inputHint, false, null, false, null);
    }
    
    public StreamDeckButton(String command, String title, String subtitle, int iconResId, ButtonColor color, String category, boolean requiresInput, String inputHint, boolean requiresConfirmation, String confirmationMessage) {
        this(command, title, subtitle, iconResId, color, category, requiresInput, inputHint, requiresConfirmation, confirmationMessage, false, null);
    }
    
    public StreamDeckButton(String command, String title, String subtitle, int iconResId, ButtonColor color, String category, boolean requiresInput, String inputHint, boolean requiresConfirmation, String confirmationMessage, boolean useCustomChannel, String customChannel) {
        this.command = command;
        this.title = title;
        this.subtitle = subtitle;
        this.iconResId = iconResId;
        this.color = color;
        this.category = category;
        this.requiresInput = requiresInput;
        this.inputHint = inputHint;
        this.requiresConfirmation = requiresConfirmation;
        this.confirmationMessage = confirmationMessage;
        this.useCustomChannel = useCustomChannel;
        this.customChannel = customChannel;
    }
    
    public String getCommand() {
        return command;
    }
    
    public String getTitle() {
        return title;
    }
    
    public String getSubtitle() {
        return subtitle;
    }
    
    public int getIconResId() {
        return iconResId;
    }
    
    public ButtonColor getColor() {
        return color;
    }
    
    public String getCategory() {
        return category;
    }
    
    public boolean requiresInput() {
        return requiresInput;
    }
    
    public String getInputHint() {
        return inputHint;
    }
    
    public boolean requiresConfirmation() {
        return requiresConfirmation;
    }
    
    public String getConfirmationMessage() {
        return confirmationMessage;
    }
    
    public void setCommand(String command) {
        this.command = command;
    }
    
    public void setTitle(String title) {
        this.title = title;
    }
    
    public void setSubtitle(String subtitle) {
        this.subtitle = subtitle;
    }
    
    public void setIconResId(int iconResId) {
        this.iconResId = iconResId;
    }
    
    public void setColor(ButtonColor color) {
        this.color = color;
    }
    
    public void setCategory(String category) {
        this.category = category;
    }
    
    public void setRequiresInput(boolean requiresInput) {
        this.requiresInput = requiresInput;
    }
    
    public void setInputHint(String inputHint) {
        this.inputHint = inputHint;
    }
    
    public void setRequiresConfirmation(boolean requiresConfirmation) {
        this.requiresConfirmation = requiresConfirmation;
    }
    
    public void setConfirmationMessage(String confirmationMessage) {
        this.confirmationMessage = confirmationMessage;
    }
    
    public boolean useCustomChannel() {
        return useCustomChannel;
    }
    
    public void setUseCustomChannel(boolean useCustomChannel) {
        this.useCustomChannel = useCustomChannel;
    }
    
    public String getCustomChannel() {
        return customChannel;
    }
    
    public void setCustomChannel(String customChannel) {
        this.customChannel = customChannel;
    }
    
    /**
     * Get optimal number of columns for this category in landscape mode
     */
    public static int getColumnsForCategory(String category) {
        if (category == null || category.equals(CATEGORY_NONE)) {
            return 12; // Full width for Default category
        }
        
        // Use 6 columns (2 per row) for most categories, 12 for single-width
        switch (category) {
            case "Scene":
            case "Audio":
            case "Camera":
                return 6;  // 2 buttons per row
            case "Camera Select":
                return 3;  // 4 buttons per row
            default:
                return 12; // Full width for custom categories
        }
    }
}
