import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../guards/roles.decorator';
import { AuditLogService } from '../audit-log.service';
import { BotChatService } from '../../bot/chat/bot-chat.service';
import type { Request as ExpressRequest } from 'express';

interface AdminRequest extends ExpressRequest {
  admin: { id: string; username: string; role: string };
}

/**
 * Conversation archive for the WhatsApp bot.
 *
 * Reads let support pick up a conversation where the member left off. The
 * data-protection operations (erasure, export, purge) are SUPER_ADMIN only and
 * every one of them is audit-logged, because "we deleted it" has to be provable.
 */
@ApiTags('Admin Bot Conversations')
@Controller('admin/bot-chat')
@UseGuards(AdminAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AdminBotChatController {
  constructor(
    private readonly chatService: BotChatService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get('threads')
  @ApiOperation({ summary: 'List conversations, newest first' })
  @ApiQuery({ name: 'instanceId', required: false })
  @ApiQuery({ name: 'memberId', required: false })
  @ApiQuery({ name: 'contactId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async listThreads(
    @Query('instanceId') instanceId?: string,
    @Query('memberId') memberId?: string,
    @Query('contactId') contactId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.chatService.listThreads({
      instanceId,
      memberId,
      contactId,
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('threads/:id')
  @ApiOperation({ summary: 'One conversation' })
  async getThread(@Param('id') id: string) {
    return this.chatService.getThread(id);
  }

  @Get('threads/:id/messages')
  @ApiOperation({ summary: 'Messages in a conversation, oldest first' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'before', required: false, description: 'ISO timestamp' })
  async listMessages(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.chatService.listMessages(id, {
      limit: limit ? Number(limit) : undefined,
      before: before ? new Date(before) : undefined,
    });
  }

  @Get('retention')
  @ApiOperation({ summary: 'The retention policy in force' })
  async retention() {
    return this.chatService.retentionPolicy();
  }

  @Post('purge')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Run the retention purge now' })
  async purge(@Request() req: AdminRequest) {
    const result = await this.chatService.purgeExpired();
    await this.audit(req, 'PURGE_BOT_CHAT', 'retention', result);
    return result;
  }

  @Post('members/:memberId/erase')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary:
      'Right to erasure: delete this member’s conversations, messages and AI logs',
  })
  async eraseMember(
    @Param('memberId') memberId: string,
    @Request() req: AdminRequest,
  ) {
    const result = await this.chatService.eraseMember(memberId);
    await this.audit(req, 'ERASE_BOT_CHAT_MEMBER', memberId, result);
    return result;
  }

  @Get('members/:memberId/export')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Right to access: everything we hold for this member, as JSON',
  })
  async exportMember(
    @Param('memberId') memberId: string,
    @Request() req: AdminRequest,
  ) {
    const result = await this.chatService.exportMember(memberId);
    await this.audit(req, 'EXPORT_BOT_CHAT_MEMBER', memberId, {
      threads: result.threads.length,
    });
    return result;
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
        targetType: 'BOT_CHAT',
        targetId,
        reason: 'Bot conversation data-protection operation',
        metadata,
        ipAddress: req.ip ?? 'unknown',
      });
    } catch {
      // Auditing must never block the operation that already happened.
    }
  }
}
