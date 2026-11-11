package com.vernu.sms.services;

import com.vernu.sms.dtos.SMSDTO;
import com.vernu.sms.dtos.SMSForwardResponseDTO;
import com.vernu.sms.dtos.RegisterDeviceInputDTO;
import com.vernu.sms.dtos.RegisterDeviceResponseDTO;
import com.vernu.sms.dtos.HeartbeatInputDTO;
import com.vernu.sms.dtos.HeartbeatResponseDTO;
import com.vernu.sms.dtos.PendingMessagesResponseDTO;
import com.vernu.sms.dtos.ClaimMessagesInputDTO;
import com.vernu.sms.dtos.ClaimMessagesResponseDTO;

import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.GET;
import retrofit2.http.Header;
import retrofit2.http.PATCH;
import retrofit2.http.POST;
import retrofit2.http.Path;

public interface GatewayApiService {
    @POST("gateway/devices")
    Call<RegisterDeviceResponseDTO> registerDevice(@Header("x-api-key") String apiKey, @Body() RegisterDeviceInputDTO body);

    @PATCH("gateway/devices/{deviceId}")
    Call<RegisterDeviceResponseDTO> updateDevice(@Path("deviceId") String deviceId, @Header("x-api-key") String apiKey, @Body() RegisterDeviceInputDTO body);

    @POST("gateway/devices/{deviceId}/receive-sms")
    Call<SMSForwardResponseDTO> sendReceivedSMS(@Path("deviceId") String deviceId, @Header("x-api-key") String apiKey, @Body() SMSDTO body);

    @PATCH("gateway/devices/{deviceId}/sms-status")
    Call<SMSForwardResponseDTO> updateSMSStatus(@Path("deviceId") String deviceId, @Header("x-api-key") String apiKey, @Body() SMSDTO body);

    @POST("gateway/devices/{deviceId}/heartbeat")
    Call<HeartbeatResponseDTO> heartbeat(@Path("deviceId") String deviceId, @Header("x-api-key") String apiKey, @Body() HeartbeatInputDTO body);

    @GET("gateway/devices/{deviceId}/messages/pending")
    Call<PendingMessagesResponseDTO> getPendingMessages(@Path("deviceId") String deviceId, @Header("x-api-key") String apiKey);

    @POST("gateway/devices/{deviceId}/messages/claim")
    Call<ClaimMessagesResponseDTO> claimMessages(@Path("deviceId") String deviceId, @Header("x-api-key") String apiKey, @Body() ClaimMessagesInputDTO body);
}