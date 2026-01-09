package com.pulserelay.locationtracker.dialogs;

import android.app.Activity;
import android.app.Dialog;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.os.Bundle;

import androidx.annotation.NonNull;

import com.google.android.gms.maps.CameraUpdateFactory;
import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.MapView;
import com.google.android.gms.maps.OnMapReadyCallback;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.maps.model.MarkerOptions;
import com.google.android.material.button.MaterialButton;
import com.pulserelay.locationtracker.R;

/**
 * Dialog for picking a location on a map
 */
public class MapPickerDialog extends Dialog implements OnMapReadyCallback {
    
    private GoogleMap map;
    private MapView mapView;
    private LatLng selectedLocation;
    private MaterialButton confirmButton;
    private OnLocationSelectedListener listener;
    
    public interface OnLocationSelectedListener {
        void onLocationSelected(double latitude, double longitude);
    }
    
    public MapPickerDialog(@NonNull Context context, OnLocationSelectedListener listener) {
        super(context, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        this.listener = listener;
        // Lock orientation to current orientation
        if (context instanceof Activity) {
            Activity activity = (Activity) context;
            activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LOCKED);
        }
    }
    
    public MapPickerDialog(@NonNull Context context, double initialLat, double initialLng, OnLocationSelectedListener listener) {
        super(context, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        this.listener = listener;
        this.selectedLocation = new LatLng(initialLat, initialLng);
        // Lock orientation to current orientation
        if (context instanceof Activity) {
            Activity activity = (Activity) context;
            activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LOCKED);
        }
    }
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.dialog_map_picker);
        
        confirmButton = findViewById(R.id.confirmButton);
        MaterialButton cancelButton = findViewById(R.id.cancelButton);
        
        // Initialize MapView
        mapView = findViewById(R.id.mapView);
        mapView.onCreate(savedInstanceState);
        mapView.onResume(); // Start the map immediately
        mapView.getMapAsync(this);
        
        confirmButton.setOnClickListener(v -> {
            if (selectedLocation != null && listener != null) {
                listener.onLocationSelected(selectedLocation.latitude, selectedLocation.longitude);
            }
            dismiss();
        });
        
        cancelButton.setOnClickListener(v -> dismiss());
        
        // Handle dialog dismiss to clean up map
        setOnDismissListener(dialog -> {
            if (mapView != null) {
                mapView.onPause();
                mapView.onDestroy();
            }
            // Restore orientation to unspecified (allows rotation)
            Context ctx = getContext();
            if (ctx instanceof Activity) {
                ((Activity) ctx).setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            }
        });
    }
    
    @Override
    public void onMapReady(@NonNull GoogleMap googleMap) {
        this.map = googleMap;
        
        // Set default location (Paris if no initial location)
        LatLng initialPosition = selectedLocation != null ? selectedLocation : new LatLng(48.8566, 2.3522);
        
        // Add marker if we have an initial location
        if (selectedLocation != null) {
            map.addMarker(new MarkerOptions()
                    .position(selectedLocation)
                    .title("Selected Location"));
            confirmButton.setEnabled(true);
        }
        
        // Move camera to initial position
        map.moveCamera(CameraUpdateFactory.newLatLngZoom(initialPosition, 12));
        
        // Handle map clicks
        map.setOnMapClickListener(latLng -> {
            // Clear existing markers
            map.clear();
            
            // Add new marker
            map.addMarker(new MarkerOptions()
                    .position(latLng)
                    .title("Selected Location"));
            
            selectedLocation = latLng;
            confirmButton.setEnabled(true);
        });
    }
}
