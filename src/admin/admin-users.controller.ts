import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { AuditLogService } from './audit-log.service';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './guards/roles.decorator';
import { CapabilityGuard } from './guards/capabilities.guard';
import { Capability } from './guards/capabilities';
import { CreateAdminDto, UpdateAdminDto } from './dto/admin-user.dto';
import type { Request as ExpressRequest } from 'express';

interface AdminRequest extends ExpressRequest {
  admin: { id: string; username: string; role: string };
}

/**
 * Dashboard-driven admin account lifecycle. Creating, re-roling and
 * deactivating admins is restricted to super admins in both the role guard and
 * the capability guard, and every action is audited.
 */
@ApiTags('Admin Users')
@Controller('admin/admins')
@UseGuards(AdminAuthGuard, RolesGuard, CapabilityGuard)
@Roles('SUPER_ADMIN')
@Capability('admins.manage')
@ApiBearerAuth()
export class AdminUsersController {
  constructor(
    private readonly adminService: AdminService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List admin accounts (no credentials returned)' })
  async list() {
    return this.adminService.listAdmins();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an admin account and return a one-time invite token',
  })
  async create(@Body() dto: CreateAdminDto, @Request() req: AdminRequest) {
    const result = await this.adminService.createAdmin(dto);
    await this.audit(req, 'CREATE_ADMIN_USER', result.admin.id, {
      username: result.admin.username,
      role: result.admin.role,
      expiresAt: result.expiresAt,
    });
    return result;
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Change an admin role, phone number or active state',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAdminDto,
    @Request() req: AdminRequest,
  ) {
    const updated = await this.adminService.updateAdmin(id, dto, req.admin.id);
    await this.audit(req, 'UPDATE_ADMIN_USER', id, {
      role: updated.role,
      isActive: updated.isActive,
    });
    return updated;
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue a new one-time password reset token' })
  async resetPassword(@Param('id') id: string, @Request() req: AdminRequest) {
    const result = await this.adminService.resetAdminPassword(id);
    await this.audit(req, 'RESET_ADMIN_PASSWORD', id, {
      expiresAt: result.expiresAt,
    });
    return result;
  }

  private async audit(
    req: AdminRequest,
    action: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ) {
    try {
      await this.auditLogService.logAction({
        adminId: req.admin.id,
        action,
        targetType: 'ADMIN_USER',
        targetId,
        reason: 'Admin account lifecycle change',
        metadata,
        ipAddress: req.ip ?? 'unknown',
      });
    } catch {
      // Auditing must never block a write that already succeeded.
    }
  }
}
