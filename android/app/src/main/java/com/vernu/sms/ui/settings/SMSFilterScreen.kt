package com.vernu.sms.ui.settings

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vernu.sms.helpers.SMSFilterHelper
import com.vernu.sms.models.SMSFilterRule

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SMSFilterScreen(
    onNavigateBack: () -> Unit,
    viewModel: SMSFilterViewModel = viewModel()
) {
    val config by viewModel.config.collectAsState()
    val simState by viewModel.simState.collectAsState()

    // Picks up SIM changes and a permission granted in system settings.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) viewModel.refreshSims()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    var showDialog by remember { mutableStateOf(false) }
    var editingIndex by remember { mutableStateOf<Int?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("SMS Filters", fontWeight = FontWeight.SemiBold) },
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
        floatingActionButton = {
            FloatingActionButton(onClick = {
                editingIndex = null
                showDialog = true
            }) {
                Icon(Icons.Default.Add, contentDescription = "Add rule")
            }
        }
    ) { padding ->
        // One scrolling list, so the SIM section never squeezes the rules.
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(bottom = 88.dp)
        ) {
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Enable SMS Filtering", style = MaterialTheme.typography.bodyLarge)
                        Text(
                            "Filter incoming SMS by SIM and by the rules below",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Switch(
                        checked = config.enabled,
                        onCheckedChange = { viewModel.setEnabled(it) }
                    )
                }
                Divider()
            }

            if (config.enabled) {
                item {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        FilterChip(
                            selected = config.mode == SMSFilterHelper.FilterMode.ALLOW_LIST,
                            onClick = { viewModel.setMode(SMSFilterHelper.FilterMode.ALLOW_LIST) },
                            label = { Text("Allow List") }
                        )
                        FilterChip(
                            selected = config.mode == SMSFilterHelper.FilterMode.BLOCK_LIST,
                            onClick = { viewModel.setMode(SMSFilterHelper.FilterMode.BLOCK_LIST) },
                            label = { Text("Block List") }
                        )
                    }
                    Text(
                        text = if (config.mode == SMSFilterHelper.FilterMode.ALLOW_LIST)
                            "Only SMS matching a rule will be forwarded"
                        else
                            "SMS matching a rule will be blocked",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp)
                    )
                    Divider()
                }

                val savedSlots = config.allowedSimSlots.orEmpty()
                // Hidden on a phone with one active SIM. Without phone access
                // the active SIMs are unknown, so the slot count decides.
                val showSims = simState.sims.size > 1 || savedSlots.isNotEmpty() ||
                    (!simState.permissionGranted && simState.modemCount > 1)
                if (showSims) {
                    item {
                        SimFilterSection(
                            savedSlots = savedSlots,
                            simState = simState,
                            onToggle = viewModel::toggleSimSlot,
                            onAllowAll = viewModel::allowAllSims,
                            onPermissionResult = { viewModel.refreshSims() }
                        )
                        Divider()
                    }
                }
            }

            if (config.rules.isEmpty()) {
                item {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 48.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(
                            Icons.Default.FilterList,
                            contentDescription = null,
                            modifier = Modifier.size(48.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(
                            "No filter rules",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(
                            "Tap + to add a rule",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            } else {
                itemsIndexed(config.rules) { index, rule ->
                    FilterRuleRow(
                        rule = rule,
                        onEdit = {
                            editingIndex = index
                            showDialog = true
                        },
                        onDelete = { viewModel.deleteRule(index) }
                    )
                    if (index < config.rules.lastIndex) {
                        Divider(modifier = Modifier.padding(start = 16.dp))
                    }
                }
            }
        }
    }

    if (showDialog) {
        FilterRuleDialog(
            rule = editingIndex?.let { config.rules.getOrNull(it) },
            onConfirm = { rule ->
                val idx = editingIndex
                if (idx != null) viewModel.updateRule(idx, rule) else viewModel.addRule(rule)
                showDialog = false
            },
            onDismiss = { showDialog = false }
        )
    }
}

@Composable
private fun SimFilterSection(
    savedSlots: List<Int>,
    simState: FilterSimState,
    onToggle: (Int) -> Boolean,
    onAllowAll: () -> Unit,
    onPermissionResult: () -> Unit
) {
    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
        Text("Receive from SIMs", style = MaterialTheme.typography.bodyLarge)
        Text(
            "Only SMS that arrive on a ticked SIM are forwarded",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        if (simState.permissionGranted) {
            SimList(savedSlots, simState.sims, onToggle, onAllowAll)
        } else {
            SimPermissionPrompt(savedSlots, onAllowAll, onPermissionResult)
        }
    }
}

@Composable
private fun SimPermissionPrompt(
    savedSlots: List<Int>,
    onAllowAll: () -> Unit,
    onPermissionResult: () -> Unit
) {
    val context = LocalContext.current
    var permissionDenied by rememberSaveable { mutableStateOf(false) }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        permissionDenied = !granted
        onPermissionResult()
    }

    Spacer(modifier = Modifier.height(8.dp))
    Text(
        if (savedSlots.isEmpty()) "Allow phone access to choose SIMs."
        else "Receiving only from ${savedSlots.joinToString(", ") { "SIM ${it + 1}" }}. " +
            "Allow phone access to change this.",
        style = MaterialTheme.typography.bodySmall
    )
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(onClick = {
            if (permissionDenied) {
                context.startActivity(
                    Intent(
                        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.fromParts("package", context.packageName, null)
                    )
                )
            } else {
                permissionLauncher.launch(Manifest.permission.READ_PHONE_STATE)
            }
        }) { Text(if (permissionDenied) "Open app settings" else "Allow phone access") }
        if (savedSlots.isNotEmpty()) {
            TextButton(onClick = onAllowAll) { Text("Receive from all SIMs") }
        }
    }
}

@Composable
private fun SimList(
    savedSlots: List<Int>,
    sims: List<FilterSimOption>,
    onToggle: (Int) -> Boolean,
    onAllowAll: () -> Unit
) {
    val presentSlots = sims.map { it.slot }
    val tickedSlots = if (savedSlots.isEmpty()) presentSlots else savedSlots

    (presentSlots + savedSlots).distinct().sorted().forEach { slot ->
        SimRow(
            label = simLabel(slot, sims.firstOrNull { it.slot == slot }),
            checked = slot in tickedSlots,
            onToggle = { onToggle(slot) }
        )
    }

    if (presentSlots.isNotEmpty() && savedSlots.isNotEmpty() && savedSlots.none { it in presentSlots }) {
        Text(
            "No allowed SIM is in the phone. All SMS are blocked.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error
        )
        TextButton(onClick = onAllowAll) { Text("Receive from all SIMs") }
    }
}

@Composable
private fun SimRow(label: String, checked: Boolean, onToggle: () -> Boolean) {
    val context = LocalContext.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .toggleable(value = checked, role = Role.Checkbox) {
                if (!onToggle()) {
                    Toast.makeText(
                        context,
                        "Keep at least one SIM. To stop all SMS, turn off Receive SMS.",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
            .padding(vertical = 4.dp)
    ) {
        // The row handles the tap, so the box itself is display only.
        Checkbox(checked = checked, onCheckedChange = null)
        Spacer(modifier = Modifier.width(8.dp))
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}

// "SIM 2 · Smart", "SIM 2", or "SIM 2 (not in phone)" for a saved slot.
private fun simLabel(slot: Int, sim: FilterSimOption?): String = when {
    sim == null -> "SIM ${slot + 1} (not in phone)"
    sim.carrier != null -> "SIM ${slot + 1} · ${sim.carrier}"
    else -> "SIM ${slot + 1}"
}

@Composable
private fun FilterRuleRow(
    rule: SMSFilterRule,
    onEdit: () -> Unit,
    onDelete: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onEdit)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = rule.pattern ?: "",
                fontWeight = FontWeight.SemiBold,
                style = MaterialTheme.typography.bodyLarge
            )
            Spacer(modifier = Modifier.height(4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                SuggestionChip(
                    onClick = {},
                    label = {
                        Text(
                            rule.matchType?.name?.replace('_', ' ')
                                ?.lowercase()?.replaceFirstChar { it.uppercaseChar() } ?: "",
                            style = MaterialTheme.typography.labelSmall
                        )
                    }
                )
                SuggestionChip(
                    onClick = {},
                    label = {
                        Text(
                            rule.filterTarget.name.lowercase().replaceFirstChar { it.uppercaseChar() },
                            style = MaterialTheme.typography.labelSmall
                        )
                    }
                )
                if (rule.caseSensitive) {
                    SuggestionChip(
                        onClick = {},
                        label = { Text("Case sensitive", style = MaterialTheme.typography.labelSmall) }
                    )
                }
            }
        }
        IconButton(onClick = onDelete) {
            Icon(
                Icons.Default.Delete,
                contentDescription = "Delete rule",
                tint = MaterialTheme.colorScheme.error
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FilterRuleDialog(
    rule: SMSFilterRule?,
    onConfirm: (SMSFilterRule) -> Unit,
    onDismiss: () -> Unit
) {
    var pattern by remember(rule) { mutableStateOf(rule?.pattern ?: "") }
    var matchType by remember(rule) {
        mutableStateOf(rule?.matchType ?: SMSFilterRule.MatchType.CONTAINS)
    }
    var filterTarget by remember(rule) {
        mutableStateOf(rule?.filterTarget ?: SMSFilterRule.FilterTarget.SENDER)
    }
    var caseSensitive by remember(rule) { mutableStateOf(rule?.caseSensitive ?: false) }
    var matchTypeExpanded by remember { mutableStateOf(false) }
    var filterTargetExpanded by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (rule == null) "Add Rule" else "Edit Rule") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = pattern,
                    onValueChange = { pattern = it },
                    label = { Text("Pattern") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                ExposedDropdownMenuBox(
                    expanded = filterTargetExpanded,
                    onExpandedChange = { filterTargetExpanded = !filterTargetExpanded }
                ) {
                    OutlinedTextField(
                        value = filterTarget.name.lowercase()
                            .replaceFirstChar { it.uppercaseChar() },
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Filter Target") },
                        trailingIcon = {
                            ExposedDropdownMenuDefaults.TrailingIcon(expanded = filterTargetExpanded)
                        },
                        modifier = Modifier.menuAnchor().fillMaxWidth()
                    )
                    ExposedDropdownMenu(
                        expanded = filterTargetExpanded,
                        onDismissRequest = { filterTargetExpanded = false }
                    ) {
                        SMSFilterRule.FilterTarget.values().forEach { target ->
                            DropdownMenuItem(
                                text = {
                                    Text(target.name.lowercase().replaceFirstChar { it.uppercaseChar() })
                                },
                                onClick = {
                                    filterTarget = target
                                    filterTargetExpanded = false
                                }
                            )
                        }
                    }
                }

                ExposedDropdownMenuBox(
                    expanded = matchTypeExpanded,
                    onExpandedChange = { matchTypeExpanded = !matchTypeExpanded }
                ) {
                    OutlinedTextField(
                        value = matchType.name.replace('_', ' ').lowercase()
                            .replaceFirstChar { it.uppercaseChar() },
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Match Type") },
                        trailingIcon = {
                            ExposedDropdownMenuDefaults.TrailingIcon(expanded = matchTypeExpanded)
                        },
                        modifier = Modifier.menuAnchor().fillMaxWidth()
                    )
                    ExposedDropdownMenu(
                        expanded = matchTypeExpanded,
                        onDismissRequest = { matchTypeExpanded = false }
                    ) {
                        SMSFilterRule.MatchType.values().forEach { type ->
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        type.name.replace('_', ' ').lowercase()
                                            .replaceFirstChar { it.uppercaseChar() }
                                    )
                                },
                                onClick = {
                                    matchType = type
                                    matchTypeExpanded = false
                                }
                            )
                        }
                    }
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        "Case sensitive",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f)
                    )
                    Switch(checked = caseSensitive, onCheckedChange = { caseSensitive = it })
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    onConfirm(SMSFilterRule(pattern.trim(), matchType, filterTarget, caseSensitive))
                },
                enabled = pattern.isNotBlank()
            ) { Text("Save") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}
