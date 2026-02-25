import { Module } from '@nestjs/common';
import { CampsService } from './camps.service';
import { CampsController } from './camps.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StaffModule } from '../staff/staff.module';
import { AuthModule } from '../auth/auth.module';
import { JwtOrStaffAuthGuard } from '../auth/guards/jwt-or-staff-auth.guard';

@Module({
  imports: [PrismaModule, StaffModule, AuthModule],
  controllers: [CampsController],
  providers: [CampsService, JwtOrStaffAuthGuard],
  exports: [CampsService],
})
export class CampsModule {}
