import {
  Controller,
  Post,
  Get,
  Param,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { CaseProcessorService } from './case-processor.service';
import { StaffAuthGuard } from '../staff/guards/staff-auth.guard';

interface MulterFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

@Controller('web3/cases')
@UseGuards(StaffAuthGuard)
export class Web3CasesController {
  private readonly logger = new Logger(Web3CasesController.name);

  constructor(private caseProcessor: CaseProcessorService) {}

  /**
   * POST /web3/cases/:visitId/upload
   * Upload before/after images to Filecoin for a visit.
   * Expects multipart form with fields: beforeImage, afterImage
   */
  @Post(':visitId/upload')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'beforeImage', maxCount: 1 },
      { name: 'afterImage', maxCount: 1 },
    ]),
  )
  async uploadImages(
    @Param('visitId') visitId: string,
    @UploadedFiles()
    files: {
      beforeImage?: MulterFile[];
      afterImage?: MulterFile[];
    },
  ) {
    if (!files?.beforeImage?.[0] || !files?.afterImage?.[0]) {
      throw new BadRequestException(
        'Both beforeImage and afterImage are required',
      );
    }

    const before = files.beforeImage[0];
    const after = files.afterImage[0];

    this.logger.log(
      `Image upload request for visit ${visitId}: before=${before.originalname} after=${after.originalname}`,
    );

    return this.caseProcessor.uploadCaseImages(
      visitId,
      before.buffer,
      after.buffer,
      before.mimetype,
      after.mimetype,
    );
  }

  /**
   * POST /web3/cases/:visitId/process
   * Run the full AI → on-chain → Hypercert pipeline for a visit.
   */
  @Post(':visitId/process')
  async processCase(@Param('visitId') visitId: string) {
    this.logger.log(`Processing web3 case for visit ${visitId}`);
    return this.caseProcessor.processCase(visitId);
  }

  /**
   * GET /web3/cases/:visitId/status
   * Get the current web3 verification status for a visit.
   */
  @Get(':visitId/status')
  async getCaseStatus(@Param('visitId') visitId: string) {
    return this.caseProcessor.getCaseStatus(visitId);
  }
}
