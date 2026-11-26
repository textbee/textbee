import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common'

/**
 * Lets through only a request that carries a dashboard login and no API key.
 * Goes before AuthGuard, which then resolves the login. A request with an
 * API key is refused even when it also carries a login.
 */
@Injectable()
export class LoginSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest()
    const hasApiKey =
      request.headers?.['x-api-key'] !== undefined ||
      request.query?.apiKey !== undefined
    const hasLogin =
      typeof request.headers?.authorization === 'string' &&
      request.headers.authorization.startsWith('Bearer ')
    if (hasApiKey || !hasLogin) {
      throw new HttpException(
        { error: 'Unauthorized', code: 'AUTH_INVALID' },
        HttpStatus.UNAUTHORIZED,
      )
    }
    return true
  }
}
