import { Module } from '@nestjs/common';
import { EmailService } from '../appointments/email.service';
import { VoucherModule } from '../voucher/voucher.module';
import { FoundationAdminController } from './foundation-admin.controller';
import { FoundationInquiriesService } from './foundation-inquiries.service';
import { FoundationPublicController } from './foundation-public.controller';
import { FoundationSiteService } from './foundation-site.service';
import { FoundationVoucherController } from './foundation-voucher.controller';

@Module({
  imports: [VoucherModule],
  controllers: [
    FoundationAdminController,
    FoundationPublicController,
    FoundationVoucherController,
  ],
  providers: [FoundationSiteService, FoundationInquiriesService, EmailService],
})
export class FoundationSiteModule {}
