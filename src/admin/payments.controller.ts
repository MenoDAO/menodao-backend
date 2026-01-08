import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Admin - Payments')
@Controller('admin/payments')
@UseGuards(AdminAuthGuard)
@ApiBearerAuth()
export class PaymentsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'List all payments with pagination and filters' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'] })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  async listPayments(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = Number(page) || 1;
    const limitNum = Math.min(Number(limit) || 20, 100);
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    
    if (status) {
      where.status = status;
    }

    if (startDate) {
      where.createdAt = { ...where.createdAt, gte: new Date(startDate) };
    }

    if (endDate) {
      where.createdAt = { ...where.createdAt, lte: new Date(endDate) };
    }

    if (search) {
      where.OR = [
        { paymentRef: { contains: search } },
        { member: { phoneNumber: { contains: search } } },
        { member: { fullName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [payments, total, totalAmount] = await Promise.all([
      this.prisma.contribution.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: {
          member: {
            select: {
              id: true,
              phoneNumber: true,
              fullName: true,
              subscription: {
                select: { tier: true },
              },
            },
          },
        },
      }),
      this.prisma.contribution.count({ where }),
      this.prisma.contribution.aggregate({
        where: { ...where, status: 'COMPLETED' },
        _sum: { amount: true },
      }),
    ]);

    return {
      data: payments,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        totalAmount: totalAmount._sum.amount || 0,
      },
    };
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get payment summary by status' })
  async getPaymentSummary() {
    const summary = await this.prisma.contribution.groupBy({
      by: ['status'],
      _count: true,
      _sum: { amount: true },
    });

    return summary.map((s) => ({
      status: s.status,
      count: s._count,
      totalAmount: s._sum.amount || 0,
    }));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payment detail by ID' })
  async getPaymentDetail(@Param('id') id: string) {
    return this.prisma.contribution.findUnique({
      where: { id },
      include: {
        member: {
          select: {
            id: true,
            phoneNumber: true,
            fullName: true,
            subscription: true,
          },
        },
      },
    });
  }
}
