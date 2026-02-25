import { Test, TestingModule } from '@nestjs/testing';
import { VisitsService } from './visits.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProceduresService } from '../procedures/procedures.service';
import { SmsService } from '../sms/sms.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VisitStatus, PackageTier } from '@prisma/client';

describe('VisitsService', () => {
  let service: VisitsService;
  let prisma: jest.Mocked<PrismaService>;
  let proceduresService: jest.Mocked<ProceduresService>;
  let smsService: jest.Mocked<SmsService>;

  const mockPrisma = {
    member: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    visit: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    visitProcedure: {
      create: jest.fn(),
    },
    claim: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockProceduresService = {
    getProcedureById: jest.fn(),
  };

  const mockSmsService = {
    sendSms: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisitsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ProceduresService, useValue: mockProceduresService },
        { provide: SmsService, useValue: mockSmsService },
      ],
    }).compile();

    service = module.get<VisitsService>(VisitsService);
    prisma = module.get(PrismaService);
    proceduresService = module.get(ProceduresService);
    smsService = module.get(SmsService);

    jest.clearAllMocks();
  });

  describe('normalizePhoneNumber', () => {
    it('should normalize 07... format to +254...', () => {
      const result = (service as any).normalizePhoneNumber('0712345678');
      expect(result).toBe('+254712345678');
    });

    it('should normalize 254... format to +254...', () => {
      const result = (service as any).normalizePhoneNumber('254712345678');
      expect(result).toBe('+254712345678');
    });

    it('should prepend + if missing and not 0 or 254 prefixed', () => {
      const result = (service as any).normalizePhoneNumber('712345678');
      expect(result).toBe('+712345678');
    });

    it('should keep + prefix if already present', () => {
      const result = (service as any).normalizePhoneNumber('+254712345678');
      expect(result).toBe('+254712345678');
    });
  });

  describe('checkIn', () => {
    it('should throw BadRequestException if consent is not provided', async () => {
      mockPrisma.member.findFirst.mockResolvedValue({
        id: 'member-1',
        phoneNumber: '+254712345678',
        subscription: { isActive: true, tier: 'BRONZE' },
        claims: [],
      });

      await expect(
        service.checkIn(
          { phoneNumber: '0712345678', hasConsent: false },
          'staff-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if member has an open visit', async () => {
      mockPrisma.member.findFirst.mockResolvedValue({
        id: 'member-1',
        phoneNumber: '+254712345678',
        subscription: { isActive: true, tier: 'BRONZE' },
        claims: [],
      });
      mockPrisma.visit.findFirst.mockResolvedValue({ id: 'visit-1' });

      await expect(
        service.checkIn(
          { phoneNumber: '0712345678', hasConsent: true },
          'staff-1',
        ),
      ).rejects.toThrow('Member already has an open visit');
    });

    it('should create a visit with clinical data', async () => {
      const member = {
        id: 'member-1',
        phoneNumber: '+254712345678',
        subscription: { isActive: true, tier: 'GOLD' },
        claims: [],
      };
      mockPrisma.member.findFirst.mockResolvedValue(member);
      mockPrisma.visit.findFirst.mockResolvedValue(null);
      mockPrisma.member.findUnique.mockResolvedValue(member);

      const mockVisit = {
        id: 'visit-new',
        memberId: 'member-1',
        status: VisitStatus.OPEN,
        checkedInAt: new Date(),
        totalCost: 0,
        member: {
          id: 'member-1',
          fullName: 'Test User',
          phoneNumber: '+254712345678',
          subscription: { tier: 'GOLD', isActive: true },
        },
      };
      mockPrisma.visit.create.mockResolvedValue(mockVisit);

      const result = await service.checkIn(
        {
          phoneNumber: '0712345678',
          hasConsent: true,
          chiefComplaint: 'Toothache',
          vitals: { bp: '120/80', pulse: 72, temp: 36.6 },
        },
        'staff-1',
      );

      expect(result.visit.id).toBe('visit-new');
      expect(mockPrisma.visit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            chiefComplaint: 'Toothache',
            vitals: { bp: '120/80', pulse: 72, temp: 36.6 },
            hasConsent: true,
          }),
        }),
      );
    });
  });

  describe('dischargeVisit', () => {
    it('should discharge visit and create claims in a transaction', async () => {
      const mockVisit = {
        id: 'visit-1',
        status: VisitStatus.OPEN,
        memberId: 'member-1',
        totalCost: 1000,
        member: {
          fullName: 'John Doe',
          phoneNumber: '+254712345678',
          subscription: { tier: 'BRONZE' },
          claims: [],
        },
        procedures: [
          {
            cost: 1000,
            procedure: { code: 'CONSULT', name: 'Consultation' },
          },
        ],
      };

      mockPrisma.visit.findUnique.mockResolvedValue(mockVisit as any);

      // Mock transaction
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrisma);
      });

      mockPrisma.visit.update.mockResolvedValue({
        ...mockVisit,
        status: VisitStatus.DISCHARGED,
      });

      const result = await service.dischargeVisit('visit-1');

      expect(result.visit.status).toBe(VisitStatus.DISCHARGED);
      expect(mockPrisma.claim.create).toHaveBeenCalled();
      expect(mockSmsService.sendSms).toHaveBeenCalled();
    });
  });
});
