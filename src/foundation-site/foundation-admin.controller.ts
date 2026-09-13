import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminAuthGuard } from '../admin/guards/admin-auth.guard';
import { FoundationSiteService } from './foundation-site.service';
import { FoundationInquiriesService } from './foundation-inquiries.service';
import { UpdateFoundationSettingsDto } from './foundation-settings.dto';

type Upload = {
  buffer: Buffer;
  mimetype: string;
};

@ApiTags('Admin / Foundation site')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/foundation')
export class FoundationAdminController {
  constructor(
    private foundationSite: FoundationSiteService,
    private inquiries: FoundationInquiriesService,
  ) {}

  @Get('inquiries')
  @ApiOperation({ summary: 'List Foundation website form submissions' })
  listInquiries(
    @Query('kind') kind?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.inquiries.list(kind, Number(page), Number(limit));
  }

  @Get('inquiries/:id')
  @ApiOperation({ summary: 'Get one Foundation website form submission' })
  getInquiry(@Param('id') id: string) {
    return this.inquiries.getById(id);
  }

  @Get('network')
  @ApiOperation({ summary: 'Approved clinics, logos, and WhatsApp desk number' })
  getNetwork(@Req() req: Request) {
    return this.foundationSite.getAdminNetwork(this.base(req));
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update Foundation WhatsApp desk or anchor clinic' })
  async updateSettings(
    @Body() body: UpdateFoundationSettingsDto,
    @Req() req: Request,
  ) {
    await this.foundationSite.updateSettings(body);
    return this.foundationSite.getAdminNetwork(this.base(req));
  }

  @Post('clinics/:id/logo')
  @ApiOperation({ summary: 'Upload a clinic logo for the Foundation site' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { logo: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('logo', {
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  uploadClinicLogo(
    @Param('id') id: string,
    @UploadedFile() file: Upload | undefined,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('Choose a logo to upload.');
    }
    this.foundationSite.saveClinicLogo(id, file.buffer, file.mimetype);
    return this.foundationSite.getAdminNetwork(this.base(req));
  }

  @Delete('clinics/:id/logo')
  @ApiOperation({ summary: 'Remove a clinic logo from the Foundation site' })
  removeClinicLogo(@Param('id') id: string, @Req() req: Request) {
    this.foundationSite.removeClinicLogo(id);
    return this.foundationSite.getAdminNetwork(this.base(req));
  }

  @Get('founder-photo')
  @ApiOperation({ summary: 'Founder letter photo metadata' })
  getFounderPhoto(@Req() req: Request) {
    return this.foundationSite.getMeta(this.base(req));
  }

  @Post('founder-photo')
  @ApiOperation({ summary: 'Upload or replace the founder letter photo' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { photo: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  uploadFounderPhoto(
    @UploadedFile() file: Upload | undefined,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('Choose a photo to upload.');
    }
    this.foundationSite.savePhoto(file.buffer, file.mimetype);
    return this.foundationSite.getMeta(this.base(req));
  }

  @Delete('founder-photo')
  @ApiOperation({ summary: 'Remove the founder letter photo' })
  removeFounderPhoto(@Req() req: Request) {
    this.foundationSite.removePhoto();
    return this.foundationSite.getMeta(this.base(req));
  }

  private base(req: Request) {
    return this.foundationSite.publicBaseFromRequest(
      req.protocol,
      req.get('host'),
    );
  }
}
