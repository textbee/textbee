package com.vernu.sms.ui.onboarding.screens

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.compose.animation.core.*
import com.vernu.sms.AppConstants
import com.vernu.sms.helpers.HeartbeatManager
import com.vernu.sms.helpers.SharedPreferenceHelper
import com.vernu.sms.helpers.SmsPermissionHelp
import com.vernu.sms.ui.components.RestrictedSettingsCard
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
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.vernu.sms.ui.onboarding.OnboardingViewModel

@Composable
fun SetupCompleteScreen(
    viewModel: OnboardingViewModel,
    onOpenDashboard: () -> Unit
) {
    val state by viewModel.state.collectAsState()
    val clipboardManager: ClipboardManager = LocalClipboardManager.current
    val context = LocalContext.current
    var receiveSmsEnabled by remember { mutableStateOf(true) }

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
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Keep this handy. You will need it for API calls and managing devices in your dashboard.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
        ) {
            Row(
                modifier = Modifier.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
                    Text(
                        text = "Forward received SMS",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold
                    )
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = "SMS you receive on this phone will appear in your textbee dashboard and be accessible via API",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Switch(
                    checked = receiveSmsEnabled,
                    onCheckedChange = { enabled ->
                        receiveSmsEnabled = enabled
                        SharedPreferenceHelper.setSharedPreferenceBoolean(
                            context,
                            AppConstants.SHARED_PREFS_RECEIVE_SMS_ENABLED_KEY,
                            enabled
                        )
                        HeartbeatManager.triggerHeartbeat(context)
                    },
                    modifier = Modifier.scale(0.75f)
                )
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = if (canSendSms)
                "Your device is registered and ready. Head to your dashboard to send your first SMS or connect via API."
            else
                "Your device is registered, but Android has not allowed the SMS permission. Messages fail until it is on.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(32.dp))

        Button(
            onClick = onOpenDashboard,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
        ) {
            Text("Open App Dashboard", style = MaterialTheme.typography.labelLarge)
        }

        Spacer(modifier = Modifier.height(12.dp))

        OutlinedButton(
            onClick = {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, Uri.parse("https://app.textbee.dev/dashboard"))
                )
            },
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
        ) {
            Text("Open Web Dashboard", style = MaterialTheme.typography.labelLarge)
        }

        Spacer(modifier = Modifier.height(8.dp))

        TextButton(
            onClick = {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, Uri.parse("https://textbee.dev/docs"))
                )
            }
        ) {
            Text(
                text = "New to textbee? Read the quickstart guide",
                style = MaterialTheme.typography.bodySmall
            )
        }

        TextButton(
            onClick = {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/textbee/textbee?ref=android-star"))
                )
            }
        ) {
            Text(
                text = "textbee is open source. Star it on GitHub.",
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
    }
}
