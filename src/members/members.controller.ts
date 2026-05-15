import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { MembersService } from './members.service';
import { UpdateMemberDto } from './dto/update-member.dto';
import { CreateDependantDto } from './dto/create-dependant.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtCaptchaGuard } from '../captcha/guards/jwt-captcha.guard';

@ApiTags('Members')
@Controller('members')
@UseGuards(JwtAuthGuard, JwtCaptchaGuard)
@ApiBearerAuth()
export class MembersController {
  constructor(private membersService: MembersService) {}

  @Get('profile')
  @ApiOperation({
    summary: 'Get current member profile with subscription and history',
  })
  async getProfile(@Request() req) {
    return this.membersService.findById(req.user.id);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update member profile' })
  async updateProfile(@Request() req, @Body() dto: UpdateMemberDto) {
    return this.membersService.update(req.user.id, dto);
  }

  @Get('contributions')
  @ApiOperation({ summary: 'Get contribution/payment history' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getContributions(
    @Request() req,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.membersService.getContributionHistory(
      req.user.id,
      +page,
      +limit,
    );
  }

  @Get('claims')
  @ApiOperation({ summary: 'Get claims/treatment history' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getClaims(
    @Request() req,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.membersService.getClaimHistory(req.user.id, +page, +limit);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get blockchain transaction history' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getTransactions(
    @Request() req,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.membersService.getTransactionHistory(
      req.user.id,
      +page,
      +limit,
    );
  }

  @Get('history')
  @ApiOperation({ summary: 'Get member treatment history' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getHistory(
    @Request() req,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.membersService.getMemberHistory(req.user.id, +page, +limit);
  }

  @Post('dependants')
  @ApiOperation({ summary: 'Add a dependant to the member subscription' })
  async addDependant(@Request() req, @Body() dto: CreateDependantDto) {
    return this.membersService.addDependant(req.user.id, dto);
  }

  @Get('dependants')
  @ApiOperation({ summary: 'Get dependants for the authenticated member' })
  async getDependants(@Request() req) {
    return this.membersService.getDependants(req.user.id);
  }
}
