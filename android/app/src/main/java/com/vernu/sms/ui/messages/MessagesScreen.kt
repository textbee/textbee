package com.vernu.sms.ui.messages

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Create
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import android.content.Intent
import android.os.Build
import android.util.Log
import android.widget.Toast
import androidx.core.content.FileProvider
import com.vernu.sms.AppConstants
import com.vernu.sms.BuildConfig
import com.vernu.sms.dtos.SmsMessage
import com.vernu.sms.helpers.DeviceLog
import com.vernu.sms.helpers.LogEntry
import com.vernu.sms.helpers.SharedPreferenceHelper
import com.vernu.sms.ui.theme.StatusColors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MessagesScreen(
    viewModel: MessagesViewModel = viewModel(),
    onNavigateToCompose: () -> Unit = {}
) {
    val state by viewModel.state.collectAsState()
    var selectedMessage by remember { mutableStateOf<SmsMessage?>(null) }
    val context = LocalContext.current
    val events by DeviceLog.entries.collectAsState()
    var menuOpen by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) { DeviceLog.load(context) }
    }

    // The main frame already applies the navigation bar
    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Default.History,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Activity", fontWeight = FontWeight.SemiBold)
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.refresh() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                    IconButton(onClick = { menuOpen = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = "More")
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(
                            text = { Text("Export diagnostics") },
                            onClick = {
                                menuOpen = false
                                scope.launch { shareDiagnostics(context) }
                            }
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = onNavigateToCompose,
                containerColor = MaterialTheme.colorScheme.primary
            ) {
                Icon(
                    Icons.Default.Create,
                    contentDescription = "Compose",
                    tint = MaterialTheme.colorScheme.onPrimary
                )
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                listOf("all" to "All", "sent" to "Sent", "received" to "Received", EVENTS_FILTER to "Events").forEach { (value, label) ->
                    FilterChip(
                        selected = state.filter == value,
                        onClick = { viewModel.setFilter(value) },
                        label = { Text(label) }
                    )
                }
            }

            when {
                state.filter == EVENTS_FILTER -> EventsList(events)
                state.isLoading -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator()
                    }
                }
                state.error != null -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                text = state.error ?: "Error",
                                color = MaterialTheme.colorScheme.error
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Button(onClick = { viewModel.refresh() }) {
                                Text("Retry")
                            }
                        }
                    }
                }
                state.messages.isEmpty() -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(
                                Icons.Default.Forum,
                                contentDescription = null,
                                modifier = Modifier.size(48.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "No messages yet",
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(state.messages) { message ->
                            MessageItem(
                                message = message,
                                onClick = { selectedMessage = message }
                            )
                        }

                        if (state.currentPage < state.totalPages) {
                            item {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(8.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    if (state.isLoadingMore) {
                                        CircularProgressIndicator(modifier = Modifier.size(24.dp))
                                    } else {
                                        OutlinedButton(onClick = { viewModel.loadMore() }) {
                                            Text("Load more")
                                        }
                                    }
                                }
                            }
                        }

                        item { Spacer(modifier = Modifier.height(80.dp)) }
                    }
                }
            }
        }
    }

    selectedMessage?.let { msg ->
        MessageDetailDialog(message = msg, events = events, onDismiss = { selectedMessage = null })
    }
}

private val eventTimeFormat = SimpleDateFormat("MMM d HH:mm:ss", Locale.getDefault())

@Composable
private fun EventsList(events: List<LogEntry>) {
    if (events.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("No events yet", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        items(events.asReversed()) { e ->
            Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(
                        text = e.event.replace('_', ' '),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = eventTimeFormat.format(java.util.Date(e.timeMs)),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                val line = listOfNotNull(e.smsId?.let { "id …${it.takeLast(6)}" }, e.detail.takeIf { it.isNotBlank() })
                if (line.isNotEmpty()) {
                    Text(
                        text = line.joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            Divider()
        }
        item { Spacer(modifier = Modifier.height(80.dp)) }
    }
}

// Plain text, redacted at write time: no message bodies, masked numbers, no API key
private suspend fun shareDiagnostics(context: android.content.Context) {
    val deviceId = SharedPreferenceHelper.getSharedPreferenceString(
        context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
    ) ?: ""
    val header = "textbee ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})\n" +
        "${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE}\n" +
        "device $deviceId\n" +
        "exported ${eventTimeFormat.format(java.util.Date())}"
    val uri = try {
        val file = withContext(Dispatchers.IO) { DeviceLog.export(context, header) }
        FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Log.w("MessagesScreen", "Diagnostics export failed", e)
        Toast.makeText(context, "Could not export diagnostics", Toast.LENGTH_SHORT).show()
        return
    }
    context.startActivity(
        Intent.createChooser(
            Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, "textbee diagnostics")
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            },
            "Export diagnostics"
        )
    )
}

@Composable
private fun MessageItem(message: SmsMessage, onClick: () -> Unit) {
    val accentColor = if (message.isReceived) Color(0xFF4CAF50)
                      else MaterialTheme.colorScheme.primary

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(IntrinsicSize.Min)
        ) {
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .fillMaxHeight()
                    .background(accentColor)
            )
            Column(
                modifier = Modifier
                    .padding(12.dp)
                    .fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = if (message.isReceived) Icons.Default.ArrowDownward
                                          else Icons.Default.ArrowUpward,
                            contentDescription = null,
                            modifier = Modifier.size(14.dp),
                            tint = accentColor
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = message.counterparty,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                    Text(
                        text = formatRelativeTime(message.createdAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = message.message ?: "",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                if (!message.isReceived && message.status != null) {
                    Spacer(modifier = Modifier.height(4.dp))
                    StatusBadge(status = message.status)
                }
            }
        }
    }
}

@Composable
private fun StatusBadge(status: String) {
    val (color, label) = when (status.lowercase()) {
        "delivered" -> StatusColors.success to "Delivered"
        "sent" -> StatusColors.info to "Sent"
        "failed" -> StatusColors.error to "Failed"
        "dispatched" -> StatusColors.info to "Handed to phone"
        "unknown" -> StatusColors.warning to "No report yet"
        else -> MaterialTheme.colorScheme.onSurfaceVariant to "Pending"
    }
    Surface(
        color = color.copy(alpha = 0.15f),
        shape = MaterialTheme.shapes.extraSmall
    ) {
        Text(
            text = label,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
            style = MaterialTheme.typography.labelSmall,
            color = color,
            fontWeight = FontWeight.SemiBold
        )
    }
}

@Composable
private fun MessageDetailDialog(message: SmsMessage, events: List<LogEntry>, onDismiss: () -> Unit) {
    val steps = remember(message, events) { ActivityTimeline.build(message, events) }
    val accentColor = if (message.isReceived) Color(0xFF4CAF50)
                      else MaterialTheme.colorScheme.primary

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = if (message.isReceived) Icons.Default.ArrowDownward
                                  else Icons.Default.ArrowUpward,
                    contentDescription = null,
                    tint = accentColor,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = if (message.isReceived) "Received from" else "Sent to",
                    style = MaterialTheme.typography.titleMedium
                )
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = message.counterparty,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = accentColor
                )
                if (!message.isReceived && message.status != null) {
                    StatusBadge(status = message.status)
                }
                Divider()
                Text(
                    text = message.message ?: "",
                    style = MaterialTheme.typography.bodyMedium
                )
                val timestamp = if (message.isReceived) message.receivedAt else message.requestedAt
                timestamp?.let {
                    Text(
                        text = formatFullDate(it),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                if (steps.isNotEmpty()) {
                    Divider()
                    Text("Timeline", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                    var previous: Long? = null
                    val timeFmt = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
                    steps.forEach { step ->
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(
                                text = step.label + if (step.detail.isNotBlank()) " · ${step.detail}" else "",
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.weight(1f)
                            )
                            Text(
                                text = "${timeFmt.format(java.util.Date(step.timeMs))} ${ActivityTimeline.delta(previous, step.timeMs)}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        previous = step.timeMs
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("Close") }
        }
    )
}

private fun formatRelativeTime(isoDate: String?): String {
    if (isoDate == null) return ""
    return try {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        val date = sdf.parse(isoDate.take(19)) ?: return ""
        val diffMs = System.currentTimeMillis() - date.time
        when {
            diffMs < 60_000 -> "Just now"
            diffMs < 3_600_000 -> "${diffMs / 60_000}m ago"
            diffMs < 86_400_000 -> "${diffMs / 3_600_000}h ago"
            diffMs < 604_800_000 -> "${diffMs / 86_400_000}d ago"
            else -> SimpleDateFormat("MMM d", Locale.getDefault()).format(date)
        }
    } catch (e: Exception) {
        ""
    }
}

private fun formatFullDate(isoDate: String): String {
    return try {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        val date = sdf.parse(isoDate.take(19)) ?: return ""
        SimpleDateFormat("MMM d, yyyy 'at' h:mm a", Locale.getDefault()).format(date)
    } catch (e: Exception) {
        ""
    }
}
