import { Module } from '@nestjs/common';
import { ProceduresService } from './procedures.service';
import { ProceduresController } from './procedures.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StaffModule } from '../staff/staff.module';

@Module({
  imports: [PrismaModule, StaffModule],
  controllers: [ProceduresController],
  providers: [ProceduresService],
  exports: [ProceduresService],
})
export class ProceduresModule {}
