package com.pulserelay.locationtracker.adapters;

import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.pulserelay.locationtracker.R;
import com.pulserelay.locationtracker.models.StreamDeckButton;

import java.util.Collections;
import java.util.List;

/**
 * Adapter for draggable button sorting list within a category
 */
public class SortableButtonAdapter extends RecyclerView.Adapter<SortableButtonAdapter.ButtonViewHolder> {
    
    private final List<StreamDeckButton> buttons;
    private final OnStartDragListener dragListener;
    
    public interface OnStartDragListener {
        void onStartDrag(RecyclerView.ViewHolder viewHolder);
    }
    
    public SortableButtonAdapter(List<StreamDeckButton> buttons, OnStartDragListener dragListener) {
        this.buttons = buttons;
        this.dragListener = dragListener;
    }
    
    @NonNull
    @Override
    public ButtonViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_sortable_button, parent, false);
        return new ButtonViewHolder(view);
    }
    
    @Override
    public void onBindViewHolder(@NonNull ButtonViewHolder holder, int position) {
        StreamDeckButton button = buttons.get(position);
        holder.buttonTitle.setText(button.getTitle());
        holder.buttonIcon.setImageResource(button.getIconResId());
        
        // Show subtitle if present
        String subtitle = button.getSubtitle();
        if (subtitle != null && !subtitle.trim().isEmpty()) {
            holder.buttonSubtitle.setText(subtitle);
            holder.buttonSubtitle.setVisibility(View.VISIBLE);
        } else {
            holder.buttonSubtitle.setVisibility(View.GONE);
        }
        
        // Start drag on touch
        holder.dragHandle.setOnTouchListener((v, event) -> {
            if (event.getAction() == MotionEvent.ACTION_DOWN) {
                dragListener.onStartDrag(holder);
            }
            return false;
        });
    }
    
    @Override
    public int getItemCount() {
        return buttons.size();
    }
    
    public void onItemMove(int fromPosition, int toPosition) {
        Collections.swap(buttons, fromPosition, toPosition);
        notifyItemMoved(fromPosition, toPosition);
    }
    
    public List<StreamDeckButton> getButtons() {
        return buttons;
    }
    
    static class ButtonViewHolder extends RecyclerView.ViewHolder {
        ImageView dragHandle;
        ImageView buttonIcon;
        TextView buttonTitle;
        TextView buttonSubtitle;
        
        ButtonViewHolder(@NonNull View itemView) {
            super(itemView);
            dragHandle = itemView.findViewById(R.id.drag_handle);
            buttonIcon = itemView.findViewById(R.id.button_icon);
            buttonTitle = itemView.findViewById(R.id.button_title);
            buttonSubtitle = itemView.findViewById(R.id.button_subtitle);
        }
    }
}
