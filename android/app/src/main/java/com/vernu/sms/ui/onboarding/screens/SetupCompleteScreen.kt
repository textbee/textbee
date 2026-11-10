package com.vernu.sms.ui.onboarding.screens

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.compose.animation.core.*
import com.vernu.sms.AppConstants
import com.vernu.sms.helpers.Diagnostics
import com.vernu.sms.helpers.HeartbeatManager
import com.vernu.sms.helpers.SharedPreferenceHelper
import com.vernu.sms.helpers.SmsPermissionHelp
import com.vernu.sms.ui.components.ReceiveSmsPermissionState
import com.vernu.sms.ui.components.RestrictedSettingsCard
import com.vernu.sms.ui.components.rememberReceiveSmsPermission
import com.vernu.sms.ui.theme.StatusColors
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ClipboardManager
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.vernu.sms.ui.onboarding.OnboardingViewModel

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SetupCompleteScreen(
    viewModel: OnboardingViewModel,
    onOpenDashboard: () -> Unit
) {
    val state by viewModel.state.collectAsState()
    val clipboardManager: ClipboardManager = LocalClipboardManager.current
    val context = LocalContext.current
    var receiveSmsEnabled by remember {
        mutableStateOf(
            SharedPreferenceHelper.getSharedPreferenceBoolean(
                context, AppConstants.SHARED_PREFS_RECEIVE_SMS_ENABLED_KEY, false
            )
        )
    }

    fun saveReceiveSms(enabled: Boolean) {
        receiveSmsEnabled = enabled
        SharedPreferenceHelper.setSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_RECEIVE_SMS_ENABLED_KEY, enabled
        )
        HeartbeatManager.triggerHeartbeat(context)
    }

    fun checkSendSms() =
        ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED

    var canSendSms by remember { mutableStateOf(checkSendSms()) }
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) canSendSms = checkSendSms()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val receivePermission = rememberReceiveSmsPermission()

    // The switch always saves. A missing permission only shows a warning.
    fun setReceiveSms(enabled: Boolean) {
        saveReceiveSms(enabled)
        Diagnostics.receiveToggled(context, enabled)
        if (enabled && canSendSms) receivePermission.requestIfAskable()
    }

    val canSendSmsAtStart = remember { canSendSms }
    LaunchedEffect(canSendSms) {
        if (canSendSms && !canSendSmsAtStart) SmsPermissionHelp.reportGranted(context)
    }

    val scale = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        scale.animateTo(
            targetValue = 1f,
            animationSpec = spring(
                dampingRatio = Spring.DampingRatioMediumBouncy,
                stiffness = Spring.StiffnessMedium
            )
        )
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(
            modifier = Modifier
                .size(96.dp)
                .scale(scale.value)
                .background(
                    if (canSendSms) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                    CircleShape
                ),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = if (canSendSms) Icons.Default.Check else Icons.Default.Warning,
                contentDescription = null,
                modifier = Modifier.size(48.dp),
                tint = Color.White
            )
        }

        Spacer(modifier = Modifier.height(32.dp))

        Text(
            text = if (canSendSms) "You're all set!" else "Your phone cannot send SMS yet",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = state.registeredDeviceName ?: "Your device",
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.primary
        )

        Spacer(modifier = Modifier.height(24.dp))

        if (!canSendSms) {
            RestrictedSettingsCard(
                title = "Allow the SMS permission",
                onOpenSettings = { SmsPermissionHelp.openAppSettings(context) },
                onOpenGuide = { SmsPermissionHelp.openGuide(context) }
            )
            Spacer(modifier = Modifier.height(12.dp))
        }

        state.registeredDeviceId?.let { deviceId ->
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                ),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = "Device ID",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = deviceId,
                            style = MaterialTheme.typography.bodyMedium,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier.weight(1f)
                        )
                        IconButton(
                            onClick = {
                                clipboardManager.setText(AnnotatedString(deviceId))
                            }
                        ) {
                            Icon(
                                Icons.Default.ContentCopy,
                                contentDescription = "Copy",
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
                        Text(
                            text = "Receive SMS",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = "See incoming SMS in your dashboard, API and webhooks.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Switch(
                        checked = receiveSmsEnabled,
                        onCheckedChange = { setReceiveSms(it) },
                        modifier = Modifier
                            .scale(0.75f)
                            .semantics { contentDescription = "Receive SMS" }
                    )
                }
                if (!receiveSmsEnabled) {
                    Spacer(modifier = Modifier.height(12.dp))
                    OutlinedButton(
                        onClick = { setReceiveSms(true) },
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Turn on receive SMS", style = MaterialTheme.typography.labelLarge)
                    }
                } else if (!receivePermission.granted) {
                    ReceiveSmsPermissionWarning(
                        permission = receivePermission,
                        canSendSms = canSendSms
                    )
                }
            }
        }

        if (!canSendSms) {
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "Your device is registered, but Android has not allowed the SMS permission. Messages fail until it is on.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
        }

        Spacer(modifier = Modifier.height(32.dp))

        Button(
            onClick = onOpenDashboard,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
        ) {
            Text("Go to dashboard", style = MaterialTheme.typography.labelLarge)
        }

        Spacer(modifier = Modifier.height(8.dp))

        // Wraps on narrow screens and large font sizes
        FlowRow(horizontalArrangement = Arrangement.Center) {
            FooterLink("Web dashboard", "https://app.textbee.dev/dashboard")
            FooterDot()
            FooterLink("Docs", "https://textbee.dev/docs")
            FooterDot()
            FooterLink("Star on GitHub", "https://github.com/textbee/textbee?ref=android-star")
        }
    }
    }
}

@Composable
private fun FooterLink(label: String, url: String) {
    val context = LocalContext.current
    TextButton(
        onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) },
        contentPadding = PaddingValues(horizontal = 4.dp)
    ) {
        Text(text = label, style = MaterialTheme.typography.bodySmall, maxLines = 1)
    }
}

@Composable
private fun FooterDot() {
    Box(
        modifier = Modifier
            .height(ButtonDefaults.MinHeight)
            .clearAndSetSemantics {},
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = "·",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun ReceiveSmsPermissionWarning(
    permission: ReceiveSmsPermissionState,
    canSendSms: Boolean
) {
    val context = LocalContext.current
    Spacer(modifier = Modifier.height(12.dp))
    Divider(color = MaterialTheme.colorScheme.outline)
    Spacer(modifier = Modifier.height(12.dp))
    Row {
        Icon(
            Icons.Default.Warning,
            contentDescription = null,
            tint = StatusColors.warning,
            modifier = Modifier.size(16.dp)
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(
            text = if (canSendSms)
                "Android has not allowed the SMS permission yet. Nothing forwards until it is allowed."
            else
                "Allow the SMS permission above to start receiving.",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.weight(1f)
        )
    }
    // Without the send permission, the card at the top of the screen has the steps
    if (!canSendSms) return
    Spacer(modifier = Modifier.height(12.dp))
    OutlinedButton(
        onClick = {
            if (permission.blocked) SmsPermissionHelp.openAppSettings(context) else permission.request()
        },
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary),
        modifier = Modifier.fillMaxWidth()
    ) {
        Text(
            text = if (permission.blocked) "Open app settings" else "Allow SMS permission",
            style = MaterialTheme.typography.labelLarge
        )
    }
    if (permission.blocked) {
        TextButton(
            onClick = { SmsPermissionHelp.openGuide(context) },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Show me with screenshots")
        }
    }
}
