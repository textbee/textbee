package com.vernu.sms.ui.dashboard

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vernu.sms.R
import com.vernu.sms.dtos.SimInfoDTO
import com.vernu.sms.dtos.SubscriptionResponse
import com.vernu.sms.dtos.UserProfile
import com.vernu.sms.helpers.AppNotice
import com.vernu.sms.helpers.Links
import com.vernu.sms.helpers.NoticeAction
import com.vernu.sms.helpers.NoticeLevel
import com.vernu.sms.helpers.SimReport
import com.vernu.sms.helpers.SmsPermissionHelp
import com.vernu.sms.ui.components.RestrictedSettingsSteps
import com.vernu.sms.ui.onboarding.OnboardingActivity
import com.vernu.sms.ui.theme.StatusColors
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    onNavigateToHealth: () -> Unit = {},
    viewModel: DashboardViewModel = viewModel()
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current

    // A notice can expire while the app is in the background
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) viewModel.loadBanners()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    LaunchedEffect(state.userMessage) {
        state.userMessage?.let { message ->
            Toast.makeText(context, message, Toast.LENGTH_LONG).show()
            viewModel.consumeUserMessage()
        }
    }

    val permissions = rememberPermissionBanners(state.isReceiveSmsEnabled)

    fun openAddApiKey() = context.startActivity(OnboardingActivity.addApiKeyIntent(context))

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
            val notices = state.notices
            // Emits nothing when no banner shows, so the screen stays as it was
            if (state.isApiKeyRejected || permissions.hasRed || notices.isNotEmpty() || permissions.hasAmber) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (state.isApiKeyRejected) {
                        DashboardBanner(
                            tone = BannerTone.ERROR,
                            title = null,
                            lines = listOf("The API key of this device no longer works. textbee cannot report or receive messages."),
                            actionLabel = "Add API key",
                            onAction = { openAddApiKey() }
                        )
                    }
                    RedPermissionCard(permissions)
                    notices.forEach { notice ->
                        key(notice.id) {
                            NoticeBanner(
                                notice = notice,
                                onClose = { viewModel.closeNotice(notice.id) },
                                onOpenDeviceHealth = onNavigateToHealth
                            )
                        }
                    }
                    AmberPermissionCard(permissions)
                }
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

/** Outlined phone glyph with no padding, so it can match the height of the text beside it. */
private val TallPhoneOutline: ImageVector = ImageVector.Builder(
    name = "TallPhoneOutline",
    defaultWidth = 14.dp,
    defaultHeight = 22.dp,
    viewportWidth = 14f,
    viewportHeight = 22f
).addPath(
    pathData = addPathNodes(
        "M11 0H3C1.34 0 0 1.34 0 3v16c0 1.66 1.34 3 3 3h8c1.66 0 3-1.34 3-3V3c0-1.66-1.34-3-3-3z" +
        "m1.5 19c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5h8" +
        "c.83 0 1.5.67 1.5 1.5v16zM5.5 18h3v1h-3z"
    ),
    fill = SolidColor(Color.Black)
).build()

/** Device name, model and id as one compact block anchored by a device icon. */
@Composable
private fun DeviceIdentityHeader(deviceName: String, deviceId: String) {
    val hardwareModel = "${Build.BRAND.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"
    val customName = deviceName.trim()
    val displayName = customName.ifEmpty { hardwareModel }
    val showModel = customName.isNotEmpty() &&
                    customName.lowercase() != hardwareModel.lowercase()

    // Intrinsic height lets the icon span the full text block, device ID included.
    Row(modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        Icon(
            imageVector = TallPhoneOutline,
            contentDescription = null,
            modifier = Modifier
                .width(51.dp)
                .fillMaxHeight(),
            tint = MaterialTheme.colorScheme.primary
        )
        Spacer(modifier = Modifier.width(14.dp))
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

internal enum class BannerTone { ERROR, WARNING, NEUTRAL }

// The card style of the permission warning, in red, amber or neutral
@Composable
internal fun DashboardBanner(
    tone: BannerTone,
    title: String?,
    lines: List<String>,
    actionLabel: String?,
    onAction: () -> Unit,
    onClose: (() -> Unit)? = null,
    filledAction: Boolean = true,
    steps: Boolean = false,
    onOpenGuide: () -> Unit = {}
) {
    var stepsShown by rememberSaveable { mutableStateOf(false) }
    val surface = MaterialTheme.colorScheme.surface
    val accent = when (tone) {
        BannerTone.ERROR -> MaterialTheme.colorScheme.error
        BannerTone.WARNING -> StatusColors.warning
        BannerTone.NEUTRAL -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val container = if (tone == BannerTone.ERROR) MaterialTheme.colorScheme.errorContainer
                    else accent.copy(alpha = 0.12f).compositeOver(surface)
    val content = if (tone == BannerTone.ERROR) MaterialTheme.colorScheme.onErrorContainer
                  else MaterialTheme.colorScheme.onSurface
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = container),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (tone == BannerTone.NEUTRAL) Icons.Default.Info else Icons.Default.Warning,
                    contentDescription = when (tone) {
                        BannerTone.ERROR -> "Error"
                        BannerTone.WARNING -> "Warning"
                        BannerTone.NEUTRAL -> null
                    },
                    tint = accent,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                // With no title, the first line sits beside the icon
                Text(
                    text = title ?: lines.firstOrNull().orEmpty(),
                    style = if (title != null) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodySmall,
                    fontWeight = if (title != null) FontWeight.SemiBold else null,
                    color = content,
                    modifier = Modifier.weight(1f)
                )
                if (onClose != null) {
                    // Takes 20 dp in the row; the touch target spreads to 48 dp around it
                    Box(modifier = Modifier.size(20.dp).wrapContentSize(unbounded = true)) {
                        IconButton(onClick = onClose, modifier = Modifier.size(48.dp)) {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = "Close",
                                tint = content,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }
                }
            }
            (if (title != null) lines else lines.drop(1)).forEach { line ->
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = line,
                    style = MaterialTheme.typography.bodySmall,
                    color = content
                )
            }
            // Collapsed by default, so the card stays short
            if (steps && stepsShown) {
                Spacer(modifier = Modifier.height(8.dp))
                RestrictedSettingsSteps()
            }
            if (actionLabel != null && filledAction) {
                Spacer(modifier = Modifier.height(12.dp))
                Button(
                    onClick = onAction,
                    colors = ButtonDefaults.buttonColors(containerColor = accent, contentColor = MaterialTheme.colorScheme.onError)
                ) {
                    Text(actionLabel)
                }
            } else if (actionLabel != null) {
                Spacer(modifier = Modifier.height(4.dp))
                TextButton(onClick = onAction, contentPadding = PaddingValues(0.dp)) {
                    Text(actionLabel)
                }
            }
            if (steps) {
                Row {
                    TextButton(
                        onClick = { stepsShown = !stepsShown },
                        colors = ButtonDefaults.textButtonColors(contentColor = content)
                    ) {
                        Text(if (stepsShown) "Hide steps" else "Show steps")
                    }
                    if (stepsShown) {
                        TextButton(
                            onClick = onOpenGuide,
                            colors = ButtonDefaults.textButtonColors(contentColor = content)
                        ) {
                            Text("Show me with screenshots")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NoticeBanner(notice: AppNotice, onClose: () -> Unit, onOpenDeviceHealth: () -> Unit) {
    val context = LocalContext.current
    fun open(intent: Intent) = try {
        context.startActivity(intent)
    } catch (e: Exception) {
        Toast.makeText(context, "Could not open the link", Toast.LENGTH_SHORT).show()
    }
    DashboardBanner(
        tone = when (notice.level) {
            NoticeLevel.ERROR -> BannerTone.ERROR
            NoticeLevel.WARNING -> BannerTone.WARNING
            NoticeLevel.INFO -> BannerTone.NEUTRAL
        },
        title = notice.title,
        lines = listOf(notice.text),
        actionLabel = notice.actionLabel?.takeIf { notice.action != null },
        onAction = {
            when (val action = notice.action) {
                is NoticeAction.Web -> open(
                    Intent(Intent.ACTION_VIEW, Uri.parse(action.url)).addCategory(Intent.CATEGORY_BROWSABLE)
                )
                NoticeAction.DeviceHealth -> onOpenDeviceHealth()
                NoticeAction.AddApiKey -> open(OnboardingActivity.addApiKeyIntent(context))
                NoticeAction.BatterySettings -> try {
                    context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                } catch (e: Exception) {
                    // Some phones have no such screen, as on the Device health screen
                    SmsPermissionHelp.openAppSettings(context)
                }
                null -> Unit
            }
        },
        onClose = if (notice.dismissible) onClose else null,
        filledAction = false
    )
}


@Composable
private fun SimCardsSection(sims: List<SimInfoDTO>) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current

    Divider(modifier = Modifier.padding(top = 10.dp, bottom = 2.dp))
    Text(
        text = "SIM Cards",
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )
    sims.forEach { sim ->
        val slot = SimReport.usableSlotIndex(sim.simSlotIndex)
        val subscriptionId = sim.subscriptionId.toString()
        // The id is still accepted, so it stays reachable without taking room
        val copySubscriptionId = {
            clipboard.setText(AnnotatedString(subscriptionId))
            Toast.makeText(context, "Subscription ID copied (older option)", Toast.LENGTH_SHORT).show()
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .pointerInput(subscriptionId) {
                    detectTapGestures(onLongPress = { copySubscriptionId() })
                }
                .semantics {
                    onLongClick(label = "Copy subscription ID") {
                        copySubscriptionId()
                        true
                    }
                },
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
                    // Key and value together, so a bare number never sits next to "SIM 1"
                    text = if (slot != null) "simSlotIndex: $slot" else subscriptionId,
                    style = MaterialTheme.typography.labelSmall,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                IconButton(
                    onClick = {
                        if (slot != null) {
                            clipboard.setText(AnnotatedString(SimReport.slotRequestField(slot)))
                            Toast.makeText(context, "Copied for SIM ${slot + 1}", Toast.LENGTH_SHORT).show()
                        } else {
                            clipboard.setText(AnnotatedString(subscriptionId))
                            Toast.makeText(context, "Subscription ID copied", Toast.LENGTH_SHORT).show()
                        }
                    },
                    modifier = Modifier.size(28.dp)
                ) {
                    Icon(
                        Icons.Default.ContentCopy,
                        contentDescription = if (slot != null) "Copy simSlotIndex" else "Copy subscription ID",
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
                                    Links.open(context, "https://textbee.dev/pricing?ref=android-dashboard")
                                }
                            ) {
                                Text("Upgrade")
                            }
                        } else {
                            TextButton(
                                onClick = {
                                    Links.open(context, "https://app.textbee.dev/dashboard/account")
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
                    Links.open(context, "https://app.textbee.dev/dashboard")
                },
                modifier = Modifier.weight(1f)
            ) {
                Icon(Icons.Default.OpenInBrowser, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(6.dp))
                Text("Dashboard")
            }
            OutlinedButton(
                onClick = {
                    Links.open(context, "https://textbee.dev/docs")
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
