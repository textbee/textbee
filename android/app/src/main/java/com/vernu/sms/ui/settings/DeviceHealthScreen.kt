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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vernu.sms.helpers.HealthAction
import com.vernu.sms.helpers.HealthRow
import com.vernu.sms.helpers.HealthStatus
import com.vernu.sms.helpers.SmsPermissionHelp
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
    var permissionDenied by remember { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        if (results.values.any { !it }) permissionDenied = true
        viewModel.refresh()
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
                        when (row.action) {
                            HealthAction.GRANT_SMS -> if (permissionDenied) openAppSettings() else permissionLauncher.launch(
                                arrayOf(Manifest.permission.SEND_SMS, Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_PHONE_STATE)
                            )
                            HealthAction.GRANT_NOTIFICATIONS -> if (permissionDenied) openAppSettings() else permissionLauncher.launch(
                                arrayOf("android.permission.POST_NOTIFICATIONS")
                            )
                            HealthAction.OPEN_BATTERY_SETTINGS -> try {
                                context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                            } catch (e: Exception) {
                                openAppSettings()
                            }
                            HealthAction.TOGGLE_STICKY -> viewModel.setStickyNotification(true)
                            HealthAction.OPEN_APP_SETTINGS -> openAppSettings()
                            HealthAction.SEND_HEARTBEAT -> viewModel.sendHeartbeatNow()
                            HealthAction.NONE -> Unit
                        }
                    },
                    actionLabel = when {
                        permissionDenied && (row.action == HealthAction.GRANT_SMS || row.action == HealthAction.GRANT_NOTIFICATIONS) ->
                            "Open app settings"
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
