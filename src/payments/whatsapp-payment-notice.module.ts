import { Module } from '@nestjs/common';
import { WhatsappClientsModule } from '../bot/whatsapp-clients/whatsapp-clients.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsappPaymentNoticeService } from './whatsapp-payment-notice.service';

@Module({
  imports: [PrismaModule, WhatsappClientsModule],
  providers: [WhatsappPaymentNoticeService],
  exports: [WhatsappPaymentNoticeService],
})
export class WhatsappPaymentNoticeModule {}
