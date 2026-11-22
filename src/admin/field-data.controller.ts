import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  FieldDataService,
  FieldContributorRole,
  FieldSubmissionStatus,
} from '../bot/field-data/field-data.service';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './guards/roles.decorator';
import { CapabilityGuard } from './guards/capabilities.guard';
import { Capability } from './guards/capabilities';
import { AuditLogService } from './audit-log.service';
import {
  CreateFieldContributorDto,
  ListFieldSubmissionsQuery,
  ReviewFieldSubmissionDto,
  UpdateFieldContributorDto,
} from './dto/field-data.dto';

interface AdminRequest extends Request {
  admin: { id: string; username: string; role: string };
}

@ApiTags('Admin Field Data')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, RolesGuard, CapabilityGuard)
@Capability('field_data.read')
@Controller('admin/field-data')
export class FieldDataController {
  constructor(
    private readonly fieldData: FieldDataService,
    private readonly audit: AuditLogService,
  ) {}

  @Get('contributors')
  @ApiOperation({ summary: 'List authorised field-data contributors' })
  listContributors() {
    return this.fieldData.listContributors();
  }

  @Post('contributors')
  @Roles('SUPER_ADMIN')
  @Capability('field_data.write')
  @ApiOperation({ summary: 'Authorise a doctor or health worker by WhatsApp number' })
  async createContributor(
    @Body() body: CreateFieldContributorDto,
    @Req() req: AdminRequest,
  ) {
    const created = await this.fieldData.createContributor(body);
    await this.audit.logAction({
      adminId: req.admin.id,
      action: 'CREATE_FIELD_CONTRIBUTOR',
      targetType: 'FIELD_CONTRIBUTOR',
      targetId: created.id,
      reason: `Authorised ${created.role} ${created.displayName}`,
      ipAddress: req.ip || 'unknown',
      metadata: { phoneNumber: created.phoneNumber },
    });
    return created;
  }

  @Patch('contributors/:id')
  @Roles('SUPER_ADMIN')
  @Capability('field_data.write')
  @ApiOperation({ summary: 'Update an authorised contributor' })
  async updateContributor(
    @Param('id') id: string,
    @Body() body: UpdateFieldContributorDto,
    @Req() req: AdminRequest,
  ) {
    const updated = await this.fieldData.updateContributor(id, body as {
      displayName?: string;
      role?: FieldContributorRole;
      organization?: string | null;
      isActive?: boolean;
    });
    await this.audit.logAction({
      adminId: req.admin.id,
      action: 'UPDATE_FIELD_CONTRIBUTOR',
      targetType: 'FIELD_CONTRIBUTOR',
      targetId: id,
      reason: body.isActive === false ? 'Revoked field-data access' : 'Updated contributor',
      ipAddress: req.ip || 'unknown',
    });
    return updated;
  }

  @Delete('contributors/:id')
  @Roles('SUPER_ADMIN')
  @Capability('field_data.write')
  @ApiOperation({ summary: 'Remove an authorised contributor' })
  async deleteContributor(@Param('id') id: string, @Req() req: AdminRequest) {
    const result = await this.fieldData.deleteContributor(id);
    await this.audit.logAction({
      adminId: req.admin.id,
      action: 'DELETE_FIELD_CONTRIBUTOR',
      targetType: 'FIELD_CONTRIBUTOR',
      targetId: id,
      reason: 'Removed field-data access',
      ipAddress: req.ip || 'unknown',
    });
    return result;
  }

  @Get('submissions')
  @ApiOperation({ summary: 'List field-data submissions for review' })
  listSubmissions(@Query() query: ListFieldSubmissionsQuery) {
    return this.fieldData.listSubmissions({
      status: query.status as FieldSubmissionStatus | undefined,
      contributorId: query.contributorId,
      limit: query.limit,
    });
  }

  @Get('submissions/:id')
  @ApiOperation({ summary: 'Get one field-data submission' })
  getSubmission(@Param('id') id: string) {
    return this.fieldData.getSubmission(id);
  }

  @Get('media/:id')
  @ApiOperation({ summary: 'Stream a stored field-data media file (admin only)' })
  async getMedia(@Param('id') id: string): Promise<StreamableFile> {
    const media = await this.fieldData.getMedia(id);
    return new StreamableFile(media.body, {
      type: media.contentType,
      disposition: 'inline',
    });
  }

  @Post('submissions/:id/review')
  @Capability('field_data.write')
  @ApiOperation({ summary: 'Approve, reject, or return a submission to review' })
  async reviewSubmission(
    @Param('id') id: string,
    @Body() body: ReviewFieldSubmissionDto,
    @Req() req: AdminRequest,
  ) {
    const updated = await this.fieldData.reviewSubmission(id, {
      status: body.status,
      reviewNotes: body.reviewNotes,
      extracted: body.extracted as never,
      reviewerAdminId: req.admin.id,
    });
    await this.audit.logAction({
      adminId: req.admin.id,
      action: `REVIEW_FIELD_SUBMISSION_${body.status}`,
      targetType: 'FIELD_SUBMISSION',
      targetId: id,
      reason: body.reviewNotes?.trim() || `Marked as ${body.status}`,
      ipAddress: req.ip || 'unknown',
    });
    return updated;
  }

  @Post('submissions/:id/reparse')
  @HttpCode(HttpStatus.OK)
  @Capability('field_data.write')
  @ApiOperation({ summary: 'Re-run vision extraction on an image submission' })
  async reparseSubmission(@Param('id') id: string, @Req() req: AdminRequest) {
    const updated = await this.fieldData.reparseSubmission(id);
    await this.audit.logAction({
      adminId: req.admin.id,
      action: 'REPARSE_FIELD_SUBMISSION',
      targetType: 'FIELD_SUBMISSION',
      targetId: id,
      reason: 'Re-ran model extraction',
      ipAddress: req.ip || 'unknown',
    });
    return updated;
  }
}
