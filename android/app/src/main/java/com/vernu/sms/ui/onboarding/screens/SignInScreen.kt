package com.vernu.sms.ui.onboarding.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.vernu.sms.helpers.BrowserTab
import com.vernu.sms.helpers.DeviceLink
import com.vernu.sms.ui.components.AppOutlinedButton
import com.vernu.sms.ui.onboarding.SignInPhase
import com.vernu.sms.ui.onboarding.SignInState
import com.vernu.sms.ui.onboarding.SignInViewModel

@Composable
fun SignInScreen(
    viewModel: SignInViewModel,
    // Called when no sign-in is in progress: after Cancel, or when sign-in cannot be used
    onLeave: () -> Unit,
    onContinue: (deviceId: String, deviceName: String) -> Unit
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current

    // Asks the server only while this screen can be seen
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> viewModel.setVisible(true)
                Lifecycle.Event.ON_STOP -> viewModel.setVisible(false)
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            viewModel.setVisible(false)
        }
    }

    // A user who types the code on a computer does not come back to a dark phone
    val view = LocalView.current
    val waiting = state.phase == SignInPhase.WAITING
    DisposableEffect(waiting) {
        view.keepScreenOn = waiting
        onDispose { view.keepScreenOn = false }
    }

    LaunchedEffect(Unit) {
        viewModel.openBrowser.collect { url -> viewModel.onBrowserResult(BrowserTab.open(context, url)) }
    }

    LaunchedEffect(state.phase) {
        if (state.phase == SignInPhase.IDLE) onLeave()
    }
    val onCancel = { viewModel.cancel() }

    val continueOn = {
        onContinue(state.deviceId.orEmpty(), state.deviceName.orEmpty())
    }
    BackHandler {
        when (state.phase) {
            SignInPhase.DONE -> continueOn()
            SignInPhase.FINISHING -> Unit
            else -> onCancel()
        }
    }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(24.dp)
        ) {
            when (state.phase) {
                SignInPhase.IDLE, SignInPhase.CREATING -> Busy(null)
                SignInPhase.FINISHING -> Busy("Connecting your device…")
                SignInPhase.WAITING -> Waiting(
                    state = state,
                    onOpenBrowser = {
                        state.linkUrl?.let { viewModel.onBrowserResult(BrowserTab.open(context, it)) }
                    },
                    onCancel = onCancel
                )
                SignInPhase.DONE -> Done(state = state, onContinue = continueOn)
                SignInPhase.FINISH_FAILED -> Problem(
                    message = state.message,
                    actionLabel = "Try again",
                    onAction = { viewModel.finish() },
                    onCancel = onCancel
                )
                SignInPhase.ENDED -> Problem(
                    message = state.message,
                    actionLabel = if (state.noCodeYet) "Try again" else "Get a new code",
                    onAction = { viewModel.start() },
                    onCancel = onCancel
                )
            }
        }
    }
}

@Composable
private fun Busy(text: String?) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 160.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
        text?.let {
            Spacer(modifier = Modifier.height(16.dp))
            Text(text = it, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun Waiting(state: SignInState, onOpenBrowser: () -> Unit, onCancel: () -> Unit) {
    val clipboard = LocalClipboardManager.current

    Text(
        text = "Enter this code in your browser",
        style = MaterialTheme.typography.headlineMedium
    )
    Spacer(modifier = Modifier.height(24.dp))

    // The code reads left to right in every language
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
        Text(
            text = state.displayCode,
            style = MaterialTheme.typography.displaySmall,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Bold,
            letterSpacing = 4.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )
    }
    Spacer(modifier = Modifier.height(24.dp))

    ChoiceCard(heading = "On your computer") {
        Text(
            text = "Open ${state.manualUrl} and enter the code.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }

    if (state.linkUrl != null) {
        Spacer(modifier = Modifier.height(12.dp))
        ChoiceCard(heading = "On this phone") {
            AppOutlinedButton(onClick = onOpenBrowser, modifier = Modifier.fillMaxWidth()) {
                Text(if (state.browserOpened) "Open browser again" else "Continue on this phone")
            }
            if (state.noBrowser) {
                Spacer(modifier = Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "No browser found on this phone. On a computer, go to ${state.manualUrl} and enter this code.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.weight(1f)
                    )
                    IconButton(onClick = { clipboard.setText(AnnotatedString(state.manualUrl)) }) {
                        Icon(Icons.Default.ContentCopy, contentDescription = "Copy", modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
    }

    Spacer(modifier = Modifier.height(24.dp))
    Row(verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            text = "Waiting for your approval",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
    Spacer(modifier = Modifier.height(24.dp))
    TextButton(onClick = onCancel, modifier = Modifier.fillMaxWidth()) {
        Text("Cancel")
    }
}

@Composable
private fun ChoiceCard(heading: String, content: @Composable ColumnScope.() -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = heading, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Spacer(modifier = Modifier.height(8.dp))
            content()
        }
    }
}

@Composable
private fun Done(state: SignInState, onContinue: () -> Unit) {
    val email = state.accountEmail ?: "your textbee account"
    val name = state.deviceName.orEmpty()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 64.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            Icons.Default.CheckCircle,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(72.dp)
        )
        Spacer(modifier = Modifier.height(24.dp))
        Text(
            text = if (state.reconnected) "Reconnected to $email" else "Connected to $email",
            style = MaterialTheme.typography.headlineSmall,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = if (state.reconnected) "This phone is \"$name\" again."
            else "This phone shows as \"$name\" in your dashboard.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(32.dp))
        Button(
            onClick = onContinue,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
        ) {
            Text("Continue")
        }
    }
}

@Composable
private fun Problem(message: String?, actionLabel: String, onAction: () -> Unit, onCancel: () -> Unit) {
    Spacer(modifier = Modifier.height(64.dp))
    Text(
        text = message ?: DeviceLink.UNEXPECTED,
        style = MaterialTheme.typography.bodyLarge
    )
    Spacer(modifier = Modifier.height(32.dp))
    Button(
        onClick = onAction,
        modifier = Modifier
            .fillMaxWidth()
            .height(52.dp)
    ) {
        Text(actionLabel)
    }
    Spacer(modifier = Modifier.height(8.dp))
    TextButton(onClick = onCancel, modifier = Modifier.fillMaxWidth()) {
        Text("Cancel")
    }
}
