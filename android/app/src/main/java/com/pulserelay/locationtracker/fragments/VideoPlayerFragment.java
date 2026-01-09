package com.pulserelay.locationtracker.fragments;

import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsetsController;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ArrayAdapter;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.fragment.app.Fragment;
import androidx.preference.PreferenceManager;

import com.google.android.material.button.MaterialButton;
import com.pulserelay.locationtracker.R;

import java.util.ArrayList;
import java.util.List;

/**
 * Fragment for displaying Twitch video stream with embedded player
 */
public class VideoPlayerFragment extends Fragment {
    
    private WebView webView;
    private ProgressBar progressLoading;
    private LinearLayout errorLayout;
    private TextView tvError;
    private MaterialButton btnRetry;
    private com.google.android.material.floatingactionbutton.FloatingActionButton fabBack;
    
    private SharedPreferences prefs;
    private String currentChannel;
    private String currentQuality;
    
    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_video_player, container, false);
    }
    
    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        
        prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
        
        // Initialize views
        webView = view.findViewById(R.id.webViewPlayer);
        progressLoading = view.findViewById(R.id.progressLoading);
        errorLayout = view.findViewById(R.id.errorLayout);
        tvError = view.findViewById(R.id.tvError);
        btnRetry = view.findViewById(R.id.btnRetry);
        fabBack = view.findViewById(R.id.fabBack);
        
        // Setup WebView
        setupWebView();
        
        // Setup retry button
        btnRetry.setOnClickListener(v -> {
            hideError();
            loadVideo();
        });
        
        // Setup back button
        fabBack.setOnClickListener(v -> requireActivity().finish());
        
        // Hide system UI for immersive experience
        hideSystemUI();
        
        // Load video automatically
        loadVideo();
    }
    
    /**
     * Configure WebView settings for Twitch player
     */
    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        
        // Enable JavaScript (required for Twitch player)
        settings.setJavaScriptEnabled(true);
        
        // Enable DOM storage
        settings.setDomStorageEnabled(true);
        
        // Disable media playback gesture requirement
        settings.setMediaPlaybackRequiresUserGesture(false);
        
        // Allow mixed content (HTTPS page loading HTTP resources)
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        
        // Enable hardware acceleration (set in manifest)
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        
        // Set user agent to ensure compatibility
        settings.setUserAgentString(settings.getUserAgentString() + " PulseRelay/1.0");
        
        // Setup WebViewClient to handle page loading
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                showLoading(true);
                hideError();
            }
            
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                showLoading(false);
            }
            
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    showLoading(false);
                    showError("Error loading stream: " + error.getDescription());
                }
            }
        });
        
        // Setup WebChromeClient
        webView.setWebChromeClient(new WebChromeClient());
    }
    

    
    /**
     * Load Twitch video stream
     */
    private void loadVideo() {
        // Get channel from settings
        String channel = prefs.getString("default_twitch_channel", "");
        if (channel.isEmpty()) {
            channel = "twitch"; // Default fallback
        }
        
        currentChannel = channel;
        
        // Get quality setting
        currentQuality = prefs.getString("video_quality", "auto");
        
        // Build Twitch embed URL - always start muted
        String embedUrl = buildEmbedUrl(channel, currentQuality, true);
        
        android.util.Log.d("VideoPlayer", "Loading URL: " + embedUrl);
        
        // Load the URL
        webView.loadUrl(embedUrl);
    }
    
    /**
     * Build Twitch embed URL with parameters
     */
    private String buildEmbedUrl(String channel, String quality, boolean muted) {
        StringBuilder url = new StringBuilder("https://player.twitch.tv/");
        url.append("?channel=").append(channel);
        url.append("&parent=localhost"); // Required by Twitch embed
        url.append("&autoplay=true");
        url.append("&muted=").append(muted ? "true" : "false");
        
        // Add quality parameter if not auto
        if (!quality.equals("auto")) {
            url.append("&quality=").append(quality);
        }
        
        return url.toString();
    }
    

    
    /**
     * Hide system UI for fullscreen
     */
    private void hideSystemUI() {
        if (getActivity() != null) {
            View decorView = getActivity().getWindow().getDecorView();
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // Use WindowInsetsController for Android 11+
                WindowInsetsController controller = decorView.getWindowInsetsController();
                if (controller != null) {
                    controller.hide(android.view.WindowInsets.Type.statusBars() | android.view.WindowInsets.Type.navigationBars());
                    controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                }
            } else {
                // Fallback for older Android versions
                decorView.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                );
            }
            
            // Hide action bar
            if (getActivity() instanceof AppCompatActivity) {
                androidx.appcompat.app.ActionBar actionBar = ((AppCompatActivity) getActivity()).getSupportActionBar();
                if (actionBar != null) {
                    actionBar.hide();
                }
            }
        }
    }
    
    /**
     * Show system UI when exiting fullscreen
     */
    private void showSystemUI() {
        if (getActivity() != null) {
            View decorView = getActivity().getWindow().getDecorView();
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // Use WindowInsetsController for Android 11+
                WindowInsetsController controller = decorView.getWindowInsetsController();
                if (controller != null) {
                    controller.show(android.view.WindowInsets.Type.statusBars() | android.view.WindowInsets.Type.navigationBars());
                }
            } else {
                // Fallback for older Android versions
                decorView.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
            }
            
            // Show action bar
            if (getActivity() instanceof AppCompatActivity) {
                androidx.appcompat.app.ActionBar actionBar = ((AppCompatActivity) getActivity()).getSupportActionBar();
                if (actionBar != null) {
                    actionBar.show();
                }
            }
        }
    }
    
    /**
     * Show/hide loading indicator
     */
    private void showLoading(boolean show) {
        if (progressLoading != null) {
            progressLoading.setVisibility(show ? View.VISIBLE : View.GONE);
        }
    }
    
    /**
     * Show error message
     */
    private void showError(String message) {
        if (errorLayout != null && tvError != null) {
            tvError.setText(message);
            errorLayout.setVisibility(View.VISIBLE);
        }
    }
    
    /**
     * Hide error message
     */
    private void hideError() {
        if (errorLayout != null) {
            errorLayout.setVisibility(View.GONE);
        }
    }
    
    @Override
    public void onPause() {
        super.onPause();
        if (webView != null) {
            webView.onPause();
        }
    }
    
    @Override
    public void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
    }
    
    @Override
    public void onDestroyView() {
        super.onDestroyView();
        
        // Clean up WebView
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.stopLoading();
            webView.setWebViewClient(null);
            webView.setWebChromeClient(null);
            webView.clearCache(true);
            webView.clearHistory();
            
            // Remove from parent before destroying to prevent crashes
            if (webView.getParent() != null) {
                ((android.view.ViewGroup) webView.getParent()).removeView(webView);
            }
            
            webView.destroy();
            webView = null;
        }
    }
    
    @Override
    public void onConfigurationChanged(@NonNull Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Orientation is locked to landscape, but handle changes gracefully
    }
    
    /**
     * Handle back button press
     */
    public boolean onBackPressed() {
        // No special handling needed
        return false;
    }
}
