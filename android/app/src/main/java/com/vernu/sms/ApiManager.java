package com.vernu.sms;

import com.vernu.sms.services.GatewayApiService;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import retrofit2.Retrofit;
import retrofit2.converter.gson.GsonConverterFactory;

public class ApiManager {
    private static final long DIRECT_CALL_TIMEOUT_SECONDS = 8;
    private static final Object directLock = new Object();
    private static GatewayApiService apiService;
    private static GatewayApiService directApiService;

    public static GatewayApiService getApiService() {
        if (apiService == null) {
            apiService = createApiService(createHttpClient());
        }
        return apiService;
    }

    /** Limits the whole call, so a direct upload ends before its queued job starts. */
    public static GatewayApiService getDirectApiService() {
        synchronized (directLock) {
            if (directApiService == null) {
                directApiService = createApiService(createHttpClient().newBuilder()
                        .callTimeout(DIRECT_CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                        .build());
            }
            return directApiService;
        }
    }

    /** Adds the client name to every request. See AppConstants.CLIENT_NAME. */
    static OkHttpClient createHttpClient() {
        return new OkHttpClient.Builder()
                .addInterceptor(new Interceptor() {
                    @Override
                    public Response intercept(Chain chain) throws IOException {
                        Request request = chain.request()
                                .newBuilder()
                                .header(AppConstants.CLIENT_HEADER, AppConstants.CLIENT_NAME)
                                .build();
                        return chain.proceed(request);
                    }
                })
                .build();
    }

    private static GatewayApiService createApiService(OkHttpClient client) {
        Retrofit retrofit = new Retrofit.Builder()
                .baseUrl(AppConstants.API_BASE_URL)
                .client(client)
                .addConverterFactory(GsonConverterFactory.create())
                .build();

        return retrofit.create(GatewayApiService.class);
    }
}
