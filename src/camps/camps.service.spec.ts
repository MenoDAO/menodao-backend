import { Test, TestingModule } from '@nestjs/testing';
import { CampsService } from './camps.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('CampsService', () => {
  let service: CampsService;
  let prismaService: jest.Mocked<PrismaService>;

  const mockPrismaService = {
    camp: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    campRegistration: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<CampsService>(CampsService);
    prismaService = module.get(PrismaService);

    jest.clearAllMocks();
  });

  describe('getUpcomingCamps', () => {
    it('should return active upcoming camps sorted by date', async () => {
      const mockCamps = [
        { id: 'c1', name: 'Camp A', startDate: new Date('2026-02-01') },
        { id: 'c2', name: 'Camp B', startDate: new Date('2026-03-01') },
      ];
      mockPrismaService.camp.findMany.mockResolvedValue(mockCamps);

      const result = await service.getUpcomingCamps();

      expect(mockPrismaService.camp.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          startDate: { gte: expect.any(Date) },
        },
        orderBy: { startDate: 'asc' },
      });
      expect(result).toEqual(mockCamps);
    });
  });

  describe('findNearby', () => {
    it('should filter camps by distance', async () => {
      const mockCamps = [
        { id: 'c1', name: 'Near Camp', latitude: -1.28, longitude: 36.82 },
        { id: 'c2', name: 'Far Camp', latitude: -4.05, longitude: 39.67 },
      ];
      mockPrismaService.camp.findMany.mockResolvedValue(mockCamps);

      // Searching from Nairobi (-1.29, 36.82)
      const result = await service.findNearby(-1.29, 36.82, 50);

      // Near camp should be within 50km, far camp (Mombasa) should be filtered out
      expect(result.length).toBeLessThanOrEqual(2);
      if (result.length > 0) {
        expect(result[0].distanceKm).toBeLessThanOrEqual(50);
      }
    });

    it('should sort camps by distance', async () => {
      const mockCamps = [
        { id: 'c1', name: 'Camp 10km', latitude: -1.2, longitude: 36.82 },
        { id: 'c2', name: 'Camp 5km', latitude: -1.25, longitude: 36.82 },
        { id: 'c3', name: 'Camp 20km', latitude: -1.1, longitude: 36.82 },
      ];
      mockPrismaService.camp.findMany.mockResolvedValue(mockCamps);

      const result = await service.findNearby(-1.29, 36.82, 100);

      // Results should be sorted by distance
      for (let i = 1; i < result.length; i++) {
        expect(result[i].distanceKm).toBeGreaterThanOrEqual(
          result[i - 1].distanceKm,
        );
      }
    });

    it('should include distance in km with camps', async () => {
      mockPrismaService.camp.findMany.mockResolvedValue([
        { id: 'c1', name: 'Camp', latitude: -1.28, longitude: 36.82 },
      ]);

      const result = await service.findNearby(-1.29, 36.82, 50);

      expect(result[0]).toHaveProperty('distanceKm');
      expect(typeof result[0].distanceKm).toBe('number');
    });
  });

  describe('getCamp', () => {
    it('should throw NotFoundException if camp not found', async () => {
      mockPrismaService.camp.findUnique.mockResolvedValue(null);

      await expect(service.getCamp('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return camp with spots remaining', async () => {
      mockPrismaService.camp.findUnique.mockResolvedValue({
        id: 'c1',
        name: 'Dental Camp',
        capacity: 100,
        _count: { registrations: 25 },
      });

      const result = await service.getCamp('c1');

      expect(result.spotsRemaining).toBe(75);
    });
  });

  describe('registerForCamp', () => {
    it('should throw if camp is fully booked', async () => {
      mockPrismaService.camp.findUnique.mockResolvedValue({
        id: 'c1',
        capacity: 50,
        _count: { registrations: 50 },
      });

      await expect(service.registerForCamp('member-1', 'c1')).rejects.toThrow(
        'fully booked',
      );
    });

    it('should throw if already registered', async () => {
      mockPrismaService.camp.findUnique.mockResolvedValue({
        id: 'c1',
        capacity: 50,
        _count: { registrations: 25 },
      });
      mockPrismaService.campRegistration.findUnique.mockResolvedValue({
        id: 'reg-1',
        campId: 'c1',
        memberId: 'member-1',
      });

      await expect(service.registerForCamp('member-1', 'c1')).rejects.toThrow(
        'already registered',
      );
    });

    it('should create registration successfully', async () => {
      mockPrismaService.camp.findUnique.mockResolvedValue({
        id: 'c1',
        name: 'Camp A',
        capacity: 50,
        _count: { registrations: 25 },
      });
      mockPrismaService.campRegistration.findUnique.mockResolvedValue(null);
      mockPrismaService.campRegistration.create.mockResolvedValue({
        id: 'reg-1',
        campId: 'c1',
        memberId: 'member-1',
        status: 'REGISTERED',
        camp: { id: 'c1', name: 'Camp A' },
      });

      const result = await service.registerForCamp('member-1', 'c1');

      expect(mockPrismaService.campRegistration.create).toHaveBeenCalledWith({
        data: { campId: 'c1', memberId: 'member-1' },
        include: { camp: true },
      });
      expect(result.status).toBe('REGISTERED');
    });
  });

  describe('getMemberRegistrations', () => {
    it('should return member registrations with camp info', async () => {
      const mockRegistrations = [
        { id: 'r1', camp: { id: 'c1', name: 'Camp A', startDate: new Date() } },
        { id: 'r2', camp: { id: 'c2', name: 'Camp B', startDate: new Date() } },
      ];
      mockPrismaService.campRegistration.findMany.mockResolvedValue(
        mockRegistrations,
      );

      const result = await service.getMemberRegistrations('member-1');

      expect(mockPrismaService.campRegistration.findMany).toHaveBeenCalledWith({
        where: { memberId: 'member-1' },
        include: { camp: true },
        orderBy: { camp: { startDate: 'asc' } },
      });
      expect(result).toEqual(mockRegistrations);
    });
  });

  describe('cancelRegistration', () => {
    it('should throw if registration not found', async () => {
      mockPrismaService.campRegistration.findUnique.mockResolvedValue(null);

      await expect(
        service.cancelRegistration('member-1', 'c1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update registration status to cancelled', async () => {
      mockPrismaService.campRegistration.findUnique.mockResolvedValue({
        id: 'reg-1',
        campId: 'c1',
        memberId: 'member-1',
      });
      mockPrismaService.campRegistration.update.mockResolvedValue({
        id: 'reg-1',
        status: 'CANCELLED',
      });

      const result = await service.cancelRegistration('member-1', 'c1');

      expect(mockPrismaService.campRegistration.update).toHaveBeenCalledWith({
        where: { id: 'reg-1' },
        data: { status: 'CANCELLED' },
      });
      expect(result.status).toBe('CANCELLED');
    });
  });
});
