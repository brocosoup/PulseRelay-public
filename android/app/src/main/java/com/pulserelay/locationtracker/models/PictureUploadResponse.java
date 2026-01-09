package com.pulserelay.locationtracker.models;

import com.google.gson.annotations.SerializedName;

/**
 * Response model for picture upload API
 */
public class PictureUploadResponse {
    
    @SerializedName("success")
    private boolean success;
    
    @SerializedName("picture")
    private PictureData picture;
    
    @SerializedName("error")
    private String error;
    
    public boolean isSuccess() {
        return success;
    }
    
    public PictureData getPicture() {
        return picture;
    }
    
    public String getError() {
        return error;
    }
    
    public static class PictureData {
        @SerializedName("id")
        private int id;
        
        @SerializedName("filename")
        private String filename;
        
        @SerializedName("filepath")
        private String filepath;
        
        @SerializedName("createdAt")
        private String createdAt;
        
        public int getId() {
            return id;
        }
        
        public String getFilename() {
            return filename;
        }
        
        public String getFilepath() {
            return filepath;
        }
        
        public String getCreatedAt() {
            return createdAt;
        }
    }
}
