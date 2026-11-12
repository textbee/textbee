package com.vernu.sms.helpers

import android.content.Context
import android.os.Build
import android.util.Log
import com.vernu.sms.dtos.HeartbeatInputDTO
import com.vernu.sms.dtos.RegisterDeviceInputDTO

/** How the app was installed, as Android reports it. The server decides what it means. */
data class InstallSourceReport(
    val installerPackage: String,
    val initiatingPackage: String?,
    val appLastUpdateTime: Long
)

/** The Android calls, split out so tests can replace them. */
interface InstallSourceReader {
    /** Installing and initiating package, API 30 and newer. */
    fun installSourceInfo(): Pair<String?, String?>

    /** Installing package, before API 30. */
    fun legacyInstaller(): String?

    fun lastUpdateTime(): Long
}

object InstallSource {
    private const val TAG = "InstallSource"

    @Volatile
    private var cached: InstallSourceReport? = null

    /** Null when the lookup fails. The caller then leaves the fields out. */
    @JvmStatic
    fun get(context: Context): InstallSourceReport? {
        val appContext = context.applicationContext ?: context
        val result = resolve(Build.VERSION.SDK_INT, object : InstallSourceReader {
            override fun installSourceInfo(): Pair<String?, String?> {
                val info = appContext.packageManager.getInstallSourceInfo(appContext.packageName)
                return Pair(info.installingPackageName, info.initiatingPackageName)
            }

            @Suppress("DEPRECATION")
            override fun legacyInstaller(): String? =
                appContext.packageManager.getInstallerPackageName(appContext.packageName)

            override fun lastUpdateTime(): Long =
                appContext.packageManager.getPackageInfo(appContext.packageName, 0).lastUpdateTime
        })
        if (result == null) Log.d(TAG, "Could not read install source")
        return result
    }

    /** Looks up once per process. A failed lookup is not cached. */
    fun resolve(sdkInt: Int, reader: InstallSourceReader): InstallSourceReport? {
        cached?.let { return it }
        return try {
            val installing: String?
            val initiating: String?
            if (sdkInt >= Build.VERSION_CODES.R) {
                val info = reader.installSourceInfo()
                installing = info.first
                initiating = info.second
            } else {
                installing = reader.legacyInstaller()
                initiating = null
            }
            report(sdkInt, installing, initiating, reader.lastUpdateTime()).also { cached = it }
        } catch (e: Exception) {
            null
        }
    }

    /** An unknown installer is an empty string, so it differs from a build that does not report. */
    fun report(
        sdkInt: Int,
        installing: String?,
        initiating: String?,
        lastUpdateTime: Long
    ): InstallSourceReport = InstallSourceReport(
        installerPackage = installing ?: "",
        initiatingPackage = if (sdkInt >= Build.VERSION_CODES.R) initiating else null,
        appLastUpdateTime = lastUpdateTime
    )

    fun resetCache() {
        cached = null
    }

    @JvmStatic
    fun applyTo(dto: RegisterDeviceInputDTO, context: Context) = applyTo(dto, get(context))

    @JvmStatic
    fun applyTo(dto: HeartbeatInputDTO, context: Context) = applyTo(dto, get(context))

    fun applyTo(dto: RegisterDeviceInputDTO, report: InstallSourceReport?) {
        if (report == null) return
        dto.installerPackage = report.installerPackage
        dto.initiatingPackage = report.initiatingPackage
        dto.appLastUpdateTime = report.appLastUpdateTime
    }

    fun applyTo(dto: HeartbeatInputDTO, report: InstallSourceReport?) {
        if (report == null) return
        dto.installerPackage = report.installerPackage
        dto.initiatingPackage = report.initiatingPackage
        dto.appLastUpdateTime = report.appLastUpdateTime
    }
}
