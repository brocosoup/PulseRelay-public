package com.pulserelay.locationtracker.adapters;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Paint;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.RecyclerView;

import com.pulserelay.locationtracker.R;
import com.pulserelay.locationtracker.models.ChatMessage;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Adapter for displaying Twitch chat messages in a RecyclerView
 */
public class ChatAdapter extends RecyclerView.Adapter<ChatAdapter.ChatViewHolder> {
    
    private List<ChatMessage> messages = new ArrayList<>();
    private final Context context;
    private final SimpleDateFormat timeFormat = new SimpleDateFormat("HH:mm", Locale.getDefault());
    private OnMessageActionListener actionListener;
    private Set<String> ttsBannedUsers = new HashSet<>();
    
    public interface OnMessageActionListener {
        void onDeleteMessage(ChatMessage message);
        void onTimeoutUser(ChatMessage message);
        void onToggleTTSBan(ChatMessage message, boolean currentlyBanned);
        void onSetAlias(ChatMessage message);
        void onUsernameClick(String username);
    }
    
    public ChatAdapter(Context context) {
        this.context = context;
    }
    
    public void setOnMessageActionListener(OnMessageActionListener listener) {
        this.actionListener = listener;
    }
    
    /**
     * Update the list of TTS banned users
     */
    public void setTTSBannedUsers(Set<String> bannedUsers) {
        this.ttsBannedUsers = bannedUsers != null ? bannedUsers : new HashSet<>();
        notifyDataSetChanged();
    }
    
    @NonNull
    @Override
    public ChatViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_chat_message, parent, false);
        return new ChatViewHolder(view);
    }
    
    @Override
    public void onBindViewHolder(@NonNull ChatViewHolder holder, int position) {
        ChatMessage message = messages.get(position);
        
        android.util.Log.d("ChatAdapter", String.format("onBindViewHolder called: position=%d, ID=%s, Text=%s",
            position, message.getId(), message.getMessage()));
        
        // Set username with color
        String displayName = message.getDisplayName() != null ? 
                message.getDisplayName() : message.getUsername();
        holder.tvUsername.setText(displayName);
        
        // Make username clickable
        holder.tvUsername.setOnClickListener(v -> {
            if (actionListener != null) {
                actionListener.onUsernameClick(message.getUsername());
            }
        });
        
        // Apply username color if available
        if (message.getUserColor() != null && !message.getUserColor().isEmpty()) {
            try {
                holder.tvUsername.setTextColor(Color.parseColor(message.getUserColor()));
            } catch (IllegalArgumentException e) {
                // Invalid color, use default
                holder.tvUsername.setTextColor(
                        ContextCompat.getColor(context, R.color.text_primary));
            }
        } else {
            holder.tvUsername.setTextColor(
                    ContextCompat.getColor(context, R.color.text_primary));
        }
        
        // Set message text
        holder.tvMessage.setText(message.getMessage());
        
        // Apply strikethrough and grey out if deleted or user timed out
        if (message.isDeleted() || message.isUserTimedOut()) {
            holder.tvMessage.setPaintFlags(holder.tvMessage.getPaintFlags() | Paint.STRIKE_THRU_TEXT_FLAG);
            holder.tvMessage.setTextColor(ContextCompat.getColor(context, R.color.text_secondary));
            holder.tvUsername.setTextColor(ContextCompat.getColor(context, R.color.text_secondary));
        } else {
            // Remove strikethrough if not deleted/timed out
            holder.tvMessage.setPaintFlags(holder.tvMessage.getPaintFlags() & ~Paint.STRIKE_THRU_TEXT_FLAG);
            holder.tvMessage.setTextColor(ContextCompat.getColor(context, R.color.text_primary));
        }
        
        // Show/hide action buttons based on message state
        // Hide ALL action buttons if this is a self message (sent from app - no ID from Twitch)
        if (message.isSelf()) {
            holder.btnDeleteMessage.setVisibility(View.GONE);
            holder.btnTimeoutUser.setVisibility(View.GONE);
            holder.btnIgnoreUser.setVisibility(View.GONE);
            holder.btnSetAlias.setVisibility(View.GONE);
        } else {
            // Hide delete button if message is deleted OR user is timed out
            if (message.isDeleted() || message.isUserTimedOut()) {
                holder.btnDeleteMessage.setVisibility(View.GONE);
            } else {
                holder.btnDeleteMessage.setVisibility(View.VISIBLE);
            }
            
            // Always show other buttons for non-self messages
            holder.btnTimeoutUser.setVisibility(View.VISIBLE);
            holder.btnIgnoreUser.setVisibility(View.VISIBLE);
            holder.btnSetAlias.setVisibility(View.VISIBLE);
        }
        
        // Set timestamp
        if (message.getTimestamp() > 0) {
            holder.tvTimestamp.setText(timeFormat.format(new Date(message.getTimestamp())));
        } else {
            holder.tvTimestamp.setText("");
        }
        
        // Add badges
        holder.badgesContainer.removeAllViews();
        addBadges(holder.badgesContainer, message);
        
        // Check if user is TTS banned
        boolean isUserBanned = ttsBannedUsers.contains(message.getUsername().toLowerCase());
        
        // Update TTS button icon and color based on ban status
        if (isUserBanned) {
            // Banned: red speaker muted icon
            holder.btnIgnoreUser.setImageResource(R.drawable.ic_speaker_muted);
            holder.btnIgnoreUser.setColorFilter(ContextCompat.getColor(context, R.color.danger_color));
        } else {
            // Not banned: green speaker icon
            holder.btnIgnoreUser.setImageResource(R.drawable.ic_speaker);
            holder.btnIgnoreUser.setColorFilter(ContextCompat.getColor(context, R.color.success_color));
        }
        
        // Setup action buttons - use adapter position to get current message at click time
        holder.btnDeleteMessage.setOnClickListener(v -> {
            if (actionListener != null) {
                int currentPosition = holder.getAdapterPosition();
                android.util.Log.d("ChatAdapter", String.format("=== DELETE BUTTON CLICKED ==="));
                android.util.Log.d("ChatAdapter", String.format("Click: ViewHolder.getAdapterPosition() = %d", currentPosition));
                android.util.Log.d("ChatAdapter", String.format("Click: messages.size() = %d", messages.size()));
                
                if (currentPosition != RecyclerView.NO_POSITION && currentPosition < messages.size()) {
                    ChatMessage msg = messages.get(currentPosition);
                    android.util.Log.d("ChatAdapter", String.format("Click: Message at position %d: ID=%s, Text='%s'",
                        currentPosition, msg.getId(), msg.getMessage()));
                    
                    // Log all messages for context
                    for (int i = 0; i < messages.size(); i++) {
                        ChatMessage m = messages.get(i);
                        android.util.Log.d("ChatAdapter", String.format("  [%d] ID=%s, Text='%s'", i, m.getId(), m.getMessage()));
                    }
                    
                    actionListener.onDeleteMessage(msg);
                } else {
                    android.util.Log.e("ChatAdapter", String.format("Click: Invalid position! currentPosition=%d, NO_POSITION=%d",
                        currentPosition, RecyclerView.NO_POSITION));
                }
            }
        });
        
        holder.btnTimeoutUser.setOnClickListener(v -> {
            if (actionListener != null) {
                int currentPosition = holder.getAdapterPosition();
                if (currentPosition != RecyclerView.NO_POSITION && currentPosition < messages.size()) {
                    actionListener.onTimeoutUser(messages.get(currentPosition));
                }
            }
        });
        
        holder.btnIgnoreUser.setOnClickListener(v -> {
            if (actionListener != null) {
                int currentPosition = holder.getAdapterPosition();
                if (currentPosition != RecyclerView.NO_POSITION && currentPosition < messages.size()) {
                    ChatMessage currentMessage = messages.get(currentPosition);
                    boolean isBanned = ttsBannedUsers.contains(currentMessage.getUsername().toLowerCase());
                    actionListener.onToggleTTSBan(currentMessage, isBanned);
                }
            }
        });
        
        holder.btnSetAlias.setOnClickListener(v -> {
            if (actionListener != null) {
                int currentPosition = holder.getAdapterPosition();
                if (currentPosition != RecyclerView.NO_POSITION && currentPosition < messages.size()) {
                    actionListener.onSetAlias(messages.get(currentPosition));
                }
            }
        });
    }
    
    /**
     * Add badge icons to the badges container based on message flags
     */
    private void addBadges(LinearLayout container, ChatMessage message) {
        // Get badges map
        Map<String, String> badges = message.getBadges();
        if (badges == null || badges.isEmpty()) {
            return;
        }
        
        // Broadcaster badge
        if (badges.containsKey("broadcaster")) {
            addBadge(container, "📺", ContextCompat.getColor(context, R.color.danger_color));
        }
        
        // Moderator badge
        if (badges.containsKey("moderator")) {
            addBadge(container, "🛡️", ContextCompat.getColor(context, R.color.success_color));
        }
        
        // VIP badge
        if (badges.containsKey("vip")) {
            addBadge(container, "💎", ContextCompat.getColor(context, R.color.warning_color));
        }
        
        // Subscriber badge
        if (badges.containsKey("subscriber")) {
            addBadge(container, "⭐", ContextCompat.getColor(context, R.color.info_color));
        }
    }
    
    /**
     * Create and add a badge TextView to the container
     */
    private void addBadge(LinearLayout container, String emoji, int backgroundColor) {
        TextView badge = new TextView(context);
        badge.setText(emoji);
        badge.setTextSize(12);
        badge.setPadding(4, 2, 4, 2);
        
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.setMarginEnd(4);
        badge.setLayoutParams(params);
        
        container.addView(badge);
    }
    
    @Override
    public int getItemCount() {
        return messages.size();
    }
    
    /**
     * Update the messages list and notify adapter
     */
    public void setMessages(List<ChatMessage> newMessages) {
        this.messages = newMessages != null ? newMessages : new ArrayList<>();
        notifyDataSetChanged();
    }
    
    /**
     * Get the current messages list
     */
    public List<ChatMessage> getMessages() {
        return messages;
    }
    
    /**
     * Add new messages to the end of the list
     */
    public void addMessages(List<ChatMessage> newMessages) {
        if (newMessages != null && !newMessages.isEmpty()) {
            int startPosition = messages.size();
            messages.addAll(newMessages);
            notifyItemRangeInserted(startPosition, newMessages.size());
        }
    }
    
    /**
     * Clear all messages
     */
    public void clearMessages() {
        messages.clear();
        notifyDataSetChanged();
    }
    
    /**
     * Get the current message count
     */
    public int getMessageCount() {
        return messages.size();
    }
    
    /**
     * Find a message by its ID in the current list
     * This prevents stale reference issues when the list is refreshed
     */
    private ChatMessage findMessageById(String messageId) {
        if (messageId == null) {
            return null;
        }
        for (ChatMessage msg : messages) {
            if (messageId.equals(msg.getId())) {
                return msg;
            }
        }
        return null;
    }
    
    static class ChatViewHolder extends RecyclerView.ViewHolder {
        TextView tvUsername;
        TextView tvMessage;
        TextView tvTimestamp;
        LinearLayout badgesContainer;
        ImageButton btnDeleteMessage;
        ImageButton btnTimeoutUser;
        ImageButton btnIgnoreUser;
        ImageButton btnSetAlias;
        
        ChatViewHolder(View itemView) {
            super(itemView);
            tvUsername = itemView.findViewById(R.id.tvUsername);
            tvMessage = itemView.findViewById(R.id.tvMessage);
            tvTimestamp = itemView.findViewById(R.id.tvTimestamp);
            badgesContainer = itemView.findViewById(R.id.badgesContainer);
            btnDeleteMessage = itemView.findViewById(R.id.btnDeleteMessage);
            btnTimeoutUser = itemView.findViewById(R.id.btnTimeoutUser);
            btnIgnoreUser = itemView.findViewById(R.id.btnIgnoreUser);
            btnSetAlias = itemView.findViewById(R.id.btnSetAlias);
        }
    }
}
