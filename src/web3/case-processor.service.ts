import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FilecoinService } from './filecoin.service';
import { BlockchainCaseService } from './blockchain-case.service';
import { AiVerifierService } from './ai-verifier.service';
import { HypercertService } from './hypercert.service';

@Injectable()
export class CaseProcessorService {
  private readonly logger = new Logger(CaseProcessorService.name);

  // Fallback clinic wallet for demo when no real wallet is configured
  private readonly DEMO_CLINIC_ADDRESS =
    '0x000000000000000000000000000000000000dEaD';

  constructor(
    private prisma: PrismaService,
    private filecoin: FilecoinService,
    private blockchainCase: BlockchainCaseService,
    private aiVerifier: AiVerifierService,
    private hypercert: HypercertService,
  ) {}

  /**
   * Upload before/after images to Filecoin and store CIDs on the visit.
   * Returns the CIDs so the frontend can display them immediately.
   */
  async uploadCaseImages(
    visitId: string,
    beforeBuffer: Buffer,
    afterBuffer: Buffer,
    beforeMime: string,
    afterMime: string,
  ) {
    const visit = await this.prisma.visit.findUnique({
      where: { id: visitId },
    });
    if (!visit) throw new NotFoundException('Visit not found');

    this.logger.log(`Uploading case images for visit ${visitId}`);

    const [beforeCID, afterCID] = await Promise.all([
      this.filecoin.uploadFile(beforeBuffer, `before-${visitId}`, beforeMime),
      this.filecoin.uploadFile(afterBuffer, `after-${visitId}`, afterMime),
    ]);

    await this.prisma.visit.update({
      where: { id: visitId },
      data: {
        beforeCID,
        afterCID,
        web3VerificationStatus: 'PENDING',
      },
    });

    this.logger.log(
      `Images uploaded — beforeCID=${beforeCID} afterCID=${afterCID}`,
    );

    return {
      beforeCID,
      afterCID,
      beforeUrl: this.filecoin.gatewayUrl(beforeCID),
      afterUrl: this.filecoin.gatewayUrl(afterCID),
      beforePinataUrl: this.filecoin.pinataGatewayUrl(beforeCID),
      afterPinataUrl: this.filecoin.pinataGatewayUrl(afterCID),
      beforeExplorerUrl: this.filecoin.nftStorageViewerUrl(beforeCID),
      afterExplorerUrl: this.filecoin.nftStorageViewerUrl(afterCID),
    };
  }

  /**
   * Full pipeline: AI verify → submit on-chain → payout → mint Hypercert.
   * Safe to call after uploadCaseImages.
   */
  async processCase(visitId: string) {
    const visit = await this.prisma.visit.findUnique({
      where: { id: visitId },
      include: { staff: { include: { clinic: true } } },
    });

    if (!visit) throw new NotFoundException('Visit not found');
    if (!visit.beforeCID || !visit.afterCID) {
      throw new Error(
        'Visit does not have before/after CIDs — upload images first',
      );
    }

    this.logger.log(`Processing web3 case for visit ${visitId}`);

    // Step 1: AI verification
    const aiResult = await this.aiVerifier.verifyCase(
      visit.beforeCID,
      visit.afterCID,
    );

    await this.prisma.visit.update({
      where: { id: visitId },
      data: { aiVerificationResult: aiResult as any },
    });

    if (!aiResult.verified) {
      await this.prisma.visit.update({
        where: { id: visitId },
        data: { web3VerificationStatus: 'REJECTED' },
      });
      this.logger.warn(`Case rejected by AI for visit ${visitId}`);
      return { verified: false, aiResult };
    }

    // Step 2: Submit case to smart contract
    const clinicAddress =
      (visit.staff?.clinic as any)?.walletAddress || this.DEMO_CLINIC_ADDRESS;

    const { caseId, txHash: submitTxHash } =
      await this.blockchainCase.submitCase(
        visit.beforeCID,
        visit.afterCID,
        clinicAddress,
      );

    await this.prisma.visit.update({
      where: { id: visitId },
      data: {
        caseOnChainId: caseId,
        onChainTxHash: submitTxHash,
      },
    });

    // Step 3: Approve and trigger on-chain payout
    const payoutTxHash = await this.blockchainCase.approveAndPay(caseId);

    // Step 4: Mint Hypercert
    const hypercertData = await this.hypercert.mintHypercert({
      visitId,
      beforeCID: visit.beforeCID,
      afterCID: visit.afterCID,
      clinicAddress,
      verifierConfidence: aiResult.confidence,
    });

    // Persist all results
    await this.prisma.visit.update({
      where: { id: visitId },
      data: {
        web3VerificationStatus: 'VERIFIED',
        payoutTxHash,
        hypercertData: hypercertData as any,
      },
    });

    this.logger.log(
      `Web3 case complete — visit=${visitId} caseId=${caseId} payout=${payoutTxHash} hypercert=${hypercertData.mockTokenId}`,
    );

    return {
      verified: true,
      aiResult,
      caseId,
      submitTxHash,
      payoutTxHash,
      hypercertData,
    };
  }

  /**
   * Get the current web3 status for a visit.
   */
  async getCaseStatus(visitId: string) {
    const visit = await this.prisma.visit.findUnique({
      where: { id: visitId },
      select: {
        id: true,
        beforeCID: true,
        afterCID: true,
        web3VerificationStatus: true,
        caseOnChainId: true,
        onChainTxHash: true,
        payoutTxHash: true,
        hypercertData: true,
        aiVerificationResult: true,
      },
    });

    if (!visit) throw new NotFoundException('Visit not found');

    return {
      ...visit,
      beforeUrl: visit.beforeCID
        ? this.filecoin.gatewayUrl(visit.beforeCID)
        : null,
      afterUrl: visit.afterCID
        ? this.filecoin.gatewayUrl(visit.afterCID)
        : null,
      beforePinataUrl: visit.beforeCID
        ? this.filecoin.pinataGatewayUrl(visit.beforeCID)
        : null,
      afterPinataUrl: visit.afterCID
        ? this.filecoin.pinataGatewayUrl(visit.afterCID)
        : null,
      beforeExplorerUrl: visit.beforeCID
        ? this.filecoin.nftStorageViewerUrl(visit.beforeCID)
        : null,
      afterExplorerUrl: visit.afterCID
        ? this.filecoin.nftStorageViewerUrl(visit.afterCID)
        : null,
    };
  }
}
