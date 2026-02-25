import { Module } from '@nestjs/common';
import { ClinicsService } from './clinics.service';
import {
  ClinicsController,
  AdminClinicsController,
} from './clinics.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { SmsModule } from '../sms/sms.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [PrismaModule, AuthModule, SmsModule, AdminModule],
  controllers: [ClinicsController, AdminClinicsController],
  providers: [ClinicsService],
  exports: [ClinicsService],
})
export class ClinicsModule {}
