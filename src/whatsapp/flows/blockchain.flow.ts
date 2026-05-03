// Feature: whatsapp-ai-chatbot
// Implements Requirement 16: Blockchain and NFT Info Flow

import { Injectable, Logger } from '@nestjs/common';
import { MembersService } from '../../members/members.service';
import { MetaApiService } from '../meta-api.service';
import { SessionService } from '../session.service';
import { ChatSession, ChatState } from '../session.service';
import { MetaMessage } from '../dto/webhook.dto';
import * as en from '../i18n/en';
import * as sw from '../i18n/sw';

// Union type for the i18n catalogue — both catalogues share the same shape
type Messages = typeof en;

// ─── maskTxHash ───────────────────────────────────────────────────────────────

/**
 * Mask a blockchain transaction hash for privacy-safe display.
 * Requirement 16.6: format `0x{first8}…{last6}` — never display full hashes.
 */
export function maskTxHash(hash: string): string {
  const clean = hash.startsWith('0x') ? hash.slice(2) : hash;
  if (clean.length < 16) return hash; // too short to mask
  return `0x${clean.slice(0, 8)}…${clean.slice(-6)}`;
}

// ─── BlockchainFlow ───────────────────────────────────────────────────────────

@Injectable()
export class BlockchainFlow {
  private readonly logger = new Logger(BlockchainFlow.name);

  constructor(
    private readonly membersService: MembersService,
    private readonly metaApi: MetaApiService,
    private readonly sessionService: SessionService,
  ) {}

  // ─── Main entry point ───────────────────────────────────────────────────────

  /**
   * Called by WhatsAppService for BLOCKCHAIN_VIEW state.
   * Matches the FlowHandler interface: handle(session, message, rawMsg).
   * Phone is derived from session.phoneNumber.
   */
  async handle(
    session: ChatSession,
    message: string,
    rawMsg: MetaMessage,
  ): Promise<void> {
    const phone = session.phoneNumber;
    const t: Messages =
      session.language === 'sw' ? (sw as unknown as Messages) : en;

    // Set state on first entry
    if (session.state !== ChatState.BLOCKCHAIN_VIEW) {
      session.state = ChatState.BLOCKCHAIN_VIEW;
      session.previousState = ChatState.MAIN_MENU;
    }

    // Extract reply ID from interactive button or plain text
    const replyId =
      rawMsg.interactive?.button_reply?.id ??
      rawMsg.interactive?.list_reply?.id ??
      message.trim().toLowerCase();

    // Handle back/menu navigation
    if (
      replyId === 'blockchain_back' ||
      replyId === 'back' ||
      replyId === 'rudi' ||
      replyId === 'menu' ||
      replyId === 'menyu' ||
      replyId === '0'
    ) {
      session.state = ChatState.MAIN_MENU;
      session.previousState = ChatState.BLOCKCHAIN_VIEW;
      await this.sessionService.set(phone, session);
      return;
    }

    // Default: show blockchain info
    await this.showBlockchainInfo(session, phone, t);
  }

  // ─── BLOCKCHAIN_VIEW ─────────────────────────────────────────────────────────

  /**
   * Retrieve and display the member's blockchain impact proof, NFTs, and
   * transaction history.
   * Requirements 16.1–16.7
   */
  private async showBlockchainInfo(
    session: ChatSession,
    phone: string,
    t: Messages,
  ): Promise<void> {
    // Guard: memberId must be present
    if (!session.memberId) {
      await this.metaApi.sendText(phone, t.genericError);
      await this.sessionService.set(phone, session);
      return;
    }

    try {
      // Requirement 16.1: retrieve visit history (enough to find all VERIFIED ones)
      const historyResult = await this.membersService.getMemberHistory(
        session.memberId,
        1,
        50,
      );
      const visits = historyResult.visits ?? [];

      // Filter to VERIFIED visits (Requirement 16.1)
      const verifiedVisits = visits.filter(
        (v) => v.impactProof?.status === 'VERIFIED',
      );

      // Check for any REJECTED visits (Requirement 16.7)
      const hasRejectedVisit = visits.some(
        (v) => v.impactProof?.status === 'REJECTED',
      );

      // Requirement 16.2: retrieve blockchain transaction history
      const txResult = await this.membersService.getTransactionHistory(
        session.memberId,
        1,
        20,
      );
      const transactions = txResult.data ?? [];

      // Requirement 16.4: retrieve member to check nfts array
      const member = await this.membersService.findById(session.memberId);

      // Requirement 16.5: no verified visits AND no transactions → explain how system works
      if (verifiedVisits.length === 0 && transactions.length === 0) {
        await this.metaApi.sendButtons(phone, t.blockchain.noRecords, [
          { id: 'blockchain_back', title: t.navigation.menuButton },
        ]);
        await this.sessionService.set(phone, session);
        return;
      }

      // Build the blockchain info message
      let message = t.blockchain.header;

      // Requirement 16.1: append each verified visit as an NFT entry
      for (const visit of verifiedVisits) {
        const proof = visit.impactProof!;
        const tokenId = String(proof.tokenId);
        const date = new Date(visit.date).toLocaleDateString('en-KE', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
        const metadataUrl = proof.metadataUrl ?? '';
        message += '\n' + t.blockchain.nftEntry(tokenId, date, metadataUrl);
      }

      // Requirement 16.7: inform about rejected verification
      if (hasRejectedVisit) {
        message += '\n' + t.blockchain.rejectedVisit;
      }

      // Requirement 16.2: append transaction history
      if (transactions.length > 0) {
        message += t.blockchain.txHeader;
        for (const tx of transactions) {
          // Guard against null/undefined txHash (Requirement 16.6)
          const maskedHash = tx.txHash ? maskTxHash(tx.txHash) : 'N/A';
          // amount is stored as a string (wei/token units) — parse to number for display
          const amount = tx.amount ? Number(tx.amount) : 0;
          message += t.blockchain.txEntry(tx.txType, amount, maskedHash) + '\n';
        }
      }

      // Requirement 16.4: NFT holdings summary
      if (member.nfts && member.nfts.length > 0) {
        message += t.blockchain.nftHoldings(member.nfts.length);
      }

      message += t.blockchain.footer;

      // Send with back button
      await this.metaApi.sendButtons(phone, message, [
        { id: 'blockchain_back', title: t.navigation.menuButton },
      ]);

      await this.sessionService.set(phone, session);
    } catch (err) {
      this.logger.error(
        `[BlockchainFlow] Error in showBlockchainInfo for ${this.hashPhone(phone)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.metaApi.sendText(phone, t.genericError);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** One-way hash of phone number for privacy-safe logging (last 4 digits). */
  private hashPhone(phone: string): string {
    return `***${phone.slice(-4)}`;
  }
}
