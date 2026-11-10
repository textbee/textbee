package com.vernu.sms.ui.components

import android.Manifest
import android.content.pm.PackageManager
import android.os.SystemClock
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.vernu.sms.helpers.HeartbeatManager
import com.vernu.sms.helpers.SmsPermissionHelp

private const val INSTANT_DENIAL_MS = 400L

class ReceiveSmsPermissionState(
    val granted: Boolean,
    // Android no longer shows the dialog, so only the app settings can allow it
    val blocked: Boolean,
    // For a tap on a fix action: asks, or opens the app settings when Android shows no dialog
    val request: () -> Unit,
    private val requestQuietly: () -> Unit
) {
    // For the switch: asks once, and never leaves the screen
    fun requestIfAskable() {
        if (!granted && !blocked) requestQuietly()
    }
}

@Composable
fun rememberReceiveSmsPermission(): ReceiveSmsPermissionState {
    val context = LocalContext.current
    val activity = remember(context) { SmsPermissionHelp.findActivity(context) }

    fun check() = ContextCompat.checkSelfPermission(
        context, Manifest.permission.RECEIVE_SMS
    ) == PackageManager.PERMISSION_GRANTED

    var granted by remember { mutableStateOf(check()) }
    var requested by rememberSaveable { mutableStateOf(false) }
    // Bumped after each request and resume, so the blocked state is read again
    var checks by remember { mutableStateOf(0) }
    var launchedAt by rememberSaveable { mutableStateOf(0L) }
    var settingsOnInstantDenial by rememberSaveable { mutableStateOf(false) }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { result ->
        granted = result
        // Set after the dialog closes, so the blocked state is not read while it is open
        requested = true
        checks++
        // An instant denial means Android showed no dialog, so go to the app settings in the same tap
        val instant = SystemClock.elapsedRealtime() - launchedAt < INSTANT_DENIAL_MS
        if (!result && instant && settingsOnInstantDenial && !SmsPermissionHelp.canShowRationale(activity, Manifest.permission.RECEIVE_SMS)) {
            SmsPermissionHelp.openAppSettings(context)
        }
    }

    fun launch(openSettingsOnInstantDenial: Boolean) {
        settingsOnInstantDenial = openSettingsOnInstantDenial
        launchedAt = SystemClock.elapsedRealtime()
        launcher.launch(Manifest.permission.RECEIVE_SMS)
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                granted = check()
                checks++
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val grantedAtStart = remember { granted }
    LaunchedEffect(granted) {
        if (granted && !grantedAtStart) HeartbeatManager.triggerHeartbeat(context)
    }

    val blocked = remember(granted, requested, checks) {
        SmsPermissionHelp.isBlocked(
            granted = granted,
            requestedBefore = requested,
            canShowRationale = SmsPermissionHelp.canShowRationale(activity, Manifest.permission.RECEIVE_SMS)
        )
    }

    return ReceiveSmsPermissionState(
        granted = granted,
        blocked = blocked,
        request = { launch(openSettingsOnInstantDenial = true) },
        requestQuietly = { launch(openSettingsOnInstantDenial = false) }
    )
}
