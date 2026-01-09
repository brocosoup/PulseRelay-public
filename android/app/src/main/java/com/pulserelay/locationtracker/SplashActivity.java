package com.pulserelay.locationtracker;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.pulserelay.locationtracker.auth.AuthManager;

/**
 * Splash screen that validates JWT token on app startup
 */
public class SplashActivity extends AppCompatActivity {
    
    private static final int SPLASH_DELAY = 1500; // 1.5 seconds
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_splash);
        
        // Hide action bar
        if (getSupportActionBar() != null) {
            getSupportActionBar().hide();
        }
        
        TextView statusText = findViewById(R.id.splashStatusText);
        
        // Validate token and navigate after delay
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            AuthManager authManager = AuthManager.getInstance(this);
            
            if (authManager.hasToken()) {
                // Token exists - proceed to main activity
                statusText.setText("Authenticated");
                navigateToMain();
            } else {
                // No token - redirect to settings
                statusText.setText("Configuration required");
                navigateToSettings();
            }
        }, SPLASH_DELAY);
    }
    
    private void navigateToMain() {
        Intent intent = new Intent(this, MainActivity.class);
        startActivity(intent);
        finish();
    }
    
    private void navigateToSettings() {
        Intent intent = new Intent(this, SettingsActivity.class);
        intent.putExtra("from_splash", true);
        startActivity(intent);
        finish();
    }
}
