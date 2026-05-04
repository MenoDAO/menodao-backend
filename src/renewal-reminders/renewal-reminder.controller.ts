import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin/guards/admin-auth.guard';
import { RenewalReminderService } from './renewal-reminder.service';
import { TriggerMemberDto } from './dto/trigger-member.dto';
import { TriggerBulkDto } from './dto/trigger-bulk.dto';

@Controller('admin/reminders')
@UseGuards(AdminAuthGuard)
export class RenewalReminderController {
  constructor(
    private readonly renewalReminderService: RenewalReminderService,
  ) {}

  @Post('trigger-member')
  async triggerMember(@Body() dto: TriggerMemberDto) {
    return this.renewalReminderService.triggerMemberReminder(dto.memberId);
  }

  @Post('trigger-bulk')
  async triggerBulk(@Body() dto: TriggerBulkDto) {
    return this.renewalReminderService.triggerBulkReminder(dto.daysUntilExpiry);
  }
}
