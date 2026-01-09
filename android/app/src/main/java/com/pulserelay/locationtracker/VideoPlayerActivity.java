package com.pulserelay.locationtracker;

import android.content.Intent;
import android.content.res.Configuration;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.fragment.app.FragmentTransaction;

import com.pulserelay.locationtracker.fragments.VideoPlayerFragment;

/**
 * Activity for displaying Twitch video stream
 */
public class VideoPlayerActivity extends AppCompatActivity {
    
    private VideoPlayerFragment videoPlayerFragment;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_video_player);
        
        if (getSupportActionBar() != null) {
            getSupportActionBar().setTitle(R.string.video_player_title);
        }
        
        // Add VideoPlayerFragment if not already added
        if (savedInstanceState == null) {
            videoPlayerFragment = new VideoPlayerFragment();
            FragmentTransaction transaction = getSupportFragmentManager().beginTransaction();
            transaction.replace(R.id.fragmentContainer, videoPlayerFragment);
            transaction.commit();
        } else {
            videoPlayerFragment = (VideoPlayerFragment) getSupportFragmentManager()
                .findFragmentById(R.id.fragmentContainer);
        }
        
        setupBackPressHandler();
    }
    
    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.main_menu, menu);
        // Hide video player item since we're already in the video player
        MenuItem videoPlayerItem = menu.findItem(R.id.action_video_player);
        if (videoPlayerItem != null) {
            videoPlayerItem.setVisible(false);
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
            // Already in video player, do nothing
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
    
    private void setupBackPressHandler() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // Let fragment handle back press first (for fullscreen exit)
                if (videoPlayerFragment != null && videoPlayerFragment.onBackPressed()) {
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
            }
        });
    }
    
    @Override
    public void onConfigurationChanged(@NonNull Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Configuration changes are handled automatically by the fragment
    }
}
