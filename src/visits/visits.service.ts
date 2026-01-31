import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProceduresService } from '../procedures/procedures.service';
import { SmsService } from '../sms/sms.service';
import {
  PackageTier,
  VisitStatus,
  ClaimStatus,
  ClaimType,
} from '@prisma/client';

// Updated claim limits per tier (total claim limit, not annual)
const CLAIM_LIMITS: Record<PackageTier, number> = {
  BRONZE: 2000, // KES 2,000
  SILVER: 5000, // KES 5,000
  GOLD: 10000, // KES 10,000
};

@Injectable()
export class VisitsService {
  private readonly logger = new Logger(VisitsService.name);

  constructor(
    private prisma: PrismaService,
    private proceduresService: ProceduresService,
    private smsService: SmsService,
  ) {}

  /**
   * Search member by phone number and return status
   */
  async searchMember(phoneNumber: string) {
    const rawInput = phoneNumber.trim();
    this.logger.log(`Searching for member: ${rawInput}`);

    // Normalize phone number to standard format (+254...)
    const normalized = this.normalizePhoneNumber(rawInput);
    const suffix = rawInput.length >= 9 ? rawInput.slice(-9) : rawInput;

    const orConditions: any[] = [
      { phoneNumber: normalized },
      { phoneNumber: rawInput },
      {
        phoneNumber: normalized.startsWith('+')
          ? normalized.substring(1)
          : '+' + normalized,
      },
    ];

    if (suffix.length >= 7) {
      orConditions.push({ phoneNumber: { endsWith: suffix } });
    }

    // Try to find by multiple conditions
    const member = await this.prisma.member.findFirst({
      where: {
        OR: orConditions,
      },
      include: {
        subscription: true,
        claims: {
          where: {
            status: { in: [ClaimStatus.APPROVED, ClaimStatus.DISBURSED] },
          },
        },
      },
    });

    if (!member) {
      this.logger.warn(
        `Member not found for input: ${rawInput} (Normalized: ${normalized}, Suffix: ${suffix}, Conditions: ${JSON.stringify(orConditions)})`,
      );
      return {
        found: false,
        message:
          'Member not found. Please verify the phone number or ask the patient to register.',
      };
    }

    this.logger.log(
      `Member found: ${member.fullName || 'Unnamed'} (${member.phoneNumber})`,
    );

    if (!member.subscription || !member.subscription.isActive) {
      return {
        found: true,
        active: false,
        member: {
          id: member.id,
          phoneNumber: member.phoneNumber,
          fullName: member.fullName,
        },
        message: 'No active subscription',
      };
    }

    // Calculate remaining claim limit
    const tier = member.subscription.tier;
    const allocatedLimit = CLAIM_LIMITS[tier];
    const totalClaimed = member.claims.reduce(
      (sum, claim) => sum + claim.amount,
      0,
    );
    const remainingLimit = Math.max(0, allocatedLimit - totalClaimed);

    return {
      found: true,
      active: true,
      member: {
        id: member.id,
        phoneNumber: member.phoneNumber,
        fullName: member.fullName,
        tier: tier,
      },
      subscription: {
        tier: tier,
        isActive: member.subscription.isActive,
      },
      claimLimit: {
        allocated: allocatedLimit,
        used: totalClaimed,
        remaining: remainingLimit,
      },
    };
  }

  /**
   * Check-in a patient (create an open visit)
   */
  async checkIn(phoneNumber: string, staffId: string) {
    const searchResult = await this.searchMember(phoneNumber);

    if (!searchResult.found) {
      throw new NotFoundException('Member not found');
    }

    if (!searchResult.active) {
      throw new BadRequestException(
        'Member does not have an active subscription',
      );
    }

    // Check if there's already an open visit for this member
    const openVisit = await this.prisma.visit.findFirst({
      where: {
        memberId: searchResult.member.id,
        status: VisitStatus.OPEN,
      },
    });

    if (openVisit) {
      throw new BadRequestException('Member already has an open visit');
    }

    // Create new visit
    const visit = await this.prisma.visit.create({
      data: {
        memberId: searchResult.member.id,
        staffId: staffId,
        status: VisitStatus.OPEN,
        totalCost: 0,
      },
      include: {
        member: {
          include: {
            subscription: true,
          },
        },
      },
    });

    return {
      visit: {
        id: visit.id,
        memberId: visit.memberId,
        status: visit.status,
        checkedInAt: visit.checkedInAt,
        totalCost: visit.totalCost,
      },
      member: {
        id: visit.member.id,
        fullName: visit.member.fullName,
        phoneNumber: visit.member.phoneNumber,
        tier: visit.member.subscription?.tier,
      },
      claimLimit: await this.getRemainingClaimLimit(visit.memberId),
    };
  }

  /**
   * Add a procedure to an open visit
   */
  async addProcedure(visitId: string, procedureId: string, staffId: string) {
    // Get visit
    const visit = await this.prisma.visit.findUnique({
      where: { id: visitId },
      include: {
        member: {
          include: {
            subscription: true,
            claims: {
              where: {
                status: { in: [ClaimStatus.APPROVED, ClaimStatus.DISBURSED] },
              },
            },
          },
        },
        procedures: {
          include: {
            procedure: true,
          },
        },
      },
    });

    if (!visit) {
      throw new NotFoundException('Visit not found');
    }

    if (visit.status !== VisitStatus.OPEN) {
      throw new BadRequestException('Visit is not open');
    }

    if (!visit.member.subscription || !visit.member.subscription.isActive) {
      throw new BadRequestException('Member subscription is not active');
    }

    // Get procedure
    const procedure =
      await this.proceduresService.getProcedureById(procedureId);
    if (!procedure || !procedure.isActive) {
      throw new NotFoundException('Procedure not found or inactive');
    }

    // Check if procedure is allowed for member's tier
    const allowedTiers = procedure.allowedTiers as string[];
    const memberTier = visit.member.subscription.tier;
    if (!allowedTiers.includes(memberTier)) {
      throw new BadRequestException(
        `Procedure "${procedure.name}" is not available for ${memberTier} tier members`,
      );
    }

    // Calculate current total cost including this procedure
    const currentVisitCost = visit.procedures.reduce(
      (sum, vp) => sum + vp.cost,
      0,
    );
    const newTotalCost = currentVisitCost + procedure.cost;

    // Calculate remaining claim limit
    const totalClaimed = visit.member.claims.reduce(
      (sum, claim) => sum + claim.amount,
      0,
    );
    const allocatedLimit = CLAIM_LIMITS[memberTier];
    const remainingLimit = allocatedLimit - totalClaimed;

    // Check if adding this procedure would exceed the limit
    if (newTotalCost > remainingLimit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          message: 'Insufficient claim limit',
          error: 'Insufficient Limit',
          details: {
            procedureCost: procedure.cost,
            currentVisitCost: currentVisitCost,
            newTotalCost: newTotalCost,
            remainingLimit: remainingLimit,
            allocatedLimit: allocatedLimit,
            totalClaimed: totalClaimed,
          },
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    // Add procedure to visit
    await this.prisma.visitProcedure.create({
      data: {
        visitId: visit.id,
        procedureId: procedure.id,
        cost: procedure.cost,
        addedBy: staffId,
      },
    });

    // Update visit total cost
    const updatedVisit = await this.prisma.visit.update({
      where: { id: visitId },
      data: {
        totalCost: newTotalCost,
      },
      include: {
        procedures: {
          include: {
            procedure: true,
          },
        },
      },
    });

    return {
      visit: updatedVisit,
      remainingLimit: remainingLimit - newTotalCost,
    };
  }

  /**
   * Discharge a visit (close visit, create claims, send SMS)
   */
  async dischargeVisit(visitId: string, staffId: string) {
    const visit = await this.prisma.visit.findUnique({
      where: { id: visitId },
      include: {
        member: {
          include: {
            subscription: true,
            claims: {
              where: {
                status: { in: [ClaimStatus.APPROVED, ClaimStatus.DISBURSED] },
              },
            },
          },
        },
        procedures: {
          include: {
            procedure: true,
          },
        },
      },
    });

    if (!visit) {
      throw new NotFoundException('Visit not found');
    }

    if (visit.status !== VisitStatus.OPEN) {
      throw new BadRequestException('Visit is not open');
    }

    if (visit.procedures.length === 0) {
      throw new BadRequestException(
        'Cannot discharge visit with no procedures',
      );
    }

    // Final validation: ensure total cost doesn't exceed limit
    const totalClaimed = visit.member.claims.reduce(
      (sum, claim) => sum + claim.amount,
      0,
    );
    const allocatedLimit = CLAIM_LIMITS[visit.member.subscription!.tier];
    const remainingLimit = allocatedLimit - totalClaimed;

    if (visit.totalCost > remainingLimit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          message: 'Insufficient claim limit',
          error: 'Insufficient Limit',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    // Create claims for each procedure
    const claims: any[] = [];
    for (const vp of visit.procedures) {
      const claim = await this.prisma.claim.create({
        data: {
          memberId: visit.memberId,
          claimType: this.mapProcedureToClaimType(vp.procedure.code),
          description: `${vp.procedure.name} - ${vp.procedure.description || ''}`,
          amount: vp.cost,
          status: ClaimStatus.APPROVED, // Auto-approve claims from staff dashboard
          visitId: visit.id,
        },
      });
      claims.push(claim);
    }

    // Close the visit
    const dischargedVisit = await this.prisma.visit.update({
      where: { id: visitId },
      data: {
        status: VisitStatus.DISCHARGED,
        dischargedAt: new Date(),
      },
    });

    // Calculate new balance
    const newTotalClaimed = totalClaimed + visit.totalCost;
    const newRemainingLimit = allocatedLimit - newTotalClaimed;

    // Send SMS notification
    const memberName = visit.member.fullName || 'Member';
    const smsMessage = `Dear ${memberName}, MenoDAO covered KES ${visit.totalCost} for your visit today. Your new limit is KES ${newRemainingLimit}. Get well soon!`;

    try {
      await this.smsService.sendSms(visit.member.phoneNumber, smsMessage);
      this.logger.log(`Discharge SMS sent to ${visit.member.phoneNumber}`);
    } catch (error) {
      this.logger.error(`Failed to send discharge SMS: ${error.message}`);
      // Don't fail the discharge if SMS fails
    }

    return {
      visit: dischargedVisit,
      claims: claims,
      summary: {
        totalCost: visit.totalCost,
        proceduresCount: visit.procedures.length,
        newRemainingLimit: newRemainingLimit,
        allocatedLimit: allocatedLimit,
      },
    };
  }

  /**
   * Get open visit for a member
   */
  async getOpenVisit(memberId: string) {
    const visit = await this.prisma.visit.findFirst({
      where: {
        memberId,
        status: VisitStatus.OPEN,
      },
      include: {
        procedures: {
          include: {
            procedure: true,
          },
        },
        member: {
          include: {
            subscription: true,
            claims: {
              where: {
                status: { in: [ClaimStatus.APPROVED, ClaimStatus.DISBURSED] },
              },
            },
          },
        },
      },
    });

    if (!visit) {
      return null;
    }

    const totalClaimed = visit.member.claims.reduce(
      (sum, claim) => sum + claim.amount,
      0,
    );
    const allocatedLimit = CLAIM_LIMITS[visit.member.subscription!.tier];
    const remainingLimit = allocatedLimit - totalClaimed;

    return {
      visit,
      remainingLimit: remainingLimit - visit.totalCost,
      allocatedLimit,
    };
  }

  /**
   * Get remaining claim limit for a member
   */
  private async getRemainingClaimLimit(memberId: string) {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      include: {
        subscription: true,
        claims: {
          where: {
            status: { in: [ClaimStatus.APPROVED, ClaimStatus.DISBURSED] },
          },
        },
      },
    });

    if (!member || !member.subscription || !member.subscription.isActive) {
      return null;
    }

    const allocatedLimit = CLAIM_LIMITS[member.subscription.tier];
    const totalClaimed = member.claims.reduce(
      (sum, claim) => sum + claim.amount,
      0,
    );
    const remainingLimit = Math.max(0, allocatedLimit - totalClaimed);

    return {
      allocated: allocatedLimit,
      used: totalClaimed,
      remaining: remainingLimit,
    };
  }

  /**
   * Map procedure code to ClaimType enum
   */
  private mapProcedureToClaimType(procedureCode: string): ClaimType {
    const mapping: Record<string, ClaimType> = {
      CONSULT: ClaimType.DENTAL_CHECKUP,
      SCREEN_BASIC: ClaimType.DENTAL_CHECKUP,
      PAIN_RELIEF: ClaimType.OTHER,
      EXTRACT_SIMPLE: ClaimType.DENTAL_EXTRACTION,
      EXTRACT_COMPLEX: ClaimType.DENTAL_EXTRACTION,
      FILLING_L1: ClaimType.DENTAL_FILLING,
      XRAY: ClaimType.OTHER,
      ROOT_CANAL_EMERGENCY: ClaimType.ROOT_CANAL,
    };

    return mapping[procedureCode] || ClaimType.OTHER;
  }

  private normalizePhoneNumber(phone: string): string {
    // Remove spaces and special characters
    let cleaned = phone.replace(/[\s\-\(\)]/g, '');

    // Handle Kenyan numbers logic matching AuthService
    if (cleaned.startsWith('0')) {
      cleaned = '+254' + cleaned.substring(1);
    } else if (cleaned.startsWith('254')) {
      cleaned = '+' + cleaned;
    } else if (!cleaned.startsWith('+')) {
      // Default to adding + if missing
      cleaned = '+' + cleaned;
    }

    return cleaned;
  }
}
