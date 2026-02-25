import { Module } from '@nestjs/common';
import { ClinicsService } from './clinics.service';
import {
  ClinicsController,
  AdminClinicsController,
} from './clinics.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ClinicsController, AdminClinicsController],
  providers: [ClinicsService],
  exports: [ClinicsService],
})
export class ClinicsModule {}
