import { Module } from '@nestjs/common';
import { ClaimsService } from './claims.service';
import { ClaimsController } from './claims.controller';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { StaffModule } from '../staff/staff.module';
import { SasaPayModule } from '../sasapay/sasapay.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [BlockchainModule, StaffModule, SasaPayModule, SmsModule],
  controllers: [ClaimsController],
  providers: [ClaimsService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
