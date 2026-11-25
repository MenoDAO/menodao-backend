import {
  BadRequestException,
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
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  BrandContextService,
  BRAND_CONTEXT_KINDS,
} from '../bot/context/brand-context.service';
import { ContextFileService } from '../bot/context/context-file.service';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './guards/roles.decorator';
import { AuditLogService } from './audit-log.service';
import { CapabilityGuard } from './guards/capabilities.guard';
import { Capability } from './guards/capabilities';
import {
  BulkDeleteBrandContextDto,
  CreateBrandContextDocumentDto,
  ImportBrandContextDto,
  PreviewBrandContextDto,
  RestoreBrandContextVersionDto,
  UpdateBrandContextDocumentDto,
  UploadBrandContextFileDto,
} from './dto/brand-context.dto';
import type { Request as ExpressRequest } from 'express';

interface AdminRequest extends ExpressRequest {
  admin: { id: string; username: string; role: string };
}

/**
 * Shape of a multer memory-storage upload. `@types/multer` is not installed in
 * this project, so the file type is declared locally (as the Foundation upload
 * endpoint already does) rather than reaching for `Express.Multer.File`.
 */
type UploadedContextFile = {
  buffer: Buffer;
  originalname?: string;
  mimetype?: string;
  size?: number;
};

/**
 * Cap on a single upload. Multer buffers the whole file in memory, so this is
 * as much as one request may hold at once. Large bundles should be zipped —
 * the zip itself then stays well inside this limit while expanding to far
 * more content.
 */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Admin dashboard endpoints for the brand guide "bibles" — the documents the
 * bot grounds its answers in (brand voice, matters of ethics, operating
 * principles, policies).
 *
 * Reads are open to every admin; writes are SUPER_ADMIN only, because a
 * changed bible silently changes what the assistant tells patients.
 */
@ApiTags('Admin Bot Context')
@Controller('admin/brand-context')
@UseGuards(AdminAuthGuard, RolesGuard, CapabilityGuard)
@Capability('brand_context.read')
@ApiBearerAuth()
export class AdminBrandContextController {
  constructor(
    private readonly contextService: BrandContextService,
    private readonly fileService: ContextFileService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get('documents')
  @ApiOperation({ summary: 'List context documents (admin)' })
  @ApiQuery({ name: 'kind', required: false })
  @ApiQuery({ name: 'source', required: false })
  @ApiQuery({ name: 'active', required: false })
  @ApiQuery({ name: 'search', required: false })
  async listDocuments(
    @Query('kind') kind?: string,
    @Query('source') source?: string,
    @Query('active') active?: string,
    @Query('search') search?: string,
  ) {
    return this.contextService.listForAdmin({
      kind,
      source,
      active: active === undefined ? undefined : active === 'true',
      search,
    });
  }

  @Get('documents/:id')
  @ApiOperation({ summary: 'Get one context document' })
  async getDocument(@Param('id') id: string) {
    return this.contextService.findById(id);
  }

  @Post('documents')
  @HttpCode(HttpStatus.CREATED)
  @Roles('SUPER_ADMIN')
  @Capability('brand_context.write')
  @ApiOperation({ summary: 'Create a context document' })
  async createDocument(
    @Body() dto: CreateBrandContextDocumentDto,
    @Request() req: AdminRequest,
  ) {
    const created = await this.contextService.create({
      kind: dto.kind,
      title: dto.title,
      content: dto.content,
      active: dto.active,
      source: dto.source,
      externalId: dto.externalId,
      externalUrl: dto.externalUrl,
      actorAdminId: req.admin.id,
    });
    await this.audit(req, 'CREATE_BRAND_CONTEXT_DOCUMENT', created.id, {
      kind: created.kind,
      title: created.title,
    });
    return created;
  }

  /**
   * Uploads one file and turns it into retrievable sections.
   *
   * One file per request on purpose: the dashboard sends a queue of files one
   * after another, so each gets its own progress, its own error message and
   * its own audit entry instead of one opaque bulk call. A zip is the way to
   * send many documents at once — it arrives as a single request and expands
   * server-side into one document per entry.
   */
  @Post('files')
  @HttpCode(HttpStatus.CREATED)
  @Roles('SUPER_ADMIN')
  @Capability('brand_context.write')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Upload a context file (pdf, docx, markdown, txt, html or zip) and ' +
      'import it as retrievable sections. Raw bytes are kept in S3; the ' +
      'extracted text is stored beside them.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        kind: { type: 'string', enum: [...BRAND_CONTEXT_KINDS] },
        title: { type: 'string' },
        active: { type: 'string', enum: ['true', 'false'] },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async uploadFile(
    @UploadedFile() file: UploadedContextFile | undefined,
    @Body() dto: UploadBrandContextFileDto,
    @Request() req: AdminRequest,
  ) {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('Choose a file to upload.');
    }

    const result = await this.fileService.ingest({
      filename: file.originalname || 'upload',
      contentType: file.mimetype || 'application/octet-stream',
      buffer: file.buffer,
      kind: dto.kind,
      title: dto.title,
      active: dto.active,
      actorAdminId: req.admin.id,
    });

    await this.audit(req, 'UPLOAD_BRAND_CONTEXT_FILE', result.fileId, {
      filename: result.filename,
      sections: result.sections,
      created: result.created,
      updated: result.updated,
      deactivated: result.deactivated,
      skipped: result.skipped.length,
      duplicate: result.duplicate,
    });
    return result;
  }

  @Patch('documents/:id')
  @Roles('SUPER_ADMIN')
  @Capability('brand_context.write')
  @ApiOperation({ summary: 'Update a context document' })
  async updateDocument(
    @Param('id') id: string,
    @Body() dto: UpdateBrandContextDocumentDto,
    @Request() req: AdminRequest,
  ) {
    const updated = await this.contextService.update(id, {
      kind: dto.kind,
      title: dto.title,
      content: dto.content,
      active: dto.active,
      source: dto.source,
      externalId: dto.externalId,
      externalUrl: dto.externalUrl,
      lastSyncedAt: dto.lastSyncedAt,
      actorAdminId: req.admin.id,
    });
    await this.audit(req, 'UPDATE_BRAND_CONTEXT_DOCUMENT', updated.id, {
      kind: updated.kind,
      version: updated.version,
    });
    return updated;
  }

  @Delete('documents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('SUPER_ADMIN')
  @Capability('brand_context.write')
  @ApiOperation({ summary: 'Delete a context document' })
  async deleteDocument(@Param('id') id: string, @Request() req: AdminRequest) {
    await this.contextService.remove(id);
    await this.audit(req, 'DELETE_BRAND_CONTEXT_DOCUMENT', id, {});
  }

  @Post('documents/bulk-delete')
  @Roles('SUPER_ADMIN')
  @Capability('brand_context.write')
  @ApiOperation({ summary: 'Bulk delete context documents' })
  async bulkDeleteDocuments(
    @Body() dto: BulkDeleteBrandContextDto,
    @Request() req: AdminRequest,
  ) {
    const result = await this.contextService.removeMany(dto.ids);
    await this.audit(req, 'BULK_DELETE_BRAND_CONTEXT_DOCUMENTS', 'bulk', {
      requested: dto.ids.length,
      deleted: result.deleted,
    });
    return result;
  }

  @Post('import')
  @HttpCode(HttpStatus.CREATED)
  @Roles('SUPER_ADMIN')
  @Capability('brand_context.write')
  @ApiOperation({
    summary:
      'Import a guide as retrievable sections (markdown headings become ' +
      'separate documents)',
  })
  async importGuide(
    @Body() dto: ImportBrandContextDto,
    @Request() req: AdminRequest,
  ) {
    const result = await this.contextService.importSections({
      kind: dto.kind,
      title: dto.title,
      content: dto.content,
      active: dto.active,
      source: dto.source,
      externalId: dto.externalId,
      externalUrl: dto.externalUrl,
      actorAdminId: req.admin.id,
    });
    await this.audit(
      req,
      'IMPORT_BRAND_CONTEXT_GUIDE',
      dto.externalId ?? 'bulk',
      {
        kind: dto.kind,
        created: result.created,
        updated: result.updated,
        deactivated: result.deactivated,
      },
    );
    return result;
  }

  @Get('documents/:id/versions')
  @ApiOperation({
    summary: 'List the immutable version history of a context document',
  })
  async listVersions(@Param('id') id: string) {
    return this.contextService.listVersions(id);
  }

  @Post('documents/:id/restore')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN')
  @Capability('brand_context.write')
  @ApiOperation({
    summary:
      'Restore a historical version as a new version (history is append-only)',
  })
  async restoreVersion(
    @Param('id') id: string,
    @Body() dto: RestoreBrandContextVersionDto,
    @Request() req: AdminRequest,
  ) {
    const restored = await this.contextService.restoreVersion(
      id,
      dto.version,
      req.admin.id,
    );
    await this.audit(req, 'RESTORE_BRAND_CONTEXT_DOCUMENT_VERSION', id, {
      restoredVersion: dto.version,
      newVersion: restored.version,
    });
    return restored;
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Preview what the bot would retrieve and inject for a given question ' +
      '(tuning aid). Omit "kind" to search every kind.',
  })
  async preview(@Body() dto: PreviewBrandContextDto) {
    return this.contextService.preview(dto.query, dto.kind, dto.topK);
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
        targetType: 'BRAND_CONTEXT' as never,
        targetId,
        reason: 'Bot context document change',
        metadata,
        ipAddress: req.ip ?? 'unknown',
      });
    } catch {
      // Auditing must never block the write that already succeeded.
    }
  }
}
