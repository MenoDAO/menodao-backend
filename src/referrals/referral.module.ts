import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SasaPayModule } from '../sasapay/sasapay.module';
import { SmsModule } from '../sms/sms.module';
import { ReferralService } from './referral.service';
import { ReferralController } from './referral.controller';

@Module({
  imports: [PrismaModule, SasaPayModule, SmsModule],
  controllers: [ReferralController],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}
