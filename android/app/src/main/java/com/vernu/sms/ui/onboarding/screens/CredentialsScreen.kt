package com.vernu.sms.ui.onboarding.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.vernu.sms.ui.onboarding.OnboardingViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CredentialsScreen(
    viewModel: OnboardingViewModel,
    onScanQr: () -> Unit,
    onNext: () -> Unit,
    onBack: () -> Unit,
    onSaved: () -> Unit = {}
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    var selectedTab by remember { mutableStateOf(0) }
    var showApiKey by remember { mutableStateOf(false) }
    val tabs = listOf("Scan QR Code", "Enter Manually")
    val adding = state.isAddingApiKey

    if (adding) {
        LaunchedEffect(Unit) {
            viewModel.registrationSuccess.collect { onSaved() }
        }
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

                if (!adding) {
                    StepIndicator(current = 1, total = 3)
                    Spacer(modifier = Modifier.height(24.dp))
                }

                Text(
                    text = if (adding) "Add a new API key" else "Connect your account",
                    style = MaterialTheme.typography.headlineMedium
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = if (adding)
                        "Create a new API key in the dashboard, then scan it or paste it here. This phone keeps its device ID and settings."
                    else
                        "Enter your API key from your textbee.dev dashboard",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                if (!adding) TextButton(
                    onClick = {
                        context.startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse("https://app.textbee.dev/register"))
                        )
                    },
                    contentPadding = PaddingValues(0.dp)
                ) {
                    Text(
                        text = "Don't have an account? Sign up free",
                        style = MaterialTheme.typography.bodySmall
                    )
                }

                Spacer(modifier = Modifier.height(16.dp))

                TabRow(selectedTabIndex = selectedTab) {
                    tabs.forEachIndexed { index, title ->
                        Tab(
                            selected = selectedTab == index,
                            onClick = { selectedTab = index },
                            text = { Text(title) }
                        )
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))

                when (selectedTab) {
                    0 -> QrTab(
                        apiKey = state.apiKey,
                        isQrScanned = state.isQrScanned,
                        onScanQr = onScanQr,
                        onSwitchToManual = { selectedTab = 1 }
                    )
                    1 -> ManualTab(
                        apiKey = state.apiKey,
                        showApiKey = showApiKey,
                        onApiKeyChange = { viewModel.setApiKey(it) },
                        onToggleVisibility = { showApiKey = !showApiKey }
                    )
                }

                if (adding) {
                    state.errorMessage?.let { error ->
                        Spacer(modifier = Modifier.height(16.dp))
                        SetupErrorCard(message = error, onDismiss = { viewModel.clearError() })
                    }
                }

                Spacer(modifier = Modifier.height(32.dp))

                Button(
                    onClick = onNext,
                    enabled = state.apiKey.isNotEmpty() && !state.isLoading,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp)
                ) {
                    Text(if (adding) "Save API key" else "Next →")
                }

                Spacer(modifier = Modifier.height(24.dp))
            }
        }
        if (adding && state.isLoading) SetupLoadingOverlay()
    }
}

@Composable
private fun QrTab(
    apiKey: String,
    isQrScanned: Boolean,
    onScanQr: () -> Unit,
    onSwitchToManual: () -> Unit
) {
    val context = LocalContext.current

    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "1. Go to your textbee.dev dashboard",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f)
                )
                TextButton(
                    onClick = {
                        context.startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse("https://app.textbee.dev/dashboard"))
                        )
                    },
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)
                ) {
                    Text("Open", style = MaterialTheme.typography.bodySmall)
                }
            }
            Text(
                text = "2. Click \"Register Device\" or \"Generate API Key\"",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth()
            )
            Text(
                text = "3. Scan the QR code shown on screen",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth()
            )
        }

        Spacer(modifier = Modifier.height(24.dp))

        if (isQrScanned && apiKey.isNotEmpty()) {
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                ),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.Check,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Column {
                        Text(
                            text = "QR scanned successfully",
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.primary
                        )
                        Text(
                            text = apiKey.take(8) + "••••••••",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
            Spacer(modifier = Modifier.height(16.dp))
            OutlinedButton(onClick = onScanQr) {
                Icon(Icons.Default.QrCodeScanner, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Scan Again")
            }
        } else {
            Button(
                onClick = onScanQr,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp)
            ) {
                Icon(Icons.Default.QrCodeScanner, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Scan QR Code")
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        TextButton(onClick = onSwitchToManual) {
            Text("Enter manually instead")
        }
    }
}

@Composable
private fun ManualTab(
    apiKey: String,
    showApiKey: Boolean,
    onApiKeyChange: (String) -> Unit,
    onToggleVisibility: () -> Unit
) {
    val context = LocalContext.current

    OutlinedTextField(
        value = apiKey,
        onValueChange = onApiKeyChange,
        label = { Text("API Key") },
        placeholder = { Text("Paste your API key here") },
        visualTransformation = if (showApiKey) VisualTransformation.None else PasswordVisualTransformation(),
        trailingIcon = {
            IconButton(onClick = onToggleVisibility) {
                Icon(
                    imageVector = if (showApiKey) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                    contentDescription = if (showApiKey) "Hide" else "Show"
                )
            }
        },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        modifier = Modifier.fillMaxWidth(),
        singleLine = true
    )
    TextButton(
        onClick = {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse("https://app.textbee.dev/dashboard"))
            )
        },
        contentPadding = PaddingValues(0.dp)
    ) {
        Text(
            text = "Get your API key at app.textbee.dev/dashboard",
            style = MaterialTheme.typography.bodySmall
        )
    }
}
