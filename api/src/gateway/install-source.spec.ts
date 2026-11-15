import { installSourceFor } from './install-source'

describe('installSourceFor', () => {
  it('reads the Play Store installer as play_store', () => {
    expect(installSourceFor('com.android.vending')).toBe('play_store')
  })

  it.each([
    'com.sec.android.app.samsungapps',
    'com.huawei.appmarket',
    'com.amazon.venezia',
    'com.xiaomi.mipicks',
    'com.oppo.market',
    'com.heytap.market',
    'org.fdroid.fdroid',
    'com.aurora.store',
  ])('reads %s as other_store', (installer) => {
    expect(installSourceFor(installer)).toBe('other_store')
  })

  it.each([
    '',
    'com.google.android.packageinstaller',
    'com.android.packageinstaller',
    'com.miui.packageinstaller',
    'com.android.shell',
    'com.android.chrome',
  ])('reads "%s" as apk', (installer) => {
    expect(installSourceFor(installer)).toBe('apk')
  })

  it('reads a field that was not sent as unknown', () => {
    expect(installSourceFor(undefined)).toBe('unknown')
  })
})
