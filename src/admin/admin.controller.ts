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
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { AdminLoginDto, ChangePasswordDto } from './dto/admin-login.dto';
import {
  PaymentSearchQuery,
  MemberSearchQuery,
  AdminActionRequest,
} from './dto/admin-search.dto';

@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Post('login')
  @HttpCode(200)
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
}

  // Payment Management Endpoints

  @Get('payments/search')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Search payments' })
  async searchPayments(@Query() query: PaymentSearchQuery) {
    return this.adminService.searchPayments({
      transactionId: query.transactionId,
      phoneNumber: query.phoneNumber,
      email: query.email,
      status: query.status,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
    });
  }

  @Get('payments/:transactionId')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get payment detail' })
  async getPaymentDetail(@Param('transactionId') transactionId: string) {
    return this.adminService.getPaymentDetail(transactionId);
  }

  // Member Management Endpoints

  @Get('members/search')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Search members' })
  async searchMembers(@Query() query: MemberSearchQuery) {
    return this.adminService.searchMembers(query);
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
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Suspend a member' })
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
  async deactivateSubscription(@Request() req, @Body() dto: AdminActionRequest) {
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
}

  // Payment Reconciliation

  @Post('reconciliation/payments')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reconcile payments with SasaPay' })
  async reconcilePayments(
    @Body() body: { from: string; to: string },
  ) {
    return this.adminService.reconcilePayments({
      from: new Date(body.from),
      to: new Date(body.to),
    });
  }

  @Post('reconciliation/sync/:paymentId')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sync payment status with SasaPay' })
  async syncPaymentStatus(
    @Request() req,
    @Param('paymentId') paymentId: string,
  ) {
    return this.adminService.syncPaymentStatus(paymentId, req.admin.id);
  }
}
