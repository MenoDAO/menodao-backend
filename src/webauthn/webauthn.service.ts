import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { PrismaService } from '../prisma/prisma.service';
import {
  allowedWebAuthnOrigins,
  resolveWebAuthnRp,
  type WebAuthnKind,
} from './webauthn-origin';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function ownerWhere(kind: WebAuthnKind, userId: string) {
  if (kind === 'staff') return { staffUserId: userId };
  if (kind === 'admin') return { adminUserId: userId };
  return { memberId: userId };
}

function ownerIdOf(
  kind: WebAuthnKind,
  stored: {
    staffUserId: string | null;
    adminUserId: string | null;
    memberId: string | null;
  },
): string | null {
  if (kind === 'staff') return stored.staffUserId;
  if (kind === 'admin') return stored.adminUserId;
  return stored.memberId;
}

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '+254' + cleaned.substring(1);
  } else if (cleaned.startsWith('254')) {
    cleaned = '+' + cleaned;
  } else if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

@Injectable()
export class WebAuthnService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  private allowedOrigins() {
    return allowedWebAuthnOrigins(
      this.config.get<string>('CORS_ORIGINS'),
      this.config.get<string>('WEBAUTHN_ORIGINS'),
    );
  }

  private rpName() {
    return this.config.get<string>('WEBAUTHN_RP_NAME') || 'MenoDAO';
  }

  private rp(originHeader?: string) {
    try {
      return resolveWebAuthnRp(originHeader, this.allowedOrigins());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid origin';
      throw new BadRequestException(message);
    }
  }

  async registrationOptions(
    kind: WebAuthnKind,
    user: { id: string; username: string; displayName: string },
    originHeader?: string,
  ) {
    const { origin, rpID } = this.rp(originHeader);
    const existing = await this.prisma.webAuthnCredential.findMany({
      where: ownerWhere(kind, user.id),
      select: { credentialId: true, transports: true },
    });
    const options = await generateRegistrationOptions({
      rpName: this.rpName(),
      rpID,
      userName: user.username,
      userDisplayName: user.displayName,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      preferredAuthenticatorType: 'localDevice',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        userVerification: 'required',
      },
      excludeCredentials: existing.map((row) => ({
        id: row.credentialId,
        transports: row.transports as AuthenticatorTransportFuture[],
      })),
    });
    await this.storeChallenge({
      kind,
      type: 'register',
      userId: user.id,
      username: user.username,
      challenge: options.challenge,
      origin,
      rpId: rpID,
    });
    return options;
  }

  async verifyRegistration(
    kind: WebAuthnKind,
    userId: string,
    response: RegistrationResponseJSON,
    originHeader?: string,
    label?: string,
  ) {
    const { origin, rpID } = this.rp(originHeader);
    const challenge = await this.takeChallenge({
      kind,
      type: 'register',
      userId,
      expectedOrigin: origin,
      expectedRpId: rpID,
    });
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new UnauthorizedException('Could not verify this device');
    }
    const info = verification.registrationInfo;
    const credential = await this.prisma.webAuthnCredential.create({
      data: {
        credentialId: info.credential.id,
        publicKey: Buffer.from(info.credential.publicKey),
        counter: BigInt(info.credential.counter),
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        transports: info.credential.transports || [],
        label: label?.trim() || 'This device',
        staffUserId: kind === 'staff' ? userId : null,
        adminUserId: kind === 'admin' ? userId : null,
        memberId: kind === 'member' ? userId : null,
      },
    });
    return {
      id: credential.id,
      label: credential.label,
      createdAt: credential.createdAt,
    };
  }

  async authenticationOptions(
    kind: WebAuthnKind,
    username: string | undefined,
    originHeader?: string,
  ) {
    const { origin, rpID } = this.rp(originHeader);
    let allowCredentials:
      | { id: string; transports?: AuthenticatorTransportFuture[] }[]
      | undefined;
    let userId: string | undefined;
    if (username?.trim()) {
      const account = await this.findAccount(kind, username.trim());
      if (account) {
        userId = account.id;
        const creds = await this.prisma.webAuthnCredential.findMany({
          where: ownerWhere(kind, account.id),
        });
        allowCredentials = creds.map((row) => ({
          id: row.credentialId,
          transports: row.transports as AuthenticatorTransportFuture[],
        }));
      }
    }
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
      allowCredentials,
    });
    await this.storeChallenge({
      kind,
      type: 'authenticate',
      userId,
      username: username?.trim() || '',
      challenge: options.challenge,
      origin,
      rpId: rpID,
    });
    return options;
  }

  async verifyAuthentication(
    kind: WebAuthnKind,
    response: AuthenticationResponseJSON,
    originHeader?: string,
  ): Promise<string> {
    const { origin, rpID } = this.rp(originHeader);
    const stored = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: response.id },
    });
    const ownerId = stored ? ownerIdOf(kind, stored) : null;
    if (!stored || !ownerId) {
      throw new UnauthorizedException('Unknown or unregistered device');
    }
    const challenge = await this.takeChallenge({
      kind,
      type: 'authenticate',
      userId: ownerId,
      expectedOrigin: origin,
      expectedRpId: rpID,
      allowEmptyUser: true,
    });
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(stored.publicKey),
        counter: Number(stored.counter),
        transports: stored.transports as AuthenticatorTransportFuture[],
      },
    });
    if (!verification.verified) {
      throw new UnauthorizedException('Device login failed');
    }
    await this.prisma.webAuthnCredential.update({
      where: { id: stored.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
        backedUp: verification.authenticationInfo.credentialBackedUp,
        deviceType: verification.authenticationInfo.credentialDeviceType,
      },
    });
    return ownerId;
  }

  async listCredentials(kind: WebAuthnKind, userId: string) {
    return this.prisma.webAuthnCredential.findMany({
      where: ownerWhere(kind, userId),
      select: {
        id: true,
        label: true,
        deviceType: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteCredential(kind: WebAuthnKind, userId: string, id: string) {
    const row = await this.prisma.webAuthnCredential.findFirst({
      where: {
        id,
        ...ownerWhere(kind, userId),
      },
    });
    if (!row) throw new BadRequestException('Device not found');
    await this.prisma.webAuthnCredential.delete({ where: { id } });
    return { deleted: true };
  }

  private async findAccount(kind: WebAuthnKind, username: string) {
    if (kind === 'staff') {
      return this.prisma.staffUser
        .findUnique({
          where: { username },
          select: { id: true, isActive: true },
        })
        .then((row) => (row?.isActive ? row : null));
    }
    if (kind === 'admin') {
      return this.prisma.adminUser.findUnique({
        where: { username },
        select: { id: true },
      });
    }
    return this.prisma.member.findUnique({
      where: { phoneNumber: normalizePhone(username) },
      select: { id: true },
    });
  }

  private async storeChallenge(input: {
    kind: WebAuthnKind;
    type: string;
    userId?: string;
    username: string;
    challenge: string;
    origin: string;
    rpId: string;
  }) {
    await this.prisma.webAuthnChallenge.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    await this.prisma.webAuthnChallenge.create({
      data: {
        ...input,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      },
    });
  }

  private async takeChallenge(input: {
    kind: WebAuthnKind;
    type: string;
    userId: string;
    expectedOrigin: string;
    expectedRpId: string;
    allowEmptyUser?: boolean;
  }) {
    const row = await this.prisma.webAuthnChallenge.findFirst({
      where: {
        kind: input.kind,
        type: input.type,
        origin: input.expectedOrigin,
        rpId: input.expectedRpId,
        expiresAt: { gt: new Date() },
        OR: input.allowEmptyUser
          ? [{ userId: input.userId }, { userId: null }]
          : [{ userId: input.userId }],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) {
      throw new UnauthorizedException('Device login challenge expired. Try again.');
    }
    await this.prisma.webAuthnChallenge.delete({ where: { id: row.id } });
    return row;
  }
}
