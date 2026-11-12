package com.vernu.sms.ui.onboarding.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.vernu.sms.ui.onboarding.OnboardingViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeviceSetupScreen(
    viewModel: OnboardingViewModel,
    onSuccess: () -> Unit,
    onBack: () -> Unit
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current

    LaunchedEffect(Unit) {
        viewModel.registrationSuccess.collect { onSuccess() }
    }

    Box(modifier = Modifier.fillMaxSize()) {
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

                StepIndicator(current = 2, total = 3)

                Spacer(modifier = Modifier.height(24.dp))

                Text(
                    text = if (state.isReturningUser) "Reconnect your device" else "Set up your device",
                    style = MaterialTheme.typography.headlineMedium
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = if (state.isReturningUser)
                        "Enter your Device ID to reconnect this device to your account"
                    else
                        "Give this device a name and register it to start sending SMS",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                Spacer(modifier = Modifier.height(24.dp))

                if (state.isReturningUser) {
                    OutlinedTextField(
                        value = state.deviceId,
                        onValueChange = { viewModel.setDeviceId(it) },
                        label = { Text("Device ID") },
                        placeholder = { Text("Enter your Device ID") },
                        supportingText = { Text("Find it at textbee.dev/dashboard → Devices") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                } else {
                    var expandDeviceId by remember { mutableStateOf(false) }

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Checkbox(
                            checked = expandDeviceId,
                            onCheckedChange = {
                                expandDeviceId = it
                                viewModel.setUseExistingDeviceId(it)
                            }
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "This device was previously registered",
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                    Text(
                        text = "Use this if you reinstalled the app and want to reconnect your existing device rather than create a new one in your dashboard",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 48.dp)
                    )

                    if (expandDeviceId) {
                        Spacer(modifier = Modifier.height(8.dp))
                        OutlinedTextField(
                            value = state.deviceId,
                            onValueChange = { viewModel.setDeviceId(it) },
                            label = { Text("Device ID") },
                            placeholder = { Text("Enter your Device ID") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                    }
                }

                OutlinedTextField(
                    value = state.deviceName,
                    onValueChange = { viewModel.setDeviceName(it) },
                    label = { Text("Device Name (optional)") },
                    placeholder = { Text("e.g. My Gateway Phone") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                state.errorMessage?.let { error ->
                    Spacer(modifier = Modifier.height(16.dp))
                    SetupErrorCard(message = error, onDismiss = { viewModel.clearError() })
                }

                Spacer(modifier = Modifier.height(32.dp))

                Button(
                    onClick = { viewModel.registerOrUpdateDevice(context) },
                    enabled = !state.isLoading,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp)
                ) {
                    Text(if (state.isReturningUser) "Reconnect Device" else "Register Device")
                }

                Spacer(modifier = Modifier.height(24.dp))
            }
        }

        if (state.isLoading) SetupLoadingOverlay()
    }
}
