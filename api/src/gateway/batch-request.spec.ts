import { Types } from 'mongoose'
import { batchRequestDetails } from './batch-request'
import { SMSBatchSchema } from './schemas/sms-batch.schema'

const keyId = new Types.ObjectId()
const withKey = (headers: Record<string, unknown>) => ({
  headers,
  apiKey: { _id: keyId },
})

describe('batchRequestDetails', () => {
  it('marks a session request as the dashboard, with no key', () => {
    expect(
      batchRequestDetails({
        headers: { authorization: 'Bearer token' },
        apiKey: { _id: keyId },
      }),
    ).toEqual({ source: 'dashboard' })
  })

  it.each([
    ['textbee-js/0.6.1', 'sdk-js', 'textbee-js', '0.6.1'],
    ['textbee-python/0.4.0', 'sdk-python', 'textbee-python', '0.4.0'],
    ['textbee-n8n/1.3.0', 'n8n', 'textbee-n8n', '1.3.0'],
    ['textbee-mcp/0.2.2 textbee-js/0.6.1', 'mcp', 'textbee-mcp', '0.2.2'],
    [
      'textbee-mcp-remote/1.4.0 textbee-mcp/0.2.2 textbee-js/0.6.1',
      'mcp-hosted',
      'textbee-mcp-remote',
      '1.4.0',
    ],
    ['Textbee-JS/1.0.0-beta.2', 'sdk-js', 'textbee-js', '1.0.0-beta.2'],
  ])('reads %s', (header, source, client, clientVersion) => {
    expect(batchRequestDetails(withKey({ 'x-sdk-client': header }))).toEqual({
      source,
      client,
      clientVersion,
      apiKey: keyId,
    })
  })

  it.each([
    ['my-app/1.2.0 textbee-js/0.7.0', 'sdk-js', 'textbee-js', '0.7.0'],
    [
      'host/1.0.0 textbee-mcp/0.3.0 textbee-js/0.7.0',
      'mcp',
      'textbee-mcp',
      '0.3.0',
    ],
    ['textbee-js/0.6.1, textbee-mcp/1.0.0', 'sdk-js', 'textbee-js', '0.6.1'],
  ])(
    'finds the first known client in %s',
    (header, source, client, clientVersion) => {
      expect(batchRequestDetails(withKey({ 'x-sdk-client': header }))).toEqual({
        source,
        client,
        clientVersion,
        apiKey: keyId,
      })
    },
  )

  it('reads the first value of a header array', () => {
    expect(
      batchRequestDetails(
        withKey({ 'x-sdk-client': ['textbee-js/0.6.1', 'textbee-mcp/1.0.0'] }),
      ).source,
    ).toBe('sdk-js')
  })

  it.each([
    'textbee-js',
    'textbee-js/abc',
    'textbee-js/1.2.3+build',
    'textbee-js/1.2.3/extra',
    'textbee-js/1.2.3-' + 'x'.repeat(40),
  ])('keeps the source but no version for %s', (header) => {
    expect(batchRequestDetails(withKey({ 'x-sdk-client': header }))).toEqual({
      source: 'sdk-js',
      client: 'textbee-js',
      apiKey: keyId,
    })
  })

  it.each([
    [
      'unknown name',
      { 'x-sdk-client': 'someone-else/1.0.0', 'user-agent': 'curl/8.4.0' },
      'curl',
    ],
    [
      'a prototype name',
      { 'x-sdk-client': 'constructor/1.0.0', 'user-agent': 'curl/8.4.0' },
      'curl',
    ],
    ['no headers', {}, 'unknown'],
    ['browser', { 'user-agent': 'Mozilla/5.0 Chrome/131.0' }, 'browser'],
  ])('falls back to a client label for %s', (_, headers, client) => {
    expect(batchRequestDetails(withKey(headers))).toEqual({
      source: 'api',
      client,
      apiKey: keyId,
    })
  })

  it('leaves the key out when the request has none', () => {
    expect(
      batchRequestDetails({ headers: { 'x-sdk-client': 'textbee-js/0.6.1' } }),
    ).toEqual({
      source: 'sdk-js',
      client: 'textbee-js',
      clientVersion: '0.6.1',
    })
  })

  it('ignores a key without a valid id', () => {
    expect(
      batchRequestDetails({ headers: {}, apiKey: { _id: 'not-an-id' } }),
    ).toEqual({ source: 'api', client: 'unknown' })
  })

  it('keeps the new batch fields out of default reads', () => {
    for (const path of ['source', 'client', 'clientVersion', 'apiKey']) {
      expect(SMSBatchSchema.path(path).options.select).toBe(false)
    }
  })
})
