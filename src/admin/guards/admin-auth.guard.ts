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
    const requestPath = request.url;

    console.log(`[AdminAuthGuard] Checking auth for: ${requestPath}`);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log(
        `[AdminAuthGuard] Missing or invalid auth header for: ${requestPath}`,
      );
      throw new UnauthorizedException(
        'Missing or invalid authorization header',
      );
    }

    const token = authHeader.substring(7);

    try {
      const secret = this.configService.get<string>('JWT_SECRET');
      if (!secret) {
        console.error('[AdminAuthGuard] JWT_SECRET not configured');
        throw new UnauthorizedException(
          'Server configuration error: JWT_SECRET is not set',
        );
      }

      // Verify token with explicit secret and options
      const payload = await this.jwtService.verifyAsync(token, {
        secret,
        ignoreExpiration: false,
      });

      console.log(
        `[AdminAuthGuard] Token payload type: ${payload.type}, sub: ${payload.sub}`,
      );

      if (payload.type !== 'admin') {
        console.log(`[AdminAuthGuard] Invalid token type: ${payload.type}`);
        throw new UnauthorizedException('Invalid token type');
      }

      const admin = await this.adminService.validateAdminToken(payload);

      if (!admin) {
        console.log(`[AdminAuthGuard] Admin not found for sub: ${payload.sub}`);
        throw new UnauthorizedException('Admin not found');
      }

      console.log(
        `[AdminAuthGuard] Auth successful for admin: ${admin.username} (${admin.role}) on ${requestPath}`,
      );
      request.admin = admin;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      // Log the actual error for debugging
      console.error(`[AdminAuthGuard] Auth error for ${requestPath}:`, error);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
