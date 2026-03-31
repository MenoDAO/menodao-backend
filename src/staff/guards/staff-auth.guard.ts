import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StaffService } from '../staff.service';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class StaffAuthGuard implements CanActivate {
  constructor(
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

      // Verify token using jsonwebtoken directly
      const payload = jwt.verify(token, secret) as any;

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
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      console.error('Staff auth error:', error);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
