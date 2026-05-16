import { Module } from '@nestjs/common';
import { ClinicsService } from './clinics.service';
import {
  ClinicsController,
  AdminClinicsController,
} from './clinics.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [PrismaModule, AuthModule, SmsModule],
  controllers: [ClinicsController, AdminClinicsController],
  providers: [ClinicsService],
  exports: [ClinicsService],
})
export class ClinicsModule {}
