package com.vernu.sms;

import android.Manifest;

public class AppConstants {
    public static final String API_BASE_URL = BuildConfig.API_BASE_URL;

    // Names this app in outgoing requests. The API key is shared with any code
    // a customer writes, so without this a request from the app and one from
    // their own server look identical.
    public static final String CLIENT_HEADER = "x-sdk-client";
    public static final String CLIENT_NAME = "textbee-android/" + BuildConfig.VERSION_NAME;
    public static final String[] requiredPermissions = new String[]{
            Manifest.permission.SEND_SMS,
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.READ_PHONE_STATE
    };
    public static final String SHARED_PREFS_DEVICE_ID_KEY = "DEVICE_ID";
    public static final String SHARED_PREFS_API_KEY_KEY = "API_KEY";
    public static final String SHARED_PREFS_GATEWAY_ENABLED_KEY = "GATEWAY_ENABLED";
    public static final String SHARED_PREFS_PREFERRED_SIM_KEY = "PREFERRED_SIM";
    public static final String SHARED_PREFS_RECEIVE_SMS_ENABLED_KEY = "RECEIVE_SMS_ENABLED";
    public static final String SHARED_PREFS_TRACK_SENT_SMS_STATUS_KEY = "TRACK_SENT_SMS_STATUS";
    public static final String SHARED_PREFS_LAST_VERSION_CODE_KEY = "LAST_VERSION_CODE";
    public static final String SHARED_PREFS_LAST_VERSION_NAME_KEY = "LAST_VERSION_NAME";
    public static final String SHARED_PREFS_STICKY_NOTIFICATION_ENABLED_KEY = "STICKY_NOTIFICATION_ENABLED";
    public static final String HEARTBEAT_WORK_TAG = "heartbeat";
    public static final String SHARED_PREFS_HEARTBEAT_ENABLED_KEY = "HEARTBEAT_ENABLED";
    public static final String SHARED_PREFS_HEARTBEAT_INTERVAL_MINUTES_KEY = "HEARTBEAT_INTERVAL_MINUTES";
    public static final String SHARED_PREFS_SMS_FILTER_CONFIG_KEY = "SMS_FILTER_CONFIG";
    public static final String SHARED_PREFS_DEVICE_NAME_KEY = "DEVICE_NAME";
    public static final String SHARED_PREFS_SMS_SEND_DELAY_SECONDS_KEY = "SMS_SEND_DELAY_SECONDS";
    /** Default delay between SMS sends (seconds). 5s helps avoid carrier/device throttling. */
    public static final int DEFAULT_SMS_SEND_DELAY_SECONDS = 5;
    public static final String SHARED_PREFS_USE_NEW_UI_KEY = "USE_NEW_UI";
    public static final String SHARED_PREFS_LAST_HEARTBEAT_MS_KEY = "LAST_HEARTBEAT_MS";
    public static final String SHARED_PREFS_LAST_REPORTED_SETTINGS_KEY = "LAST_REPORTED_SETTINGS";
    public static final String SHARED_PREFS_LAST_TRIGGERED_SETTINGS_KEY = "LAST_TRIGGERED_SETTINGS";
    public static final String SHARED_PREFS_LAST_TRIGGERED_SETTINGS_AT_KEY = "LAST_TRIGGERED_SETTINGS_AT";

    // Settings the server returns on every heartbeat
    public static final String SHARED_PREFS_CONFIG_SEND_SCHEDULER_V2_KEY = "CONFIG_SEND_SCHEDULER_V2_ENABLED";
    public static final String SHARED_PREFS_CONFIG_RECOVERY_POLL_KEY = "CONFIG_RECOVERY_POLL_ENABLED";
    public static final String SHARED_PREFS_CONFIG_UPDATE_NOTIFICATIONS_KEY = "CONFIG_UPDATE_NOTIFICATIONS_ENABLED";
    public static final String SHARED_PREFS_CONFIG_LATEST_VERSION_CODE_KEY = "CONFIG_LATEST_VERSION_CODE";
    public static final String SHARED_PREFS_CONFIG_LATEST_VERSION_NAME_KEY = "CONFIG_LATEST_VERSION_NAME";

    // Send pacing without sleeping inside a worker
    public static final String SHARED_PREFS_NEXT_SEND_SLOT_MS_KEY = "NEXT_SEND_SLOT_MS";
    public static final String SHARED_PREFS_LAST_SEND_RESERVED_AT_MS_KEY = "LAST_SEND_RESERVED_AT_MS";
    public static final String SHARED_PREFS_NEXT_SEND_EXEC_SLOT_MS_KEY = "NEXT_SEND_EXEC_SLOT_MS";
    public static final String SHARED_PREFS_LAST_SEND_EXEC_RESERVED_AT_MS_KEY = "LAST_SEND_EXEC_RESERVED_AT_MS";
    public static final String SHARED_PREFS_LAST_RECOVERY_POLL_MS_KEY = "LAST_RECOVERY_POLL_MS";
    public static final String SHARED_PREFS_LAST_UPDATE_NOTIFIED_VERSION_CODE_KEY = "LAST_UPDATE_NOTIFIED_VERSION_CODE";
    public static final String SHARED_PREFS_LAST_PERMISSION_NOTIFIED_AT_KEY = "LAST_PERMISSION_NOTIFIED_AT";
}
