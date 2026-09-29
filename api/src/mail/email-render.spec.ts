import { readFileSync } from 'fs'
import { join } from 'path'
import * as r from './email-render'

// Shared fixture: every repo runs these cases against its own renderer copy.
const f = JSON.parse(
  readFileSync(join(__dirname, 'render-conformance.json'), 'utf8'),
)

describe('email renderer conformance', () => {
  it.each(f.render.map((c: any) => [c.name, c]))('render %s', (_n, c: any) => {
    expect(r.renderEmail(c.template, c.footer, c.vars)).toEqual(c.expected)
  })

  it.each(f.document.map((c: any) => [c.name, c]))(
    'document %s',
    (_n, c: any) => {
      expect(r.renderDocument(c.template, c.footer, c.vars)).toEqual(c.expected)
    },
  )

  it.each(f.missing.map((c: any) => [c.name, c]))('missing %s', (_n, c: any) => {
    let variable: string | undefined
    try {
      r.renderEmail(c.template, c.footer, c.vars)
    } catch (e) {
      variable = e instanceof r.MissingVariableError ? e.variable : String(e)
    }
    expect(variable).toBe(c.variable)
  })

  it('placeholders', () => {
    for (const c of f.placeholders) {
      expect(r.placeholders(c.text)).toEqual(c.expected)
    }
  })

  it('safeFirstName', () => {
    for (const c of f.safeFirstName) {
      expect([c.input, r.safeFirstName(c.input)]).toEqual([c.input, c.expected])
    }
  })

  it('sanitizeUserText', () => {
    for (const c of f.sanitizeUserText) {
      expect(r.sanitizeUserText(c.input, c.max)).toBe(c.expected)
    }
  })

  it('formatCount and pluralize', () => {
    for (const c of f.formatCount) expect(r.formatCount(c.input)).toBe(c.expected)
    for (const c of f.pluralize) {
      expect(r.pluralize(c.n, c.one, c.many)).toBe(c.expected)
    }
  })

  it('formatDate and formatDateTime', () => {
    for (const c of f.dates) {
      const date = new Date(c.date)
      const now = new Date(c.now)
      expect(r.formatDate(date, now)).toBe(c.date_expected)
      expect(r.formatDateTime(date, now)).toBe(c.datetime_expected)
    }
  })

  it('signLink', () => {
    for (const c of f.signLink) {
      expect(r.signLink(f.secret, c.purpose, c.id, c.expiresAt)).toBe(c.token)
    }
  })

  it.each(f.verifyLink.map((c: any) => [c.name, c]))(
    'verifyLink %s',
    (_n, c: any) => {
      expect(r.verifyLink(f.secret, c.token, c.purpose, c.now)).toBe(c.expected)
    },
  )
})
