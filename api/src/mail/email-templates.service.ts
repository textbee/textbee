import { readFileSync } from 'fs'
import { join } from 'path'
import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import {
  MissingVariableError,
  placeholders,
  RenderedDocument,
  renderDocument,
  TemplateVars,
} from './email-render'
import {
  EmailTemplate,
  EmailTemplateDocument,
} from './schemas/email-template.schema'

export interface DefaultEmailTemplate {
  key: string
  stream: string
  name: string
  enabled: boolean
  sender: string
  footer: string
  shell: boolean
  listUnsubscribeHeader: boolean
  subject: string
  preheader: string
  body: string
  variables: Record<string, string>
}

export interface DefaultEmailFooter {
  key: string
  body: string
}

interface EmailDefaults {
  senders: Record<string, { from: string; replyTo: string }>
  footers: DefaultEmailFooter[]
  templates: DefaultEmailTemplate[]
}

export interface ResolvedEmail {
  template: DefaultEmailTemplate
  enabled: boolean
  // Override version whose copy was used, or 0 for the default copy.
  version: number
  document?: RenderedDocument
}

type Override = Pick<
  EmailTemplate,
  'key' | 'subject' | 'preheader' | 'body' | 'enabled' | 'version'
>

export const CACHE_TTL_MS = 60 * 1000
const COPY_FIELDS = ['subject', 'preheader', 'body'] as const
// Verification and password emails always send; an account cannot work without them.
export const ALWAYS_ENABLED = new Set(['T1', 'T2', 'T3'])
const USAGE_BAR_VARS = ['usageLabel', 'used', 'limit']

export const EMAIL_DEFAULTS: EmailDefaults = JSON.parse(
  readFileSync(join(__dirname, 'email-templates', 'defaults.json'), 'utf8'),
)

const hasCopy = (row?: Override) =>
  !!row && COPY_FIELDS.some((f) => typeof row[f] === 'string')

/** Placeholders an edited template may use. */
export const allowedPlaceholders = (
  template: DefaultEmailTemplate,
  text: string,
): Set<string> => {
  const allowed = new Set([
    ...Object.keys(template.variables ?? {}),
    'year',
    'unsubscribeUrl',
  ])
  if (text.includes('{{usageBar}}')) USAGE_BAR_VARS.forEach((v) => allowed.add(v))
  return allowed
}

const outside = (text: string, allowed: Set<string>) =>
  placeholders(text).filter((p) => !allowed.has(p))

@Injectable()
export class EmailTemplatesService {
  private readonly logger = new Logger(EmailTemplatesService.name)
  private cache?: { at: number; rows: Map<string, Override> }

  constructor(
    @InjectModel(EmailTemplate.name)
    private readonly emailTemplateModel: Model<EmailTemplateDocument>,
  ) {}

  getDefault(key: string): DefaultEmailTemplate | undefined {
    return EMAIL_DEFAULTS.templates.find((t) => t.key === key)
  }

  sender(key: string): { from: string; replyTo: string } | undefined {
    return EMAIL_DEFAULTS.senders[key]
  }

  private async overrides(): Promise<Map<string, Override>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) {
      return this.cache.rows
    }
    try {
      const rows = (await this.emailTemplateModel
        .find({}, { key: 1, subject: 1, preheader: 1, body: 1, enabled: 1, version: 1 })
        .lean()) as Override[]
      this.cache = { at: Date.now(), rows: new Map(rows.map((r) => [r.key, r])) }
    } catch (e) {
      this.logger.error(`Failed to load email template overrides: ${e?.message}`)
      // Keep serving the last good copy, or the defaults, until the next try.
      this.cache = { at: Date.now(), rows: this.cache?.rows ?? new Map() }
    }
    return this.cache.rows
  }

  private overrideFailed(key: string, reason: string) {
    this.logger.warn(`email_template_override_failed key=${key} reason=${reason}`)
  }

  /** Effective copy rendered with the given variables, falling back to the default on a bad edit. */
  async render(key: string, vars: TemplateVars): Promise<ResolvedEmail> {
    const template = this.getDefault(key)
    if (!template) throw new Error(`Unknown email template: ${key}`)

    const rows = await this.overrides()
    const row = rows.get(key)
    let enabled = typeof row?.enabled === 'boolean' ? row.enabled : template.enabled
    if (!enabled && ALWAYS_ENABLED.has(key)) {
      this.logger.warn(`email_template_disable_ignored key=${key}`)
      enabled = true
    }
    if (!enabled) return { template, enabled, version: 0 }

    const footerKey = `footer_${template.footer}`
    const defaultFooter = EMAIL_DEFAULTS.footers.find((f) => f.key === footerKey)
    if (!defaultFooter) throw new Error(`Unknown email footer: ${footerKey}`)

    let copy = { subject: template.subject, preheader: template.preheader, body: template.body }
    let version = 0
    if (hasCopy(row)) {
      const edited = {
        subject: row.subject ?? template.subject,
        preheader: row.preheader ?? template.preheader,
        body: row.body ?? template.body,
      }
      const text = `${edited.subject}\n${edited.preheader}\n${edited.body}`
      const bad = outside(text, allowedPlaceholders(template, edited.body))
      if (bad.length) {
        this.overrideFailed(key, `placeholder ${bad.join(',')}`)
      } else {
        copy = edited
        version = row.version ?? 0
      }
    }

    let footer = defaultFooter.body
    const footerRow = rows.get(footerKey)
    if (typeof footerRow?.body === 'string') {
      const bad = outside(footerRow.body, new Set(['year', 'unsubscribeUrl']))
      if (bad.length) this.overrideFailed(footerKey, `placeholder ${bad.join(',')}`)
      else footer = footerRow.body
    }

    const shellTemplate = { ...copy, shell: template.shell }
    try {
      return { template, enabled, version, document: renderDocument(shellTemplate, footer, vars) }
    } catch (e) {
      const edited = version > 0 || footer !== defaultFooter.body
      if (!(e instanceof MissingVariableError) || !edited) throw e
      this.overrideFailed(key, `missing ${e.variable}`)
    }
    const fallback = {
      subject: template.subject,
      preheader: template.preheader,
      body: template.body,
      shell: template.shell,
    }
    return {
      template,
      enabled,
      version: 0,
      document: renderDocument(fallback, defaultFooter.body, vars),
    }
  }
}
