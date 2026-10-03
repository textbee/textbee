package com.vernu.sms.ui.dashboard

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vernu.sms.R
import com.vernu.sms.dtos.SimInfoDTO
import com.vernu.sms.dtos.SubscriptionResponse
import com.vernu.sms.dtos.UserProfile
import com.vernu.sms.helpers.SmsPermissionHelp
import com.vernu.sms.ui.components.RestrictedSettingsSteps
import com.vernu.sms.ui.theme.StatusColors
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

private val REQUIRED_PERMISSIONS = listOf(
    Manifest.permission.SEND_SMS,
    Manifest.permission.RECEIVE_SMS,
    Manifest.permission.READ_PHONE_STATE
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    viewModel: DashboardViewModel = viewModel()
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current

    LaunchedEffect(state.userMessage) {
        state.userMessage?.let { message ->
            Toast.makeText(context, message, Toast.LENGTH_LONG).show()
            viewModel.consumeUserMessage()
        }
    }

    fun checkMissingPermissions() = REQUIRED_PERMISSIONS.filter {
        ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
    }

    var missingPermissions by remember { mutableStateOf(checkMissingPermissions()) }
    var permissionsDenied by remember { mutableStateOf(false) }
    val sendSmsMissing = Manifest.permission.SEND_SMS in missingPermissions
    val sendSmsMissingAtStart = remember { sendSmsMissing }
    LaunchedEffect(sendSmsMissing) {
        if (!sendSmsMissing && sendSmsMissingAtStart) SmsPermissionHelp.reportGranted(context)
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        val stillMissing = checkMissingPermissions()
        missingPermissions = stillMissing
        if (stillMissing.isNotEmpty()) permissionsDenied = true
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                missingPermissions = checkMissingPermissions()
                if (missingPermissions.isEmpty()) permissionsDenied = false
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Image(
                            painter = painterResource(id = R.drawable.ic_app_logo),
                            contentDescription = null,
                            modifier = Modifier.size(28.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Column {
                            Text(
                                text = "textbee.dev",
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.primary
                            )
                            val greeting = state.userProfile?.name?.takeIf { it.isNotBlank() }
                                ?: state.userProfile?.email?.takeIf { it.isNotBlank() }
                            if (greeting != null) {
                                Text(
                                    text = "Hello, $greeting",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.refresh() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Spacer(modifier = Modifier.height(4.dp))
            if (missingPermissions.isNotEmpty()) {
                PermissionWarningCard(
                    missingPermissions = missingPermissions,
                    showOpenSettings = permissionsDenied,
                    showRestrictedSteps = Manifest.permission.SEND_SMS in missingPermissions && permissionsDenied,
                    onGrant = { permissionLauncher.launch(missingPermissions.toTypedArray()) },
                    onOpenSettings = { SmsPermissionHelp.openAppSettings(context) },
                    onOpenGuide = { SmsPermissionHelp.openGuide(context) }
                )
            }
            DeviceStatusCard(
                state = state,
                onToggle = { viewModel.toggleGateway(it) },
                onReceiveSmsToggle = { viewModel.setReceiveSms(it) }
            )
            SubscriptionCard(
                subscription = state.subscription,
                isLoading = state.isSubscriptionLoading,
                unavailable = state.subscriptionUnavailable
            )
            QuickActionsSection()
            Spacer(modifier = Modifier.height(8.dp))
        }
    }
}

@Composable
private fun DeviceStatusCard(
    state: DashboardState,
    onToggle: (Boolean) -> Unit,
    onReceiveSmsToggle: (Boolean) -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            DeviceIdentityHeader(deviceName = state.deviceName, deviceId = state.deviceId)

            Spacer(modifier = Modifier.height(16.dp))
            GatewayStatusStrip(
                enabled = state.isGatewayEnabled,
                busy = state.isTogglingGateway,
                onToggle = onToggle
            )

            Spacer(modifier = Modifier.height(16.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f).padding(end = 8.dp)) {
                    Text(
                        text = "Receive SMS",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = "Received messages appear in your dashboard and API",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
                    )
                }
                Switch(
                    checked = state.isReceiveSmsEnabled,
                    onCheckedChange = onReceiveSmsToggle,
                    modifier = Modifier
                        .scale(0.75f)
                        .semantics { contentDescription = "Receive SMS" }
                )
            }
            if (state.availableSims.isNotEmpty()) {
                SimCardsSection(sims = state.availableSims)
            }
        }
    }
}

/** Device name, model and id as one compact block anchored by a device icon. */
@Composable
private fun DeviceIdentityHeader(deviceName: String, deviceId: String) {
    val hardwareModel = "${Build.BRAND.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"
    val customName = deviceName.trim()
    val displayName = customName.ifEmpty { hardwareModel }
    val showModel = customName.isNotEmpty() &&
                    customName.lowercase() != hardwareModel.lowercase()

    Row(modifier = Modifier.fillMaxWidth()) {
        Surface(
            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
            shape = MaterialTheme.shapes.medium,
            modifier = Modifier.size(44.dp)
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Default.PhoneAndroid,
                    contentDescription = null,
                    modifier = Modifier.size(22.dp),
                    tint = MaterialTheme.colorScheme.primary
                )
            }
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = displayName,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            if (showModel) {
                Text(
                    text = hardwareModel,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (deviceId.isNotEmpty()) {
                Spacer(modifier = Modifier.height(6.dp))
                DeviceIdChip(deviceId = deviceId)
            }
        }
    }
}

/** Tap target for the device id. A chip keeps it one line tall, unlike an icon button. */
@Composable
private fun DeviceIdChip(deviceId: String) {
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    val shape = MaterialTheme.shapes.small
    val tint = MaterialTheme.colorScheme.onSurfaceVariant

    Surface(
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.06f),
        shape = shape,
        modifier = Modifier
            .clip(shape)
            .clickable {
                clipboard.setText(AnnotatedString(deviceId))
                Toast.makeText(context, "Device ID copied", Toast.LENGTH_SHORT).show()
            }
            .semantics { contentDescription = "Copy device ID" }
    ) {
        Row(
            modifier = Modifier
                .heightIn(min = 32.dp)
                .padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = deviceId,
                style = MaterialTheme.typography.labelSmall,
                fontFamily = FontFamily.Monospace,
                color = tint,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false)
            )
            Spacer(modifier = Modifier.width(6.dp))
            Icon(
                Icons.Default.ContentCopy,
                contentDescription = null,
                modifier = Modifier.size(13.dp),
                tint = tint
            )
        }
    }
}

/**
 * The gateway state and the switch that changes it, in one bounded strip. The
 * bounds are what stop the label from being read against the row below it, and
 * the copy avoids the word receive for the same reason.
 */
@Composable
private fun GatewayStatusStrip(
    enabled: Boolean,
    busy: Boolean,
    onToggle: (Boolean) -> Unit
) {
    val statusColor = if (enabled) StatusColors.success
                      else MaterialTheme.colorScheme.onSurfaceVariant
    val statusText = if (enabled) "Gateway enabled" else "Gateway disabled"
    val statusDetail = if (enabled) "This phone is connected and ready."
                       else "This phone is not handling messages."

    Surface(
        color = statusColor.copy(alpha = 0.12f),
        shape = MaterialTheme.shapes.medium,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(start = 14.dp, end = 10.dp, top = 12.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .background(statusColor, CircleShape)
            )
            Spacer(modifier = Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f).padding(end = 8.dp)) {
                Text(
                    text = statusText,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = statusColor
                )
                Text(
                    text = statusDetail,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Switch(
                checked = enabled,
                onCheckedChange = onToggle,
                enabled = !busy,
                modifier = Modifier.semantics { contentDescription = "Gateway" }
            )
        }
    }
}

@Composable
private fun PermissionWarningCard(
    missingPermissions: List<String>,
    showOpenSettings: Boolean,
    showRestrictedSteps: Boolean,
    onGrant: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenGuide: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.Warning,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Permissions Required",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onErrorContainer
                )
            }
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = "The gateway won't work without: ${missingPermissions.joinToString { friendlyPermissionName(it) }}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onErrorContainer
            )
            if (showRestrictedSteps) {
                Spacer(modifier = Modifier.height(8.dp))
                RestrictedSettingsSteps()
            }
            Spacer(modifier = Modifier.height(12.dp))
            Button(
                onClick = if (showOpenSettings || showRestrictedSteps) onOpenSettings else onGrant,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.error,
                    contentColor = MaterialTheme.colorScheme.onError
                )
            ) {
                Text(if (showOpenSettings || showRestrictedSteps) "Open app settings" else "Grant Permissions")
            }
            if (showRestrictedSteps) {
                TextButton(
                    onClick = onOpenGuide,
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.onErrorContainer)
                ) {
                    Text("Show me with screenshots")
                }
            }
        }
    }
}

private fun friendlyPermissionName(permission: String) = when (permission) {
    Manifest.permission.SEND_SMS -> "Send SMS"
    Manifest.permission.RECEIVE_SMS -> "Receive SMS"
    Manifest.permission.READ_PHONE_STATE -> "Phone State"
    else -> permission.substringAfterLast(".")
}

@Composable
private fun SimCardsSection(sims: List<SimInfoDTO>) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current

    Divider(modifier = Modifier.padding(top = 10.dp, bottom = 2.dp))
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = "SIM Cards",
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = "simSubscriptionId",
            style = MaterialTheme.typography.labelSmall,
            fontFamily = FontFamily.Monospace,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
        )
    }
    sims.forEach { sim ->
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "SIM ${(sim.simSlotIndex ?: 0) + 1} · ${sim.carrierName ?: sim.displayName ?: "Unknown"}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f)
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = sim.subscriptionId.toString(),
                    style = MaterialTheme.typography.labelSmall,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                IconButton(
                    onClick = {
                        clipboard.setText(AnnotatedString(sim.subscriptionId.toString()))
                        Toast.makeText(context, "Subscription ID copied", Toast.LENGTH_SHORT).show()
                    },
                    modifier = Modifier.size(28.dp)
                ) {
                    Icon(
                        Icons.Default.ContentCopy,
                        contentDescription = "Copy subscription ID",
                        modifier = Modifier.size(13.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

@Composable
private fun SubscriptionCard(
    subscription: SubscriptionResponse?,
    isLoading: Boolean,
    unavailable: Boolean
) {
    val context = LocalContext.current

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        when {
            isLoading -> {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(24.dp),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(24.dp))
                }
            }
            unavailable || subscription == null -> {
                // silently hide rather than show an error card
            }
            else -> {
                Column(modifier = Modifier.padding(20.dp)) {
                    val planName = subscription.plan?.name?.uppercase() ?: "FREE"
                    val isFree = subscription.plan?.name?.lowercase() == "free" ||
                                 subscription.plan?.name == null

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text(
                                text = "Subscription",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Surface(
                                color = if (isFree) MaterialTheme.colorScheme.surfaceVariant
                                        else MaterialTheme.colorScheme.primary.copy(alpha = 0.15f),
                                shape = MaterialTheme.shapes.small
                            ) {
                                Text(
                                    text = planName,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold,
                                    color = if (isFree) MaterialTheme.colorScheme.onSurfaceVariant
                                            else MaterialTheme.colorScheme.primary
                                )
                            }
                        }
                        if (isFree) {
                            OutlinedButton(
                                onClick = {
                                    context.startActivity(
                                        Intent(Intent.ACTION_VIEW, Uri.parse("https://textbee.dev/pricing?ref=android-dashboard"))
                                    )
                                }
                            ) {
                                Text("Upgrade")
                            }
                        } else {
                            TextButton(
                                onClick = {
                                    context.startActivity(
                                        Intent(Intent.ACTION_VIEW, Uri.parse("https://app.textbee.dev/dashboard/account"))
                                    )
                                }
                            ) {
                                Text("Manage")
                            }
                        }
                    }

                    if (isFree) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = "Unlock higher limits, more devices & priority support",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    } else {
                        subscription.usage?.let { usage ->
                            Spacer(modifier = Modifier.height(16.dp))
                            UsageRow(
                                label = "Today",
                                used = usage.processedSmsToday,
                                limit = usage.dailyLimit,
                                pct = usage.dailyUsagePercentage
                            )
                            Spacer(modifier = Modifier.height(10.dp))
                            UsageRow(
                                label = "This month",
                                used = usage.processedSmsLastMonth,
                                limit = usage.monthlyLimit,
                                pct = usage.monthlyUsagePercentage
                            )
                        }

                        subscription.currentPeriodEnd?.let { dateStr ->
                            formatDate(dateStr)?.let { formatted ->
                                Spacer(modifier = Modifier.height(12.dp))
                                Text(
                                    text = "Renews $formatted",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun UsageRow(label: String, used: Int?, limit: Int?, pct: Int?) {
    val isUnlimited = limit == -1
    val progress = if (isUnlimited || limit == null || limit == 0) 0f
                   else (pct ?: 0).coerceIn(0, 100) / 100f

    Column {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(text = label, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                text = if (isUnlimited) "${used ?: 0} / Unlimited"
                       else "${used ?: 0} / ${limit ?: "—"}",
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Medium
            )
        }
        Spacer(modifier = Modifier.height(4.dp))
        if (!isUnlimited && limit != null && limit > 0) {
            LinearProgressIndicator(
                progress = progress,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(6.dp),
                color = if (progress > 0.8f) MaterialTheme.colorScheme.error
                        else MaterialTheme.colorScheme.primary,
                trackColor = MaterialTheme.colorScheme.surfaceVariant
            )
        }
    }
}

@Composable
private fun QuickActionsSection() {
    val context = LocalContext.current

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = "Quick Actions",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            OutlinedButton(
                onClick = {
                    context.startActivity(
                        Intent(Intent.ACTION_VIEW, Uri.parse("https://app.textbee.dev/dashboard"))
                    )
                },
                modifier = Modifier.weight(1f)
            ) {
                Icon(Icons.Default.OpenInBrowser, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(6.dp))
                Text("Dashboard")
            }
            OutlinedButton(
                onClick = {
                    context.startActivity(
                        Intent(Intent.ACTION_VIEW, Uri.parse("https://textbee.dev/docs"))
                    )
                },
                modifier = Modifier.weight(1f)
            ) {
                Icon(Icons.Default.MenuBook, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(6.dp))
                Text("Explore Docs")
            }
        }
    }
}

private fun formatDate(isoDate: String): String? {
    return try {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        val date = sdf.parse(isoDate.take(19)) ?: return null
        SimpleDateFormat("MMM d, yyyy", Locale.getDefault()).format(date)
    } catch (e: Exception) {
        null
    }
}
