import { Module } from '@nestjs/common';
import { EmailService } from '../appointments/email.service';
import { FoundationAdminController } from './foundation-admin.controller';
import { FoundationInquiriesService } from './foundation-inquiries.service';
import { FoundationPublicController } from './foundation-public.controller';
import { FoundationSiteService } from './foundation-site.service';

@Module({
  controllers: [FoundationAdminController, FoundationPublicController],
  providers: [FoundationSiteService, FoundationInquiriesService, EmailService],
})
export class FoundationSiteModule {}
