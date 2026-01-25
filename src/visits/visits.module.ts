import { Module } from '@nestjs/common';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ProceduresModule } from '../procedures/procedures.module';
import { SmsModule } from '../sms/sms.module';
import { StaffModule } from '../staff/staff.module';
import { StaffAuthGuard } from '../staff/guards/staff-auth.guard';

@Module({
  imports: [PrismaModule, ProceduresModule, SmsModule, StaffModule],
  controllers: [VisitsController],
  providers: [VisitsService, StaffAuthGuard],
  exports: [VisitsService],
})
export class VisitsModule {
  constructor() {
    console.log('🟡 VisitsModule constructor called');
  }
}
