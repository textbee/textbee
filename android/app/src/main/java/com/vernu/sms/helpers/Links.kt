package com.vernu.sms.helpers

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast

// Opens web links. A phone that cannot open one gets a short message.
object Links {
    fun open(context: Context, url: String): Boolean = try {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        if (context !is Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        true
    } catch (e: ActivityNotFoundException) {
        notOpened(context)
    } catch (e: SecurityException) {
        // Some phones have a browser entry that other apps may not start
        notOpened(context)
    }

    private fun notOpened(context: Context): Boolean {
        Toast.makeText(context, "Could not open the link. Check that a web browser is installed.", Toast.LENGTH_LONG).show()
        return false
    }
}
