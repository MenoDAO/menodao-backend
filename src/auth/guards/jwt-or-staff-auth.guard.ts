import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../../auth/auth.service';
import { StaffService } from '../../staff/staff.service';

/**
 * Combined guard that accepts BOTH member (JWT) and staff tokens.
 * Use on endpoints that need to be accessible to both members and staff.
 *
 * - If token type is 'staff', validates via StaffService
 * - Otherwise, validates as a member token via AuthService
 * - Sets request.user (member) or request.staff accordingly
 */
@Injectable()
export class JwtOrStaffAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private authService: AuthService,
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

      const payload = await this.jwtService.verifyAsync(token, { secret });

      // Staff token
      if (payload.type === 'staff') {
        const staff = await this.staffService.validateStaffToken(payload);
        if (!staff) {
          throw new UnauthorizedException('Staff not found or inactive');
        }
        request.staff = staff;
        return true;
      }

      // Member token
      const member = await this.authService.validateToken(payload.sub);
      if (!member) {
        throw new UnauthorizedException('Member not found');
      }
      request.user = member;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
