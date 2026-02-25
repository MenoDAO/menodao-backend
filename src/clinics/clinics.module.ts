import { Module } from '@nestjs/common';
import { ClinicsService } from './clinics.service';
import {
  ClinicsController,
  AdminClinicsController,
} from './clinics.controller';
import { SmsModule } from '../sms/sms.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [SmsModule, AdminModule],
  controllers: [ClinicsController, AdminClinicsController],
  providers: [ClinicsService],
  exports: [ClinicsService],
})
export class ClinicsModule {}
