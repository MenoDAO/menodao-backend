import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  HttpCode,
  Query,
  Param,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { AuditLogService } from './audit-log.service';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './guards/roles.decorator';
import { AdminLoginDto, ChangePasswordDto } from './dto/admin-login.dto';
import {
  PaymentSearchQuery,
  MemberSearchQuery,
  AdminActionRequest,
} from './dto/admin-search.dto';
import { ReferralService } from '../referrals/referral.service';
import { CaptchaGuard } from '../captcha/captcha.guard';

@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  constructor(
    private adminService: AdminService,
    private auditLogService: AuditLogService,
    private referralService: ReferralService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @UseGuards(CaptchaGuard)
  @ApiOperation({ summary: 'Admin login' })
  @ApiBody({ type: AdminLoginDto })
  async login(@Body() dto: AdminLoginDto) {
    return this.adminService.login(dto.username, dto.password);
  }

  @Get('profile')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get admin profile' })
  async getProfile(@Request() req) {
    return this.adminService.getProfile(req.admin.id);
  }

  @Post('change-password')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change admin password' })
  @ApiBody({ type: ChangePasswordDto })
  async changePassword(@Request() req, @Body() dto: ChangePasswordDto) {
    return this.adminService.changePassword(
      req.admin.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  // Member Management Endpoints

  @Get('members/search')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Search members' })
  async searchMembers(@Query() query: MemberSearchQuery) {
    return this.adminService.searchMembers(query);
  }

  @Get('subscriptions')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all subscriptions with renewal/expiry data' })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['daysToExpiry', 'tier', 'startDate', 'renewalDate'],
  })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({
    name: 'tier',
    required: false,
    enum: ['ALL', 'BRONZE', 'SILVER', 'GOLD'],
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'inactive', 'all'],
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async listSubscriptions(
    @Query('sortBy')
    sortBy?: 'daysToExpiry' | 'tier' | 'startDate' | 'renewalDate',
    @Query('order') order?: 'asc' | 'desc',
    @Query('tier') tier?: string,
    @Query('status') status?: 'active' | 'inactive' | 'all',
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.adminService.listSubscriptions({
      sortBy,
      order,
      tier,
      status,
      limit,
      offset,
    });
  }

  @Get('members/:memberId')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get member detail' })
  async getMemberDetail(@Param('memberId') memberId: string) {
    return this.adminService.getMemberDetail(memberId);
  }

  // Admin Actions

  @Post('actions/suspend-member')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Suspend a member (SUPER_ADMIN only)' })
  @ApiBody({ type: AdminActionRequest })
  async suspendMember(@Request() req, @Body() dto: AdminActionRequest) {
    return this.adminService.suspendMember(
      dto.targetId,
      dto.reason,
      req.admin.id,
    );
  }

  @Post('actions/deactivate-subscription')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deactivate a subscription' })
  @ApiBody({ type: AdminActionRequest })
  async deactivateSubscription(
    @Request() req,
    @Body() dto: AdminActionRequest,
  ) {
    return this.adminService.deactivateSubscription(
      dto.targetId,
      dto.reason,
      req.admin.id,
    );
  }

  @Post('actions/verify-payment')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Manually verify a payment' })
  @ApiBody({ type: AdminActionRequest })
  async verifyPaymentManually(@Request() req, @Body() dto: AdminActionRequest) {
    return this.adminService.verifyPaymentManually(
      dto.targetId,
      dto.reason,
      req.admin.id,
    );
  }

  // Payment Reconciliation

  @Post('reconciliation/payments')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reconcile payments with SasaPay (SUPER_ADMIN only)',
  })
  async reconcilePayments(@Body() body: { from: string; to: string }) {
    return this.adminService.reconcilePayments({
      from: new Date(body.from),
      to: new Date(body.to),
    });
  }

  @Post('reconciliation/sync/:paymentId')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Sync payment status with SasaPay (SUPER_ADMIN only)',
  })
  async syncPaymentStatus(
    @Request() req,
    @Param('paymentId') paymentId: string,
  ) {
    return this.adminService.syncPaymentStatus(paymentId, req.admin.id);
  }

  // Audit Logs

  @Get('audit-logs')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get recent audit logs' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getAuditLogs(@Query('limit') limit?: number) {
    return this.auditLogService.getRecentLogs(limit || 50);
  }

  // ── Referral / Champion Admin Endpoints ─────────────────────────────────────

  @Get('members/:memberId/referrals')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get referral summary for a member' })
  async getMemberReferrals(@Param('memberId') memberId: string) {
    const [stats, referrals] = await Promise.all([
      this.referralService.getChampionStats(memberId).catch(() => null),
      this.referralService.getChampionReferrals(memberId, 1, 100),
    ]);
    return { stats, referrals };
  }

  @Get('withdrawals')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List withdrawal records (filterable by status)' })
  @ApiQuery({ name: 'status', required: false, type: String })
  async listWithdrawals(@Query('status') status?: string) {
    return this.adminService.listWithdrawals(status);
  }
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve a first-payout withdrawal' })
  async approveWithdrawal(
    @Request() req,
    @Param('withdrawalId') withdrawalId: string,
  ) {
    await this.referralService.approveWithdrawal(withdrawalId, req.admin.id);
    return { message: 'Withdrawal approved and disbursement initiated' };
  }

  @Post('withdrawals/:withdrawalId/reject')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject a first-payout withdrawal' })
  async rejectWithdrawal(
    @Request() req,
    @Param('withdrawalId') withdrawalId: string,
    @Body() body: { reason: string },
  ) {
    await this.referralService.rejectWithdrawal(
      withdrawalId,
      req.admin.id,
      body.reason,
    );
    return { message: 'Withdrawal rejected' };
  }
}
