import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AdminService } from '../admin.service';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private adminService: AdminService,
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

      if (payload.type !== 'admin') {
        throw new UnauthorizedException('Invalid token type');
      }

      const admin = await this.adminService.validateAdminToken(payload);

      if (!admin) {
        throw new UnauthorizedException('Admin not found');
      }

      request.admin = admin;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      // Log the actual error for debugging
      console.error('Admin auth error:', error);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
