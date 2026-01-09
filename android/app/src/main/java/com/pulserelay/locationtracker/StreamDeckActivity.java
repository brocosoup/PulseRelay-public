package com.pulserelay.locationtracker;

import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;
import android.view.WindowManager;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.fragment.app.Fragment;

import com.pulserelay.locationtracker.fragments.StreamDeckFragment;

import androidx.preference.PreferenceManager;

public class StreamDeckActivity extends AppCompatActivity {
    
    private SharedPreferences prefs;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_stream_deck);
        
        prefs = PreferenceManager.getDefaultSharedPreferences(this);
        applyKeepScreenOnSetting();
        
        // Set up action bar
        if (getSupportActionBar() != null) {
            getSupportActionBar().setTitle("Pulse Deck");
        }
        
        // Update action bar visibility based on orientation
        updateActionBarVisibility();
        
        // Load the PulseDeckFragment
        if (savedInstanceState == null) {
            Fragment fragment = new StreamDeckFragment();
            getSupportFragmentManager()
                    .beginTransaction()
                    .replace(R.id.fragment_container, fragment)
                    .commit();
        }
        
        // Check if we should open chat dialog
        if (getIntent().getBooleanExtra("open_chat", false)) {
            // Post to handler to ensure fragment is fully initialized
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                Fragment fragment = getSupportFragmentManager().findFragmentById(R.id.fragment_container);
                if (fragment instanceof StreamDeckFragment) {
                    ((StreamDeckFragment) fragment).showChat();
                }
            }, 100);
        }
    }
    
    @Override
    public void onConfigurationChanged(@NonNull Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        updateActionBarVisibility();
        
        // Notify fragment about orientation change
        Fragment fragment = getSupportFragmentManager().findFragmentById(R.id.fragment_container);
        if (fragment instanceof StreamDeckFragment) {
            ((StreamDeckFragment) fragment).onOrientationChanged(newConfig.orientation);
        }
    }
    
    private void updateActionBarVisibility() {
        int orientation = getResources().getConfiguration().orientation;
        if (getSupportActionBar() != null) {
            if (orientation == Configuration.ORIENTATION_LANDSCAPE) {
                getSupportActionBar().hide();
            } else {
                getSupportActionBar().show();
            }
        }
    }
    
    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.main_menu, menu);
        // Hide stream deck item since we're already in stream deck
        MenuItem streamDeckItem = menu.findItem(R.id.action_stream_deck);
        if (streamDeckItem != null) {
            streamDeckItem.setVisible(false);
        }
        return true;
    }
    
    @Override
    public boolean onOptionsItemSelected(@NonNull MenuItem item) {
        int id = item.getItemId();
        if (id == R.id.action_dashboard) {
            startActivity(new Intent(this, MainActivity.class));
            return true;
        } else if (id == R.id.action_live_chat) {
            startActivity(new Intent(this, LiveChatActivity.class));
            return true;
        } else if (id == R.id.action_video_player) {
            startActivity(new Intent(this, VideoPlayerActivity.class));
            return true;
        } else if (id == R.id.action_stream_deck) {
            // Already in stream deck, do nothing or refresh
            return true;
        } else if (id == R.id.action_settings) {
            startActivity(new Intent(this, SettingsActivity.class));
            return true;
        }
        return super.onOptionsItemSelected(item);
    }
    
    /**
     * Apply keep screen on setting from preferences
     */
    private void applyKeepScreenOnSetting() {
        boolean keepScreenOn = prefs.getBoolean("keep_screen_on", true);
        if (keepScreenOn) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
    }
}
