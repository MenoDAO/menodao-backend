import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { AppointmentsService } from './appointments.service';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { EmailService } from './email.service';

const FUTURE_SLOT = new Date('2026-08-20T10:00:00+03:00');

describe('AppointmentsService', () => {
  let service: AppointmentsService;

  const mockPrisma = {
    clinic: { findFirst: jest.fn() },
    member: { findUnique: jest.fn() },
    staffUser: { findUnique: jest.fn() },
    appointment: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockSms = { sendSms: jest.fn().mockResolvedValue(undefined) };
  const mockEmail = { send: jest.fn().mockResolvedValue(true) };

  const clinic = {
    id: 'clinic-1',
    name: 'Westlands Dental',
    subCounty: 'Westlands',
    physicalLocation: 'Waiyaki Way',
    operatingHours: null,
    operatesOnWeekends: false,
    leadDentistName: 'Dr A',
    whatsappNumber: null,
    googleMapsLink: null,
    latitude: null,
    longitude: null,
    activeDentalChairs: 1,
    ownerPhone: '+254700000001',
    email: 'clinic@example.com',
  };

  const member = {
    id: 'member-1',
    phoneNumber: '+254712345678',
    fullName: 'Jane Doe',
    county: 'Nairobi',
    subCounty: 'Westlands',
    preferredLanguage: 'en',
    subscription: { isActive: true },
  };

  const booked = {
    id: 'appt-1',
    memberId: 'member-1',
    clinicId: 'clinic-1',
    status: AppointmentStatus.BOOKED,
    scheduledAt: FUTURE_SLOT,
    durationMinutes: 30,
    clinicNotes: null,
    clinic,
    member,
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-19T08:00:00+03:00'));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SmsService, useValue: mockSms },
        { provide: EmailService, useValue: mockEmail },
      ],
    }).compile();

    service = module.get(AppointmentsService);
    jest.clearAllMocks();
    mockPrisma.clinic.findFirst.mockResolvedValue(clinic);
    mockPrisma.appointment.findMany.mockResolvedValue([]);
    mockPrisma.appointment.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('create', () => {
    it('requires intake consent', async () => {
      await expect(
        service.create('member-1', {
          clinicId: 'clinic-1',
          scheduledAt: FUTURE_SLOT.toISOString(),
          intakeReason: 'Pain',
          hasConsent: false,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires an active membership', async () => {
      mockPrisma.member.findUnique.mockResolvedValue({
        ...member,
        subscription: { isActive: false },
      });
      await expect(
        service.create('member-1', {
          clinicId: 'clinic-1',
          scheduledAt: FUTURE_SLOT.toISOString(),
          intakeReason: 'Pain',
          hasConsent: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects times that are not on the clinic slot grid', async () => {
      mockPrisma.member.findUnique.mockResolvedValue(member);
      await expect(
        service.create('member-1', {
          clinicId: 'clinic-1',
          scheduledAt: '2026-08-20T10:07:00.000+03:00',
          intakeReason: 'Pain',
          hasConsent: true,
        }),
      ).rejects.toThrow(/listed clinic slot/i);
    });

    it('creates a booking on a free listed slot and notifies member and clinic', async () => {
      mockPrisma.member.findUnique.mockResolvedValue(member);
      mockPrisma.appointment.create.mockResolvedValue(booked);
      const result = await service.create('member-1', {
        clinicId: 'clinic-1',
        scheduledAt: FUTURE_SLOT.toISOString(),
        intakeReason: 'Toothache',
        hasConsent: true,
      });
      expect(result.id).toBe('appt-1');
      expect(mockPrisma.appointment.create).toHaveBeenCalled();
      expect(mockSms.sendSms).toHaveBeenCalledTimes(2);
      expect(mockEmail.send).toHaveBeenCalled();
    });
  });

  describe('cancelByMember', () => {
    it('blocks cancelling someone else’s appointment', async () => {
      mockPrisma.appointment.findUnique.mockResolvedValue(booked);
      await expect(
        service.cancelByMember('other-member', 'appt-1', 'Cannot attend'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('attachVisit', () => {
    it('rejects an appointment for a different member', async () => {
      mockPrisma.appointment.findUnique.mockResolvedValue(booked);
      await expect(
        service.attachVisit('appt-1', 'visit-1', 'staff-1', {
          memberId: 'someone-else',
          clinicId: 'clinic-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('marks the matching open appointment as attended', async () => {
      mockPrisma.appointment.findUnique.mockResolvedValue(booked);
      mockPrisma.appointment.update.mockResolvedValue({
        ...booked,
        status: AppointmentStatus.ATTENDED,
      });
      await service.attachVisit('appt-1', 'visit-1', 'staff-1', {
        memberId: 'member-1',
        clinicId: 'clinic-1',
      });
      expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'appt-1' },
          data: expect.objectContaining({
            visitId: 'visit-1',
            status: AppointmentStatus.ATTENDED,
          }),
        }),
      );
    });

    it('throws when the appointment does not exist', async () => {
      mockPrisma.appointment.findUnique.mockResolvedValue(null);
      await expect(
        service.attachVisit('missing', 'visit-1', 'staff-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
