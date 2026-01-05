import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { BlockchainService } from './blockchain.service';

@ApiTags('Blockchain')
@Controller('blockchain')
export class BlockchainController {
  constructor(private blockchainService: BlockchainService) {}

  @Get('transactions')
  @ApiOperation({ summary: 'Get all blockchain transactions (public audit log)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getAllTransactions(
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.blockchainService.getAllTransactions(+page, +limit);
  }

  @Get('transactions/:txHash')
  @ApiOperation({ summary: 'Get transaction by hash' })
  async getTransaction(@Param('txHash') txHash: string) {
    return this.blockchainService.getTransaction(txHash);
  }
}
