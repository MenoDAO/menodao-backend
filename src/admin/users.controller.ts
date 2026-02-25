import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { Delete } from '@nestjs/common';

@ApiTags('Admin - Users')
@Controller('admin/users')
@UseGuards(AdminAuthGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(
    private prisma: PrismaService,
    private subscriptionsService: SubscriptionsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all members with pagination' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({
    name: 'tier',
    required: false,
    enum: ['BRONZE', 'SILVER', 'GOLD'],
  })
  async listUsers(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('tier') tier?: string,
  ) {
    const pageNum = Number(page) || 1;
    const limitNum = Math.min(Number(limit) || 20, 100);
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};

    if (search) {
      where.OR = [
        { phoneNumber: { contains: search } },
        { fullName: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (tier) {
      where.subscription = { tier };
    }

    const [users, total] = await Promise.all([
      this.prisma.member.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          phoneNumber: true,
          fullName: true,
          location: true,
          isVerified: true,
          createdAt: true,
          subscription: {
            select: {
              tier: true,
              isActive: true,
              monthlyAmount: true,
              startDate: true,
            },
          },
          _count: {
            select: {
              contributions: true,
              claims: true,
            },
          },
        },
      }),
      this.prisma.member.count({ where }),
    ]);

    return {
      data: users,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get member detail by ID' })
  async getUserDetail(@Param('id') id: string) {
    const user = await this.prisma.member.findUnique({
      where: { id },
      include: {
        subscription: true,
        contributions: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        claims: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        nfts: true,
        deviceTokens: {
          select: {
            id: true,
            platform: true,
            createdAt: true,
          },
        },
      },
    });

    if (!user) {
      return null;
    }

    // Calculate totals
    const totalContributed = user.contributions
      .filter((c) => c.status === 'COMPLETED')
      .reduce((sum, c) => sum + c.amount, 0);

    return {
      ...user,
      stats: {
        totalContributed,
        contributionCount: user.contributions.length,
        claimCount: user.claims.length,
        nftCount: user.nfts.length,
      },
    };
  }

  @Delete(':id/subscription')
  @ApiOperation({ summary: 'Delete a members subscription' })
  async deleteSubscription(@Param('id') id: string) {
    return this.subscriptionsService.removeSubscription(id);
  }
}
