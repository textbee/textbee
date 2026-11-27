package com.vernu.sms.services

import com.vernu.sms.dtos.DeviceLinkInputDTO
import com.vernu.sms.dtos.GatewayStatsResponse
import com.vernu.sms.dtos.MessagesResponse
import com.vernu.sms.dtos.RegisterDeviceInputDTO
import com.vernu.sms.dtos.RegisterDeviceResponseDTO
import com.vernu.sms.dtos.SendSmsRequest
import com.vernu.sms.dtos.SubscriptionResponse
import com.vernu.sms.dtos.UserProfileWrapper
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*

interface GatewayApiServiceKt {

    @GET("auth/who-am-i")
    suspend fun whoAmI(
        @Header("x-api-key") apiKey: String
    ): Response<UserProfileWrapper>

    @GET("gateway/stats")
    suspend fun getStats(
        @Header("x-api-key") apiKey: String
    ): Response<GatewayStatsResponse>

    @POST("gateway/devices")
    suspend fun registerDevice(
        @Header("x-api-key") apiKey: String,
        @Body body: RegisterDeviceInputDTO
    ): Response<RegisterDeviceResponseDTO>

    @GET("billing/current-subscription")
    suspend fun getCurrentSubscription(
        @Header("x-api-key") apiKey: String
    ): Response<SubscriptionResponse>

    @PATCH("gateway/devices/{deviceId}")
    suspend fun updateDevice(
        @Path("deviceId") deviceId: String,
        @Header("x-api-key") apiKey: String,
        @Body body: RegisterDeviceInputDTO
    ): Response<RegisterDeviceResponseDTO>

    @GET("gateway/devices/{deviceId}/messages")
    suspend fun getMessages(
        @Path("deviceId") deviceId: String,
        @Header("x-api-key") apiKey: String,
        @Query("page") page: Int,
        @Query("limit") limit: Int,
        @Query("type") type: String
    ): Response<MessagesResponse>

    // Sign-in answers are read as text, so one unexpected field cannot fail the whole answer
    @POST("auth/device-links")
    suspend fun createDeviceLink(
        @Body body: DeviceLinkInputDTO
    ): Response<ResponseBody>

    @POST("auth/device-links/poll")
    suspend fun pollDeviceLink(
        @Body body: Map<String, String>
    ): Response<ResponseBody>

    @POST("gateway/devices/{deviceId}/disconnect")
    suspend fun disconnectDevice(
        @Path("deviceId") deviceId: String,
        @Header("x-api-key") apiKey: String
    ): Response<ResponseBody>

    @POST("gateway/devices/{deviceId}/send-sms")
    suspend fun sendSms(
        @Path("deviceId") deviceId: String,
        @Header("x-api-key") apiKey: String,
        @Body body: SendSmsRequest
    ): Response<Any>
}
