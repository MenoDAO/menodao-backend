import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateMemberDto } from './dto/update-member.dto';

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
}
