import 'dotenv/config'
import * as crypto from 'crypto'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import * as firebase from 'firebase-admin'
import { SwaggerModule } from '@nestjs/swagger'
import * as express from 'express'
import { NestExpressApplication } from '@nestjs/platform-express'
import { applyApiConventions, buildSwaggerConfig } from './openapi/swagger-config'

// Ensure crypto is available globally for @nestjs/schedule
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = crypto as any
}

// Global error handlers to prevent server crashes
const logger = new Logger('GlobalErrorHandler')

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', error.stack || error.message)
  // Don't exit the process for uncaught exceptions in production
  // process.exit(1)
})

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

async function bootstrap() {
  const app: NestExpressApplication = await NestFactory.create(AppModule)
  const PORT = process.env.PORT || 3001

  applyApiConventions(app)

  const config = buildSwaggerConfig({
    title: 'textbee API Docs',
    description: 'textbee - Android SMS Gateway API Docs',
  })
  const document = SwaggerModule.createDocument(app, config)
  // Every route that carries the spec itself, including swagger-ui-init.js,
  // which embeds the whole document and is otherwise cached as a static .js
  // by CDNs and browsers. The swagger-ui library assets stay cacheable.
  const SPEC_ROUTES = new Set([
    '/',
    '/-json',
    '/-yaml',
    '/swagger-ui-init.js',
  ])
  app.use((req, res, next) => {
    if (SPEC_ROUTES.has(req.path)) {
      res.setHeader('Cache-Control', 'no-cache')
    }
    next()
  })
  SwaggerModule.setup('', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  })

  const firebaseConfig = {
    type: 'service_account',
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKeyId: process.env.FIREBASE_PRIVATE_KEY_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    clientId: process.env.FIREBASE_CLIENT_ID,
    authUri: 'https://accounts.google.com/o/oauth2/auth',
    tokenUri: 'https://oauth2.googleapis.com/token',
    authProviderX509CertUrl: 'https://www.googleapis.com/oauth2/v1/certs',
    clientC509CertUrl: process.env.FIREBASE_CLIENT_C509_CERT_URL,
  }

  firebase.initializeApp({
    credential: firebase.credential.cert(firebaseConfig),
  })

  app.use(
    '/api/v1/billing/webhook/polar',
    express.raw({ type: 'application/json' }),
  )
  // SNS posts JSON as text/plain.
  app.use(
    '/api/v1/email/ses-events',
    express.text({ type: () => true, limit: '256kb' }),
  )
  app.useBodyParser('json', { limit: '2mb' });
  // The app runs behind a reverse proxy, so without this req.ip is the proxy's
  // loopback address for every request. That makes rate limiting see one client
  // and gives conversion reporting a single useless IP for everyone.
  app.set('trust proxy', 1)
  app.enableCors()
  await app.listen(PORT)
}
bootstrap()
