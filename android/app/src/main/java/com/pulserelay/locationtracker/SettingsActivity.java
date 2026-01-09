package com.pulserelay.locationtracker;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.text.InputType;
import android.view.Menu;
import android.view.MenuItem;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.preference.EditTextPreference;
import androidx.preference.Preference;
import androidx.preference.PreferenceFragmentCompat;
import androidx.preference.PreferenceManager;

import com.pulserelay.locationtracker.auth.AuthManager;
import com.pulserelay.locationtracker.services.StreamDeckConfigManager;

import org.json.JSONObject;

import java.io.OutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Iterator;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

public class SettingsActivity extends AppCompatActivity {
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);
        
        if (savedInstanceState == null) {
            getSupportFragmentManager()
                .beginTransaction()
                .replace(R.id.settings_container, new SettingsFragment())
                .commit();
        }
        
        if (getSupportActionBar() != null) {
            // Remove back button
        }
        
        // Check if we came from splash screen (no token configured)
        boolean fromSplash = getIntent().getBooleanExtra("from_splash", false);
        if (fromSplash) {
            Toast.makeText(this, "Please configure your JWT token to continue", Toast.LENGTH_LONG).show();
        }
    }
    
    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.main_menu, menu);
        // Hide settings item since we're already in settings
        MenuItem settingsItem = menu.findItem(R.id.action_settings);
        if (settingsItem != null) {
            settingsItem.setVisible(false);
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
            startActivity(new Intent(this, StreamDeckActivity.class));
            return true;
        } else if (id == R.id.action_settings) {
            // Already in settings, do nothing
            return true;
        }
        return super.onOptionsItemSelected(item);
    }
    
    public static class SettingsFragment extends PreferenceFragmentCompat {
        
        private ActivityResultLauncher<String> exportLauncher;
        private ActivityResultLauncher<String[]> importLauncher;
        private ActivityResultLauncher<String> exportConfigLauncher;
        private ActivityResultLauncher<String[]> importConfigLauncher;
        private String exportPassword;
        private String importPassword;
        
        @Override
        public void onCreate(Bundle savedInstanceState) {
            super.onCreate(savedInstanceState);
            
            // Register export launcher
            exportLauncher = registerForActivityResult(
                new ActivityResultContracts.CreateDocument("application/json"),
                uri -> {
                    if (uri != null) {
                        exportLayout(uri);
                    }
                }
            );
            
            // Register import launcher
            importLauncher = registerForActivityResult(
                new ActivityResultContracts.OpenDocument(),
                uri -> {
                    if (uri != null) {
                        importLayout(uri);
                    }
                }
            );
            
            // Register config export launcher
            exportConfigLauncher = registerForActivityResult(
                new ActivityResultContracts.CreateDocument("application/json"),
                uri -> {
                    if (uri != null && exportPassword != null) {
                        exportConfig(uri, exportPassword);
                        exportPassword = null;
                    }
                }
            );
            
            // Register config import launcher
            importConfigLauncher = registerForActivityResult(
                new ActivityResultContracts.OpenDocument(),
                uri -> {
                    if (uri != null && importPassword != null) {
                        importConfig(uri, importPassword);
                        importPassword = null;
                    }
                }
            );
        }
        
        @Override
        public void onCreatePreferences(Bundle savedInstanceState, String rootKey) {
            setPreferencesFromResource(R.xml.preferences, rootKey);
            
            // Ensure update_interval minimum is 5 seconds
            androidx.preference.SeekBarPreference intervalPref = findPreference("update_interval");
            if (intervalPref != null) {
                intervalPref.setMin(5);
                intervalPref.setMax(300);
                
                // If current value is less than 5, reset to 5
                if (intervalPref.getValue() < 5) {
                    intervalPref.setValue(5);
                }
            }
            
            // Handle target_channel preference with dark theme styling
            EditTextPreference targetChannelPref = findPreference("target_channel");
            if (targetChannelPref != null) {
                targetChannelPref.setOnBindEditTextListener(editText -> {
                    editText.setInputType(InputType.TYPE_CLASS_TEXT);
                    editText.setHint("Enter Twitch channel name");
                    editText.setTextColor(0xFFFFFFFF); // White text
                    editText.setHintTextColor(0xFF999999); // Gray hint
                    editText.setBackgroundColor(0xFF1F1F23); // Dark gray background
                    editText.setPadding(24, 24, 24, 24);
                });
            }
            
            // Handle default_twitch_channel preference with dark theme styling
            EditTextPreference defaultChannelPref = findPreference("default_twitch_channel");
            if (defaultChannelPref != null) {
                defaultChannelPref.setOnBindEditTextListener(editText -> {
                    editText.setInputType(InputType.TYPE_CLASS_TEXT);
                    editText.setHint("Enter default Twitch channel for video player");
                    editText.setTextColor(0xFFFFFFFF); // White text
                    editText.setHintTextColor(0xFF999999); // Gray hint
                    editText.setBackgroundColor(0xFF1F1F23); // Dark gray background
                    editText.setPadding(24, 24, 24, 24);
                });
            }
            
            // Handle JWT token preference securely with EncryptedSharedPreferences
            EditTextPreference jwtTokenPref = findPreference("jwt_token");
            if (jwtTokenPref != null) {
                AuthManager authManager = AuthManager.getInstance(requireContext());
                
                // Disable persistence for this preference - we'll handle it via AuthManager
                jwtTokenPref.setPersistent(false);
                
                // Clear the text field - always start empty
                jwtTokenPref.setText("");
                
                // Check if token exists in AuthManager
                boolean hasToken = authManager.hasToken();
                
                // Show whether token is set or not in summary
                if (hasToken) {
                    jwtTokenPref.setSummary("Token is set (encrypted storage) - tap to enter new token");
                } else {
                    jwtTokenPref.setSummary("No token set - required for pulse deck and chat");
                }
                
                // Set input type and styling
                jwtTokenPref.setOnBindEditTextListener(editText -> {
                    // Clear any existing text when dialog opens
                    editText.setText("");
                    editText.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
                    editText.setHint("Paste JWT token here");
                    // Set colors to match dark purple theme
                    editText.setTextColor(0xFFFFFFFF); // White text
                    editText.setHintTextColor(0xFF999999); // Gray hint
                    editText.setBackgroundColor(0xFF1F1F23); // Dark gray background
                    editText.setPadding(24, 24, 24, 24); // Add padding for better appearance
                });
                
                // Custom change listener to save to encrypted storage
                jwtTokenPref.setOnPreferenceChangeListener((preference, newValue) -> {
                    // Get raw input first
                    String rawToken = newValue.toString();
                    android.util.Log.d("SettingsActivity", "Raw token length: " + rawToken.length());
                    android.util.Log.d("SettingsActivity", "Raw token: [" + rawToken + "]");
                    
                    // Clean the token - remove all whitespace, newlines, etc.
                    String newToken = rawToken
                            .replaceAll("\\s+", "")  // Remove all whitespace
                            .replaceAll("[\\r\\n]+", "")  // Remove line breaks
                            .trim();
                    
                    android.util.Log.d("SettingsActivity", "Cleaned token length: " + newToken.length());
                    android.util.Log.d("SettingsActivity", "Cleaned token: [" + newToken + "]");
                    
                    if (newToken.isEmpty()) {
                        // Don't allow empty token to overwrite existing one
                        Toast.makeText(requireContext(), "Token not changed (empty input)", Toast.LENGTH_SHORT).show();
                        return false;
                    }
                    
                    // Count dots manually and show their positions
                    int dotCount = 0;
                    StringBuilder dotPositions = new StringBuilder("Dot positions: ");
                    for (int i = 0; i < newToken.length(); i++) {
                        if (newToken.charAt(i) == '.') {
                            dotCount++;
                            dotPositions.append(i).append(" ");
                        }
                    }
                    android.util.Log.d("SettingsActivity", "Dot count: " + dotCount);
                    android.util.Log.d("SettingsActivity", dotPositions.toString());
                    
                    // Validate token format
                    if (!authManager.isTokenValid(newToken)) {
                        String[] parts = newToken.split("\\.");
                        String errorMsg = "Invalid JWT format: Expected 2 dots (3 parts), found " + dotCount + " dots (" + parts.length + " parts)";
                        Toast.makeText(requireContext(), errorMsg, Toast.LENGTH_LONG).show();
                        
                        android.util.Log.e("SettingsActivity", "Token validation failed!");
                        android.util.Log.e("SettingsActivity", "Expected: 2 dots, Found: " + dotCount);
                        android.util.Log.e("SettingsActivity", "Parts after split: " + parts.length);
                        for (int i = 0; i < Math.min(parts.length, 6); i++) {
                            android.util.Log.e("SettingsActivity", "Part[" + i + "] length=" + parts[i].length() + ", preview: " + parts[i].substring(0, Math.min(30, parts[i].length())));
                        }
                        return false;
                    }
                    
                    // Save the new token to encrypted storage via AuthManager
                    authManager.saveToken(newToken);
                    
                    // Update summary
                    jwtTokenPref.setSummary("Token is set (encrypted storage) - tap to change");
                    
                    Toast.makeText(requireContext(), "API token saved securely", Toast.LENGTH_SHORT).show();
                    
                    // Return false to prevent the EditTextPreference from saving anything
                    return false;
                });
            }
            
            // Add logout/delete token button
            Preference logoutPref = findPreference("logout");
            if (logoutPref != null) {
                AuthManager authManager = AuthManager.getInstance(requireContext());
                
                // Update summary based on token status
                if (authManager.hasToken()) {
                    logoutPref.setSummary("Clear stored JWT token");
                    logoutPref.setEnabled(true);
                } else {
                    logoutPref.setSummary("No token to clear");
                    logoutPref.setEnabled(false);
                }
                
                logoutPref.setOnPreferenceClickListener(preference -> {
                    // Show confirmation dialog
                    new AlertDialog.Builder(requireContext())
                            .setTitle("Clear Token")
                            .setMessage("Are you sure you want to clear the stored JWT token? You will need to re-enter it to use pulse deck and chat features.")
                            .setPositiveButton("Clear", (dialog, which) -> {
                                authManager.deleteToken();
                                Toast.makeText(requireContext(), "Token cleared", Toast.LENGTH_SHORT).show();
                                
                                // Update preferences UI
                                logoutPref.setSummary("No token to clear");
                                logoutPref.setEnabled(false);
                                
                                EditTextPreference jwtPref = findPreference("jwt_token");
                                if (jwtPref != null) {
                                    jwtPref.setSummary("No token set - required for pulse deck and chat");
                                }
                                
                                // Optionally restart app or return to main activity
                                Intent intent = new Intent(requireContext(), MainActivity.class);
                                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                                startActivity(intent);
                                requireActivity().finish();
                            })
                            .setNegativeButton("Cancel", null)
                            .show();
                    
                    return true;
                });
            }
            
            // Export layout preference
            Preference exportPref = findPreference("export_layout");
            if (exportPref != null) {
                exportPref.setOnPreferenceClickListener(preference -> {
                    String filename = "pulserelay_layout_" + System.currentTimeMillis() + ".json";
                    exportLauncher.launch(filename);
                    return true;
                });
            }
            
            // Import layout preference
            Preference importPref = findPreference("import_layout");
            if (importPref != null) {
                importPref.setOnPreferenceClickListener(preference -> {
                    importLauncher.launch(new String[]{"application/json"});
                    return true;
                });
            }
            
            // Export config preference
            Preference exportConfigPref = findPreference("export_config");
            if (exportConfigPref != null) {
                exportConfigPref.setOnPreferenceClickListener(preference -> {
                    showPasswordDialog("Enter password to encrypt configuration", password -> {
                        if (password != null && !password.isEmpty()) {
                            exportPassword = password;
                            String filename = "pulserelay_config_" + System.currentTimeMillis() + ".enc";
                            exportConfigLauncher.launch(filename);
                        } else {
                            Toast.makeText(requireContext(), "Password cannot be empty", Toast.LENGTH_SHORT).show();
                        }
                    });
                    return true;
                });
            }
            
            // Import config preference
            Preference importConfigPref = findPreference("import_config");
            if (importConfigPref != null) {
                importConfigPref.setOnPreferenceClickListener(preference -> {
                    showPasswordDialog("Enter password to decrypt configuration", password -> {
                        if (password != null && !password.isEmpty()) {
                            importPassword = password;
                            importConfigLauncher.launch(new String[]{"*/*"});
                        } else {
                            Toast.makeText(requireContext(), "Password cannot be empty", Toast.LENGTH_SHORT).show();
                        }
                    });
                    return true;
                });
            }
            
            // TTS enable/disable - KISS: just check service state and start/stop
            androidx.preference.SwitchPreferenceCompat enableTtsPref = findPreference("enable_tts");
            if (enableTtsPref != null) {
                // Toggle reflects service running state, NOT a saved preference
                boolean serviceRunning = isServiceRunning(com.pulserelay.locationtracker.TTSService.class);
                enableTtsPref.setChecked(serviceRunning);
                
                enableTtsPref.setOnPreferenceChangeListener((preference, newValue) -> {
                    boolean enabled = (Boolean) newValue;
                    
                    Intent serviceIntent = new Intent(requireContext(), com.pulserelay.locationtracker.TTSService.class);
                    
                    if (enabled) {
                        // Start TTS service
                        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                            requireContext().startForegroundService(serviceIntent);
                        } else {
                            requireContext().startService(serviceIntent);
                        }
                        Toast.makeText(requireContext(), "TTS enabled", Toast.LENGTH_SHORT).show();
                    } else {
                        // Stop TTS service
                        requireContext().stopService(serviceIntent);
                        Toast.makeText(requireContext(), "TTS disabled", Toast.LENGTH_SHORT).show();
                    }
                    
                    return true; // Allow toggle to update
                });
            }
            
            // TTS OpenAI processing preference - sync to server when changed
            androidx.preference.SwitchPreferenceCompat ttsOpenaiPref = findPreference("tts_openai_processing");
            if (ttsOpenaiPref != null) {
                // Load current setting from server
                loadTTSSettingFromServer();
                
                ttsOpenaiPref.setOnPreferenceChangeListener((preference, newValue) -> {
                    syncTTSSettingToServer((Boolean) newValue);
                    return true;
                });
            }
            
            // Sync ignored users bidirectionally: upload local to server, then download to merge
            syncIgnoredUsersToServerOnStart();
        }
        
        private void showPasswordDialog(String title, PasswordCallback callback) {
            android.widget.EditText input = new android.widget.EditText(requireContext());
            input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
            input.setHint("Password");
            
            new AlertDialog.Builder(requireContext())
                    .setTitle(title)
                    .setView(input)
                    .setPositiveButton("OK", (dialog, which) -> {
                        callback.onPassword(input.getText().toString());
                    })
                    .setNegativeButton("Cancel", null)
                    .show();
        }
        
        private interface PasswordCallback {
            void onPassword(String password);
        }
        
        private void exportLayout(Uri uri) {
            try {
                StreamDeckConfigManager configManager = new StreamDeckConfigManager(requireContext());
                SharedPreferences prefs = requireContext().getSharedPreferences("stream_deck_config", 0);
                
                // Get the raw JSON configuration
                String configJson = prefs.getString("button_config", "");
                String categoryOrder = prefs.getString("category_order", "");
                
                // Get all button orders (keys starting with "button_order_")
                JSONObject buttonOrders = new JSONObject();
                Map<String, ?> allPrefs = prefs.getAll();
                for (Map.Entry<String, ?> entry : allPrefs.entrySet()) {
                    if (entry.getKey().startsWith("button_order_")) {
                        String categoryName = entry.getKey().substring(13); // Remove "button_order_" prefix
                        buttonOrders.put(categoryName, entry.getValue());
                    }
                }
                
                // Combine into export format
                String exportJson = "{\"buttons\":" + configJson + ",\"categoryOrder\":" + categoryOrder + ",\"buttonOrders\":" + buttonOrders.toString() + "}";
                
                OutputStream outputStream = requireContext().getContentResolver().openOutputStream(uri);
                if (outputStream != null) {
                    outputStream.write(exportJson.getBytes(StandardCharsets.UTF_8));
                    outputStream.close();
                    Toast.makeText(requireContext(), "Layout exported successfully", Toast.LENGTH_SHORT).show();
                }
            } catch (Exception e) {
                Toast.makeText(requireContext(), "Export failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
        
        private void importLayout(Uri uri) {
            try {
                InputStream inputStream = requireContext().getContentResolver().openInputStream(uri);
                if (inputStream != null) {
                    byte[] bytes = new byte[inputStream.available()];
                    inputStream.read(bytes);
                    inputStream.close();
                    
                    String importJson = new String(bytes, StandardCharsets.UTF_8);
                    
                    // Parse JSON properly
                    JSONObject json = new JSONObject(importJson);
                    
                    // Parse and save
                    SharedPreferences prefs = requireContext().getSharedPreferences("stream_deck_config", 0);
                    SharedPreferences.Editor editor = prefs.edit();
                    
                    // Import buttons and category order
                    if (json.has("buttons")) {
                        editor.putString("button_config", json.getString("buttons"));
                    }
                    if (json.has("categoryOrder")) {
                        editor.putString("category_order", json.getString("categoryOrder"));
                    }
                    
                    // Import button orders (new)
                    if (json.has("buttonOrders")) {
                        JSONObject buttonOrders = json.getJSONObject("buttonOrders");
                        Iterator<String> keys = buttonOrders.keys();
                        while (keys.hasNext()) {
                            String categoryName = keys.next();
                            String orderJson = buttonOrders.getString(categoryName);
                            editor.putString("button_order_" + categoryName, orderJson);
                        }
                    }
                    
                    editor.putBoolean("use_custom_config", true);
                    editor.apply();
                    
                    Toast.makeText(requireContext(), "Layout imported successfully. Restart Pulse Deck to see changes.", Toast.LENGTH_LONG).show();
                }
            } catch (Exception e) {
                Toast.makeText(requireContext(), "Import failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
        
        private void exportConfig(Uri uri, String password) {
            try {
                // Gather all configuration
                SharedPreferences defaultPrefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
                SharedPreferences deckPrefs = requireContext().getSharedPreferences("stream_deck_config", 0);
                AuthManager authManager = AuthManager.getInstance(requireContext());
                
                JSONObject config = new JSONObject();
                
                // Add default preferences
                config.put("api_url", defaultPrefs.getString("api_url", ""));
                config.put("target_channel", defaultPrefs.getString("target_channel", ""));
                config.put("update_interval", defaultPrefs.getInt("update_interval", 30));
                config.put("auto_start", defaultPrefs.getBoolean("auto_start", false));
                
                // Add JWT token from AuthManager
                String jwtToken = authManager.getToken();
                if (jwtToken != null) {
                    config.put("jwt_token", jwtToken);
                }
                
                // Add stream deck configuration
                config.put("button_config", deckPrefs.getString("button_config", ""));
                config.put("category_order", deckPrefs.getString("category_order", ""));
                config.put("use_custom_config", deckPrefs.getBoolean("use_custom_config", false));
                
                // Add button orders
                JSONObject buttonOrders = new JSONObject();
                Map<String, ?> allDeckPrefs = deckPrefs.getAll();
                for (Map.Entry<String, ?> entry : allDeckPrefs.entrySet()) {
                    if (entry.getKey().startsWith("button_order_")) {
                        String categoryName = entry.getKey().substring(13);
                        buttonOrders.put(categoryName, entry.getValue());
                    }
                }
                config.put("button_orders", buttonOrders);
                
                // Encrypt the configuration
                String plaintext = config.toString();
                String encrypted = encryptAES(plaintext, password);
                
                // Write to file
                OutputStream outputStream = requireContext().getContentResolver().openOutputStream(uri);
                if (outputStream != null) {
                    outputStream.write(encrypted.getBytes(StandardCharsets.UTF_8));
                    outputStream.close();
                    Toast.makeText(requireContext(), "Configuration exported successfully", Toast.LENGTH_SHORT).show();
                }
            } catch (Exception e) {
                Toast.makeText(requireContext(), "Export failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
        
        private void importConfig(Uri uri, String password) {
            try {
                // Read encrypted file
                InputStream inputStream = requireContext().getContentResolver().openInputStream(uri);
                if (inputStream != null) {
                    byte[] bytes = new byte[inputStream.available()];
                    inputStream.read(bytes);
                    inputStream.close();
                    
                    String encrypted = new String(bytes, StandardCharsets.UTF_8);
                    
                    // Decrypt the configuration
                    String plaintext = decryptAES(encrypted, password);
                    
                    // Parse JSON
                    JSONObject config = new JSONObject(plaintext);
                    
                    // Apply default preferences
                    SharedPreferences defaultPrefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
                    SharedPreferences.Editor defaultEditor = defaultPrefs.edit();
                    
                    if (config.has("api_url")) defaultEditor.putString("api_url", config.getString("api_url"));
                    if (config.has("target_channel")) defaultEditor.putString("target_channel", config.getString("target_channel"));
                    if (config.has("update_interval")) defaultEditor.putInt("update_interval", config.getInt("update_interval"));
                    if (config.has("auto_start")) defaultEditor.putBoolean("auto_start", config.getBoolean("auto_start"));
                    
                    defaultEditor.apply();
                    
                    // Apply JWT token to AuthManager
                    if (config.has("jwt_token")) {
                        AuthManager authManager = AuthManager.getInstance(requireContext());
                        authManager.saveToken(config.getString("jwt_token"));
                    }
                    
                    // Apply stream deck configuration
                    SharedPreferences deckPrefs = requireContext().getSharedPreferences("stream_deck_config", 0);
                    SharedPreferences.Editor deckEditor = deckPrefs.edit();
                    
                    if (config.has("button_config")) deckEditor.putString("button_config", config.getString("button_config"));
                    if (config.has("category_order")) deckEditor.putString("category_order", config.getString("category_order"));
                    if (config.has("use_custom_config")) deckEditor.putBoolean("use_custom_config", config.getBoolean("use_custom_config"));
                    
                    // Apply button orders
                    if (config.has("button_orders")) {
                        JSONObject buttonOrders = config.getJSONObject("button_orders");
                        Iterator<String> keys = buttonOrders.keys();
                        while (keys.hasNext()) {
                            String categoryName = keys.next();
                            String orderJson = buttonOrders.getString(categoryName);
                            deckEditor.putString("button_order_" + categoryName, orderJson);
                        }
                    }
                    
                    deckEditor.apply();
                    
                    Toast.makeText(requireContext(), "Configuration imported successfully. Please restart the app.", Toast.LENGTH_LONG).show();
                    
                    // Restart app
                    new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                        Intent intent = new Intent(requireContext(), MainActivity.class);
                        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                        startActivity(intent);
                        requireActivity().finish();
                    }, 2000);
                }
            } catch (javax.crypto.BadPaddingException e) {
                Toast.makeText(requireContext(), "Wrong password or corrupted file", Toast.LENGTH_LONG).show();
            } catch (Exception e) {
                Toast.makeText(requireContext(), "Import failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
        
        /**
         * Encrypt string using AES-256 with PBKDF2 key derivation
         */
        private String encryptAES(String plaintext, String password) throws Exception {
            // Generate random salt and IV
            byte[] salt = new byte[16];
            byte[] iv = new byte[16];
            SecureRandom random = new SecureRandom();
            random.nextBytes(salt);
            random.nextBytes(iv);
            
            // Derive key from password
            SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, 65536, 256);
            SecretKeySpec keySpec = new SecretKeySpec(factory.generateSecret(spec).getEncoded(), "AES");
            
            // Encrypt
            Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
            cipher.init(Cipher.ENCRYPT_MODE, keySpec, new IvParameterSpec(iv));
            byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            
            // Combine salt + IV + encrypted data
            byte[] combined = new byte[salt.length + iv.length + encrypted.length];
            System.arraycopy(salt, 0, combined, 0, salt.length);
            System.arraycopy(iv, 0, combined, salt.length, iv.length);
            System.arraycopy(encrypted, 0, combined, salt.length + iv.length, encrypted.length);
            
            // Return Base64 encoded
            return Base64.getEncoder().encodeToString(combined);
        }
        
        /**
         * Decrypt AES-256 encrypted string
         */
        private String decryptAES(String encrypted, String password) throws Exception {
            // Decode Base64
            byte[] combined = Base64.getDecoder().decode(encrypted);
            
            // Extract salt, IV, and encrypted data
            byte[] salt = new byte[16];
            byte[] iv = new byte[16];
            byte[] encryptedData = new byte[combined.length - 32];
            
            System.arraycopy(combined, 0, salt, 0, 16);
            System.arraycopy(combined, 16, iv, 0, 16);
            System.arraycopy(combined, 32, encryptedData, 0, encryptedData.length);
            
            // Derive key from password
            SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, 65536, 256);
            SecretKeySpec keySpec = new SecretKeySpec(factory.generateSecret(spec).getEncoded(), "AES");
            
            // Decrypt
            Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
            cipher.init(Cipher.DECRYPT_MODE, keySpec, new IvParameterSpec(iv));
            byte[] decrypted = cipher.doFinal(encryptedData);
            
            return new String(decrypted, StandardCharsets.UTF_8);
        }
        
        /**
         * Sync TTS OpenAI setting to server
         */
        private void loadTTSSettingFromServer() {
            com.pulserelay.locationtracker.api.UserApiService userApiService = 
                com.pulserelay.locationtracker.api.ApiClient.getRetrofitInstance(requireContext())
                    .create(com.pulserelay.locationtracker.api.UserApiService.class);
            
            userApiService.getTTSSettings().enqueue(new retrofit2.Callback<com.pulserelay.locationtracker.models.TTSSettingsResponse>() {
                @Override
                public void onResponse(retrofit2.Call<com.pulserelay.locationtracker.models.TTSSettingsResponse> call, 
                                     retrofit2.Response<com.pulserelay.locationtracker.models.TTSSettingsResponse> response) {
                    if (response.isSuccessful() && response.body() != null) {
                        boolean serverEnabled = response.body().isTtsOpenaiEnabled();
                        
                        // Update the preference to match server
                        androidx.preference.SwitchPreferenceCompat ttsOpenaiPref = findPreference("tts_openai_processing");
                        if (ttsOpenaiPref != null) {
                            ttsOpenaiPref.setChecked(serverEnabled);
                        }
                        
                        android.util.Log.d("SettingsActivity", "Loaded TTS setting from server: " + serverEnabled);
                    }
                }
                
                @Override
                public void onFailure(retrofit2.Call<com.pulserelay.locationtracker.models.TTSSettingsResponse> call, Throwable t) {
                    android.util.Log.e("SettingsActivity", "Failed to load TTS setting from server", t);
                }
            });
        }
        
        private void syncTTSSettingToServer(boolean enabled) {
            com.pulserelay.locationtracker.api.UserApiService userApiService = 
                com.pulserelay.locationtracker.api.ApiClient.getRetrofitInstance(requireContext())
                    .create(com.pulserelay.locationtracker.api.UserApiService.class);
            
            com.pulserelay.locationtracker.models.TTSSettings settings = 
                new com.pulserelay.locationtracker.models.TTSSettings(enabled);
            
            userApiService.updateTTSSettings(settings).enqueue(new retrofit2.Callback<com.pulserelay.locationtracker.models.TTSSettingsResponse>() {
                @Override
                public void onResponse(retrofit2.Call<com.pulserelay.locationtracker.models.TTSSettingsResponse> call, 
                                     retrofit2.Response<com.pulserelay.locationtracker.models.TTSSettingsResponse> response) {
                    if (response.isSuccessful()) {
                        Toast.makeText(requireContext(), "TTS setting synced to server", Toast.LENGTH_SHORT).show();
                    } else {
                        Toast.makeText(requireContext(), "Failed to sync TTS setting", Toast.LENGTH_SHORT).show();
                    }
                }
                
                @Override
                public void onFailure(retrofit2.Call<com.pulserelay.locationtracker.models.TTSSettingsResponse> call, Throwable t) {
                    Toast.makeText(requireContext(), "Error syncing TTS setting: " + t.getMessage(), Toast.LENGTH_SHORT).show();
                }
            });
        }
        
        /**
         * Sync ignored users to server on settings start (Android app is master - upload only)
         */
        private void syncIgnoredUsersToServerOnStart() {
            SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
            String ignoredUsersStr = prefs.getString("tts_ignored_users", "");
            java.util.List<String> ignoredUsersList = new java.util.ArrayList<>();
            
            if (!ignoredUsersStr.isEmpty()) {
                for (String user : ignoredUsersStr.split(",")) {
                    ignoredUsersList.add(user.trim());
                }
            }
            
            // Upload local list to server first
            com.pulserelay.locationtracker.api.UserApiService userApiService = 
                com.pulserelay.locationtracker.api.ApiClient.getRetrofitInstance(requireContext())
                    .create(com.pulserelay.locationtracker.api.UserApiService.class);
            
            com.pulserelay.locationtracker.api.UserApiService.TTSIgnoredUsersRequest request = 
                new com.pulserelay.locationtracker.api.UserApiService.TTSIgnoredUsersRequest(ignoredUsersList);
            
            userApiService.updateTTSIgnoredUsers(request).enqueue(new retrofit2.Callback<com.pulserelay.locationtracker.api.UserApiService.TTSIgnoredUsersResponse>() {
                @Override
                public void onResponse(retrofit2.Call<com.pulserelay.locationtracker.api.UserApiService.TTSIgnoredUsersResponse> call,
                                     retrofit2.Response<com.pulserelay.locationtracker.api.UserApiService.TTSIgnoredUsersResponse> response) {
                    if (response.isSuccessful()) {
                        android.util.Log.d("SettingsActivity", "Synced " + ignoredUsersList.size() + " ignored users to server");
                    } else {
                        android.util.Log.e("SettingsActivity", "Failed to sync ignored users to server: " + response.code());
                    }
                }
                
                @Override
                public void onFailure(retrofit2.Call<com.pulserelay.locationtracker.api.UserApiService.TTSIgnoredUsersResponse> call,
                                    Throwable t) {
                    android.util.Log.e("SettingsActivity", "Error syncing ignored users to server", t);
                }
            });
        }
        
        /**
         * Check if a service is currently running
         * Note: getRunningServices is deprecated but still functional for own app services
         */
        @SuppressWarnings("deprecation")
        private boolean isServiceRunning(Class<?> serviceClass) {
            android.app.ActivityManager manager = (android.app.ActivityManager) requireContext().getSystemService(android.content.Context.ACTIVITY_SERVICE);
            if (manager != null) {
                for (android.app.ActivityManager.RunningServiceInfo service : manager.getRunningServices(Integer.MAX_VALUE)) {
                    if (serviceClass.getName().equals(service.service.getClassName())) {
                        return true;
                    }
                }
            }
            return false;
        }
    }
}
