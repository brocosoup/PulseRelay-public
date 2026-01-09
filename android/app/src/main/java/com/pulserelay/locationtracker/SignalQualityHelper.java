package com.pulserelay.locationtracker;

import android.content.Context;
import android.location.GnssStatus;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.telephony.PhoneStateListener;
import android.telephony.SignalStrength;
import android.telephony.TelephonyCallback;
import android.telephony.TelephonyManager;

import androidx.annotation.RequiresApi;

import java.util.concurrent.Executor;

/**
 * Helper class to get GPS quality and GSM signal strength metrics
 */
public class SignalQualityHelper {
    
    private Context context;
    private TelephonyManager telephonyManager;
    private Integer currentGsmSignal = null;
    private Object signalCallback; // TelephonyCallback for API 31+ or PhoneStateListener for older
    
    public SignalQualityHelper(Context context) {
        this.context = context;
        this.telephonyManager = (TelephonyManager) context.getSystemService(Context.TELEPHONY_SERVICE);
        startMonitoringSignal();
    }
    
    /**
     * Calculate GPS quality based on location accuracy and number of satellites
     * Returns a percentage (0-100) where higher is better
     */
    public Integer getGpsQuality(Location location) {
        if (location == null) {
            return null;
        }
        
        int quality = 0;
        
        // Factor 1: Accuracy (70% weight)
        // Excellent: < 5m, Good: < 10m, Fair: < 20m, Poor: < 50m, Very Poor: >= 50m
        float accuracy = location.getAccuracy();
        if (accuracy < 5) {
            quality += 70;
        } else if (accuracy < 10) {
            quality += 60;
        } else if (accuracy < 20) {
            quality += 40;
        } else if (accuracy < 50) {
            quality += 20;
        } else {
            quality += 10;
        }
        
        // Factor 2: Age of location (30% weight)
        // Fresh data gets higher score
        long ageMillis = System.currentTimeMillis() - location.getTime();
        if (ageMillis < 5000) {  // < 5 seconds
            quality += 30;
        } else if (ageMillis < 10000) {  // < 10 seconds
            quality += 20;
        } else if (ageMillis < 30000) {  // < 30 seconds
            quality += 10;
        } else {
            quality += 5;
        }
        
        return Math.min(100, quality);
    }
    
    /**
     * Get GSM signal strength as a percentage (0-100)
     */
    public Integer getGsmSignal() {
        return currentGsmSignal;
    }
    
    /**
     * Start monitoring cellular signal strength
     * Note: PhoneStateListener is deprecated but still functional
     */
    @SuppressWarnings("deprecation")
    private void startMonitoringSignal() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // For Android 12+ use the callback method
                telephonyManager.listen(new PhoneStateListener() {
                    @Override
                    public void onSignalStrengthsChanged(SignalStrength signalStrength) {
                        currentGsmSignal = convertSignalStrengthToPercentage(signalStrength);
                    }
                }, PhoneStateListener.LISTEN_SIGNAL_STRENGTHS);
            } else {
                // For older versions
                telephonyManager.listen(new PhoneStateListener() {
                    @Override
                    public void onSignalStrengthsChanged(SignalStrength signalStrength) {
                        currentGsmSignal = convertSignalStrengthToPercentage(signalStrength);
                    }
                }, PhoneStateListener.LISTEN_SIGNAL_STRENGTHS);
            }
        } catch (SecurityException e) {
            // Permission not granted, signal monitoring not available
            currentGsmSignal = null;
        }
    }
    
    /**
     * Convert SignalStrength to percentage (0-100)
     */
    private Integer convertSignalStrengthToPercentage(SignalStrength signalStrength) {
        if (signalStrength == null) {
            return null;
        }
        
        // Try to get actual dBm value for more granular readings
        int dBm = 0;
        
        // Try to get GSM signal strength (most common)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10+ provides getCellSignalStrengths
                android.telephony.CellSignalStrengthGsm gsmStrength = 
                    (android.telephony.CellSignalStrengthGsm) signalStrength.getCellSignalStrengths()
                        .stream()
                        .filter(s -> s instanceof android.telephony.CellSignalStrengthGsm)
                        .findFirst()
                        .orElse(null);
                        
                if (gsmStrength != null) {
                    dBm = gsmStrength.getDbm();
                } else {
                    // Try LTE
                    android.telephony.CellSignalStrengthLte lteStrength = 
                        (android.telephony.CellSignalStrengthLte) signalStrength.getCellSignalStrengths()
                            .stream()
                            .filter(s -> s instanceof android.telephony.CellSignalStrengthLte)
                            .findFirst()
                            .orElse(null);
                    if (lteStrength != null) {
                        dBm = lteStrength.getDbm();
                    }
                }
            }
        } catch (Exception e) {
            // Fall back to level-based approach
        }
        
        // If we got a dBm value, convert it to percentage
        if (dBm != 0) {
            // GSM/LTE dBm typically ranges from -113 (worst) to -51 (best)
            // Convert to 0-100 scale
            // -113 dBm or worse = 0%
            // -51 dBm or better = 100%
            int percentage = (int) (((dBm + 113) / 62.0) * 100);
            return Math.max(0, Math.min(100, percentage));
        }
        
        // Fallback: Use level-based approach with better distribution
        int level = signalStrength.getLevel();
        
        // Convert to percentage with finer granularity
        // Level 0 (none/no signal) = 0-15%
        // Level 1 (poor) = 15-40%
        // Level 2 (moderate) = 40-65%
        // Level 3 (good) = 65-85%
        // Level 4 (excellent) = 85-100%
        
        switch (level) {
            case 0:
                return 8;   // Very poor
            case 1:
                return 28;  // Poor
            case 2:
                return 53;  // Moderate
            case 3:
                return 75;  // Good
            case 4:
                return 93;  // Excellent
            default:
                return null;
        }
    }
    
    /**
     * Clean up resources
     */
    @SuppressWarnings("deprecation")
    public void cleanup() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (signalCallback instanceof TelephonyCallback) {
                    telephonyManager.unregisterTelephonyCallback((TelephonyCallback) signalCallback);
                }
            } else {
                if (signalCallback instanceof PhoneStateListener) {
                    telephonyManager.listen((PhoneStateListener) signalCallback, PhoneStateListener.LISTEN_NONE);
                }
            }
        } catch (Exception e) {
            // Ignore cleanup errors
        }
    }
}
