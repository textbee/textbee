// How the app reached the device, read from the installer package the phone reports.

export const INSTALL_SOURCES = ['apk', 'play_store', 'other_store', 'unknown'] as const

export type InstallSource = (typeof INSTALL_SOURCES)[number]

const PLAY_STORE = 'com.android.vending'

const OTHER_STORES = new Set([
  'com.sec.android.app.samsungapps',
  'com.huawei.appmarket',
  'com.amazon.venezia',
  'com.xiaomi.mipicks',
  'com.oppo.market',
  'com.heytap.market',
  'org.fdroid.fdroid',
  'com.aurora.store',
])

// undefined means the build does not report an installer; any other unlisted name is an APK install
export function installSourceFor(installerPackage: string | undefined): InstallSource {
  if (installerPackage === undefined) return 'unknown'
  if (installerPackage === PLAY_STORE) return 'play_store'
  if (OTHER_STORES.has(installerPackage)) return 'other_store'
  return 'apk'
}
