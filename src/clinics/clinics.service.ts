import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { RegisterClinicDto } from './dto/register-clinic.dto';
import { ClinicStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class ClinicsService {
  private readonly logger = new Logger(ClinicsService.name);

  constructor(
    private prisma: PrismaService,
    private smsService: SmsService,
  ) {}

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
      const message = `Welcome to MenoDAO! ${clinic.name} has been approved as a Clinical Hub. Your staff login: Username: ${account.username} Password: ${account.password} Login at: https://dev.menodao.org/staff/login`;
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
