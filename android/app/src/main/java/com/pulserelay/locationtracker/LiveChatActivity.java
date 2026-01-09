package com.pulserelay.locationtracker;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;
import android.view.WindowManager;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.fragment.app.Fragment;
import androidx.preference.PreferenceManager;

import com.pulserelay.locationtracker.fragments.LiveChatFragment;

public class LiveChatActivity extends AppCompatActivity {
    
    private SharedPreferences prefs;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_live_chat);
        
        prefs = PreferenceManager.getDefaultSharedPreferences(this);
        applyKeepScreenOnSetting();
        
        // Set up action bar
        if (getSupportActionBar() != null) {
            getSupportActionBar().setTitle("Live Chat");
        }
        
        // Load the LiveChatFragment
        if (savedInstanceState == null) {
            Fragment fragment = new LiveChatFragment();
            getSupportFragmentManager()
                    .beginTransaction()
                    .replace(R.id.fragment_container, fragment)
                    .commit();
        }
    }
    
    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.main_menu, menu);
        // Hide live chat item since we're already in live chat
        MenuItem liveChatItem = menu.findItem(R.id.action_live_chat);
        if (liveChatItem != null) {
            liveChatItem.setVisible(false);
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
            // Already in live chat, do nothing
            return true;
        } else if (id == R.id.action_video_player) {
            startActivity(new Intent(this, VideoPlayerActivity.class));
            return true;
        } else if (id == R.id.action_stream_deck) {
            startActivity(new Intent(this, StreamDeckActivity.class));
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
