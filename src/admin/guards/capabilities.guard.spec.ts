import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CapabilityGuard } from './capabilities.guard';

describe('CapabilityGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;
  const guard = new CapabilityGuard(reflector);

  const contextFor = (role?: string) =>
    ({
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({ admin: role ? { role } : undefined }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('allows a protected action for a role with the capability', () => {
    jest
      .mocked(reflector.getAllAndOverride)
      .mockReturnValue(['brand_context.write']);

    expect(guard.canActivate(contextFor('SUPER_ADMIN'))).toBe(true);
  });

  it('denies a protected action for a role without the capability', () => {
    jest.mocked(reflector.getAllAndOverride).mockReturnValue(['admins.manage']);

    expect(() => guard.canActivate(contextFor('JUNIOR_ADMIN'))).toThrow(
      ForbiddenException,
    );
  });

  it('denies when no admin is attached to the request', () => {
    jest.mocked(reflector.getAllAndOverride).mockReturnValue(['admins.manage']);

    expect(() => guard.canActivate(contextFor())).toThrow(ForbiddenException);
  });

  it('allows an unprotected action regardless of role', () => {
    jest.mocked(reflector.getAllAndOverride).mockReturnValue(undefined);

    expect(guard.canActivate(contextFor())).toBe(true);
  });
});
