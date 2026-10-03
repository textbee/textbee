package com.vernu.sms.ui.onboarding.screens

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Sms
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.vernu.sms.helpers.SmsPermissionHelp
import com.vernu.sms.ui.components.RestrictedSettingsCard

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PermissionsScreen(
    onContinue: () -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val activity = remember(context) { SmsPermissionHelp.findActivity(context) }

    val permissions = remember {
        listOf(
            PermissionItem(
                permission = Manifest.permission.SEND_SMS,
                label = "Send SMS",
                rationale = "Required to send messages from your device",
                icon = Icons.Default.Sms
            ),
            PermissionItem(
                permission = Manifest.permission.RECEIVE_SMS,
                label = "Receive SMS",
                rationale = "Required to receive and forward incoming messages",
                icon = Icons.Default.Sms
            ),
            PermissionItem(
                permission = Manifest.permission.READ_PHONE_STATE,
                label = "Phone State",
                rationale = "Required to detect SIM cards for multi-SIM support",
                icon = Icons.Default.PhoneAndroid
            )
        ) + if (Build.VERSION.SDK_INT >= 33) listOf(
            PermissionItem(
                permission = "android.permission.POST_NOTIFICATIONS",
                label = "Notifications",
                rationale = "Lets textbee show that it is running and sending in the background",
                icon = Icons.Default.Notifications
            )
        ) else emptyList()
    }

    fun checkGranted() = permissions.associate { item ->
        item.permission to (ContextCompat.checkSelfPermission(context, item.permission) == PackageManager.PERMISSION_GRANTED)
    }

    var grantedMap by remember { mutableStateOf(checkGranted()) }
    var requested by rememberSaveable(
        stateSaver = listSaver<Set<String>, String>(save = { it.toList() }, restore = { it.toSet() })
    ) { mutableStateOf(emptySet()) }

    // Bumped after each request and resume, so the blocked state is read again
    var checks by remember { mutableStateOf(0) }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        requested = requested + results.keys
        grantedMap = grantedMap + results
        checks++
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                grantedMap = checkGranted()
                checks++
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val blocked = remember(grantedMap, requested, checks) {
        permissions.map { it.permission }.filter { permission ->
            SmsPermissionHelp.isBlocked(
                granted = grantedMap[permission] == true,
                requestedBefore = permission in requested,
                canShowRationale = SmsPermissionHelp.canShowRationale(activity, permission)
            )
        }.toSet()
    }

    // Recorded at the tap, because a cancelled request returns no result
    fun request(toRequest: Array<String>) {
        requested = requested + toRequest
        launcher.launch(toRequest)
    }

    val allGranted = grantedMap.values.all { it }
    val sendSmsGranted = grantedMap[Manifest.permission.SEND_SMS] == true
    val sendSmsGrantedAtStart = remember { sendSmsGranted }
    LaunchedEffect(sendSmsGranted) {
        if (sendSmsGranted && !sendSmsGrantedAtStart) SmsPermissionHelp.reportGranted(context)
    }
    val requestedSendSms = Manifest.permission.SEND_SMS in requested
    val showRestrictedSettings = !sendSmsGranted && requestedSendSms &&
        (Manifest.permission.SEND_SMS in blocked || SmsPermissionHelp.needsRestrictedSettings)

    Scaffold(
        topBar = {
            TopAppBar(
                title = {},
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 24.dp)
                .verticalScroll(rememberScrollState())
        ) {
            Spacer(modifier = Modifier.height(8.dp))

            StepIndicator(current = 3, total = 3)

            Spacer(modifier = Modifier.height(24.dp))

            Text(
                text = "Grant Permissions",
                style = MaterialTheme.typography.headlineMedium
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "textbee needs the SMS permission to send messages. The others are optional.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(24.dp))

            if (showRestrictedSettings) {
                RestrictedSettingsCard(
                    onOpenSettings = { SmsPermissionHelp.openAppSettings(context) },
                    onOpenGuide = { SmsPermissionHelp.openGuide(context) }
                )
                Spacer(modifier = Modifier.height(16.dp))
            } else if (!allGranted) {
                Button(
                    onClick = {
                        val missing = permissions
                            .filter { grantedMap[it.permission] == false }
                            .map { it.permission }
                            .toTypedArray()
                        request(missing)
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp)
                ) {
                    Text("Grant All Permissions")
                }
                Spacer(modifier = Modifier.height(16.dp))
            }

            permissions.forEach { item ->
                val isGranted = grantedMap[item.permission] == true
                PermissionRow(
                    item = item,
                    isGranted = isGranted,
                    isBlocked = item.permission in blocked,
                    onGrant = { request(arrayOf(item.permission)) },
                    onOpenSettings = { SmsPermissionHelp.openAppSettings(context) }
                )
                Spacer(modifier = Modifier.height(8.dp))
            }

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "These permissions are only used to send and receive SMS on your behalf. textbee never accesses your existing message history.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
            TextButton(
                onClick = {
                    context.startActivity(
                        Intent(Intent.ACTION_VIEW, Uri.parse("https://textbee.dev/privacy-policy"))
                    )
                },
                contentPadding = PaddingValues(0.dp)
            ) {
                Text("Privacy Policy", style = MaterialTheme.typography.bodySmall)
            }

            Spacer(modifier = Modifier.height(16.dp))

            Button(
                onClick = onContinue,
                enabled = sendSmsGranted,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp)
            ) {
                Text(if (sendSmsGranted && !allGranted) "Continue without optional permissions" else "Continue")
            }

            if (!allGranted) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = if (sendSmsGranted)
                        "You can allow ${permissions.filter { grantedMap[it.permission] != true }.joinToString(", ") { it.label }} later from Settings > Device health."
                    else
                        "Allow Send SMS to continue.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                // A way out for a phone that cannot grant it, shown only after a real attempt
                if (!sendSmsGranted && requestedSendSms) {
                    TextButton(onClick = onContinue) {
                        Text("Skip for now. This phone will not send SMS.", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

@Composable
private fun PermissionRow(
    item: PermissionItem,
    isGranted: Boolean,
    isBlocked: Boolean,
    onGrant: () -> Unit,
    onOpenSettings: () -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (isGranted)
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)
            else
                MaterialTheme.colorScheme.surfaceVariant
        ),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = item.icon,
                contentDescription = null,
                tint = if (isGranted) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(24.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = item.label,
                    style = MaterialTheme.typography.titleMedium
                )
                Text(
                    text = item.rationale,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
            if (isGranted) {
                Icon(
                    Icons.Default.Check,
                    contentDescription = "Granted",
                    tint = MaterialTheme.colorScheme.primary
                )
            } else if (isBlocked) {
                TextButton(onClick = onOpenSettings) {
                    Text("Open settings")
                }
            } else {
                TextButton(onClick = onGrant) {
                    Text("Grant")
                }
            }
        }
    }
}

private data class PermissionItem(
    val permission: String,
    val label: String,
    val rationale: String,
    val icon: ImageVector
)
