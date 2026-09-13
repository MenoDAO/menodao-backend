import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { FoundationSiteService } from './foundation-site.service';
import { FoundationInquiriesService } from './foundation-inquiries.service';
import { SubmitFoundationInquiryDto } from './submit-inquiry.dto';

@ApiTags('Public / Foundation site')
@Controller('public/foundation')
export class FoundationPublicController {
  constructor(
    private foundationSite: FoundationSiteService,
    private inquiries: FoundationInquiriesService,
  ) {}

  @Get('media')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cache-Control', 'public, max-age=30')
  @ApiOperation({ summary: 'Public Foundation website snapshot' })
  media(@Req() req: Request) {
    return this.foundationSite.getPublicSite(this.base(req));
  }

  @Get('clinic-logo/:id')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiOperation({ summary: 'Clinic logo for the Foundation website' })
  clinicLogo(@Param('id') id: string): StreamableFile {
    const file = this.foundationSite.readClinicLogo(id);
    return new StreamableFile(file.buffer, {
      type: file.mimeType,
      disposition: 'inline',
    });
  }

  @Post('inquiries')
  @Header('Access-Control-Allow-Origin', '*')
  @ApiOperation({ summary: 'Submit a Foundation website intake form' })
  submitInquiry(@Body() body: SubmitFoundationInquiryDto) {
    return this.inquiries.create(body.formId, body.fields || {});
  }

  @Get('founder-photo')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiOperation({ summary: 'Founder letter portrait' })
  photo(): StreamableFile {
    const file = this.foundationSite.readPhoto();
    return new StreamableFile(file.buffer, {
      type: file.mimeType,
      disposition: 'inline',
    });
  }

  private base(req: Request) {
    return this.foundationSite.publicBaseFromRequest(
      req.protocol,
      req.get('host'),
    );
  }
}
