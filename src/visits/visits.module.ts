import { Module } from '@nestjs/common';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ProceduresModule } from '../procedures/procedures.module';
import { SmsModule } from '../sms/sms.module';
import { StaffModule } from '../staff/staff.module';

@Module({
  imports: [PrismaModule, ProceduresModule, SmsModule, StaffModule],
  controllers: [VisitsController],
  providers: [VisitsService],
  exports: [VisitsService],
})
export class VisitsModule {
  constructor() {
    try {
      console.log('🟡 VisitsModule constructor called');
    } catch (error) {
      console.error('🟡 VisitsModule constructor ERROR:', error);
      throw error;
    }
  }
}
