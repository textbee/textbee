import {
  ErrorHistorySource,
  isStatusTimeoutNote,
  storedErrorHistory,
} from './error-history'
import { currentFailureSource } from './status-report-decision'

// One catalog for every failure code a message can carry. Stored data keeps
// what the phone or the server wrote; the text here is applied when a message
// is read, so a fix to the text reaches old messages and old app versions.

// Where the code comes from, as in the trail: device, push or server
export type SmsError = {
  source: ErrorHistorySource
  code: string
  // a delivery report from the phone that did not confirm delivery, not a
  // send result
  deliveryReport?: boolean
  // also matches codes that start with code + '_'
  matchPrefix?: boolean
  // stable, for code that matches on it
  name: string
  // what happened and the fix
  message: string
  // true when the same send can succeed later without a change: the cause
  // is often temporary. false when something must change first.
  retryable: boolean
  // page and section in the public docs
  docsAnchor?: string
}

export const DOCS_ORIGIN = 'https://textbee.dev'

const DOCS_SENDING = '/docs/troubleshooting/messages-not-sending'
const PERMISSION_DOCS = `${DOCS_SENDING}#3-does-the-app-have-the-sms-permission`
const SEND_CAP_DOCS = `${DOCS_SENDING}#7-androids-own-outgoing-sms-cap`
const RECONNECT_DOCS = `${DOCS_SENDING}#8-when-to-reconnect-the-device`
const SHORT_CODE_DOCS = '/docs/sending-sms/sending-sms#short-codes'

const PREMIUM_SMS_FIX =
  'In Android settings, open Special app access > Premium SMS access and set textbee to Always allow.'
const RESTART_FIX = 'Restart the phone, then send the message again.'
const WAIT_FIX = 'Wait a moment, then send the message again.'
const SIGNAL_FIX =
  'Check the signal and the SMS credit on the SIM, then send the message again.'
const MODEM_FIX =
  'Check the signal and the SIM, or restart the phone, then send the message again.'
const RECONNECT_FIX =
  'Open the textbee app on the phone and register it again with the same device id.'

function device(
  code: number | string,
  name: string,
  message: string,
  retryable: boolean,
  docsAnchor?: string,
): SmsError {
  return {
    source: 'device',
    code: String(code),
    name,
    message,
    retryable,
    docsAnchor,
  }
}

// A carrier delivery report that says the SMS was not delivered. The phone
// sends CARRIER_ and the TP-Status in hex (3GPP TS 23.040 section 9.2.3.15).
// The API stores it as a failure, not as a delivery report note.
function carrier(
  status: number,
  name: string,
  message: string,
  retryable: boolean,
): SmsError {
  return {
    source: 'device',
    code: `CARRIER_0x${status.toString(16).toUpperCase().padStart(2, '0')}`,
    name,
    message,
    retryable,
  }
}

const CHECK_NUMBER = 'Check the recipient number.'
const LATER = 'Send the message again later.'

// Send results are Android SmsManager result codes, see
// https://developer.android.com/reference/android/telephony/SmsManager
export const SMS_ERRORS: readonly SmsError[] = [
  device(
    1,
    'GENERIC_FAILURE',
    `The phone could not send the SMS, and Android gave no exact reason. ${SIGNAL_FIX}`,
    true,
  ),
  device(
    2,
    'RADIO_OFF',
    'The mobile radio on the phone is off, for example in airplane mode. Turn off airplane mode and turn on mobile service, then send the message again.',
    false,
  ),
  device(
    3,
    'NULL_PDU',
    'Android could not build an SMS from this message. Check that the message is not empty, or send a shorter message.',
    false,
  ),
  device(
    4,
    'NO_SERVICE',
    'The phone has no mobile service. Move the phone to a place with coverage or check the SIM, then send the message again.',
    true,
  ),
  device(
    5,
    'LIMIT_EXCEEDED',
    'Android stopped the send because the app sent too many SMS in a short time. Increase the Send Delay in the app or wait a few minutes, then send the message again.',
    true,
    SEND_CAP_DOCS,
  ),
  device(
    6,
    'FDN_CHECK_FAILURE',
    'The SIM has Fixed Dialing Numbers (FDN) turned on, and this number is not on the allowed list. Turn off FDN in the phone call settings or add the number, then send the message again.',
    false,
  ),
  device(
    7,
    'SHORT_CODE_CANCELLED',
    `The phone asked whether textbee may text this short code, and nobody allowed it, for example someone tapped Cancel. Send the message again and tap Send on the phone. To stop the prompt, tick Remember my choice, or set textbee to Always allow in Android settings, Special app access > Premium SMS access.`,
    false,
    SHORT_CODE_DOCS,
  ),
  device(
    8,
    'SHORT_CODE_NEVER_ALLOWED',
    `textbee is set to Never allow in Premium SMS access, so the phone blocks texts to short codes. ${PREMIUM_SMS_FIX}`,
    false,
    SHORT_CODE_DOCS,
  ),
  device(
    9,
    'RADIO_NOT_AVAILABLE',
    `The mobile radio on the phone was not available, for example while it restarted. ${WAIT_FIX}`,
    true,
  ),
  device(
    10,
    'NETWORK_REJECT',
    'The mobile network rejected the SMS. Check that the SIM has SMS credit and can text this number.',
    false,
  ),
  device(
    11,
    'INVALID_ARGUMENTS',
    'Android rejected the send request as not valid. Check the recipient number and the message text.',
    false,
  ),
  device(
    12,
    'INVALID_STATE',
    `The SMS service on the phone was in a state that cannot send. ${RESTART_FIX}`,
    true,
  ),
  device(
    13,
    'NO_MEMORY',
    `The phone ran out of memory during the send. ${RESTART_FIX}`,
    true,
  ),
  device(
    14,
    'INVALID_SMS_FORMAT',
    'Android reported that the SMS format is not valid. Check the recipient number, or send a shorter message.',
    false,
  ),
  device(
    15,
    'SYSTEM_ERROR',
    `Android reported a system error during the send. ${RESTART_FIX}`,
    true,
  ),
  device(
    16,
    'MODEM_ERROR',
    `The modem on the phone reported an error during the send. ${MODEM_FIX}`,
    true,
  ),
  device(
    17,
    'NETWORK_ERROR',
    'A network error stopped the send. Check the signal, then send the message again.',
    true,
  ),
  device(
    18,
    'ENCODING_ERROR',
    'Android could not encode the message text. Remove unusual characters, or send a shorter message.',
    false,
  ),
  device(
    19,
    'INVALID_SMSC_ADDRESS',
    'The SMS center number (SMSC) on the SIM is not valid. Get the correct SMS center number from the carrier and set it on the phone.',
    false,
  ),
  device(
    20,
    'OPERATION_NOT_ALLOWED',
    'Android or the SIM does not allow this send. Check that the SIM can send SMS.',
    false,
  ),
  device(
    21,
    'INTERNAL_ERROR',
    `Android reported an internal error during the send. ${RESTART_FIX}`,
    true,
  ),
  device(
    22,
    'NO_RESOURCES',
    `The phone did not have the resources to send at that moment. ${WAIT_FIX}`,
    true,
  ),
  device(
    23,
    'CANCELLED',
    'Android cancelled the send. Send the message again.',
    true,
  ),
  device(
    24,
    'REQUEST_NOT_SUPPORTED',
    'The phone or the SIM does not support this send request. Use a different SIM or phone.',
    false,
  ),
  device(
    25,
    'NO_BLUETOOTH_SERVICE',
    'Android tried to send through a Bluetooth link, and the Bluetooth service was not available. Turn off Bluetooth on the phone, then send the message again.',
    true,
  ),
  device(
    26,
    'INVALID_BLUETOOTH_ADDRESS',
    'Android tried to send through a Bluetooth link, and the Bluetooth device address was not valid. Turn off Bluetooth on the phone, then send the message again.',
    true,
  ),
  device(
    27,
    'BLUETOOTH_DISCONNECTED',
    'Android tried to send through a Bluetooth link, and the link disconnected. Turn off Bluetooth on the phone, then send the message again.',
    true,
  ),
  device(
    28,
    'CONFIRMATION_DENIED',
    'The phone asked for permission to send, for a short code or for many texts in a short time, and the request was denied. Allow the send when the phone asks, or set textbee to Always allow in Special app access > Premium SMS access.',
    false,
    SHORT_CODE_DOCS,
  ),
  device(
    29,
    'BLOCKED_DURING_EMERGENCY',
    'Android blocks SMS during an emergency call. Send the message again after the call ends.',
    true,
  ),
  device(
    30,
    'SEND_RETRY_FAILED',
    'Android sent the SMS again after a failure, and that try also failed. Check the signal, then send the message again.',
    true,
  ),
  device(
    31,
    'REMOTE_EXCEPTION',
    `An Android system service failed during the send. ${RESTART_FIX}`,
    true,
  ),
  device(
    32,
    'NO_DEFAULT_SMS_APP',
    'Android needs a default SMS app on this phone, and none is set. Set a default SMS app in Android settings, then send the message again.',
    false,
  ),
  device(
    33,
    'USER_NOT_ALLOWED',
    'The Android user profile that runs textbee is not linked to this SIM. Run textbee in the main user profile of the phone.',
    false,
  ),
  device(
    100,
    'RIL_RADIO_NOT_AVAILABLE',
    `The mobile radio did not start, or it was restarting. ${WAIT_FIX}`,
    true,
  ),
  device(
    101,
    'RIL_SMS_SEND_FAIL_RETRY',
    'The mobile radio could not send the SMS. Check the signal, then send the message again.',
    true,
  ),
  device(
    102,
    'RIL_NETWORK_REJECT',
    'The mobile network rejected the SMS. Check that the SIM has SMS credit and can text this number.',
    false,
  ),
  device(
    103,
    'RIL_INVALID_STATE',
    `The mobile radio was in a state that cannot send. ${RESTART_FIX}`,
    true,
  ),
  device(
    104,
    'RIL_INVALID_ARGUMENTS',
    'The mobile radio rejected the send request as not valid. Check the recipient number and the message text.',
    false,
  ),
  device(
    105,
    'RIL_NO_MEMORY',
    `The mobile radio did not have enough memory to send. ${RESTART_FIX}`,
    true,
  ),
  device(
    106,
    'RIL_REQUEST_RATE_LIMITED',
    'The mobile radio refused the send because sends came too often. Increase the Send Delay in the app, then send the message again.',
    true,
    SEND_CAP_DOCS,
  ),
  device(
    107,
    'RIL_INVALID_SMS_FORMAT',
    'The mobile radio reported that the SMS format is not valid. Check the recipient number, or send a shorter message.',
    false,
  ),
  device(
    108,
    'RIL_SYSTEM_ERR',
    `The mobile radio reported a system error. ${RESTART_FIX}`,
    true,
  ),
  device(
    109,
    'RIL_ENCODING_ERR',
    'The mobile radio could not encode the message text. Remove unusual characters, or send a shorter message.',
    false,
  ),
  device(
    110,
    'RIL_INVALID_SMSC_ADDRESS',
    'The SMS center number (SMSC) on the SIM is not valid. Get the correct SMS center number from the carrier and set it on the phone.',
    false,
  ),
  device(
    111,
    'RIL_MODEM_ERR',
    `The modem on the phone gave an unexpected response. ${MODEM_FIX}`,
    true,
  ),
  device(
    112,
    'RIL_NETWORK_ERR',
    `The mobile network returned an error. ${SIGNAL_FIX}`,
    true,
  ),
  device(
    113,
    'RIL_INTERNAL_ERR',
    `The modem had an unexpected error. ${RESTART_FIX}`,
    true,
  ),
  device(
    114,
    'RIL_REQUEST_NOT_SUPPORTED',
    'The mobile radio does not support this send request. Use a different SIM or phone.',
    false,
  ),
  device(
    115,
    'RIL_INVALID_MODEM_STATE',
    `The modem was in a state that cannot send. ${RESTART_FIX}`,
    true,
  ),
  device(
    116,
    'RIL_NETWORK_NOT_READY',
    'The mobile network was not ready. Wait for a stable signal, then send the message again.',
    true,
  ),
  device(
    117,
    'RIL_OPERATION_NOT_ALLOWED',
    'The mobile radio does not allow this send. Check that the SIM can send SMS.',
    false,
  ),
  device(
    118,
    'RIL_NO_RESOURCES',
    `The mobile radio did not have the resources to send at that moment. ${WAIT_FIX}`,
    true,
  ),
  device(
    119,
    'RIL_CANCELLED',
    'The mobile radio cancelled the send. Send the message again.',
    true,
  ),
  device(
    120,
    'RIL_SIM_ABSENT',
    'The phone could not find the SIM. Check that the SIM is in the phone and active.',
    false,
  ),
  device(
    121,
    'RIL_SMS_DURING_CALL_NOT_ALLOWED',
    'The network does not allow SMS during a voice call. Send the message again after the call ends.',
    true,
  ),
  device(
    122,
    'RIL_ACCESS_BARRED',
    'The mobile network does not let this SIM send. Ask the carrier to check the SMS service on the SIM.',
    false,
  ),
  device(
    123,
    'RIL_BLOCKED_DUE_TO_CALL',
    'The network blocked the SMS because of a call in progress. Send the message again after the call ends.',
    true,
  ),
  device(
    124,
    'RIL_GENERIC_ERROR',
    `The mobile radio reported an error, with no exact reason. ${SIGNAL_FIX}`,
    true,
  ),
  device(
    125,
    'RIL_INVALID_RESPONSE',
    `The mobile radio got a response it did not recognize. ${RESTART_FIX}`,
    true,
  ),
  device(
    126,
    'RIL_SIM_PIN2',
    'The SIM needs its PIN2 code for this send. Enter PIN2 on the phone, or turn off Fixed Dialing Numbers (FDN).',
    false,
  ),
  device(
    127,
    'RIL_SIM_PUK2',
    'The PIN2 code of the SIM is locked. Get the PUK2 code from the carrier and unlock it.',
    false,
  ),
  device(
    128,
    'RIL_SUBSCRIPTION_NOT_AVAILABLE',
    'The phone could not find the subscription of the SIM. Check that the SIM is active.',
    false,
  ),
  device(
    129,
    'RIL_SIM_ERROR',
    'The SIM card returned an error. Take out the SIM and put it back, or restart the phone, then send the message again.',
    false,
  ),
  device(
    130,
    'RIL_INVALID_SIM_STATE',
    'The SIM was in a state that cannot send, for example locked or still starting. Unlock the SIM or wait, then send the message again.',
    true,
  ),
  device(
    131,
    'RIL_NO_SMS_TO_ACK',
    'The mobile radio reported an acknowledgement error. Send the message again.',
    true,
  ),
  device(132, 'RIL_SIM_BUSY', `The SIM was busy. ${WAIT_FIX}`, true),
  device(
    133,
    'RIL_SIM_FULL',
    'The storage on the SIM is full. Delete old messages stored on the SIM, then send the message again.',
    false,
  ),
  device(
    134,
    'RIL_NO_SUBSCRIPTION',
    'The phone has no active SIM subscription for this send. Check that the SIM is in the phone and active, or select a different SIM.',
    false,
  ),
  device(
    135,
    'RIL_NO_NETWORK_FOUND',
    'The phone found no mobile network. Move the phone to a place with coverage, then send the message again.',
    true,
  ),
  device(
    136,
    'RIL_DEVICE_IN_USE',
    `The mobile radio was busy with another task. ${WAIT_FIX}`,
    true,
  ),
  device(
    137,
    'RIL_ABORTED',
    'The mobile radio stopped the send before it finished. Send the message again.',
    true,
  ),
  device(
    138,
    'SEND_FAILED_AFTER_MAX_RETRY',
    `Android tried the send as many times as it allows, and every try failed. ${SIGNAL_FIX}`,
    true,
  ),

  // Written by the textbee app, not by Android
  device(
    'PERMISSION_DENIED',
    'PERMISSION_DENIED',
    'textbee does not have the SMS permission on the phone. Open the textbee app on the phone and allow the SMS permission, then send the message again.',
    false,
    PERMISSION_DOCS,
  ),
  device(
    'SEND_INTERRUPTED',
    'SEND_INTERRUPTED',
    'The textbee app stopped after it handed the message to the mobile radio and before the result arrived. The message may have been sent, and the phone does not send it again. Check with the recipient before you send it again.',
    false,
  ),
  device(
    'SIM_SLOT_EMPTY',
    'SIM_SLOT_EMPTY',
    'The phone has no active SIM in the slot this message asked for. Put a SIM in that slot or choose another SIM, then send the message again.',
    false,
  ),
  device(
    'SENDING_EXCEPTION',
    'SENDING_EXCEPTION',
    'Android stopped the send with an error before it reached the mobile radio, and deviceMessage has the error. Check the recipient number and the selected SIM, then send the message again.',
    false,
  ),

  // Delivery reports. Android Activity.RESULT_CANCELED is 0.
  {
    source: 'device',
    code: '0',
    deliveryReport: true,
    name: 'DELIVERY_REPORT_CANCELLED',
    message:
      'The phone sent the SMS, but the carrier sent no delivery report, often because it does not support them. The message can still have arrived.',
    retryable: false,
  },

  // Carrier delivery reports: the carrier gave up on the SMS
  carrier(
    0x40,
    'CARRIER_NETWORK_ERROR',
    `The carrier could not deliver the SMS because of an error in its network, and it stopped trying. ${LATER}`,
    true,
  ),
  carrier(
    0x41,
    'CARRIER_INCOMPATIBLE_DESTINATION',
    `The carrier could not deliver the SMS because the recipient number cannot receive it, for example a landline. ${CHECK_NUMBER}`,
    false,
  ),
  carrier(
    0x42,
    'CARRIER_REJECTED_BY_RECIPIENT',
    `The phone or network of the recipient refused the SMS, and the carrier stopped trying. ${CHECK_NUMBER}`,
    false,
  ),
  carrier(
    0x43,
    'CARRIER_NOT_OBTAINABLE',
    `The carrier could not reach the recipient, often because the number does not exist or is not in service. ${CHECK_NUMBER}`,
    false,
  ),
  carrier(
    0x44,
    'CARRIER_SERVICE_UNAVAILABLE',
    `The carrier could not give the SMS the service it needs, and it stopped trying. ${LATER}`,
    true,
  ),
  carrier(
    0x45,
    'CARRIER_NO_ROUTE',
    `The carrier has no route to the network of the recipient. ${CHECK_NUMBER} You can also send from a SIM on another carrier.`,
    false,
  ),
  carrier(
    0x46,
    'CARRIER_EXPIRED',
    `The carrier tried to deliver the SMS until it expired, often because the phone of the recipient was off or out of coverage. ${LATER}`,
    true,
  ),
  carrier(
    0x47,
    'CARRIER_DELETED_BY_SENDER',
    'The SMS was deleted at the carrier before delivery, on a request from the sending side. Send the message again.',
    true,
  ),
  carrier(
    0x48,
    'CARRIER_DELETED_BY_CARRIER',
    'The carrier deleted the SMS before delivery, often because of a spam filter or a block on the sender. Contact the carrier of the sending SIM.',
    false,
  ),
  carrier(
    0x49,
    'CARRIER_MESSAGE_UNKNOWN',
    'The carrier has no record of the SMS, so it could not deliver it. Send the message again.',
    true,
  ),
  carrier(
    0x60,
    'CARRIER_CONGESTION',
    `The network of the carrier was too busy to deliver the SMS, and the carrier stopped trying. ${LATER}`,
    true,
  ),
  carrier(
    0x61,
    'CARRIER_RECIPIENT_BUSY',
    `The phone of the recipient was busy, and the carrier stopped trying. ${LATER}`,
    true,
  ),
  carrier(
    0x62,
    'CARRIER_NO_RESPONSE',
    `The phone of the recipient did not answer, often because it was off or out of coverage, and the carrier stopped trying. ${LATER}`,
    true,
  ),
  carrier(
    0x63,
    'CARRIER_SERVICE_REJECTED',
    `The network of the recipient refused the SMS, for example because the number cannot receive SMS or blocks the sender. ${CHECK_NUMBER}`,
    false,
  ),
  carrier(
    0x64,
    'CARRIER_SERVICE_UNAVAILABLE_TEMPORARY',
    `The carrier could not give the SMS the service it needs for a while, and it stopped trying. ${LATER}`,
    true,
  ),
  carrier(
    0x65,
    'CARRIER_RECIPIENT_PHONE_ERROR',
    'The phone of the recipient reported an error, for example a full SMS memory, and the carrier stopped trying. Ask the recipient to free space on the phone, then send the message again.',
    false,
  ),
  {
    source: 'device',
    code: 'CARRIER',
    matchPrefix: true,
    name: 'CARRIER_DELIVERY_FAILED',
    message:
      'The carrier sent a delivery report that says the SMS was not delivered, and it stopped trying. The code holds the status value from the carrier.',
    retryable: true,
  },

  // The push to the phone
  {
    source: 'push',
    code: 'FCM_TOKEN_NOT_REGISTERED',
    name: 'PUSH_TOKEN_NOT_REGISTERED',
    message: `The push service does not know this phone anymore, so the message did not reach it. ${RECONNECT_FIX}`,
    retryable: false,
    docsAnchor: RECONNECT_DOCS,
  },
  {
    source: 'push',
    code: 'FCM_INVALID_REGISTRATION_TOKEN',
    name: 'PUSH_REQUEST_REJECTED',
    message: `The push service rejected the push to this phone, often because the push token of the phone is out of date or the message is very long. ${RECONNECT_FIX}`,
    retryable: false,
    docsAnchor: RECONNECT_DOCS,
  },
  {
    source: 'push',
    code: 'FCM_PROJECT_MISMATCH',
    name: 'PUSH_PROJECT_MISMATCH',
    message: `The phone is registered with a different push project than this server, so the message did not reach it. ${RECONNECT_FIX}`,
    retryable: false,
    docsAnchor: RECONNECT_DOCS,
  },
  {
    source: 'push',
    code: 'FCM_DELIVERY_FAILED_messaging/message-rate-exceeded',
    name: 'PUSH_RATE_LIMITED',
    message:
      'The push service limits how many messages one phone can get in a short time, and this phone reached the limit. Send fewer messages at once, then send the message again.',
    retryable: true,
  },
  {
    source: 'push',
    code: 'FCM_DELIVERY_FAILED',
    name: 'PUSH_FAILED',
    message:
      'The push service could not deliver the message to the phone. Send the message again, and if it fails again, register the phone again from the textbee app.',
    retryable: true,
    docsAnchor: RECONNECT_DOCS,
    matchPrefix: true,
  },
  {
    source: 'push',
    code: 'FCM_SEND_TIMEOUT',
    name: 'PUSH_TIMEOUT',
    message:
      'The push to the phone did not finish in time. The phone can still get the message, so check the message status before you send it again.',
    retryable: true,
  },
  {
    source: 'push',
    code: 'FCM_SEND_ERROR',
    name: 'PUSH_SEND_ERROR',
    message:
      'textbee could not reach the push service. Send the message again.',
    retryable: true,
  },
  {
    source: 'push',
    code: 'FCM_SEND_SKIPPED',
    name: 'PUSH_SKIPPED',
    message:
      'textbee did not push this message to the phone, because pushes are paused for this account or device.',
    retryable: false,
  },

  // The server
  {
    source: 'server',
    code: 'DISPATCH_FAILED',
    name: 'DISPATCH_FAILED',
    message:
      'textbee could not hand the message to the push service. Send the message again.',
    retryable: true,
  },
  {
    source: 'server',
    code: 'QUEUE_ADD_FAILED',
    name: 'QUEUE_ADD_FAILED',
    message:
      'textbee could not add the message to the send queue. Send the message again.',
    retryable: true,
  },
  {
    source: 'server',
    code: 'SEND_TIMEOUT',
    name: 'SEND_TIMEOUT',
    message:
      'The push to the phone was rejected and the phone did not collect the message in time. The message was not sent. Send it again.',
    retryable: true,
  },
]

const keyOf = (source: string, code: string, deliveryReport: boolean) =>
  `${source}:${deliveryReport ? 'delivery:' : ''}${code}`

const BY_KEY = new Map(
  SMS_ERRORS.map((entry) => [
    keyOf(entry.source, entry.code, entry.deliveryReport === true),
    entry,
  ]),
)
const PREFIXED = SMS_ERRORS.filter((entry) => entry.matchPrefix)

/** The catalog entry for a code, or undefined when the code is not known. */
export function findSmsError(
  source: ErrorHistorySource | 'fcm',
  code: unknown,
  { deliveryReport = false }: { deliveryReport?: boolean } = {},
): SmsError | undefined {
  const text = typeof code === 'string' ? code.trim() : ''
  if (!text) return undefined
  // A numeric code means something only from the source that sent it
  const from = source === 'fcm' ? 'push' : source
  return (
    BY_KEY.get(keyOf(from, text, deliveryReport)) ??
    PREFIXED.find(
      (entry) =>
        entry.source === from &&
        (entry.deliveryReport === true) === deliveryReport &&
        text.startsWith(`${entry.code}_`),
    )
  )
}

/** The full docs link of an entry, when it has one. */
export function smsErrorDocsUrl(entry: SmsError): string | undefined {
  return entry.docsAnchor ? `${DOCS_ORIGIN}${entry.docsAnchor}` : undefined
}

// The radio cause the phone adds to a code 1 failure, as in "(code 21)"
const RADIO_CODE = /\(code (-?\d+)\)\s*$/

// The API stores this when the phone sends no text, so it is not the phone's
const NO_TEXT_PLACEHOLDER = 'Unknown error'

function catalogText(entry: SmsError, stored: string | undefined): string {
  const radio =
    entry.source === 'device' &&
    !entry.deliveryReport &&
    entry.code === '1' &&
    stored?.match(RADIO_CODE)
  return radio ? `${entry.message} (code ${radio[1]})` : entry.message
}

type ErrorText = {
  message: string
  name: string
  deviceMessage?: string
  docsUrl?: string
}

function errorText(
  entry: SmsError,
  source: ErrorHistorySource,
  stored: unknown,
): ErrorText {
  const original = typeof stored === 'string' && stored ? stored : undefined
  const message = catalogText(entry, original)
  const deviceMessage =
    source === 'device' &&
    original &&
    original !== message &&
    original !== NO_TEXT_PLACEHOLDER
      ? original
      : undefined
  return {
    message,
    name: entry.name,
    deviceMessage,
    docsUrl: smsErrorDocsUrl(entry),
  }
}

function toDate(value: unknown): Date | undefined {
  if (value == null) return undefined
  const date = value instanceof Date ? value : new Date(value as string)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function sourceOf(value: unknown): ErrorHistorySource {
  if (value === 'fcm' || value === 'push') return 'push'
  if (value === 'server') return 'server'
  return 'device'
}

export type SmsErrorFields = {
  errorMessage?: string
  errorName?: string
  deviceMessage?: string
  docsUrl?: string
  issueHistory?: Record<string, unknown>[]
}

/**
 * The error fields of a stored message as the API returns them: catalog text
 * for known codes, the stored text otherwise. Only fields that change are
 * returned, so the caller merges them over the message.
 */
export function smsErrorFields(sms: any): SmsErrorFields {
  const fields: SmsErrorFields = {}
  if (!sms) return fields

  const code = typeof sms.errorCode === 'string' ? sms.errorCode.trim() : ''
  if (code) {
    const stored = {
      errorCode: code,
      errorMessage: sms.errorMessage,
      failedAt: toDate(sms.failedAt),
      issueHistory: sms.issueHistory,
    }
    const source = currentFailureSource(stored, storedErrorHistory(stored))
    const entry = findSmsError(source, code)
    if (entry) {
      fields.errorName = entry.name
      const docsUrl = smsErrorDocsUrl(entry)
      if (docsUrl) fields.docsUrl = docsUrl
      const text = sms.errorMessage
      // The timeout note is not about this code. A code with no text, such as
      // the push-skip marker on a sent message, gets no text either.
      const describesFailure =
        !isStatusTimeoutNote(text) &&
        ((typeof text === 'string' && text !== '') || sms.status === 'failed')
      if (describesFailure) {
        const shown = errorText(entry, source, text)
        fields.errorMessage = shown.message
        if (shown.deviceMessage) fields.deviceMessage = shown.deviceMessage
      }
    }
  }

  if (Array.isArray(sms.issueHistory)) {
    fields.issueHistory = sms.issueHistory.map((item: any) => {
      const plain =
        typeof item?.toObject === 'function' ? item.toObject() : { ...item }
      const source = sourceOf(plain.source)
      const entry = findSmsError(source, plain.code, {
        deliveryReport: plain.deliveryReport === true,
      })
      if (!entry) return plain
      const text = errorText(entry, source, plain.message)
      return {
        ...plain,
        name: text.name,
        message: text.message,
        ...(text.deviceMessage && { deviceMessage: text.deviceMessage }),
        ...(text.docsUrl && { docsUrl: text.docsUrl }),
      }
    })
  }

  return fields
}

/** The catalog as written to api/sms-errors.json, for docs to check against. */
export function smsErrorCatalogJson(): string {
  // Every entry has the same keys, in this order; the two match flags only
  // where they apply
  const entries = SMS_ERRORS.map((entry) => ({
    source: entry.source,
    code: entry.code,
    ...(entry.deliveryReport && { deliveryReport: true }),
    ...(entry.matchPrefix && { matchPrefix: true }),
    name: entry.name,
    message: entry.message,
    docsAnchor: entry.docsAnchor ?? null,
    retryable: entry.retryable,
  }))
  return `${JSON.stringify(entries, null, 2)}\n`
}

/** A message as the API returns it. Takes a lean object or a document. */
export function presentSms<T = any>(sms: T): T {
  if (!sms) return sms
  const plain =
    typeof (sms as any).toObject === 'function' ? (sms as any).toObject() : sms
  return { ...plain, ...smsErrorFields(plain) }
}
