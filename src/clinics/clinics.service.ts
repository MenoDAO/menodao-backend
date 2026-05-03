import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { RegisterClinicDto } from './dto/register-clinic.dto';
import { UpdateClinicDto } from './dto/update-clinic.dto';
import { AdminCreateClinicDto } from './dto/admin-create-clinic.dto';
import { ClinicStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { haversineKm } from '../common/utils/haversine';

export interface ClinicMapRecord {
  id: string;
  name: string;
  subCounty: string;
  physicalLocation: string;
  operatingHours: string;
  whatsappNumber: string;
  googleMapsLink: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ClinicWithDistance extends ClinicMapRecord {
  distanceKm: number;
}

@Injectable()
export class ClinicsService {
  private readonly logger = new Logger(ClinicsService.name);
  private readonly frontendUrl: string;

  constructor(
    private prisma: PrismaService,
    private smsService: SmsService,
    private configService: ConfigService,
  ) {
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    this.frontendUrl = isProduction
      ? 'https://app.menodao.org'
      : 'https://dev.menodao.org';
    this.logger.log(`Frontend URL set to: ${this.frontendUrl}`);
  }

  /**
   * Public: Register a new partner clinic
   */
  async registerClinic(dto: RegisterClinicDto) {
    const clinic = await this.prisma.clinic.create({
      data: {
        name: dto.name,
        subCounty: dto.subCounty,
        physicalLocation: dto.physicalLocation,
        googleMapsLink: dto.googleMapsLink,
        operatingHours: dto.operatingHours,
        operatesOnWeekends: dto.operatesOnWeekends,
        leadDentistName: dto.leadDentistName,
        ownerPhone: dto.ownerPhone,
        managerName: dto.managerName,
        whatsappNumber: dto.whatsappNumber,
        email: dto.email,
        mpesaTillOrPaybill: dto.mpesaTillOrPaybill,
        tillPaybillName: dto.tillPaybillName,
        bankAccountName: dto.bankAccountName,
        bankAccountNumber: dto.bankAccountNumber,
        kmpdcRegNumber: dto.kmpdcRegNumber,
        activeDentalChairs: dto.activeDentalChairs,
        xrayCapability: dto.xrayCapability,
        specializedServices: dto.specializedServices,
        agreedToRateCard: dto.agreedToRateCard,
        agreedToNoChargePolicy: dto.agreedToNoChargePolicy,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
      },
    });

    this.logger.log(`New clinic registered: ${clinic.name} (${clinic.id})`);

    return {
      success: true,
      clinicId: clinic.id,
      message:
        'Clinic registration submitted successfully. You will be contacted once approved.',
    };
  }

  /**
   * Admin: List clinics filtered by status
   */
  async listClinics(status?: ClinicStatus) {
    const where = status ? { status } : {};

    const clinics = await this.prisma.clinic.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { staffUsers: true } },
      },
    });

    return clinics;
  }

  /**
   * Admin: Get single clinic details
   */
  async getClinic(id: string) {
    const clinic = await this.prisma.clinic.findUnique({
      where: { id },
      include: {
        staffUsers: {
          select: {
            id: true,
            username: true,
            fullName: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
        },
      },
    });

    if (!clinic) {
      throw new NotFoundException('Clinic not found');
    }

    return clinic;
  }

  /**
   * Admin: Approve a clinic — generates staff credentials
   */
  async approveClinic(id: string, adminId: string) {
    const clinic = await this.prisma.clinic.findUnique({ where: { id } });

    if (!clinic) {
      throw new NotFoundException('Clinic not found');
    }

    if (clinic.status === 'APPROVED') {
      throw new BadRequestException('Clinic is already approved');
    }

    // Update clinic status
    await this.prisma.clinic.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: adminId,
      },
    });

    // Generate staff accounts for the contact persons
    const staffAccounts: {
      name: string;
      username: string;
      password: string;
    }[] = [];

    // 1. Owner / Lead Dentist
    const ownerAccount = await this.createStaffAccount(
      clinic.leadDentistName,
      clinic.ownerPhone,
      id,
    );
    staffAccounts.push(ownerAccount);

    // 2. Manager / Receptionist (if provided)
    if (clinic.managerName && clinic.whatsappNumber !== clinic.ownerPhone) {
      const managerAccount = await this.createStaffAccount(
        clinic.managerName,
        clinic.whatsappNumber,
        id,
      );
      staffAccounts.push(managerAccount);
    }

    // Send SMS with credentials
    for (const account of staffAccounts) {
      const message = `Welcome to MenoDAO! ${clinic.name} has been approved as a Clinical Hub. Your staff login: Username: ${account.username} Password: ${account.password} Login at: ${this.frontendUrl}/staff/login`;
      try {
        await this.smsService.sendSms(
          account.username.replace(/[^0-9]/g, '').length > 8
            ? account.username
            : clinic.ownerPhone,
          message,
        );
      } catch (error) {
        this.logger.error(
          `Failed to send credentials SMS for ${account.name}`,
          error,
        );
      }
    }

    this.logger.log(
      `Clinic ${clinic.name} approved by admin ${adminId}. ${staffAccounts.length} staff account(s) created.`,
    );

    return {
      success: true,
      message: `Clinic approved. ${staffAccounts.length} staff credential(s) generated and sent via SMS.`,
      staffAccounts: staffAccounts.map((a) => ({
        name: a.name,
        username: a.username,
      })),
    };
  }

  /**
   * Admin: Suspend a clinic
   */
  async suspendClinic(id: string) {
    const clinic = await this.prisma.clinic.findUnique({ where: { id } });
    if (!clinic) throw new NotFoundException('Clinic not found');

    await this.prisma.clinic.update({
      where: { id },
      data: { status: 'SUSPENDED' },
    });

    // Deactivate all staff accounts for this clinic
    await this.prisma.staffUser.updateMany({
      where: { clinicId: id },
      data: { isActive: false },
    });

    this.logger.log(`Clinic ${clinic.name} suspended`);
    return { success: true, message: 'Clinic suspended' };
  }

  /**
   * Admin: Reject a clinic
   */
  async rejectClinic(id: string, reason: string) {
    const clinic = await this.prisma.clinic.findUnique({ where: { id } });
    if (!clinic) throw new NotFoundException('Clinic not found');

    await this.prisma.clinic.update({
      where: { id },
      data: { status: 'REJECTED', rejectionReason: reason },
    });

    this.logger.log(`Clinic ${clinic.name} rejected: ${reason}`);
    return { success: true, message: 'Clinic rejected' };
  }

  /**
   * Public: Get all APPROVED clinics for the member map (includes null-coord clinics)
   */
  async getMapClinics(): Promise<ClinicMapRecord[]> {
    const clinics = await this.prisma.clinic.findMany({
      where: { status: 'APPROVED' },
      select: {
        id: true,
        name: true,
        subCounty: true,
        physicalLocation: true,
        operatingHours: true,
        whatsappNumber: true,
        googleMapsLink: true,
        latitude: true,
        longitude: true,
      },
      orderBy: { name: 'asc' },
    });
    return clinics;
  }

  /**
   * Public: Get APPROVED geo-located clinics within radius km, sorted by distance
   */
  async getNearbyClinics(
    lat: number,
    lng: number,
    radius: number = 50,
  ): Promise<ClinicWithDistance[]> {
    const clinics = await this.prisma.clinic.findMany({
      where: {
        status: 'APPROVED',
        latitude: { not: null },
        longitude: { not: null },
      },
      select: {
        id: true,
        name: true,
        subCounty: true,
        physicalLocation: true,
        operatingHours: true,
        whatsappNumber: true,
        googleMapsLink: true,
        latitude: true,
        longitude: true,
      },
    });

    const withDistance: ClinicWithDistance[] = clinics
      .filter((c) => c.latitude != null && c.longitude != null)
      .map((c) => ({
        ...c,
        latitude: c.latitude as number,
        longitude: c.longitude as number,
        distanceKm:
          Math.round(
            haversineKm(lat, lng, c.latitude as number, c.longitude as number) *
              100,
          ) / 100,
      }))
      .filter((c) => c.distanceKm <= radius)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    return withDistance;
  }

  /**
   * Admin: Partial update of any clinic field
   */
  async updateClinic(id: string, dto: UpdateClinicDto) {
    const clinic = await this.prisma.clinic.findUnique({ where: { id } });
    if (!clinic) throw new NotFoundException('Clinic not found');

    // Validate parentClinicId if provided
    if (dto.parentClinicId) {
      const parent = await this.prisma.clinic.findUnique({
        where: { id: dto.parentClinicId },
      });
      if (!parent) {
        throw new BadRequestException('Parent clinic not found');
      }
      if (dto.parentClinicId === id) {
        throw new BadRequestException('A clinic cannot be its own parent');
      }
    }

    const updated = await this.prisma.clinic.update({
      where: { id },
      data: dto as any,
    });

    this.logger.log(`Clinic ${id} updated`);
    return updated;
  }

  /**
   * Admin: Create a clinic directly (bypasses self-registration)
   */
  async adminCreateClinic(dto: AdminCreateClinicDto, adminId: string) {
    // Validate parentClinicId if provided
    if (dto.parentClinicId) {
      const parent = await this.prisma.clinic.findUnique({
        where: { id: dto.parentClinicId },
      });
      if (!parent) {
        throw new BadRequestException('Parent clinic not found');
      }
    }

    const targetStatus = dto.status ?? 'PENDING';

    const clinic = await this.prisma.clinic.create({
      data: {
        name: dto.name,
        subCounty: dto.subCounty,
        physicalLocation: dto.physicalLocation,
        googleMapsLink: dto.googleMapsLink,
        operatingHours: dto.operatingHours,
        operatesOnWeekends: dto.operatesOnWeekends,
        leadDentistName: dto.leadDentistName,
        ownerPhone: dto.ownerPhone,
        managerName: dto.managerName,
        whatsappNumber: dto.whatsappNumber,
        email: dto.email,
        mpesaTillOrPaybill: dto.mpesaTillOrPaybill,
        tillPaybillName: dto.tillPaybillName,
        bankAccountName: dto.bankAccountName,
        bankAccountNumber: dto.bankAccountNumber,
        kmpdcRegNumber: dto.kmpdcRegNumber,
        activeDentalChairs: dto.activeDentalChairs,
        xrayCapability: dto.xrayCapability,
        specializedServices: dto.specializedServices,
        agreedToRateCard: dto.agreedToRateCard,
        agreedToNoChargePolicy: dto.agreedToNoChargePolicy,
        latitude: dto.latitude,
        longitude: dto.longitude,
        branchName: dto.branchName,
        parentClinicId: dto.parentClinicId,
        status: targetStatus,
      },
    });

    this.logger.log(
      `Clinic ${clinic.name} created by admin ${adminId} with status ${targetStatus}`,
    );

    // If created as APPROVED, generate staff credentials
    if (targetStatus === 'APPROVED') {
      await this.approveClinic(clinic.id, adminId);
    }

    return clinic;
  }

  /**
   * Admin: Get all branch clinics for a given parent clinic
   */
  async getClinicBranches(id: string) {
    const parent = await this.prisma.clinic.findUnique({ where: { id } });
    if (!parent) throw new NotFoundException('Clinic not found');

    return this.prisma.clinic.findMany({
      where: { parentClinicId: id },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Helper: Create a staff account for a clinic contact
   */
  private async createStaffAccount(
    fullName: string,
    phone: string,
    clinicId: string,
  ): Promise<{ name: string; username: string; password: string }> {
    // Generate a clean username from the phone
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const username = cleanPhone.startsWith('0')
      ? cleanPhone
      : `0${cleanPhone.slice(-9)}`;

    // Generate a random 6-char password
    const password = Math.random().toString(36).slice(-6) + '!A1';

    const passwordHash = await bcrypt.hash(password, 10);

    // Check if staff user already exists
    const existing = await this.prisma.staffUser.findUnique({
      where: { username },
    });

    if (existing) {
      // Link existing staff to clinic
      await this.prisma.staffUser.update({
        where: { username },
        data: { clinicId, isActive: true },
      });
      this.logger.log(
        `Existing staff ${username} linked to clinic ${clinicId}`,
      );
      return { name: fullName, username, password: '(existing — unchanged)' };
    }

    await this.prisma.staffUser.create({
      data: {
        username,
        passwordHash,
        fullName,
        role: 'STAFF',
        isActive: true,
        clinicId,
      },
    });

    return { name: fullName, username, password };
  }
}
