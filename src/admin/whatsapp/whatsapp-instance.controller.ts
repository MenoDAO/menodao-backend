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
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../guards/roles.decorator';
import { AuditLogService } from '../audit-log.service';
import { AdminWhatsappService } from './whatsapp-instance.service';
import {
  CreateWhatsappInstanceDto,
  PairingCodeDto,
  RelinkWhatsappInstanceDto,
  SetInstanceKeyDto,
  UpdateWhatsappInstanceDto,
} from './dto/whatsapp.dto';
import type { Request as ExpressRequest } from 'express';

interface AdminRequest extends ExpressRequest {
  admin: { id: string; username: string; role: string };
}

/**
 * Remote control of the bot's WhatsApp instances.
 *
 * Reads are open to every admin (support needs to see why the bot is quiet);
 * anything that changes which number the bot speaks from is SUPER_ADMIN only.
 */
@ApiTags('Admin WhatsApp')
@Controller('admin/whatsapp')
@UseGuards(AdminAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AdminWhatsappController {
  constructor(
    private readonly whatsappService: AdminWhatsappService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get('instances')
  @ApiOperation({
    summary:
      'List instances with live plan limits and the webhook URL to paste into FlareSend',
  })
  async list() {
    return this.whatsappService.overview();
  }

  @Post('instances/sync')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Import instances from FlareSend into the local table',
  })
  async sync(@Request() req: AdminRequest) {
    const result = await this.whatsappService.sync();
    await this.audit(req, 'SYNC_WHATSAPP_INSTANCES', 'all', {
      count: result.instances.length,
    });
    return result;
  }

  @Get('instances/:id')
  @ApiOperation({ summary: 'Instance detail with live provider status' })
  async detail(@Param('id') id: string) {
    return this.whatsappService.detail(id);
  }

  @Post('instances')
  @HttpCode(HttpStatus.CREATED)
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary:
      'Create an instance on FlareSend (refused when the plan has no free slot)',
  })
  async create(
    @Body() dto: CreateWhatsappInstanceDto,
    @Request() req: AdminRequest,
  ) {
    const instance = await this.whatsappService.create(dto);
    await this.audit(req, 'CREATE_WHATSAPP_INSTANCE', instance.id, {
      providerId: instance.providerId,
      label: instance.label,
    });
    return instance;
  }

  @Patch('instances/:id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Update the local label / recorded webhook URL' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateWhatsappInstanceDto,
    @Request() req: AdminRequest,
  ) {
    let instance = await this.whatsappService.detail(id);
    if (dto.label !== undefined) {
      instance = await this.whatsappService.setLabel(id, dto.label);
    }
    if (dto.webhookUrl !== undefined) {
      instance = await this.whatsappService.setWebhookUrl(id, dto.webhookUrl);
    }
    await this.audit(req, 'UPDATE_WHATSAPP_INSTANCE', id, { ...dto });
    return instance;
  }

  @Patch('instances/:id/key')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary:
      'Store the instance-scoped key (encrypted at rest) so this instance can send',
  })
  async storeKey(
    @Param('id') id: string,
    @Body() dto: SetInstanceKeyDto,
    @Request() req: AdminRequest,
  ) {
    const instance = await this.whatsappService.storeKey(id, dto.apiKey);
    await this.audit(req, 'STORE_WHATSAPP_INSTANCE_KEY', id, {
      keyFingerprint: instance.keyFingerprint,
    });
    return instance;
  }

  @Post('instances/:id/activate')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Make this instance the one the bot sends from' })
  async activate(@Param('id') id: string, @Request() req: AdminRequest) {
    const instance = await this.whatsappService.activate(id);
    await this.audit(req, 'ACTIVATE_WHATSAPP_INSTANCE', id, {
      providerId: instance.providerId,
    });
    return instance;
  }

  @Post('instances/:id/reconnect')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Ask FlareSend to reconnect the WhatsApp session' })
  async reconnect(@Param('id') id: string, @Request() req: AdminRequest) {
    const instance = await this.whatsappService.reconnect(id);
    await this.audit(req, 'RECONNECT_WHATSAPP_INSTANCE', id, {});
    return instance;
  }

  @Post('instances/:id/relink')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary:
      'Move this instance to another phone number: reset the session, reconnect, ' +
      'and issue a pairing code for the new number',
  })
  async relink(
    @Param('id') id: string,
    @Body() dto: RelinkWhatsappInstanceDto,
    @Request() req: AdminRequest,
  ) {
    const result = await this.whatsappService.relink(id, dto.phoneNumber);
    await this.audit(req, 'RELINK_WHATSAPP_INSTANCE', id, {
      phoneNumber: result.phoneNumber,
    });
    return result;
  }

  @Post('instances/:id/pairing-code')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary:
      'Issue a pairing code (type it on the phone instead of scanning a QR)',
  })
  async pairingCode(@Param('id') id: string, @Body() dto: PairingCodeDto) {
    return this.whatsappService.pairingCode(id, dto.phoneNumber);
  }

  @Get('instances/:id/qr')
  @ApiOperation({
    summary: 'Raw QR payload for the instance (render it with any QR encoder)',
  })
  async qr(@Param('id') id: string) {
    return this.whatsappService.qr(id);
  }

  @Delete('instances/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete the instance on FlareSend and locally' })
  async remove(@Param('id') id: string, @Request() req: AdminRequest) {
    await this.whatsappService.remove(id);
    await this.audit(req, 'DELETE_WHATSAPP_INSTANCE', id, {});
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
        targetType: 'WHATSAPP_INSTANCE',
        targetId,
        reason: 'WhatsApp instance change',
        metadata,
        ipAddress: req.ip ?? 'unknown',
      });
    } catch {
      // Auditing must never block a change that already happened.
    }
  }
}
