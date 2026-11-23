import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VoucherService } from './voucher.service';

@Module({
  imports: [PrismaModule],
  providers: [VoucherService],
  exports: [VoucherService],
})
export class VoucherModule {}
