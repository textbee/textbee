package com.vernu.sms.ui.settings

import android.Manifest
import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vernu.sms.TextbeeUtils
import com.vernu.sms.helpers.AppPermission
import com.vernu.sms.helpers.DeviceHealthRows
import com.vernu.sms.helpers.Diagnostics
import com.vernu.sms.helpers.HealthAction
import com.vernu.sms.helpers.HealthRow
import com.vernu.sms.helpers.HealthStatus
import com.vernu.sms.helpers.SmsPermissionHelp
import com.vernu.sms.ui.onboarding.OnboardingActivity
import com.vernu.sms.ui.theme.StatusColors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeviceHealthScreen(
    onNavigateBack: () -> Unit,
    viewModel: DeviceHealthViewModel = viewModel()
) {
    val rows by viewModel.rows.collectAsState()
    val heartbeatSend by viewModel.heartbeatSend.collectAsState()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    val activity = remember(context) { SmsPermissionHelp.findActivity(context) }
    // Set when the dialog returns, so the blocked state is not read while it is open
    val setSaver = listSaver<Set<String>, String>(save = { it.toList() }, restore = { it.toSet() })
    var requested by rememberSaveable(stateSaver = setSaver) { mutableStateOf(emptySet()) }
    // The permissions of the open dialog. A cancelled request returns no keys, so they come from here.
    var pending by rememberSaveable(stateSaver = setSaver) { mutableStateOf(emptySet()) }

    var grantedBeforeRequest by remember { mutableStateOf(emptySet<String>()) }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        Diagnostics.permissionResults(context, results, grantedBeforeRequest)
        requested = requested + pending + results.keys
        pending = emptySet()
        viewModel.refresh()
    }

    fun permissionsFor(action: HealthAction): Array<String>? = when (action) {
        HealthAction.GRANT_SMS -> arrayOf(Manifest.permission.SEND_SMS, Manifest.permission.RECEIVE_SMS)
        HealthAction.GRANT_PHONE_STATE -> arrayOf(Manifest.permission.READ_PHONE_STATE)
        HealthAction.GRANT_NOTIFICATIONS -> arrayOf(DeviceHealthRows.androidPermission(AppPermission.NOTIFICATIONS))
        else -> null
    }

    // Android no longer shows the dialog for one of them, so only the app settings can allow it
    fun blocked(permissions: Array<String>) = permissions.any {
        SmsPermissionHelp.isBlocked(
            granted = TextbeeUtils.isPermissionGranted(context, it),
            requestedBefore = it in requested,
            canShowRationale = SmsPermissionHelp.canShowRationale(activity, it)
        )
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) viewModel.refresh()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    fun openAppSettings() = SmsPermissionHelp.openAppSettings(context)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Device health", fontWeight = FontWeight.SemiBold) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface)
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Text(
                    text = "What can slow down or stop messages on this phone, in either direction, and what to change.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 4.dp)
                )
            }
            items(rows, key = { it.id }) { row ->
                HealthRowCard(
                    row = row,
                    onAction = {
                        fun request(permissions: Array<String>) {
                            grantedBeforeRequest = Diagnostics.grantedPermissions(context, permissions)
                            pending = permissions.toSet()
                            permissionLauncher.launch(permissions)
                        }
                        val permissions = permissionsFor(row.action)
                        when (row.action) {
                            HealthAction.GRANT_SMS, HealthAction.GRANT_PHONE_STATE, HealthAction.GRANT_NOTIFICATIONS -> permissions?.let {
                                if (blocked(it)) openAppSettings()
                                else request(it.filter { p -> !TextbeeUtils.isPermissionGranted(context, p) }.toTypedArray())
                            }
                            HealthAction.OPEN_BATTERY_SETTINGS -> try {
                                context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                            } catch (e: Exception) {
                                openAppSettings()
                            }
                            HealthAction.TOGGLE_STICKY -> viewModel.setStickyNotification(true)
                            HealthAction.OPEN_APP_SETTINGS -> openAppSettings()
                            HealthAction.SEND_HEARTBEAT -> viewModel.sendHeartbeatNow()
                            HealthAction.ADD_API_KEY -> context.startActivity(OnboardingActivity.addApiKeyIntent(context))
                            HealthAction.NONE -> Unit
                        }
                    },
                    actionLabel = when {
                        permissionsFor(row.action)?.let { blocked(it) } == true -> "Open app settings"
                        row.action == HealthAction.SEND_HEARTBEAT -> when (heartbeatSend) {
                            HeartbeatSend.SENDING -> "Sending"
                            HeartbeatSend.SENT -> "Sent"
                            HeartbeatSend.FAILED -> "Could not send. Try again"
                            HeartbeatSend.IDLE -> row.actionLabel
                        }
                        else -> row.actionLabel
                    },
                    actionEnabled = !(row.action == HealthAction.SEND_HEARTBEAT && heartbeatSend == HeartbeatSend.SENDING)
                )
            }
        }
    }
}

@Composable
private fun HealthRowCard(
    row: HealthRow,
    onAction: () -> Unit,
    actionLabel: String?,
    actionEnabled: Boolean = true,
) {
    val color = when (row.status) {
        HealthStatus.GREEN -> StatusColors.success
        HealthStatus.AMBER -> StatusColors.warning
        HealthStatus.RED -> StatusColors.error
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .background(color, CircleShape)
                )
                Spacer(modifier = Modifier.width(10.dp))
                Text(row.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            }
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = row.detail,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (row.action != HealthAction.NONE && actionLabel != null) {
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedButton(onClick = onAction, enabled = actionEnabled) { Text(actionLabel) }
            }
        }
    }
}
