import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { StaffAuthGuard } from './guards/staff-auth.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { SmsModule } from '../sms/sms.module';
import { getJwtConfig } from '../common/jwt.config';

@Module({
  imports: [PrismaModule, SmsModule, ConfigModule],
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
