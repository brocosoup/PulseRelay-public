package com.pulserelay.locationtracker.api;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.preference.PreferenceManager;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.pulserelay.locationtracker.auth.AuthManager;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.logging.HttpLoggingInterceptor;
import retrofit2.Retrofit;
import retrofit2.converter.gson.GsonConverterFactory;

/**
 * Base API client for making HTTP requests to PulseRelay server
 */
public class ApiClient {
    private static final String TAG = "ApiClient";
    private static Retrofit retrofit = null;
    private static String baseUrl = null;
    private static Context appContext = null;

    /**
     * Get Retrofit instance with configured base URL
     */
    public static Retrofit getClient(String url) {
        if (retrofit == null || !url.equals(baseUrl)) {
            baseUrl = url;
            
            // Ensure URL ends with /
            if (!baseUrl.endsWith("/")) {
                baseUrl += "/";
            }
            
            // Create OkHttp client with interceptors
            OkHttpClient.Builder httpClient = new OkHttpClient.Builder()
                    .connectTimeout(30, TimeUnit.SECONDS)
                    .readTimeout(30, TimeUnit.SECONDS)
                    .writeTimeout(30, TimeUnit.SECONDS);
            
            // Add logging interceptor only for errors
            HttpLoggingInterceptor loggingInterceptor = new HttpLoggingInterceptor();
            loggingInterceptor.setLevel(HttpLoggingInterceptor.Level.BASIC); // Changed from BODY to BASIC
            httpClient.addInterceptor(loggingInterceptor);
            
            // Add auth interceptor for JWT token
            httpClient.addInterceptor(new AuthInterceptor());
            
            // Create Gson instance with lenient parsing
            Gson gson = new GsonBuilder()
                    .setLenient()
                    .create();
            
            // Build Retrofit instance
            retrofit = new Retrofit.Builder()
                    .baseUrl(baseUrl)
                    .client(httpClient.build())
                    .addConverterFactory(GsonConverterFactory.create(gson))
                    .build();
        }
        
        return retrofit;
    }
    
    /**
     * Initialize ApiClient with application context
     */
    public static void init(Context context) {
        appContext = context.getApplicationContext();
    }
    
    /**
     * Get Retrofit instance using default URL from SharedPreferences
     * Used when URL is already configured in app settings
     */
    public static Retrofit getRetrofitInstance(Context context) {
        if (appContext == null) {
            appContext = context.getApplicationContext();
        }
        
        // Get URL from SharedPreferences
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(appContext);
        String apiUrl = prefs.getString("api_url", "http://10.0.2.2:3000/");
        
        android.util.Log.d(TAG, "Using API URL from settings: " + apiUrl);
        
        return getClient(apiUrl);
    }
    
    /**
     * Deprecated - use getRetrofitInstance(Context) instead
     */
    @Deprecated
    public static Retrofit getRetrofitInstance() {
        // Fallback for old code - use localhost as default
        String defaultUrl = "http://10.0.2.2:3000/";
        android.util.Log.w(TAG, "Using deprecated getRetrofitInstance() - API URL: " + defaultUrl);
        return getClient(defaultUrl);
    }
    
    /**
     * Clear cached client (useful when changing server URL)
     */
    public static void clearClient() {
        retrofit = null;
        baseUrl = null;
    }
    
    /**
     * Auth interceptor to automatically inject JWT token in headers
     */
    private static class AuthInterceptor implements Interceptor {
        @Override
        public Response intercept(Chain chain) throws IOException {
            Request original = chain.request();
            
            // Get JWT token from AuthManager using app context
            String token = null;
            if (appContext != null) {
                token = AuthManager.getInstance(appContext).getToken();
            }
            
            // Build new request with Authorization header if token exists
            Request.Builder requestBuilder = original.newBuilder();
            
            if (token != null && !token.isEmpty()) {
                requestBuilder.header("Authorization", "Bearer " + token);
                android.util.Log.d(TAG, "Added Authorization header to request");
            } else {
                android.util.Log.w(TAG, "No JWT token available for request");
            }
            
            Request request = requestBuilder.build();
            return chain.proceed(request);
        }
    }
}
