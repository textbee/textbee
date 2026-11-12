package com.vernu.sms.helpers;

import android.content.Context;
import android.util.Log;

import com.vernu.sms.ApiManager;
import com.vernu.sms.AppConstants;
import com.vernu.sms.BuildConfig;
import com.vernu.sms.dtos.RegisterDeviceInputDTO;
import com.vernu.sms.dtos.RegisterDeviceResponseDTO;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class VersionTracker {
    private static final String TAG = "VersionTracker";

    /**
     * Checks if the app version has changed since the last time it was run
     * @param context Application context
     * @return true if version has changed, false otherwise
     */
    public static boolean hasVersionChanged(Context context) {
        int lastVersionCode = SharedPreferenceHelper.getSharedPreferenceInt(
                context, 
                AppConstants.SHARED_PREFS_LAST_VERSION_CODE_KEY, 
                -1
        );
        
        String lastVersionName = SharedPreferenceHelper.getSharedPreferenceString(
                context,
                AppConstants.SHARED_PREFS_LAST_VERSION_NAME_KEY,
                ""
        );
        
        int currentVersionCode = BuildConfig.VERSION_CODE;
        String currentVersionName = BuildConfig.VERSION_NAME;
        
        // First app launch or version changed
        return lastVersionCode == -1 || 
               lastVersionCode != currentVersionCode || 
               !lastVersionName.equals(currentVersionName);
    }
    
    /**
     * Updates the stored version information with current version
     * @param context Application context
     */
    public static void updateStoredVersion(Context context) {
        SharedPreferenceHelper.setSharedPreferenceInt(
                context,
                AppConstants.SHARED_PREFS_LAST_VERSION_CODE_KEY,
                BuildConfig.VERSION_CODE
        );
        
        SharedPreferenceHelper.setSharedPreferenceString(
                context,
                AppConstants.SHARED_PREFS_LAST_VERSION_NAME_KEY,
                BuildConfig.VERSION_NAME
        );
    }
    
    /**
     * Reports current app version to the server
     * @param context Application context
     */
    public static void reportVersionToServer(Context context) {
        String deviceId = SharedPreferenceHelper.getSharedPreferenceString(
                context, 
                AppConstants.SHARED_PREFS_DEVICE_ID_KEY, 
                ""
        );
        
        String apiKey = SharedPreferenceHelper.getSharedPreferenceString(
                context,
                AppConstants.SHARED_PREFS_API_KEY_KEY,
                ""
        );
        
        // If device is not registered or no API key, can't report version
        if (deviceId.isEmpty() || apiKey.isEmpty()) {
            Log.d(TAG, "Can't report version: device not registered or no API key");
            return;
        }
        
        RegisterDeviceInputDTO updateInput = new RegisterDeviceInputDTO();
        updateInput.setAppVersionCode(BuildConfig.VERSION_CODE);
        updateInput.setAppVersionName(BuildConfig.VERSION_NAME);
        
        Call<RegisterDeviceResponseDTO> apiCall = ApiManager.getApiService()
                .updateDevice(deviceId, apiKey, updateInput);
        
        apiCall.enqueue(new Callback<RegisterDeviceResponseDTO>() {
            @Override
            public void onResponse(Call<RegisterDeviceResponseDTO> call, Response<RegisterDeviceResponseDTO> response) {
                ApiKeyStatus.record(context, response.code(), apiKey);
                if (response.isSuccessful()) {
                    Log.d(TAG, "Version update reported successfully");
                    updateStoredVersion(context);
                } else {
                    Log.e(TAG, "Failed to report version update: " + response.code());
                }
            }
            
            @Override
            public void onFailure(Call<RegisterDeviceResponseDTO> call, Throwable t) {
                Log.e(TAG, "Error reporting version update: " + t.getMessage());
            }
        });
    }
} 