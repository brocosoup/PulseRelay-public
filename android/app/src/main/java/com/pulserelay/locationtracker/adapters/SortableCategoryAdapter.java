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

import java.util.Collections;
import java.util.List;

/**
 * Adapter for draggable category sorting list
 */
public class SortableCategoryAdapter extends RecyclerView.Adapter<SortableCategoryAdapter.CategoryViewHolder> {
    
    private final List<CategoryItem> categories;
    private final OnStartDragListener dragListener;
    
    public interface OnStartDragListener {
        void onStartDrag(RecyclerView.ViewHolder viewHolder);
    }
    
    public static class CategoryItem {
        public String name;
        public int buttonCount;
        
        public CategoryItem(String name, int buttonCount) {
            this.name = name;
            this.buttonCount = buttonCount;
        }
    }
    
    public SortableCategoryAdapter(List<CategoryItem> categories, OnStartDragListener dragListener) {
        this.categories = categories;
        this.dragListener = dragListener;
    }
    
    @NonNull
    @Override
    public CategoryViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_sortable_category, parent, false);
        return new CategoryViewHolder(view);
    }
    
    @Override
    public void onBindViewHolder(@NonNull CategoryViewHolder holder, int position) {
        CategoryItem category = categories.get(position);
        holder.categoryName.setText(category.name);
        holder.buttonCount.setText(category.buttonCount + " buttons");
        
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
        return categories.size();
    }
    
    public void onItemMove(int fromPosition, int toPosition) {
        Collections.swap(categories, fromPosition, toPosition);
        notifyItemMoved(fromPosition, toPosition);
    }
    
    public List<CategoryItem> getCategories() {
        return categories;
    }
    
    static class CategoryViewHolder extends RecyclerView.ViewHolder {
        ImageView dragHandle;
        TextView categoryName;
        TextView buttonCount;
        
        CategoryViewHolder(@NonNull View itemView) {
            super(itemView);
            dragHandle = itemView.findViewById(R.id.drag_handle);
            categoryName = itemView.findViewById(R.id.category_name);
            buttonCount = itemView.findViewById(R.id.button_count);
        }
    }
}
