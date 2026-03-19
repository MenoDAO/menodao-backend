import { Module } from '@nestjs/common';
import { FilecoinService } from './filecoin.service';
import { BlockchainCaseService } from './blockchain-case.service';
import { AiVerifierService } from './ai-verifier.service';
import { HypercertService } from './hypercert.service';
import { CaseProcessorService } from './case-processor.service';
import { Web3CasesController } from './web3-cases.controller';
import { StaffModule } from '../staff/staff.module';

@Module({
  imports: [StaffModule],
  controllers: [Web3CasesController],
  providers: [
    FilecoinService,
    BlockchainCaseService,
    AiVerifierService,
    HypercertService,
    CaseProcessorService,
  ],
  exports: [CaseProcessorService],
})
export class Web3Module {}
