package com.vernu.sms.ui.settings

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vernu.sms.BuildConfig
import com.vernu.sms.helpers.Links
import com.vernu.sms.helpers.PreferredSim
import com.vernu.sms.helpers.SmsPermissionHelp
import com.vernu.sms.ui.components.rememberReceiveSmsPermission
import com.vernu.sms.ui.onboarding.OnboardingActivity

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onNavigateToFilters: () -> Unit,
    onNavigateToHealth: () -> Unit,
    onDisconnect: () -> Unit,
    viewModel: SettingsViewModel = viewModel()
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val snackbarHostState = remember { SnackbarHostState() }

    var showDisconnectDialog by remember { mutableStateOf(false) }
    var showAboutDialog by remember { mutableStateOf(false) }
    var showDeviceNameDialog by remember { mutableStateOf(false) }
    var editedDeviceName by remember(state.deviceName) { mutableStateOf(state.deviceName) }
    var showDelayDialog by remember { mutableStateOf(false) }
    var editedDelay by remember(state.smsSendDelaySeconds) { mutableStateOf(state.smsSendDelaySeconds.toString()) }

    LaunchedEffect(state.snackbarMessage) {
        state.snackbarMessage?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearSnackbar()
        }
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) viewModel.refresh()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val receivePermission = rememberReceiveSmsPermission()
    val receivePermissionMissing = state.isReceiveSmsEnabled && !receivePermission.granted

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Settings, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Settings", fontWeight = FontWeight.SemiBold)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
        ) {
            SettingsSectionHeader("Account")

            SettingsRow(
                icon = Icons.Default.Fingerprint,
                title = "Device ID",
                subtitle = state.deviceId.ifEmpty { "Not set" },
                subtitleFont = FontFamily.Monospace,
                trailing = {
                    IconButton(onClick = { clipboard.setText(AnnotatedString(state.deviceId)) }) {
                        Icon(Icons.Default.ContentCopy, contentDescription = "Copy", modifier = Modifier.size(18.dp))
                    }
                }
            )

            SettingsRow(
                icon = Icons.Default.Key,
                title = "API Key",
                subtitle = if (state.apiKey.isEmpty()) "Not set" else "••••••••" + state.apiKey.takeLast(4),
                trailing = {
                    IconButton(onClick = { clipboard.setText(AnnotatedString(state.apiKey)) }) {
                        Icon(Icons.Default.ContentCopy, contentDescription = "Copy", modifier = Modifier.size(18.dp))
                    }
                }
            )

            SettingsRow(
                icon = Icons.Default.Key,
                title = "Change API key",
                subtitle = if (state.isApiKeyRejected) "Not working. Tap to add a new key."
                    else "Use a different API key on this device",
                subtitleColor = if (state.isApiKeyRejected) MaterialTheme.colorScheme.error
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                onClick = { context.startActivity(OnboardingActivity.addApiKeyIntent(context)) },
                trailing = {
                    Icon(Icons.Default.ChevronRight, contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            )

            SettingsRow(
                icon = Icons.Default.Edit,
                title = "Device Name",
                subtitle = state.deviceName,
                onClick = {
                    editedDeviceName = state.deviceName
                    showDeviceNameDialog = true
                },
                trailing = {
                    if (state.isSavingDeviceName) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.ChevronRight, contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            )

            Divider(modifier = Modifier.padding(start = 56.dp))

            SettingsRow(
                icon = Icons.Default.LinkOff,
                title = "Disconnect Device",
                titleColor = MaterialTheme.colorScheme.error,
                onClick = { showDisconnectDialog = true }
            )

            SettingsSectionHeader("Gateway")

            SettingsSwitchRow(
                icon = Icons.Default.Power,
                title = "Gateway Enabled",
                subtitle = "Allow sending and receiving SMS",
                checked = state.isGatewayEnabled,
                onCheckedChange = { viewModel.setGatewayEnabled(it) }
            )

            // Also shown for a stored choice on a one-SIM phone, so it can be set back to the default
            if (state.availableSims.size > 1 || state.preferredSimSlot != PreferredSim.NONE) {
                SimSelectionRow(
                    sims = state.availableSims,
                    selectedSlot = state.preferredSimSlot,
                    onSelect = { viewModel.setPreferredSim(it) }
                )
                Text(
                    text = "Used when a request names no SIM. simSlotIndex in a request overrides it.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 56.dp, end = 16.dp, bottom = 8.dp)
                )
            }

            SettingsSectionHeader("SMS")

            SettingsSwitchRow(
                icon = Icons.Default.MoveToInbox,
                title = "Receive SMS",
                subtitle = if (receivePermissionMissing)
                    "Android has not allowed the SMS permission yet. Tap to fix."
                else
                    "Forward incoming SMS to backend",
                subtitleColor = if (receivePermissionMissing) MaterialTheme.colorScheme.error
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                checked = state.isReceiveSmsEnabled,
                // The switch always saves. A missing permission only shows a warning.
                onCheckedChange = {
                    viewModel.setReceiveSms(it)
                    if (it) receivePermission.requestIfAskable()
                },
                onClick = if (receivePermissionMissing) {
                    {
                        if (receivePermission.blocked) SmsPermissionHelp.openAppSettings(context)
                        else receivePermission.request()
                    }
                } else null
            )

            SettingsRow(
                icon = Icons.Default.Timer,
                title = "Send Delay",
                subtitle = "${state.smsSendDelaySeconds}s between each SMS",
                onClick = {
                    editedDelay = state.smsSendDelaySeconds.toString()
                    showDelayDialog = true
                },
                trailing = {
                    Icon(Icons.Default.ChevronRight, contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            )

            SettingsRow(
                icon = Icons.Default.FilterList,
                title = "Configure Filters",
                subtitle = "Allow/block list for incoming SMS",
                onClick = onNavigateToFilters,
                trailing = {
                    Icon(Icons.Default.ChevronRight, contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            )

            SettingsSectionHeader("System")

            SettingsRow(
                icon = Icons.Default.HealthAndSafety,
                title = "Device health",
                subtitle = when (state.healthIssueCount) {
                    0 -> "All checks pass"
                    1 -> "1 item to check"
                    else -> "${state.healthIssueCount} items to check"
                },
                onClick = onNavigateToHealth,
                trailing = {
                    Icon(Icons.Default.ChevronRight, contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            )

            SettingsSwitchRow(
                icon = Icons.Default.NotificationsActive,
                title = "Sticky Notification",
                subtitle = "Keeps the gateway alive in the background",
                checked = state.isStickyNotificationEnabled,
                onCheckedChange = { viewModel.setStickyNotification(it) }
            )

            SettingsRow(
                icon = Icons.Default.Info,
                title = "App Version",
                subtitle = "${state.appVersionName} (Build ${state.appVersionCode})"
            )

            SettingsRow(
                icon = Icons.Default.AutoAwesome,
                title = "About",
                subtitle = "textbee.dev",
                onClick = { showAboutDialog = true },
                trailing = {
                    Icon(Icons.Default.ChevronRight, contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            )

            SettingsRow(
                icon = Icons.Default.SystemUpdate,
                title = "Check for Updates",
                onClick = {
                    val versionInfo = "${BuildConfig.VERSION_NAME}(${BuildConfig.VERSION_CODE})"
                    val url = "https://textbee.dev/download?currentVersion=${Uri.encode(versionInfo)}"
                    Links.open(context, url)
                },
                trailing = {
                    Icon(Icons.Default.OpenInBrowser, contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                }
            )

            SettingsSectionHeader("Community")

            SettingsRow(
                icon = Icons.Default.SupportAgent,
                title = "Get Support",
                onClick = {
                    Links.open(context, "https://app.textbee.dev/dashboard/account/get-support")
                },
                trailing = {
                    Icon(Icons.Default.OpenInBrowser, contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                }
            )

            SettingsRow(
                icon = Icons.Default.Forum,
                title = "Join our Discord",
                subtitle = "Get help from the community",
                onClick = {
                    Links.open(context, "https://textbee.dev/discord")
                },
                trailing = {
                    Icon(Icons.Default.OpenInBrowser, contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                }
            )

            SettingsRow(
                icon = Icons.Default.Share,
                title = "Share textbee",
                subtitle = "Help spread the word",
                onClick = {
                    val shareText = "i've been using textbee.dev to send SMS via API from my own phone, " +
                        "no Twilio or paid services needed. works great for automations, alerts, " +
                        "notifications, or anything that needs programmatic SMS. open source and free to start\n\n" +
                        "https://textbee.dev"
                    context.startActivity(
                        Intent.createChooser(
                            Intent(Intent.ACTION_SEND).apply {
                                type = "text/plain"
                                putExtra(Intent.EXTRA_TEXT, shareText)
                            },
                            "Share textbee"
                        )
                    )
                }
            )

            SettingsSectionHeader("Legal")

            SettingsRow(
                icon = Icons.Default.Gavel,
                title = "Terms of Service",
                onClick = {
                    Links.open(context, "https://textbee.dev/terms-of-service")
                },
                trailing = {
                    Icon(Icons.Default.OpenInBrowser, contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                }
            )

            SettingsRow(
                icon = Icons.Default.Policy,
                title = "Privacy Policy",
                onClick = {
                    Links.open(context, "https://textbee.dev/privacy-policy")
                },
                trailing = {
                    Icon(Icons.Default.OpenInBrowser, contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                }
            )

            Spacer(modifier = Modifier.height(32.dp))
        }
    }

    if (showDeviceNameDialog) {
        AlertDialog(
            onDismissRequest = { showDeviceNameDialog = false },
            title = { Text("Edit Device Name") },
            text = {
                OutlinedTextField(
                    value = editedDeviceName,
                    onValueChange = { editedDeviceName = it },
                    label = { Text("Device Name") },
                    singleLine = true
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.saveDeviceName(editedDeviceName)
                    showDeviceNameDialog = false
                }) { Text("Save") }
            },
            dismissButton = {
                TextButton(onClick = { showDeviceNameDialog = false }) { Text("Cancel") }
            }
        )
    }

    if (showDelayDialog) {
        AlertDialog(
            onDismissRequest = { showDelayDialog = false },
            title = { Text("SMS Send Delay") },
            text = {
                Column {
                    Text(
                        "Delay between each SMS in seconds (0–3600)",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = editedDelay,
                        onValueChange = { editedDelay = it.filter { c -> c.isDigit() } },
                        label = { Text("Seconds") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.setSmsSendDelay(editedDelay.toIntOrNull() ?: 5)
                    showDelayDialog = false
                }) { Text("Save") }
            },
            dismissButton = {
                TextButton(onClick = { showDelayDialog = false }) { Text("Cancel") }
            }
        )
    }

    if (showAboutDialog) {
        AlertDialog(
            onDismissRequest = { showAboutDialog = false },
            title = {
                Text("textbee.dev", fontWeight = FontWeight.Bold)
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "An open-source SMS gateway that turns your Android into a personal SMS API. " +
                        "Send and receive messages programmatically without relying on expensive third-party services.",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = {
                                Links.open(context, "https://textbee.dev")
                            }
                        ) {
                            Text("textbee.dev")
                        }
                        OutlinedButton(
                            onClick = {
                                Links.open(context, "https://github.com/textbee/textbee")
                            }
                        ) {
                            Text("GitHub")
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showAboutDialog = false }) { Text("Close") }
            }
        )
    }

    if (showDisconnectDialog) {
        AlertDialog(
            onDismissRequest = { showDisconnectDialog = false },
            title = { Text("Disconnect Device?") },
            text = { Text("This will remove all credentials from this device. You'll need to reconnect to use the gateway.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDisconnectDialog = false
                        onDisconnect()
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
                ) { Text("Disconnect") }
            },
            dismissButton = {
                TextButton(onClick = { showDisconnectDialog = false }) { Text("Cancel") }
            }
        )
    }
}

@Composable
private fun SettingsSectionHeader(title: String) {
    Text(
        text = title.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 16.dp, top = 20.dp, bottom = 4.dp)
    )
}

@Composable
private fun SettingsRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String? = null,
    subtitleFont: FontFamily = FontFamily.Default,
    subtitleColor: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurfaceVariant,
    titleColor: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurface,
    onClick: (() -> Unit)? = null,
    trailing: @Composable (() -> Unit)? = null
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(24.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.width(16.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(text = title, style = MaterialTheme.typography.bodyLarge, color = titleColor)
            subtitle?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = subtitleFont),
                    color = subtitleColor
                )
            }
        }
        trailing?.invoke()
    }
}

@Composable
private fun SettingsSwitchRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String? = null,
    subtitleColor: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurfaceVariant,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    onClick: (() -> Unit)? = null
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(24.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.width(16.dp))
        // Clickable on the text only, so the Switch keeps its own toggle action
        Column(
            modifier = Modifier
                .weight(1f)
                .then(
                    if (onClick != null) Modifier.clickable(
                        onClickLabel = "Fix the SMS permission",
                        role = Role.Button,
                        onClick = onClick
                    ) else Modifier
                )
        ) {
            Text(text = title, style = MaterialTheme.typography.bodyLarge)
            subtitle?.let {
                Text(text = it, style = MaterialTheme.typography.bodySmall, color = subtitleColor)
            }
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SimSelectionRow(
    sims: List<SimOption>,
    selectedSlot: Int,
    onSelect: (Int) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    val selectedLabel = if (selectedSlot < 0) null
        else sims.find { it.slot == selectedSlot }?.label ?: "SIM ${selectedSlot + 1} (not in phone)"

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = Icons.Default.SimCard,
            contentDescription = null,
            modifier = Modifier.size(24.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.width(16.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(text = "Default SIM", style = MaterialTheme.typography.bodyLarge)
            ExposedDropdownMenuBox(
                expanded = expanded,
                onExpandedChange = { expanded = !expanded }
            ) {
                OutlinedTextField(
                    value = selectedLabel ?: "Device Default",
                    onValueChange = {},
                    readOnly = true,
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                    modifier = Modifier
                        .menuAnchor()
                        .fillMaxWidth(),
                    textStyle = MaterialTheme.typography.bodySmall
                )
                ExposedDropdownMenu(
                    expanded = expanded,
                    onDismissRequest = { expanded = false }
                ) {
                    DropdownMenuItem(
                        text = { Text("Device Default") },
                        onClick = {
                            onSelect(PreferredSim.NONE)
                            expanded = false
                        }
                    )
                    sims.forEach { sim ->
                        DropdownMenuItem(
                            text = { Text(sim.label) },
                            onClick = {
                                onSelect(sim.slot)
                                expanded = false
                            }
                        )
                    }
                }
            }
        }
    }
}
