import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../prisma/prisma.module';
import { SmsService } from './sms.service';

@Module({
  imports: [HttpModule, PrismaModule],
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
