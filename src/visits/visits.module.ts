import { Module, forwardRef } from '@nestjs/common';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ProceduresModule } from '../procedures/procedures.module';
import { SmsModule } from '../sms/sms.module';
import { StaffModule } from '../staff/staff.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => ProceduresModule),
    SmsModule,
    forwardRef(() => StaffModule),
  ],
  controllers: [VisitsController],
  providers: [VisitsService],
  exports: [VisitsService],
})
export class VisitsModule {
  constructor() {
    console.log('🟡 VisitsModule constructor called');
  }
}
