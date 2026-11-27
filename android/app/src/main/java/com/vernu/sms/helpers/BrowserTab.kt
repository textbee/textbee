package com.vernu.sms.helpers

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent

// Opens a page in a browser tab over the app, or in the plain browser when the browser has no tabs.
// Never an in-app web view: the page must share the browser's login.
object BrowserTab {
    /** False when no browser can open the page. */
    fun open(context: Context, url: String): Boolean = try {
        val tab = CustomTabsIntent.Builder().setShowTitle(true).build()
        if (context !is Activity) tab.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        tab.launchUrl(context, Uri.parse(url))
        true
    } catch (e: ActivityNotFoundException) {
        false
    } catch (e: SecurityException) {
        // Some phones have a browser entry that other apps may not start
        false
    }
}
