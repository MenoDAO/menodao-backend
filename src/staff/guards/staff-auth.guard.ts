import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { StaffService } from '../staff.service';

@Injectable()
export class StaffAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private staffService: StaffService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid authorization header',
      );
    }

    const token = authHeader.substring(7);

    try {
      const secret = this.configService.get<string>('JWT_SECRET');
      if (!secret) {
        throw new UnauthorizedException(
          'Server configuration error: JWT_SECRET is not set',
        );
      }

      // Verify token with explicit secret and options
      const payload = await this.jwtService.verifyAsync(token, {
        secret,
        ignoreExpiration: false,
      });

      if (payload.type !== 'staff') {
        throw new UnauthorizedException('Invalid token type');
      }

      const staff = await this.staffService.validateStaffToken(payload);

      if (!staff) {
        throw new UnauthorizedException('Staff not found or inactive');
      }

      request.staff = staff;
      return true;
    } catch (error) {
      // Log the actual error for debugging
      console.error('Staff auth error:', error);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
