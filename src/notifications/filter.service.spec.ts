import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { FilterService } from './filter.service';
import { PrismaService } from '../prisma/prisma.service';
import { PackageTier } from '@prisma/client';

describe('FilterService', () => {
  let service: FilterService;

  const mockPrismaService = {
    member: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilterService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<FilterService>(FilterService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getFilteredRecipients', () => {
    it('should return phone numbers for matching members', async () => {
      const mockMembers = [
        { phoneNumber: '+254712345678' },
        { phoneNumber: '+254723456789' },
      ];
      mockPrismaService.member.findMany.mockResolvedValue(mockMembers);

      const result = await service.getFilteredRecipients({
        packageTypes: [PackageTier.BRONZE],
      });

      expect(result).toEqual(['+254712345678', '+254723456789']);
      expect(mockPrismaService.member.findMany).toHaveBeenCalledWith({
        where: {
          AND: [
            {
              subscription: {
                tier: { in: [PackageTier.BRONZE] },
              },
            },
          ],
        },
        select: {
          phoneNumber: true,
        },
      });
    });

    it('should handle single phone number filter', async () => {
      const mockMembers = [{ phoneNumber: '+254712345678' }];
      mockPrismaService.member.findMany.mockResolvedValue(mockMembers);

      const result = await service.getFilteredRecipients({
        singlePhoneNumber: '+254712345678',
      });

      expect(result).toEqual(['+254712345678']);
      expect(mockPrismaService.member.findMany).toHaveBeenCalledWith({
        where: {
          phoneNumber: '+254712345678',
        },
        select: {
          phoneNumber: true,
        },
      });
    });

    it('should throw error for invalid phone number', async () => {
      await expect(
        service.getFilteredRecipients({
          singlePhoneNumber: 'invalid',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle CSV phone numbers filter', async () => {
      const mockMembers = [
        { phoneNumber: '+254712345678' },
        { phoneNumber: '+254723456789' },
      ];
      mockPrismaService.member.findMany.mockResolvedValue(mockMembers);

      const result = await service.getFilteredRecipients({
        csvPhoneNumbers: ['+254712345678', '+254723456789'],
      });

      expect(result).toEqual(['+254712345678', '+254723456789']);
      expect(mockPrismaService.member.findMany).toHaveBeenCalledWith({
        where: {
          phoneNumber: { in: ['+254712345678', '+254723456789'] },
        },
        select: {
          phoneNumber: true,
        },
      });
    });
  });

  describe('countFilteredRecipients', () => {
    it('should return count of matching members', async () => {
      mockPrismaService.member.count.mockResolvedValue(5);

      const result = await service.countFilteredRecipients({
        subscriptionStatus: 'active',
      });

      expect(result).toBe(5);
      expect(mockPrismaService.member.count).toHaveBeenCalledWith({
        where: {
          AND: [
            {
              subscription: {
                isActive: true,
              },
            },
          ],
        },
      });
    });

    it('should combine multiple filters with AND logic', async () => {
      mockPrismaService.member.count.mockResolvedValue(3);

      const dateFrom = new Date('2024-01-01');
      const dateTo = new Date('2024-12-31');

      await service.countFilteredRecipients({
        packageTypes: [PackageTier.GOLD, PackageTier.SILVER],
        dateJoinedFrom: dateFrom,
        dateJoinedTo: dateTo,
        subscriptionStatus: 'active',
      });

      expect(mockPrismaService.member.count).toHaveBeenCalledWith({
        where: {
          AND: [
            {
              subscription: {
                tier: { in: [PackageTier.GOLD, PackageTier.SILVER] },
              },
            },
            {
              createdAt: {
                gte: dateFrom,
                lte: dateTo,
              },
            },
            {
              subscription: {
                isActive: true,
              },
            },
          ],
        },
      });
    });
  });

  describe('validatePhoneNumber', () => {
    it('should validate correct phone number formats', () => {
      expect(service.validatePhoneNumber('+254712345678')).toBe(true);
      expect(service.validatePhoneNumber('254712345678')).toBe(true);
      expect(service.validatePhoneNumber('0712345678')).toBe(true);
      expect(service.validatePhoneNumber('0123456789')).toBe(true);
    });

    it('should reject invalid phone number formats', () => {
      expect(service.validatePhoneNumber('invalid')).toBe(false);
      expect(service.validatePhoneNumber('12345')).toBe(false);
      expect(service.validatePhoneNumber('+1234567890')).toBe(false);
      expect(service.validatePhoneNumber('')).toBe(false);
    });
  });

  describe('parseCSVPhoneNumbers', () => {
    it('should parse valid CSV with phone numbers', () => {
      const csv = `Phone Number
+254712345678
0723456789
254734567890`;
      const buffer = Buffer.from(csv);

      const result = service.parseCSVPhoneNumbers(buffer);

      expect(result.valid).toHaveLength(3);
      expect(result.valid).toContain('+254712345678');
      expect(result.valid).toContain('+254723456789');
      expect(result.valid).toContain('+254734567890');
      expect(result.errors).toHaveLength(0);
    });

    it('should skip header row', () => {
      const csv = `phone,name
0712345678,John`;
      const buffer = Buffer.from(csv);

      const result = service.parseCSVPhoneNumbers(buffer);

      expect(result.valid).toHaveLength(1);
      expect(result.valid[0]).toBe('+254712345678');
    });

    it('should deduplicate phone numbers', () => {
      const csv = `0712345678
0712345678
+254712345678`;
      const buffer = Buffer.from(csv);

      const result = service.parseCSVPhoneNumbers(buffer);

      expect(result.valid).toHaveLength(1);
      expect(result.valid[0]).toBe('+254712345678');
    });

    it('should report invalid phone numbers with line numbers', () => {
      const csv = `0712345678
invalid
0723456789
bad-number`;
      const buffer = Buffer.from(csv);

      const result = service.parseCSVPhoneNumbers(buffer);

      expect(result.valid).toHaveLength(2);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toContain('Line 2');
      expect(result.errors[1]).toContain('Line 4');
    });

    it('should handle different CSV delimiters', () => {
      const csv = `0712345678;John;Nairobi
0723456789,Jane,Mombasa
0734567890\tBob\tKisumu`;
      const buffer = Buffer.from(csv);

      const result = service.parseCSVPhoneNumbers(buffer);

      expect(result.valid).toHaveLength(3);
    });

    it('should skip empty lines', () => {
      const csv = `0712345678

0723456789

`;
      const buffer = Buffer.from(csv);

      const result = service.parseCSVPhoneNumbers(buffer);

      expect(result.valid).toHaveLength(2);
    });
  });
});
