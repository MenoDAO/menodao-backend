import { Module } from '@nestjs/common';
import { CampsService } from './camps.service';
import { CampsController } from './camps.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StaffModule } from '../staff/staff.module';

@Module({
  imports: [PrismaModule, StaffModule],
  controllers: [CampsController],
  providers: [CampsService],
  exports: [CampsService],
})
export class CampsModule {}
