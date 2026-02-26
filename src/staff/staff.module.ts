import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { StaffAuthGuard } from './guards/staff-auth.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [PrismaModule, SmsModule],
  controllers: [StaffController],
  providers: [StaffService, StaffAuthGuard],
  exports: [StaffService, StaffAuthGuard],
})
export class StaffModule {
  constructor() {
    try {
      console.log('🔵 StaffModule constructor called');
    } catch (error) {
      console.error('🔵 StaffModule constructor ERROR:', error);
      throw error;
    }
  }
}
