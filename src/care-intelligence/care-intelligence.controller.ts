import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../admin/guards/admin-auth.guard';
import { CareIntelligenceService } from './care-intelligence.service';

@ApiTags('Admin - Care Intelligence')
@Controller('admin/care-intelligence')
@UseGuards(AdminAuthGuard)
@ApiBearerAuth()
export class CareIntelligenceController {
  constructor(private readonly careIntelligence: CareIntelligenceService) {}

  @Get()
  @ApiOperation({ summary: 'Care Intelligence dashboard metrics' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'county', required: false })
  @ApiQuery({ name: 'subCounty', required: false })
  getDashboard(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('county') county?: string,
    @Query('subCounty') subCounty?: string,
  ) {
    return this.careIntelligence.getDashboard({ from, to, county, subCounty });
  }

  @Get('data-room')
  @ApiOperation({
    summary: 'Aggregated impact metrics for donor/investor view (no PII)',
  })
  getDataRoom(@Query('from') from?: string, @Query('to') to?: string) {
    return this.careIntelligence.getDataRoom({ from, to });
  }

  @Get('definitions')
  @ApiOperation({ summary: 'Canonical metric and care-loop definitions' })
  getDefinitions() {
    return this.careIntelligence.getDefinitions();
  }

  @Get('targets')
  @ApiOperation({ summary: 'Configurable care-loop targets' })
  getTargets() {
    return this.careIntelligence.getTargets();
  }

  @Put('targets/:metricId')
  @ApiOperation({ summary: 'Update a care-loop target threshold' })
  upsertTarget(
    @Param('metricId') metricId: string,
    @Body()
    body: {
      targetValue: number;
      minSampleSize?: number;
      impactWeight?: number;
      controllability?: number;
      notes?: string;
    },
    @Request() req: { admin?: { username?: string } },
  ) {
    return this.careIntelligence.upsertTarget(metricId, body, req.admin?.username);
  }

  @Get('experiments')
  @ApiOperation({ summary: 'List care-loop experiments' })
  listExperiments() {
    return this.careIntelligence.listExperiments();
  }

  @Post('experiments')
  @ApiOperation({ summary: 'Create an experiment' })
  createExperiment(
    @Body()
    body: {
      name: string;
      hypothesis: string;
      metricId: string;
      baseline?: number;
      target?: number;
      startDate: string;
      endDate?: string;
      owner?: string;
    },
  ) {
    return this.careIntelligence.createExperiment(body);
  }

  @Patch('experiments/:id')
  @ApiOperation({ summary: 'Update experiment status, result, or decision' })
  updateExperiment(
    @Param('id') id: string,
    @Body()
    body: {
      status?: 'DRAFT' | 'RUNNING' | 'COMPLETED' | 'KILLED' | 'KEPT' | 'MODIFIED';
      result?: string;
      decision?: string;
      endDate?: string;
    },
  ) {
    return this.careIntelligence.updateExperiment(id, body);
  }

  @Get('insights')
  @ApiOperation({ summary: 'Stored observed/interpreted insights (no fabricated metrics)' })
  listInsights() {
    return this.careIntelligence.listInsights();
  }

  @Get('cohorts/:key')
  @ApiOperation({
    summary: 'Non-clinical member cohort for an action-center recommendation',
  })
  getCohort(@Param('key') key: string) {
    return this.careIntelligence.getCohort(key);
  }
}
