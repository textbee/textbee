package com.vernu.sms.ui.messages

import androidx.compose.ui.platform.LocalContext
import android.net.Uri
import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ComposeScreen(
    viewModel: ComposeViewModel = viewModel(),
    onNavigateBack: () -> Unit
) {
    val state by viewModel.state.collectAsState()
    var recipientInput by remember { mutableStateOf("") }
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current

    LaunchedEffect(state.sendSuccess) {
        if (state.sendSuccess) {
            snackbarHostState.showSnackbar("Message sent successfully!")
            viewModel.clearSuccess()
        }
    }

    LaunchedEffect(state.sendError) {
        state.sendError?.let { message ->
            val upgradeUrl = state.upgradeUrl
            val result = snackbarHostState.showSnackbar(
                message = message,
                actionLabel = if (upgradeUrl != null) "Upgrade" else null,
                duration = if (upgradeUrl != null) SnackbarDuration.Long else SnackbarDuration.Short
            )
            if (result == SnackbarResult.ActionPerformed && upgradeUrl != null) {
                try {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(upgradeUrl)))
                } catch (e: ActivityNotFoundException) {
                    snackbarHostState.showSnackbar("No browser found. Open textbee.dev/pricing on another device.")
                }
            }
            viewModel.clearError()
        }
    }

    // The main frame already applies the navigation bar
    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            TopAppBar(
                title = {
                    Text("New Message", fontWeight = FontWeight.SemiBold)
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        // The window no longer shrinks for the keyboard on Android 15 and newer
        snackbarHost = { SnackbarHost(snackbarHostState, Modifier.imePadding()) }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "Recipients",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedTextField(
                    value = recipientInput,
                    onValueChange = { recipientInput = it },
                    modifier = Modifier.weight(1f),
                    label = { Text("Phone number") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    singleLine = true
                )
                Button(
                    onClick = {
                        val trimmed = recipientInput.trim()
                        if (trimmed.isNotEmpty() && !state.recipients.contains(trimmed)) {
                            viewModel.addRecipient(trimmed)
                            recipientInput = ""
                        }
                    },
                    enabled = recipientInput.trim().isNotEmpty()
                ) {
                    Text("Add")
                }
            }

            if (state.recipients.isNotEmpty()) {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    state.recipients.forEach { number ->
                        InputChip(
                            selected = false,
                            onClick = {},
                            label = { Text(number) },
                            trailingIcon = {
                                IconButton(
                                    onClick = { viewModel.removeRecipient(number) },
                                    modifier = Modifier.size(18.dp)
                                ) {
                                    Icon(
                                        Icons.Default.Close,
                                        contentDescription = "Remove",
                                        modifier = Modifier.size(14.dp)
                                    )
                                }
                            }
                        )
                    }
                }
            }

            Divider()

            Text(
                text = "Message",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold
            )

            OutlinedTextField(
                value = state.message,
                onValueChange = { viewModel.setMessage(it) },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 120.dp),
                label = { Text("Type your message") },
                maxLines = 8,
                supportingText = {
                    Text("${state.message.length} characters")
                }
            )

            Button(
                onClick = { viewModel.sendSms() },
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.isSending &&
                          state.recipients.isNotEmpty() &&
                          state.message.isNotEmpty()
            ) {
                if (state.isSending) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                        strokeWidth = 2.dp
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Sending...")
                } else {
                    Icon(
                        Icons.Default.Send,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Send Message")
                }
            }
        }
    }
}
