package com.vernu.sms.ui.dashboard

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.vernu.sms.helpers.CardAction
import com.vernu.sms.helpers.DeviceHealth
import com.vernu.sms.helpers.DeviceHealthRows
import com.vernu.sms.helpers.HomeCard
import com.vernu.sms.helpers.PermissionItem
import com.vernu.sms.helpers.SmsPermissionHelp

private val STRING_SET_SAVER = listSaver<Set<String>, String>(save = { it.toList() }, restore = { it.toSet() })

// The red and amber permission cards of the home screen, and what their buttons do
class PermissionBannersState(
    val redItems: List<PermissionItem>,
    val amberItems: List<PermissionItem>,
    val redAction: CardAction?,
    val amberAction: CardAction?,
    val act: (CardAction) -> Unit
) {
    val hasRed get() = redItems.isNotEmpty()
    val hasAmber get() = amberItems.isNotEmpty()
}

@Composable
fun rememberPermissionBanners(receiveSmsEnabled: Boolean): PermissionBannersState {
    val context = LocalContext.current
    val activity = remember(context) { SmsPermissionHelp.findActivity(context) }
    var health by remember { mutableStateOf(DeviceHealth.evaluate(context)) }
    val permissionItems = remember(health, receiveSmsEnabled) {
        DeviceHealthRows.permissionItems(health, receiveSmsEnabled)
    }
    // Set when the dialog returns, so the blocked state is not read while it is open
    var requested by rememberSaveable(stateSaver = STRING_SET_SAVER) { mutableStateOf(emptySet()) }
    // The permissions of the open dialog. A cancelled request returns no keys, so they come from here.
    var pending by rememberSaveable(stateSaver = STRING_SET_SAVER) { mutableStateOf(emptySet()) }
    // Bumped after each request and resume, so the blocked state is read again
    var checks by remember { mutableStateOf(0) }

    val sendSmsMissing = !health.hasSendSmsPermission
    val sendSmsMissingAtStart = remember { sendSmsMissing }
    LaunchedEffect(sendSmsMissing) {
        if (!sendSmsMissing && sendSmsMissingAtStart) SmsPermissionHelp.reportGranted(context)
    }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        requested = requested + pending + results.keys
        pending = emptySet()
        health = DeviceHealth.evaluate(context)
        checks++
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                health = DeviceHealth.evaluate(context)
                checks++
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val redPermissions = DeviceHealthRows.homeRequest(HomeCard.RED, permissionItems)
    val amberPermissions = DeviceHealthRows.homeRequest(HomeCard.AMBER, permissionItems)
    // Android no longer shows the dialog for these
    val blocked = remember(redPermissions, amberPermissions, requested, checks) {
        (redPermissions + amberPermissions).filter {
            SmsPermissionHelp.isBlocked(
                granted = false,
                requestedBefore = it in requested,
                canShowRationale = SmsPermissionHelp.canShowRationale(activity, it)
            )
        }.toSet()
    }

    return PermissionBannersState(
        redItems = permissionItems.filter { it.homeCard == HomeCard.RED },
        amberItems = permissionItems.filter { it.homeCard == HomeCard.AMBER },
        redAction = DeviceHealthRows.cardAction(redPermissions, blocked),
        amberAction = DeviceHealthRows.cardAction(amberPermissions, blocked),
        act = { action ->
            when (action) {
                is CardAction.Ask -> {
                    pending = action.permissions.toSet()
                    launcher.launch(action.permissions.toTypedArray())
                }
                CardAction.OpenSettings -> SmsPermissionHelp.openAppSettings(context)
            }
        }
    )
}

@Composable
fun RedPermissionCard(state: PermissionBannersState) {
    val action = state.redAction ?: return
    if (!state.hasRed) return
    val context = LocalContext.current
    val settingsOnly = action == CardAction.OpenSettings
    DashboardBanner(
        tone = BannerTone.ERROR,
        title = "Permission required",
        lines = state.redItems.map { "${it.title}: ${it.detail}" },
        actionLabel = if (settingsOnly) "Open app settings" else "Allow",
        onAction = { state.act(action) },
        steps = settingsOnly,
        onOpenGuide = { SmsPermissionHelp.openGuide(context) }
    )
}

@Composable
fun AmberPermissionCard(state: PermissionBannersState) {
    val action = state.amberAction ?: return
    if (!state.hasAmber) return
    DashboardBanner(
        tone = BannerTone.WARNING,
        title = "Optional permission",
        lines = state.amberItems.map { "${it.title}: ${it.detail}" },
        actionLabel = if (action == CardAction.OpenSettings) "Open app settings" else "Allow",
        onAction = { state.act(action) },
        filledAction = false
    )
}
