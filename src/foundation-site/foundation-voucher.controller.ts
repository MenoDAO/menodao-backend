import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { VerifyVoucherDto } from '../voucher/dto/voucher.dto';
import { VoucherService } from '../voucher/voucher.service';

@ApiTags('Public / Foundation site')
@Controller('public/foundation/vouchers')
export class FoundationVoucherController {
  constructor(private readonly vouchers: VoucherService) {}

  @Post('verify')
  @Header('Access-Control-Allow-Origin', '*')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check a voucher code without exposing batch or recipient details',
  })
  verify(@Body() body: VerifyVoucherDto) {
    return this.vouchers.verifyPublic(body.code);
  }
}
