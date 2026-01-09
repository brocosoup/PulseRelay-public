package com.pulserelay.locationtracker.api;

import com.pulserelay.locationtracker.models.PictureUploadResponse;

import okhttp3.MultipartBody;
import okhttp3.RequestBody;
import okhttp3.ResponseBody;
import retrofit2.Call;
import retrofit2.http.DELETE;
import retrofit2.http.Multipart;
import retrofit2.http.POST;
import retrofit2.http.Part;

/**
 * Retrofit service interface for picture upload API endpoints
 */
public interface PictureApiService {
    
    /**
     * Upload a picture to display on the overlay
     * @param picture The image file as multipart data
     * @return PictureUploadResponse with uploaded picture details
     */
    @Multipart
    @POST("/api/pictures")
    Call<PictureUploadResponse> uploadPicture(@Part MultipartBody.Part picture);
    
    /**
     * Clear all queued media
     * @return Response with deletion count
     */
    @DELETE("/api/pictures/queue")
    Call<ResponseBody> clearQueue();
}
