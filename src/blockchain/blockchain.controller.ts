import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { BlockchainService } from './blockchain.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Blockchain')
@Controller('blockchain')
export class BlockchainController {
  constructor(private blockchainService: BlockchainService) {}

  @Get('chains')
  @ApiOperation({ summary: 'Get supported blockchain networks' })
  getSupportedChains() {
    return this.blockchainService.getSupportedChains();
  }

  @Get('transactions')
  @ApiOperation({
    summary: 'Get all blockchain transactions (public audit log)',
  })
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

  @Get('wallet')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get or create custodial wallet for current member',
  })
  async getWallet(@Request() req) {
    const address = await this.blockchainService.getOrCreateWallet(req.user.id);
    return {
      address,
      type: 'custodial',
      message:
        'This is your custodial wallet. Connect an external wallet to claim your NFTs.',
    };
  }

  @Get('nfts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all NFTs for current member' })
  async getNFTs(@Request() req) {
    return this.blockchainService.getMemberNFTs(req.user.id);
  }

  @Post('nfts/:id/claim')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Claim NFT to external wallet' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        externalWallet: {
          type: 'string',
          example: '0x1234567890abcdef1234567890abcdef12345678',
          description: 'External wallet address to transfer NFT to',
        },
      },
      required: ['externalWallet'],
    },
  })
  async claimNFT(
    @Request() req,
    @Param('id') nftId: string,
    @Body('externalWallet') externalWallet: string,
  ) {
    const txHash = await this.blockchainService.claimNFT(
      req.user.id,
      nftId,
      externalWallet,
    );
    return {
      success: true,
      txHash,
      message:
        'NFT claimed successfully. It will appear in your external wallet shortly.',
    };
  }
}
