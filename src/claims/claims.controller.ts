import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { ClaimsService } from './claims.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtCaptchaGuard } from '../captcha/guards/jwt-captcha.guard';
import { StaffAuthGuard } from '../staff/guards/staff-auth.guard';
import { StaffJwtCaptchaGuard } from '../captcha/guards/staff-jwt-captcha.guard';
import { CreateClaimDto } from './dto/create-claim.dto';
import { ClaimStatus } from '@prisma/client';

@ApiTags('Claims')
@Controller('claims')
export class ClaimsController {
  private readonly logger = new Logger(ClaimsController.name);

  constructor(private claimsService: ClaimsService) {}

  @Get()
  @UseGuards(JwtAuthGuard, JwtCaptchaGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all claims for current member' })
  async getMyClaims(@Request() req) {
    return this.claimsService.getMemberClaims(req.user.id);
  }

  @Get('staff')
  @UseGuards(StaffAuthGuard, StaffJwtCaptchaGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all claims for staff management' })
  @ApiQuery({ name: 'status', enum: ClaimStatus, required: false })
  @ApiQuery({ name: 'memberId', required: false })
  async getStaffClaims(
    @Query('status') status?: ClaimStatus,
    @Query('memberId') memberId?: string,
  ) {
    return await this.claimsService.getAllClaims({ status, memberId });
  }

  @Get(':id')
  @UseGuards(StaffAuthGuard, StaffJwtCaptchaGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get claim details' })
  async getClaim(@Param('id') id: string) {
    return await this.claimsService.getClaimById(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, JwtCaptchaGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit a new claim' })
  async createClaim(@Request() req: any, @Body() dto: CreateClaimDto) {
    return await this.claimsService.createClaim(
      req.user.id,
      dto.claimType,
      dto.description,
      dto.amount,
      dto.campId,
    );
  }

  @Post(':id/approve')
  @UseGuards(StaffAuthGuard, StaffJwtCaptchaGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Approve a pending claim and trigger disbursal',
  })
  async approveClaim(@Param('id') id: string) {
    return await this.claimsService.approveClaim(id);
  }

  @Post(':id/reject')
  @UseGuards(StaffAuthGuard, StaffJwtCaptchaGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject a pending claim with a reason' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          example: 'Insufficient documentation provided',
        },
      },
      required: ['reason'],
    },
  })
  async rejectClaim(@Param('id') id: string, @Body() body: { reason: string }) {
    return await this.claimsService.rejectClaim(id, body.reason);
  }
}
