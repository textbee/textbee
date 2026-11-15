package com.vernu.sms.helpers

import android.content.Context
import android.content.SharedPreferences

object SharedPreferenceHelper {
    private const val PREF_FILE = "PREF"

    // For a screen that observes changes
    @JvmStatic
    fun preferences(context: Context): SharedPreferences = context.getSharedPreferences(PREF_FILE, 0)

    @JvmStatic
    fun setSharedPreferenceString(context: Context, key: String, value: String) {
        context.getSharedPreferences(PREF_FILE, 0).edit().putString(key, value).apply()
    }

    @JvmStatic
    fun setSharedPreferenceInt(context: Context, key: String, value: Int) {
        context.getSharedPreferences(PREF_FILE, 0).edit().putInt(key, value).apply()
    }

    // Written before it returns, for a caller that may be stopped right after
    @JvmStatic
    fun commitSharedPreferenceInt(context: Context, key: String, value: Int): Boolean =
        context.getSharedPreferences(PREF_FILE, 0).edit().putInt(key, value).commit()

    @JvmStatic
    fun setSharedPreferenceLong(context: Context, key: String, value: Long) {
        context.getSharedPreferences(PREF_FILE, 0).edit().putLong(key, value).apply()
    }

    @JvmStatic
    fun setSharedPreferenceBoolean(context: Context, key: String, value: Boolean) {
        context.getSharedPreferences(PREF_FILE, 0).edit().putBoolean(key, value).apply()
    }

    @JvmStatic
    fun getSharedPreferenceString(context: Context, key: String, defValue: String?): String? {
        return context.getSharedPreferences(PREF_FILE, 0).getString(key, defValue)
    }

    @JvmStatic
    fun getSharedPreferenceInt(context: Context, key: String, defValue: Int): Int {
        return context.getSharedPreferences(PREF_FILE, 0).getInt(key, defValue)
    }

    @JvmStatic
    fun getSharedPreferenceLong(context: Context, key: String, defValue: Long): Long {
        return context.getSharedPreferences(PREF_FILE, 0).getLong(key, defValue)
    }

    @JvmStatic
    fun getSharedPreferenceBoolean(context: Context, key: String, defValue: Boolean): Boolean {
        return context.getSharedPreferences(PREF_FILE, 0).getBoolean(key, defValue)
    }

    @JvmStatic
    fun clearSharedPreference(context: Context, key: String) {
        context.getSharedPreferences(PREF_FILE, 0).edit().remove(key).apply()
    }
}
