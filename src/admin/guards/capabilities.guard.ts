import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  Capability,
  CAPABILITIES_KEY,
  ROLE_CAPABILITIES,
} from './capabilities';

@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Capability[]>(
      CAPABILITIES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{
      admin?: { role?: string };
    }>();
    const admin = request.admin;
    if (!admin?.role) {
      throw new ForbiddenException('Access denied: no role assigned');
    }

    const allowed = ROLE_CAPABILITIES[admin.role] ?? [];
    const missing = required.find(
      (capability) => !allowed.includes(capability),
    );
    if (missing) {
      throw new ForbiddenException(
        `Access denied: requires ${missing} capability`,
      );
    }
    return true;
  }
}
