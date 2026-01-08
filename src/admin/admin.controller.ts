import { Controller, Post, Get, Body, UseGuards, Request, HttpCode, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody, ApiQuery } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { AdminLoginDto, ChangePasswordDto } from './dto/admin-login.dto';

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

  @Post('nuke-database')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'DANGER: Delete all data from database (one-time cleanup)' })
  @ApiQuery({ name: 'confirm', required: true, description: 'Confirmation code: CONFIRM_NUKE_ALL_DATA_2026' })
  async nukeDatabase(@Query('confirm') confirmationCode: string) {
    return this.adminService.nukeDatabaseData(confirmationCode);
  }
}
