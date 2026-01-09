package com.pulserelay.locationtracker.adapters;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.pulserelay.locationtracker.R;

import java.util.ArrayList;
import java.util.List;

public class IconPickerAdapter extends RecyclerView.Adapter<IconPickerAdapter.IconViewHolder> {
    
    private final List<Integer> iconResIds;
    private final OnIconSelectedListener listener;
    private int selectedPosition = -1;
    
    public interface OnIconSelectedListener {
        void onIconSelected(int iconResId);
    }
    
    public IconPickerAdapter(OnIconSelectedListener listener) {
        this.listener = listener;
        this.iconResIds = getAvailableIcons();
    }
    
    private List<Integer> getAvailableIcons() {
        List<Integer> icons = new ArrayList<>();
        
        // Custom icons
        icons.add(R.drawable.ic_video);
        icons.add(R.drawable.ic_audio);
        icons.add(R.drawable.ic_camera);
        icons.add(R.drawable.ic_scene);
        icons.add(R.drawable.ic_chat);
        icons.add(R.drawable.ic_music);
        icons.add(R.drawable.ic_record);
        icons.add(R.drawable.ic_screen);
        icons.add(R.drawable.ic_settings);
        icons.add(R.drawable.ic_overlay);
        icons.add(R.drawable.ic_stop);
        icons.add(R.drawable.ic_emergency);
        icons.add(R.drawable.ic_map);
        icons.add(R.drawable.ic_telemetry);
        icons.add(R.drawable.ic_volume);
        icons.add(R.drawable.ic_mic);
        icons.add(R.drawable.ic_speaker);
        icons.add(R.drawable.ic_capture);
        icons.add(R.drawable.ic_blur);
        icons.add(R.drawable.ic_message);
        
        // Standard Android icons - Media
        icons.add(android.R.drawable.ic_media_play);
        icons.add(android.R.drawable.ic_media_pause);
        icons.add(android.R.drawable.ic_media_ff);
        icons.add(android.R.drawable.ic_media_rew);
        icons.add(android.R.drawable.ic_media_next);
        icons.add(android.R.drawable.ic_media_previous);
        
        // Standard Android icons - Menu
        icons.add(android.R.drawable.ic_menu_add);
        icons.add(android.R.drawable.ic_menu_delete);
        icons.add(android.R.drawable.ic_menu_edit);
        icons.add(android.R.drawable.ic_menu_save);
        icons.add(android.R.drawable.ic_menu_send);
        icons.add(android.R.drawable.ic_menu_share);
        icons.add(android.R.drawable.ic_menu_search);
        icons.add(android.R.drawable.ic_menu_info_details);
        icons.add(android.R.drawable.ic_menu_help);
        icons.add(android.R.drawable.ic_menu_preferences);
        icons.add(android.R.drawable.ic_menu_manage);
        icons.add(android.R.drawable.ic_menu_view);
        icons.add(android.R.drawable.ic_menu_close_clear_cancel);
        icons.add(android.R.drawable.ic_menu_revert);
        icons.add(android.R.drawable.ic_menu_camera);
        icons.add(android.R.drawable.ic_menu_gallery);
        icons.add(android.R.drawable.ic_menu_slideshow);
        icons.add(android.R.drawable.ic_menu_compass);
        icons.add(android.R.drawable.ic_menu_mapmode);
        icons.add(android.R.drawable.ic_menu_mylocation);
        icons.add(android.R.drawable.ic_menu_myplaces);
        icons.add(android.R.drawable.ic_menu_recent_history);
        icons.add(android.R.drawable.ic_menu_rotate);
        icons.add(android.R.drawable.ic_menu_zoom);
        icons.add(android.R.drawable.ic_menu_crop);
        icons.add(android.R.drawable.ic_menu_sort_by_size);
        icons.add(android.R.drawable.ic_menu_sort_alphabetically);
        icons.add(android.R.drawable.ic_menu_today);
        icons.add(android.R.drawable.ic_menu_week);
        icons.add(android.R.drawable.ic_menu_month);
        icons.add(android.R.drawable.ic_menu_day);
        icons.add(android.R.drawable.ic_menu_agenda);
        icons.add(android.R.drawable.ic_menu_upload);
        icons.add(android.R.drawable.ic_menu_upload_you_tube);
        icons.add(android.R.drawable.ic_menu_set_as);
        icons.add(android.R.drawable.ic_menu_call);
        icons.add(android.R.drawable.ic_menu_directions);
        icons.add(android.R.drawable.ic_menu_report_image);
        icons.add(android.R.drawable.ic_menu_always_landscape_portrait);
        
        // Dialog icons
        icons.add(android.R.drawable.ic_dialog_alert);
        icons.add(android.R.drawable.ic_dialog_info);
        icons.add(android.R.drawable.ic_dialog_dialer);
        icons.add(android.R.drawable.ic_dialog_email);
        icons.add(android.R.drawable.ic_dialog_map);
        
        // Lock icons
        icons.add(android.R.drawable.ic_lock_idle_charging);
        icons.add(android.R.drawable.ic_lock_lock);
        icons.add(android.R.drawable.ic_lock_power_off);
        icons.add(android.R.drawable.ic_lock_silent_mode);
        icons.add(android.R.drawable.ic_lock_silent_mode_off);
        
        // Presence icons
        icons.add(android.R.drawable.presence_video_online);
        icons.add(android.R.drawable.presence_video_away);
        icons.add(android.R.drawable.presence_video_busy);
        icons.add(android.R.drawable.presence_audio_online);
        icons.add(android.R.drawable.presence_audio_away);
        icons.add(android.R.drawable.presence_audio_busy);
        icons.add(android.R.drawable.presence_online);
        icons.add(android.R.drawable.presence_away);
        icons.add(android.R.drawable.presence_busy);
        icons.add(android.R.drawable.presence_invisible);
        
        // Input icons
        icons.add(android.R.drawable.ic_input_add);
        icons.add(android.R.drawable.ic_input_delete);
        icons.add(android.R.drawable.ic_input_get);
        
        // Buttons
        icons.add(android.R.drawable.button_onoff_indicator_on);
        icons.add(android.R.drawable.button_onoff_indicator_off);
        icons.add(android.R.drawable.ic_btn_speak_now);
        
        // Other
        icons.add(android.R.drawable.star_on);
        icons.add(android.R.drawable.star_off);
        icons.add(android.R.drawable.star_big_on);
        icons.add(android.R.drawable.star_big_off);
        icons.add(android.R.drawable.checkbox_on_background);
        icons.add(android.R.drawable.checkbox_off_background);
        icons.add(android.R.drawable.radiobutton_on_background);
        icons.add(android.R.drawable.radiobutton_off_background);
        icons.add(android.R.drawable.ic_notification_clear_all);
        icons.add(android.R.drawable.ic_notification_overlay);
        icons.add(android.R.drawable.ic_partial_secure);
        icons.add(android.R.drawable.ic_secure);
        icons.add(android.R.drawable.ic_delete);
        icons.add(android.R.drawable.ic_search_category_default);
        
        return icons;
    }
    
    public void setSelectedIcon(int iconResId) {
        int position = iconResIds.indexOf(iconResId);
        if (position != -1) {
            int previousPosition = selectedPosition;
            selectedPosition = position;
            if (previousPosition != -1) {
                notifyItemChanged(previousPosition);
            }
            notifyItemChanged(selectedPosition);
        }
    }
    
    @NonNull
    @Override
    public IconViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_icon, parent, false);
        return new IconViewHolder(view);
    }
    
    @Override
    public void onBindViewHolder(@NonNull IconViewHolder holder, int position) {
        int iconResId = iconResIds.get(position);
        
        // Validate resource is a drawable before using it
        try {
            String resourceTypeName = holder.itemView.getContext().getResources().getResourceTypeName(iconResId);
            if ("drawable".equals(resourceTypeName) || "mipmap".equals(resourceTypeName)) {
                holder.iconView.setImageResource(iconResId);
            } else {
                holder.iconView.setImageResource(android.R.drawable.ic_menu_help);
            }
        } catch (android.content.res.Resources.NotFoundException e) {
            holder.iconView.setImageResource(android.R.drawable.ic_menu_help);
        }
        
        // Highlight selected icon
        holder.itemView.setAlpha(position == selectedPosition ? 1.0f : 0.5f);
        holder.itemView.setScaleX(position == selectedPosition ? 1.1f : 1.0f);
        holder.itemView.setScaleY(position == selectedPosition ? 1.1f : 1.0f);
        
        holder.itemView.setOnClickListener(v -> {
            int previousPosition = selectedPosition;
            selectedPosition = holder.getBindingAdapterPosition();
            
            if (previousPosition != -1) {
                notifyItemChanged(previousPosition);
            }
            notifyItemChanged(selectedPosition);
            
            if (listener != null) {
                listener.onIconSelected(iconResId);
            }
        });
    }
    
    @Override
    public int getItemCount() {
        return iconResIds.size();
    }
    
    static class IconViewHolder extends RecyclerView.ViewHolder {
        final ImageView iconView;
        
        IconViewHolder(@NonNull View itemView) {
            super(itemView);
            iconView = itemView.findViewById(R.id.iv_icon);
        }
    }
}
