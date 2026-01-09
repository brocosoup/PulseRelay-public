package com.pulserelay.locationtracker;

import android.content.Context;
import android.location.Location;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.io.IOException;

import okhttp3.Call;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class LocationSender {
    
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static final OkHttpClient client = new OkHttpClient();
    
    public interface Callback {
        void onSuccess();
        void onError(String error, int statusCode);
    }
    
    public static void sendLocation(Context context, Location location, String apiUrl, Callback callback) {
        sendLocation(context, location, apiUrl, null, null, null, callback);
    }
    
    public static void sendLocation(Context context, Location location, String apiUrl, String jwtToken, Callback callback) {
        sendLocation(context, location, apiUrl, jwtToken, null, null, callback);
    }
    
    public static void sendLocation(Context context, Location location, String apiUrl, String jwtToken, Integer gpsQuality, Integer gsmSignal, Callback callback) {
        Handler mainHandler = new Handler(Looper.getMainLooper());
        
        new Thread(() -> {
            try {
                JSONObject json = new JSONObject();
                json.put("latitude", location.getLatitude());
                json.put("longitude", location.getLongitude());
                json.put("accuracy", location.getAccuracy());
                json.put("altitude", location.getAltitude());
                json.put("altitudeAccuracy", location.hasVerticalAccuracy() ? location.getVerticalAccuracyMeters() : null);
                json.put("heading", location.getBearing());
                json.put("speed", location.getSpeed());
                
                // Add GPS quality if available
                if (gpsQuality != null) {
                    json.put("gpsQuality", gpsQuality);
                }
                
                // Add GSM signal if available
                if (gsmSignal != null) {
                    json.put("gsmSignal", gsmSignal);
                }
                
                RequestBody body = RequestBody.create(json.toString(), JSON);
                Request.Builder requestBuilder = new Request.Builder()
                        .url(apiUrl)
                        .post(body)
                        .addHeader("Content-Type", "application/json");
                
                // Add JWT token if provided
                if (jwtToken != null && !jwtToken.isEmpty()) {
                    requestBuilder.addHeader("Authorization", "Bearer " + jwtToken);
                }
                
                Request request = requestBuilder.build();
                
                try (Response response = client.newCall(request).execute()) {
                    final int statusCode = response.code();
                    if (response.isSuccessful()) {
                        mainHandler.post(() -> callback.onSuccess());
                    } else {
                        mainHandler.post(() -> callback.onError("HTTP " + statusCode, statusCode));
                    }
                }
            } catch (Exception e) {
                final String errorMsg = e.getMessage();
                mainHandler.post(() -> callback.onError(errorMsg, 0));
            }
        }).start();
    }
}
