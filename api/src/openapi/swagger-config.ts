import { INestApplication, VersioningType } from '@nestjs/common'
import { DocumentBuilder } from '@nestjs/swagger'

export const API_KEY_SECURITY_SCHEME = 'x-api-key'
export const BEARER_SECURITY_SCHEME = 'bearer'

export const API_TAGS: ReadonlyArray<{ name: string; description: string }> = [
  {
    name: 'gateway',
    description:
      'Send SMS and read message history through the Android devices paired with your account.',
  },
  {
    name: 'webhooks',
    description:
      'Subscribe to SMS events and inspect the delivery attempts textbee made for them.',
  },
  {
    name: 'auth',
    description:
      'Accounts, sessions, and API keys. Used by the textbee dashboard.',
  },
  {
    name: 'billing',
    description: 'Plans, the current subscription, and checkout.',
  },
  {
    name: 'support',
    description: 'Contact support and request account deletion.',
  },
  {
    name: 'notifications',
    description:
      'The messages the textbee dashboard shows an account. Used by the dashboard only.',
  },
]

export interface SwaggerConfigOptions {
  title: string
  description: string
  version?: string
  /** Absolute base URLs the operations can be called against. */
  servers?: string[]
}

const LICENSE = {
  name: 'MIT',
  url: 'https://github.com/textbee/textbee/blob/main/LICENSE',
} as const

// The server and the openapi exporter both call this, so the documented paths
// cannot drift from the ones the app actually serves.
export function applyApiConventions(app: INestApplication): void {
  app.setGlobalPrefix('api')
  app.enableVersioning({
    defaultVersion: '1',
    type: VersioningType.URI,
  })
}

export function buildSwaggerConfig({
  title,
  description,
  version = '1.0',
  servers = [],
}: SwaggerConfigOptions) {
  const builder = new DocumentBuilder()
    .setTitle(title)
    .setDescription(description)
    .setVersion(version)
    .setLicense(LICENSE.name, LICENSE.url)
    .addBearerAuth()
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-api-key',
        in: 'header',
        description:
          'API key from your textbee dashboard, sent on every request.',
      },
      API_KEY_SECURITY_SCHEME,
    )

  for (const tag of API_TAGS) {
    builder.addTag(tag.name, tag.description)
  }

  for (const server of servers) {
    builder.addServer(server)
  }

  return builder.build()
}
