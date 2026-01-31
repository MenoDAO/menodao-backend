import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { StaffAuthGuard } from './guards/staff-auth.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [
    PrismaModule,
    SmsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '8h' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [StaffController],
  providers: [StaffService, StaffAuthGuard],
  exports: [StaffService, StaffAuthGuard, JwtModule],
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
