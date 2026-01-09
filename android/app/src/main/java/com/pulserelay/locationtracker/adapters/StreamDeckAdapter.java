package com.pulserelay.locationtracker.adapters;

import android.content.Context;
import android.content.res.ColorStateList;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.RecyclerView;

import com.google.android.material.card.MaterialCardView;
import com.pulserelay.locationtracker.R;
import com.pulserelay.locationtracker.models.StreamDeckButton;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Adapter for stream deck buttons with expandable category folders
 */
public class StreamDeckAdapter extends RecyclerView.Adapter<RecyclerView.ViewHolder> {
    
    private static final int TYPE_HEADER = 0;
    private static final int TYPE_BUTTON = 1;
    
    private List<Object> items; // Mix of CategoryHeader and StreamDeckButton
    private List<Object> allItems; // All items including collapsed ones
    private List<StreamDeckButton> allButtons; // Store all buttons for easy access
    private OnButtonClickListener listener;
    private Context context;
    private boolean enabled = true;
    private boolean editMode = false;
    private Map<String, Boolean> expandedCategories; // Track which categories are expanded
    private List<String> categoryOrder = null; // Custom category sort order
    private Map<String, List<String>> buttonOrders = new HashMap<>(); // Custom button sort order per category
    private android.content.SharedPreferences prefs; // For saving category states
    
    public interface OnButtonClickListener {
        void onButtonClick(StreamDeckButton button);
    }
    
    public interface OnCategoryLongClickListener {
        void onCategoryLongClick(String categoryName);
    }
    
    private OnCategoryLongClickListener categoryLongClickListener;
    
    // Top-level button row container
    private static class CategoryHeader {
        String name;
        int buttonCount;
        
        CategoryHeader(String name, int buttonCount) {
            this.name = name;
            this.buttonCount = buttonCount;
        }
    }
    
    public StreamDeckAdapter(Context context, OnButtonClickListener listener) {
        this.context = context;
        this.items = new ArrayList<>();
        this.allItems = new ArrayList<>();
        this.listener = listener;
        this.expandedCategories = new HashMap<>();
          this.prefs = androidx.preference.PreferenceManager.getDefaultSharedPreferences(context);
    }
    
    public void setButtons(List<StreamDeckButton> buttons) {
        this.allButtons = new ArrayList<>(buttons);
        allItems.clear();
        expandedCategories.clear();
        
        // Group ALL buttons by category (including "None")
        for (StreamDeckButton button : buttons) {
            allItems.add(button);
        }
        
        // Sort by category using custom order if available, otherwise alphabetically
        allItems.sort((o1, o2) -> {
            if (!(o1 instanceof StreamDeckButton) || !(o2 instanceof StreamDeckButton)) return 0;
            StreamDeckButton b1 = (StreamDeckButton) o1;
            StreamDeckButton b2 = (StreamDeckButton) o2;
            
            if (categoryOrder != null) {
                // Use custom order
                int index1 = categoryOrder.indexOf(b1.getCategory());
                int index2 = categoryOrder.indexOf(b2.getCategory());
                
                // If not in order list, put at end
                if (index1 == -1) index1 = Integer.MAX_VALUE;
                if (index2 == -1) index2 = Integer.MAX_VALUE;
                
                return Integer.compare(index1, index2);
            } else {
                // Default alphabetical
                return b1.getCategory().compareTo(b2.getCategory());
            }
        });
        
        // Insert category headers
        List<Object> itemsWithHeaders = new ArrayList<>();
        String currentCategory = null;
        int categoryButtonCount = 0;
        List<StreamDeckButton> categoryButtons = new ArrayList<>();
        
        for (Object item : allItems) {
            if (item instanceof StreamDeckButton) {
                StreamDeckButton button = (StreamDeckButton) item;
                String categoryName = button.getCategory();
                
                if (!categoryName.equals(currentCategory)) {
                    // Add header and buttons for previous category
                    if (currentCategory != null) {
                        // Sort buttons within category if order is defined
                        sortButtonsInCategory(currentCategory, categoryButtons);
                        itemsWithHeaders.add(new CategoryHeader(currentCategory, categoryButtonCount));
                        itemsWithHeaders.addAll(categoryButtons);
                        categoryButtons.clear();
                    }
                    currentCategory = categoryName;
                    categoryButtonCount = 0;
                    
                    // Load saved state or default to expanded (true)
                    if (!expandedCategories.containsKey(categoryName)) {
                        boolean savedState = prefs.getBoolean("category_expanded_" + categoryName, true);
                        expandedCategories.put(categoryName, savedState);
                    }
                }
                
                categoryButtons.add(button);
                categoryButtonCount++;
            }
        }
        
        // Add last category header and buttons
        if (currentCategory != null) {
            // Sort buttons within category if order is defined
            sortButtonsInCategory(currentCategory, categoryButtons);
            itemsWithHeaders.add(new CategoryHeader(currentCategory, categoryButtonCount));
            itemsWithHeaders.addAll(categoryButtons);
        }
        
        allItems.clear();
        allItems.addAll(itemsWithHeaders);
        
        // Initially collapse all categories (except None which is expanded above)
        refreshVisibleItems();
    }
    
    private void refreshVisibleItems() {
        items.clear();
        
        for (int i = 0; i < allItems.size(); i++) {
            Object item = allItems.get(i);
            
            if (item instanceof CategoryHeader) {
                items.add(item);
            } else if (item instanceof StreamDeckButton) {
                StreamDeckButton button = (StreamDeckButton) item;
                
                // Find the category this button belongs to
                String category = findCategoryForIndex(i);
                if (category != null && expandedCategories.getOrDefault(category, false)) {
                    items.add(item);
                }
            }
        }
        
        notifyDataSetChanged();
    }
    
    private String findCategoryForIndex(int index) {
        // Go backwards to find the category header
        for (int i = index - 1; i >= 0; i--) {
            if (allItems.get(i) instanceof CategoryHeader) {
                return ((CategoryHeader) allItems.get(i)).name;
            }
        }
        return null;
    }
    
    private void sortButtonsInCategory(String categoryName, List<StreamDeckButton> categoryButtons) {
        List<String> buttonOrder = buttonOrders.get(categoryName);
        if (buttonOrder == null || buttonOrder.isEmpty()) {
            return; // No custom order, keep as-is
        }
        
        // Sort buttons based on saved order
        categoryButtons.sort((b1, b2) -> {
            int index1 = buttonOrder.indexOf(b1.getTitle());
            int index2 = buttonOrder.indexOf(b2.getTitle());
            
            // If not in order list, put at end
            if (index1 == -1) index1 = Integer.MAX_VALUE;
            if (index2 == -1) index2 = Integer.MAX_VALUE;
            
            return Integer.compare(index1, index2);
        });
    }
    
    private void toggleCategory(String categoryName) {
        boolean isExpanded = expandedCategories.getOrDefault(categoryName, false);
        boolean newState = !isExpanded;
        expandedCategories.put(categoryName, newState);
        
        // Save state to preferences
        prefs.edit().putBoolean("category_expanded_" + categoryName, newState).apply();
        
        refreshVisibleItems();
    }
    
    @Override
    public int getItemViewType(int position) {
        Object item = items.get(position);
        if (item instanceof CategoryHeader) {
            return TYPE_HEADER;
        } else {
            return TYPE_BUTTON;
        }
    }
    
    @NonNull
    @Override
    public RecyclerView.ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        if (viewType == TYPE_HEADER) {
            View view = LayoutInflater.from(parent.getContext())
                    .inflate(R.layout.item_category_header, parent, false);
            return new HeaderViewHolder(view);
        } else {
            View view = LayoutInflater.from(parent.getContext())
                    .inflate(R.layout.item_stream_deck_button, parent, false);
            return new ButtonViewHolder(view);
        }
    }
    
    @Override
    public void onBindViewHolder(@NonNull RecyclerView.ViewHolder holder, int position) {
        if (holder instanceof HeaderViewHolder) {
            ((HeaderViewHolder) holder).bind((CategoryHeader) items.get(position));
        } else if (holder instanceof ButtonViewHolder) {
            ((ButtonViewHolder) holder).bind((StreamDeckButton) items.get(position));
        }
    }
    
    /**
     * Enable/disable all buttons (for loading states)
     */
    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
        notifyDataSetChanged();
    }
    
    /**
     * Check if position is a header or top-level row (for GridLayoutManager span sizing)
     */
    public boolean isHeader(int position) {
        if (position < 0 || position >= items.size()) {
            return false;
        }
        Object item = items.get(position);
        return item instanceof CategoryHeader;
    }
    
    /**
     * Get button at position (returns null if not a button)
     */
    public StreamDeckButton getButtonAt(int position) {
        if (position < 0 || position >= items.size()) {
            return null;
        }
        Object item = items.get(position);
        if (item instanceof StreamDeckButton) {
            return (StreamDeckButton) item;
        }
        return null;
    }
    
    @Override
    public int getItemCount() {
        return items.size();
    }
    
    // Category Header ViewHolder
    class HeaderViewHolder extends RecyclerView.ViewHolder {
        private MaterialCardView categoryCard;
        private TextView categoryTitle;
        private TextView buttonCount;
        private ImageView expandIcon;
        
        HeaderViewHolder(@NonNull View itemView) {
            super(itemView);
            categoryCard = (MaterialCardView) itemView;
            categoryTitle = itemView.findViewById(R.id.categoryTitle);
            buttonCount = itemView.findViewById(R.id.buttonCount);
            expandIcon = itemView.findViewById(R.id.expandIcon);
        }
        
        void bind(CategoryHeader header) {
            categoryTitle.setText(header.name);
            buttonCount.setText(header.buttonCount + " buttons");
            
            boolean isExpanded = expandedCategories.getOrDefault(header.name, false);
            expandIcon.setRotation(isExpanded ? 180 : 0);
            
            categoryCard.setOnClickListener(v -> {
                toggleCategory(header.name);
            });
            
            // Long-press to edit category when in edit mode
            categoryCard.setOnLongClickListener(v -> {
                if (editMode && categoryLongClickListener != null) {
                    categoryLongClickListener.onCategoryLongClick(header.name);
                    return true;
                }
                return false;
            });
        }
    }
    
    // Button ViewHolder
    class ButtonViewHolder extends RecyclerView.ViewHolder {
        private MaterialCardView card;
        private ImageView icon;
        private TextView title;
        private TextView subtitle;
        
        ButtonViewHolder(@NonNull View itemView) {
            super(itemView);
            card = (MaterialCardView) itemView;
            icon = itemView.findViewById(R.id.buttonIcon);
            title = itemView.findViewById(R.id.buttonTitle);
            subtitle = itemView.findViewById(R.id.buttonSubtitle);
        }
        
        void bind(StreamDeckButton button) {
            int iconResId = button.getIconResId();
            
            // Validate resource is actually a drawable
            try {
                if (iconResId != 0) {
                    String resourceTypeName = context.getResources().getResourceTypeName(iconResId);
                    if ("drawable".equals(resourceTypeName) || "mipmap".equals(resourceTypeName)) {
                        icon.setImageResource(iconResId);
                    } else {
                        // Invalid resource type, use fallback
                        icon.setImageResource(android.R.drawable.ic_menu_help);
                    }
                } else {
                    icon.setImageResource(android.R.drawable.ic_menu_help);
                }
            } catch (android.content.res.Resources.NotFoundException e) {
                // Resource not found, use fallback
                icon.setImageResource(android.R.drawable.ic_menu_help);
            }
            
            title.setText(button.getTitle());
            
            // Only show subtitle if it has content
            String subtitleText = button.getSubtitle();
            if (subtitleText != null && !subtitleText.trim().isEmpty()) {
                subtitle.setText(subtitleText);
                subtitle.setVisibility(View.VISIBLE);
            } else {
                subtitle.setVisibility(View.GONE);
            }
            
            // Set card background color based on button color
            int colorResId = getColorForButton(button.getColor());
            card.setCardBackgroundColor(ContextCompat.getColor(context, colorResId));
            
            // Set enabled state
            card.setEnabled(enabled);
            card.setAlpha(enabled ? 1.0f : 0.5f);
            
            // Set click listener
            card.setOnClickListener(v -> {
                if (listener != null && enabled) {
                    listener.onButtonClick(button);
                }
            });
        }
        
        private int getColorForButton(StreamDeckButton.ButtonColor color) {
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
    
    // ==================== EDIT MODE METHODS ====================
    
    public void setEditMode(boolean editMode) {
        this.editMode = editMode;
        notifyDataSetChanged();
    }
    
    public void setCategoryLongClickListener(OnCategoryLongClickListener listener) {
        this.categoryLongClickListener = listener;
    }
    
    public void setCategoryOrder(List<String> categoryOrder) {
        this.categoryOrder = categoryOrder;
        // Only rebuild if we already have buttons loaded
        if (allButtons != null && !allButtons.isEmpty()) {
            setButtons(allButtons);
        }
    }
    
    public List<String> getCategoryOrder() {
        return categoryOrder;
    }
    
    public void setButtonOrder(String categoryName, List<String> buttonOrder) {
        this.buttonOrders.put(categoryName, buttonOrder);
        // Only rebuild if we already have buttons loaded
        if (allButtons != null && !allButtons.isEmpty()) {
            setButtons(allButtons);
        }
    }
    
    public List<String> getButtonOrder(String categoryName) {
        return buttonOrders.get(categoryName);
    }
    
    public boolean isEditMode() {
        return editMode;
    }
    
    public List<StreamDeckButton> getAllButtons() {
        return new ArrayList<>(allButtons);
    }
    
    public void removeButton(StreamDeckButton button) {
        allButtons.remove(button);
        setButtons(allButtons);
        notifyDataSetChanged();
    }
    
    public void addButton(StreamDeckButton button) {
        allButtons.add(button);
        setButtons(allButtons);
        notifyDataSetChanged();
    }
}


