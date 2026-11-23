import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  CreateVoucherBatchDto,
  ListVouchersQuery,
  RedeemVoucherDto,
  ShareVoucherDto,
} from '../voucher/dto/voucher.dto';
import { VoucherService } from '../voucher/voucher.service';
import { AuditLogService } from './audit-log.service';
import { Capability } from './guards/capabilities';
import { CapabilityGuard } from './guards/capabilities.guard';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { Roles } from './guards/roles.decorator';
import { RolesGuard } from './guards/roles.guard';

interface AdminRequest extends Request {
  admin: { id: string; username: string; role: string };
}

@ApiTags('Admin Vouchers')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, RolesGuard, CapabilityGuard)
@Capability('vouchers.read')
@Controller('admin/vouchers')
export class VoucherController {
  constructor(
    private readonly vouchers: VoucherService,
    private readonly audit: AuditLogService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Voucher counts by status, including shared codes' })
  stats() {
    return this.vouchers.stats();
  }

  @Get()
  @ApiOperation({ summary: 'Search voucher codes' })
  list(@Query() query: ListVouchersQuery) {
    return this.vouchers.listVouchers(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one voucher and its batch' })
  get(@Param('id') id: string) {
    return this.vouchers.get(id);
  }

  @Post('batches')
  @Roles('SUPER_ADMIN')
  @Capability('vouchers.write')
  @ApiOperation({ summary: 'Generate a batch of unique voucher codes' })
  async createBatch(@Body() body: CreateVoucherBatchDto, @Req() req: AdminRequest) {
    const result = await this.vouchers.createBatch({
      ...body,
      createdByAdminId: req.admin.id,
    });
    await this.audit.logAction({
      adminId: req.admin.id,
      action: 'CREATE_VOUCHER_BATCH',
      targetType: 'VOUCHER_BATCH',
      targetId: result.batch.id,
      reason: `Generated ${result.batch.total} ${result.batch.codePrefix} vouchers`,
      metadata: { prefix: result.batch.codePrefix, count: result.batch.total },
      ipAddress: req.ip || 'unknown',
    });
    return result;
  }

  @Post(':id/redeem')
  @HttpCode(HttpStatus.OK)
  @Capability('vouchers.write')
  @ApiOperation({ summary: 'Redeem a voucher (idempotent)' })
  async redeem(
    @Param('id') id: string,
    @Body() body: RedeemVoucherDto,
    @Req() req: AdminRequest,
  ) {
    const voucher = await this.vouchers.redeem(id, {
      ...body,
      adminId: req.admin.id,
    });
    await this.audit.logAction({
      adminId: req.admin.id,
      action: 'REDEEM_VOUCHER',
      targetType: 'VOUCHER',
      targetId: id,
      reason: body.notes?.trim() || `Redeemed ${voucher.code}`,
      ipAddress: req.ip || 'unknown',
    });
    return voucher;
  }

  @Post(':id/share')
  @HttpCode(HttpStatus.OK)
  @Capability('vouchers.write')
  @ApiOperation({ summary: 'Record that a voucher was shared on a channel' })
  async share(
    @Param('id') id: string,
    @Body() body: ShareVoucherDto,
    @Req() req: AdminRequest,
  ) {
    const voucher = await this.vouchers.share(id, body.channel);
    await this.audit.logAction({
      adminId: req.admin.id,
      action: 'SHARE_VOUCHER',
      targetType: 'VOUCHER',
      targetId: id,
      reason: `Shared via ${body.channel}`,
      ipAddress: req.ip || 'unknown',
    });
    return voucher;
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @Capability('vouchers.write')
  @ApiOperation({ summary: 'Void a voucher so it can no longer be redeemed' })
  async void(@Param('id') id: string, @Req() req: AdminRequest) {
    const voucher = await this.vouchers.void(id);
    await this.audit.logAction({
      adminId: req.admin.id,
      action: 'VOID_VOUCHER',
      targetType: 'VOUCHER',
      targetId: id,
      reason: `Voided ${voucher.code}`,
      ipAddress: req.ip || 'unknown',
    });
    return voucher;
  }
}
