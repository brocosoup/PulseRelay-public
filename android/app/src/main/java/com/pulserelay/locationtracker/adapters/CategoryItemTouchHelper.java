package com.pulserelay.locationtracker.adapters;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.ItemTouchHelper;
import androidx.recyclerview.widget.RecyclerView;

/**
 * Helper for drag-and-drop functionality in category sorting
 */
public class CategoryItemTouchHelper extends ItemTouchHelper.Callback {
    
    private final SortableCategoryAdapter adapter;
    
    public CategoryItemTouchHelper(SortableCategoryAdapter adapter) {
        this.adapter = adapter;
    }
    
    @Override
    public boolean isLongPressDragEnabled() {
        return false; // We handle drag start manually via touch on drag handle
    }
    
    @Override
    public boolean isItemViewSwipeEnabled() {
        return false; // No swipe to delete
    }
    
    @Override
    public int getMovementFlags(@NonNull RecyclerView recyclerView, @NonNull RecyclerView.ViewHolder viewHolder) {
        int dragFlags = ItemTouchHelper.UP | ItemTouchHelper.DOWN;
        return makeMovementFlags(dragFlags, 0);
    }
    
    @Override
    public boolean onMove(@NonNull RecyclerView recyclerView, @NonNull RecyclerView.ViewHolder viewHolder, @NonNull RecyclerView.ViewHolder target) {
        adapter.onItemMove(viewHolder.getBindingAdapterPosition(), target.getBindingAdapterPosition());
        return true;
    }
    
    @Override
    public void onSwiped(@NonNull RecyclerView.ViewHolder viewHolder, int direction) {
        // Not used
    }
}
