import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminService } from '../admin.service';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
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
      console.log(
        '[AdminAuthGuard] JWT_SECRET exists:',
        !!secret,
        'length:',
        secret?.length,
      );

      if (!secret) {
        console.error('[AdminAuthGuard] JWT_SECRET is undefined or empty');
        throw new UnauthorizedException(
          'Server configuration error: JWT_SECRET is not set',
        );
      }

      // Verify token using jsonwebtoken directly
      const payload = jwt.verify(token, secret) as any;

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
      console.error('[AdminAuthGuard] Auth error:', error.message);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
