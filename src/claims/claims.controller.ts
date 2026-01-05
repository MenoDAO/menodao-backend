import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ClaimsService } from './claims.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateClaimDto } from './dto/create-claim.dto';

@ApiTags('Claims')
@Controller('claims')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ClaimsController {
  constructor(private claimsService: ClaimsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all claims for current member' })
  async getMyClaims(@Request() req) {
    return this.claimsService.getMemberClaims(req.user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Submit a new claim' })
  async createClaim(@Request() req, @Body() dto: CreateClaimDto) {
    return this.claimsService.createClaim(
      req.user.id,
      dto.claimType,
      dto.description,
      dto.amount,
      dto.campId,
    );
  }
}
