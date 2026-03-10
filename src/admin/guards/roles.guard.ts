import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no roles are required, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const admin = request.admin;

    if (!admin || !admin.role) {
      throw new ForbiddenException('Access denied: no role assigned');
    }

    if (!requiredRoles.includes(admin.role)) {
      throw new ForbiddenException(
        `Access denied: requires ${requiredRoles.join(' or ')} role`,
      );
    }

    return true;
  }
}
