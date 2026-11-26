import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { UsersService } from '../../users/users.service'
import { AuthService } from '../auth.service'
import { assertKeyScope } from '../key-scope'

@Injectable()
// Guard for optionally authenticating users by either jwt token or api key
export class OptionalAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    private authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    let userId
    const apiKeyString = request.headers['x-api-key'] || request.query.apiKey
    if (request.headers.authorization?.startsWith('Bearer ')) {
      const bearerToken = request.headers.authorization.split(' ')[1]
      try {
        const payload = this.jwtService.verify(bearerToken)
        userId = payload.sub
      } catch (e) {
        // Ignore token verification errors
        return true
      }
    } else if (apiKeyString) {
      const apiKey = await this.authService.verifyApiKey(apiKeyString)

      if (apiKey) {
        assertKeyScope(request, apiKey)
        userId = apiKey.user
        request.apiKey = apiKey
      }
    }

    if (userId) {
      const user = await this.usersService.findOne({ _id: userId })
      if (user) {
        request.user = user
        this.authService.trackAccessLog({ request })
      }
    }

    // Always return true as authentication is optional
    return true
  }
} 