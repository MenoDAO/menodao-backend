import { Module } from '@nestjs/common';
import { ProceduresService } from './procedures.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [],
  providers: [ProceduresService],
  exports: [ProceduresService],
})
export class ProceduresModule {
  constructor() {
    console.log('🟢 ProceduresModule constructor called');
  }
}
