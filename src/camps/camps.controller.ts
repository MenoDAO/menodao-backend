import { Controller, Get, Post, Delete, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CampsService } from './camps.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Camps')
@Controller('camps')
export class CampsController {
  constructor(private campsService: CampsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all upcoming dental camps' })
  async getUpcoming() {
    return this.campsService.getUpcomingCamps();
  }

  @Get('nearby')
  @ApiOperation({ summary: 'Find camps near a location' })
  @ApiQuery({ name: 'lat', required: true, type: Number })
  @ApiQuery({ name: 'lng', required: true, type: Number })
  @ApiQuery({ name: 'radius', required: false, type: Number, description: 'Radius in km (default: 50)' })
  async findNearby(
    @Query('lat') lat: number,
    @Query('lng') lng: number,
    @Query('radius') radius = 50,
  ) {
    return this.campsService.findNearby(+lat, +lng, +radius);
  }

  @Get('my-registrations')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get my camp registrations' })
  async getMyRegistrations(@Request() req) {
    return this.campsService.getMemberRegistrations(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get camp details' })
  async getCamp(@Param('id') id: string) {
    return this.campsService.getCamp(id);
  }

  @Post(':id/register')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register for a camp' })
  async register(@Request() req, @Param('id') campId: string) {
    return this.campsService.registerForCamp(req.user.id, campId);
  }

  @Delete(':id/register')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel camp registration' })
  async cancelRegistration(@Request() req, @Param('id') campId: string) {
    return this.campsService.cancelRegistration(req.user.id, campId);
  }
}
