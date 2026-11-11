package com.vernu.sms.helpers

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.util.Log

// Claims messages when the network comes back. Registered once per process,
// from the Application, so it lives as long as the app does.
object NetworkDoorbell {
    private const val TAG = "NetworkDoorbell"

    @JvmStatic
    fun register(context: Context) {
        val appContext = context.applicationContext
        try {
            val cm = appContext.getSystemService(ConnectivityManager::class.java) ?: return
            cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    PullClient.claimNow(appContext, "network")
                }
            })
        } catch (e: Exception) {
            // The other doorbells still work
            Log.w(TAG, "Could not watch the network: ${e.message}")
        }
    }
}
