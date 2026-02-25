import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { SmsService } from '../sms/sms.service';
import {
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;
  let prismaService: jest.Mocked<PrismaService>;
  let jwtService: jest.Mocked<JwtService>;
  let smsService: jest.Mocked<SmsService>;

  const mockPrismaService = {
    oTPCode: {
      updateMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    member: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockJwtService = {
    sign: jest.fn(),
  };

  const mockSmsService = {
    sendOtp: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: SmsService, useValue: mockSmsService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prismaService = module.get(PrismaService);
    jwtService = module.get(JwtService);
    smsService = module.get(SmsService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('requestOtp', () => {
    it('should normalize phone number starting with 0', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue({
        id: '1',
        phoneNumber: '+254712345678',
      });
      mockPrismaService.oTPCode.create.mockResolvedValue({});
      mockSmsService.sendOtp.mockResolvedValue({
        success: true,
        messageId: 'test-123',
      });

      await service.requestOtp('0712345678');

      expect(mockPrismaService.member.findUnique).toHaveBeenCalledWith({
        where: { phoneNumber: '+254712345678' },
      });
    });

    it('should normalize phone number starting with 254', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue({
        id: '1',
        phoneNumber: '+254712345678',
      });
      mockPrismaService.oTPCode.create.mockResolvedValue({});
      mockSmsService.sendOtp.mockResolvedValue({
        success: true,
        messageId: 'test-123',
      });

      await service.requestOtp('254712345678');

      expect(mockPrismaService.member.findUnique).toHaveBeenCalledWith({
        where: { phoneNumber: '+254712345678' },
      });
    });

    it('should create new member if not exists', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue(null);
      mockPrismaService.member.create.mockResolvedValue({
        id: 'new-member-id',
        phoneNumber: '+254712345678',
      });
      mockPrismaService.oTPCode.create.mockResolvedValue({});
      mockSmsService.sendOtp.mockResolvedValue({
        success: true,
        messageId: 'test-123',
      });

      await service.requestOtp('+254712345678');

      expect(mockPrismaService.member.create).toHaveBeenCalledWith({
        data: { phoneNumber: '+254712345678' },
      });
    });

    it('should invalidate existing OTPs before creating new one', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue({
        id: '1',
        phoneNumber: '+254712345678',
      });
      mockPrismaService.oTPCode.create.mockResolvedValue({});
      mockSmsService.sendOtp.mockResolvedValue({
        success: true,
        messageId: 'test-123',
      });

      await service.requestOtp('+254712345678');

      expect(mockPrismaService.oTPCode.updateMany).toHaveBeenCalledWith({
        where: {
          phoneNumber: '+254712345678',
          isUsed: false,
        },
        data: {
          isUsed: true,
        },
      });
    });

    it('should create OTP with 5 minute expiry', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue({
        id: '1',
        phoneNumber: '+254712345678',
      });
      mockPrismaService.oTPCode.create.mockResolvedValue({});
      mockSmsService.sendOtp.mockResolvedValue({
        success: true,
        messageId: 'test-123',
      });

      const beforeCall = Date.now();
      await service.requestOtp('+254712345678');
      const afterCall = Date.now();

      const createCall = mockPrismaService.oTPCode.create.mock.calls[0][0];
      const expiresAt = new Date(createCall.data.expiresAt).getTime();

      // Should expire in ~5 minutes
      expect(expiresAt).toBeGreaterThanOrEqual(
        beforeCall + 5 * 60 * 1000 - 1000,
      );
      expect(expiresAt).toBeLessThanOrEqual(afterCall + 5 * 60 * 1000 + 1000);
    });

    it('should send OTP via SMS', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue({
        id: '1',
        phoneNumber: '+254712345678',
      });
      mockPrismaService.oTPCode.create.mockResolvedValue({});
      mockSmsService.sendOtp.mockResolvedValue({
        success: true,
        messageId: 'test-123',
      });

      await service.requestOtp('+254712345678');

      expect(mockSmsService.sendOtp).toHaveBeenCalledWith(
        '+254712345678',
        expect.stringMatching(/^\d{6}$/),
      );
    });

    it('should return success message', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue({
        id: '1',
        phoneNumber: '+254712345678',
      });
      mockPrismaService.oTPCode.create.mockResolvedValue({});
      mockSmsService.sendOtp.mockResolvedValue({
        success: true,
        messageId: 'test-123',
      });

      const result = await service.requestOtp('+254712345678');

      expect(result).toEqual({ message: 'OTP sent successfully' });
    });

    it('should throw ServiceUnavailableException when SMS fails', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue({
        id: '1',
        phoneNumber: '+254712345678',
      });
      mockPrismaService.oTPCode.create.mockResolvedValue({});
      mockSmsService.sendOtp.mockResolvedValue({
        success: false,
        error: 'SMS service unavailable',
      });

      await expect(service.requestOtp('+254712345678')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('verifyOtp', () => {
    const mockMember = {
      id: 'member-1',
      phoneNumber: '+254712345678',
      fullName: 'Test User',
      location: 'Nairobi',
      walletAddress: '0x123',
      isVerified: true,
      subscription: { tier: 'BRONZE' },
    };

    it('should throw UnauthorizedException for invalid OTP', async () => {
      mockPrismaService.oTPCode.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyOtp('+254712345678', '123456'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for expired OTP', async () => {
      mockPrismaService.oTPCode.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyOtp('+254712345678', '123456'),
      ).rejects.toThrow('Invalid or expired OTP');
    });

    it('should mark OTP as used after verification', async () => {
      mockPrismaService.oTPCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        code: '123456',
        memberId: 'member-1',
        member: mockMember,
      });
      mockPrismaService.oTPCode.update.mockResolvedValue({});
      mockPrismaService.member.update.mockResolvedValue(mockMember);
      mockJwtService.sign.mockReturnValue('jwt-token');

      await service.verifyOtp('+254712345678', '123456');

      expect(mockPrismaService.oTPCode.update).toHaveBeenCalledWith({
        where: { id: 'otp-1' },
        data: { isUsed: true },
      });
    });

    it('should update member as verified', async () => {
      mockPrismaService.oTPCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        code: '123456',
        memberId: 'member-1',
        member: mockMember,
      });
      mockPrismaService.oTPCode.update.mockResolvedValue({});
      mockPrismaService.member.update.mockResolvedValue(mockMember);
      mockJwtService.sign.mockReturnValue('jwt-token');

      await service.verifyOtp('+254712345678', '123456');

      expect(mockPrismaService.member.update).toHaveBeenCalledWith({
        where: { id: 'member-1' },
        data: { isVerified: true },
        include: { subscription: true },
      });
    });

    it('should generate and return JWT token', async () => {
      mockPrismaService.oTPCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        code: '123456',
        memberId: 'member-1',
        member: mockMember,
      });
      mockPrismaService.oTPCode.update.mockResolvedValue({});
      mockPrismaService.member.update.mockResolvedValue(mockMember);
      mockJwtService.sign.mockReturnValue('jwt-token');

      const result = await service.verifyOtp('+254712345678', '123456');

      expect(mockJwtService.sign).toHaveBeenCalledWith({
        sub: 'member-1',
        phone: '+254712345678',
      });
      expect(result.accessToken).toBe('jwt-token');
    });

    it('should return member details', async () => {
      mockPrismaService.oTPCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        code: '123456',
        memberId: 'member-1',
        member: mockMember,
      });
      mockPrismaService.oTPCode.update.mockResolvedValue({});
      mockPrismaService.member.update.mockResolvedValue(mockMember);
      mockJwtService.sign.mockReturnValue('jwt-token');

      const result = await service.verifyOtp('+254712345678', '123456');

      expect(result.member).toMatchObject({
        id: 'member-1',
        phoneNumber: '+254712345678',
        fullName: 'Test User',
        isVerified: true,
      });
    });
  });

  describe('validateToken', () => {
    it('should return member if found', async () => {
      const mockMember = {
        id: 'member-1',
        phoneNumber: '+254712345678',
        subscription: { tier: 'GOLD' },
      };
      mockPrismaService.member.findUnique.mockResolvedValue(mockMember);

      const result = await service.validateToken('member-1');

      expect(result).toEqual(mockMember);
    });

    it('should throw UnauthorizedException if member not found', async () => {
      mockPrismaService.member.findUnique.mockResolvedValue(null);

      await expect(service.validateToken('invalid-id')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
