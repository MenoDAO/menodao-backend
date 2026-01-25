import { Controller, Post, Get, Body, UseGuards, Request, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { StaffService } from './staff.service';
import { StaffAuthGuard } from './guards/staff-auth.guard';
import { StaffLoginDto, ChangePasswordDto } from './dto/staff-login.dto';

@ApiTags('Staff')
@Controller('staff')
export class StaffController {
  constructor(private staffService: StaffService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Staff login' })
  @ApiBody({ type: StaffLoginDto })
  async login(@Body() dto: StaffLoginDto) {
    return this.staffService.login(dto.username, dto.password);
  }

  @Get('profile')
  @UseGuards(StaffAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get staff profile' })
  async getProfile(@Request() req) {
    return this.staffService.getProfile(req.staff.id);
  }

  @Post('change-password')
  @UseGuards(StaffAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change staff password' })
  @ApiBody({ type: ChangePasswordDto })
  async changePassword(@Request() req, @Body() dto: ChangePasswordDto) {
    return this.staffService.changePassword(
      req.staff.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
