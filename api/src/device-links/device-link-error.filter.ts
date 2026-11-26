import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { STATUS_CODES } from 'http'

// The app and the link page show the error field as it is, so it must be a
// sentence for a person, never a status name such as "Bad Request".
const TEXTS: Record<number, string> = {
  400: 'The request could not be read. Start again.',
  401: 'Log in to continue.',
  403: 'This request is not allowed.',
  404: 'This sign-in request was not found. Start again.',
  429: 'Too many requests. Try again later.',
}
const SERVER_TEXT = 'Something went wrong. Try again.'

@Catch()
export class DeviceLinkErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(DeviceLinkErrorFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse()
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR
    if (!(exception instanceof HttpException)) {
      this.logger.error(`device link request failed: ${(exception as any)?.message ?? exception}`)
    }
    const raw = exception instanceof HttpException ? exception.getResponse() : undefined
    const body: Record<string, unknown> =
      raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}
    const error = body.error
    const isSentence =
      typeof error === 'string' && error.trim() !== '' && error !== STATUS_CODES[status]
    if (!isSentence) {
      body.error = TEXTS[status] ?? (status >= 500 ? SERVER_TEXT : TEXTS[400])
    }
    response.status(status).json(body)
  }
}
