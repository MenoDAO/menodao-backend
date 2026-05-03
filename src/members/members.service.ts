import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateMemberDto } from './dto/update-member.dto';
import { CreateDependantDto } from './dto/create-dependant.dto';

@Injectable()
export class MembersService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const member = await this.prisma.member.findUnique({
      where: { id },
      include: {
        subscription: true,
        contributions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        claims: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        nfts: true,
      },
    });

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    return member;
  }

  async update(id: string, dto: UpdateMemberDto) {
    return this.prisma.member.update({
      where: { id },
      data: dto,
      include: {
        subscription: true,
      },
    });
  }

  async getContributionHistory(memberId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [contributions, total] = await Promise.all([
      this.prisma.contribution.findMany({
        where: { memberId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.contribution.count({ where: { memberId } }),
    ]);

    return {
      data: contributions,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getClaimHistory(memberId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [claims, total] = await Promise.all([
      this.prisma.claim.findMany({
        where: { memberId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          camp: true,
        },
      }),
      this.prisma.claim.count({ where: { memberId } }),
    ]);

    return {
      data: claims,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getTransactionHistory(memberId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      this.prisma.blockchainTransaction.findMany({
        where: { memberId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.blockchainTransaction.count({ where: { memberId } }),
    ]);

    return {
      data: transactions,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getMemberHistory(memberId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    // Fetch member name for personalised ownership fields
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: { fullName: true, phoneNumber: true },
    });
    const memberName = member?.fullName || member?.phoneNumber || 'Member';

    const [visits, total] = await Promise.all([
      this.prisma.visit.findMany({
        where: { memberId },
        include: {
          procedures: { include: { procedure: true } },
          staff: {
            select: {
              fullName: true,
              clinic: { select: { name: true } },
            },
          },
          questionnaire: true,
        },
        orderBy: { checkedInAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.visit.count({ where: { memberId } }),
    ]);

    const formattedVisits = visits.map((visit) => {
      const clinicName = visit.staff.clinic?.name || 'MenoHub Clinic';
      return {
        id: visit.id,
        date: visit.checkedInAt,
        status: visit.status,
        totalCost: visit.totalCost,
        clinic: clinicName,
        treatedBy: visit.staff.fullName || 'Unknown Provider',
        procedures: visit.procedures.map((vp) => ({
          name: vp.procedure.name,
          cost: vp.cost,
          addedAt: vp.addedAt,
        })),
        clinicalData: {
          chiefComplaint: visit.chiefComplaint,
          medicalHistory: visit.medicalHistory,
          vitals: visit.vitals,
          clinicalNotes: visit.clinicalNotes,
        },
        questionnaire: visit.questionnaire,
        impactProof:
          visit.web3VerificationStatus !== 'NONE' &&
          visit.web3VerificationStatus !== null
            ? {
                status: visit.web3VerificationStatus,
                tokenId: (visit.hypercertData as any)?.tokenId || null,
                metadataUrl: (visit.hypercertData as any)?.metadataUrl || null,
                metadataCID: (visit.hypercertData as any)?.metadataCID || null,
                onChainTxHash: visit.onChainTxHash,
                payoutTxHash: visit.payoutTxHash,
                mintedAt: (visit.hypercertData as any)?.mintedAt || null,
                ownership: {
                  attester: 'MenoDAO',
                  clinic: clinicName,
                  beneficiary: memberName,
                },
              }
            : null,
      };
    });

    return {
      visits: formattedVisits,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async addDependant(memberId: string, dto: CreateDependantDto) {
    const TIER_MAX: Record<string, number> = { SILVER: 1, GOLD: 2 };

    const subscription = await this.prisma.subscription.findUnique({
      where: { memberId },
    });

    if (
      !subscription ||
      !subscription.isActive ||
      subscription.tier === 'BRONZE'
    ) {
      throw new BadRequestException(
        'Dependant coverage requires a Silver or Gold subscription',
      );
    }

    const existingCount = await this.prisma.dependant.count({
      where: { memberId },
    });

    const limit = TIER_MAX[subscription.tier];
    if (existingCount >= limit) {
      const message =
        subscription.tier === 'SILVER'
          ? 'Silver plan allows a maximum of 1 dependant'
          : 'Gold plan allows a maximum of 2 dependants';
      throw new BadRequestException(message);
    }

    return this.prisma.dependant.create({
      data: {
        memberId,
        fullName: dto.fullName,
        relationship: dto.relationship,
      },
    });
  }

  async getDependants(memberId: string) {
    return await this.prisma.dependant.findMany({
      where: { memberId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
