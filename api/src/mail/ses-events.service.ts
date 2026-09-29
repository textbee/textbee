import { createVerify } from 'crypto'
import axios from 'axios'
import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import {
  EmailSuppression,
  EmailSuppressionDocument,
} from './schemas/email-suppression.schema'

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com$/
const SNS_CERT_PATH = /^\/SimpleNotificationService-[A-Za-z0-9]+\.pem$/
const MAX_AGE_MS = 60 * 60 * 1000
const MAX_CERTS = 20

export const isSnsUrl = (value: unknown): boolean => {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && SNS_HOST.test(url.hostname)
  } catch {
    return false
  }
}

const SIGNED_FIELDS: Record<string, string[]> = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
}

/** The string SNS signs for a message, or null for an unknown type. */
export const snsStringToSign = (msg: Record<string, any>): string | null => {
  const fields = SIGNED_FIELDS[msg.Type]
  if (!fields) return null
  return fields
    .filter((f) => !(f === 'Subject' && msg.Subject === undefined))
    .map((f) => `${f}\n${msg[f]}\n`)
    .join('')
}

const bareAddress = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const address = (value.match(/<([^<>]+)>\s*$/)?.[1] ?? value).trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+$/.test(address) ? address : null
}

export type SesEventResult = 'ok' | 'invalid' | 'rejected' | 'error'

@Injectable()
export class SesEventsService {
  private readonly logger = new Logger(SesEventsService.name)
  private readonly certs = new Map<string, string>()

  constructor(
    @InjectModel(EmailSuppression.name)
    private readonly suppressionModel: Model<EmailSuppressionDocument>,
  ) {}

  async fetchText(url: string): Promise<string> {
    const res = await axios.get(url, {
      responseType: 'text',
      timeout: 5000,
      maxRedirects: 0,
    })
    return String(res.data)
  }

  async handle(raw: unknown): Promise<SesEventResult> {
    let msg: Record<string, any>
    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : (raw as any)
    } catch {
      return 'invalid'
    }
    if (!msg || typeof msg !== 'object' || typeof msg.Type !== 'string') {
      return 'invalid'
    }
    // Closed until a topic is configured.
    const topic = process.env.SES_EVENTS_TOPIC_ARN
    if (!topic || msg.TopicArn !== topic) return 'rejected'
    const sentAt = Date.parse(msg.Timestamp)
    if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > MAX_AGE_MS) {
      return 'rejected'
    }
    if (!(await this.verify(msg))) return 'rejected'

    try {
      if (msg.Type === 'SubscriptionConfirmation' && isSnsUrl(msg.SubscribeURL)) {
        await this.fetchText(msg.SubscribeURL)
        this.logger.log('Confirmed the SES events subscription')
      } else if (msg.Type === 'Notification') {
        await this.record(msg.Message)
      }
    } catch (e) {
      this.logger.error(`Failed to handle an SES event: ${e?.message}`)
      // A failed write asks SNS to retry; the writes are idempotent.
      if (msg.Type === 'Notification') return 'error'
    }
    return 'ok'
  }

  /** Signing certificates only come from the SNS certificate path on an SNS host. */
  static isSnsCertUrl(value: unknown): boolean {
    if (!isSnsUrl(value)) return false
    const url = new URL(value as string)
    return SNS_CERT_PATH.test(url.pathname) && url.search === '' && url.username === '' && url.password === '' && url.port === ''
  }

  private async verify(msg: Record<string, any>): Promise<boolean> {
    const algorithm =
      msg.SignatureVersion === '1' ? 'RSA-SHA1' : msg.SignatureVersion === '2' ? 'RSA-SHA256' : null
    const toSign = snsStringToSign(msg)
    if (!algorithm || !toSign || typeof msg.Signature !== 'string') return false
    if (!SesEventsService.isSnsCertUrl(msg.SigningCertURL)) return false
    const certUrl = new URL(msg.SigningCertURL)
    const safeCertUrl = `https://${certUrl.hostname}${certUrl.pathname}`
    try {
      let cert = this.certs.get(safeCertUrl)
      if (!cert) {
        cert = await this.fetchText(safeCertUrl)
        if (this.certs.size >= MAX_CERTS) {
          this.certs.delete(this.certs.keys().next().value)
        }
        this.certs.set(safeCertUrl, cert)
      }
      return createVerify(algorithm).update(toSign, 'utf8').verify(cert, msg.Signature, 'base64')
    } catch (e) {
      this.logger.warn(`Could not verify an SES event: ${e?.message}`)
      return false
    }
  }

  private async record(message: unknown) {
    let event: Record<string, any>
    try {
      event = typeof message === 'string' ? JSON.parse(message) : (message as any)
    } catch {
      return
    }
    const type = event?.eventType ?? event?.notificationType
    let reason: 'bounce' | 'complaint'
    let recipients: unknown[]
    let detail: string | undefined
    let at: unknown
    if (type === 'Bounce' && event.bounce?.bounceType === 'Permanent') {
      reason = 'bounce'
      recipients = event.bounce.bouncedRecipients
      detail = event.bounce.bounceSubType
      at = event.bounce.timestamp
    } else if (type === 'Complaint') {
      reason = 'complaint'
      recipients = event.complaint?.complainedRecipients
      detail = event.complaint?.complaintFeedbackType
      at = event.complaint?.timestamp
    } else {
      return
    }
    const when = new Date(typeof at === 'string' ? at : Date.now())
    const addresses = (Array.isArray(recipients) ? recipients : [])
      .map((r: any) => bareAddress(r?.emailAddress))
      .filter(Boolean)
    for (const email of addresses) {
      await this.suppressionModel.updateOne(
        { email },
        {
          $set: {
            reason,
            source: 'ses',
            at: Number.isNaN(when.getTime()) ? new Date() : when,
            ...(typeof detail === 'string' && { detail: detail.slice(0, 200) }),
          },
          $setOnInsert: { email },
        },
        { upsert: true },
      )
    }
  }
}
