// Feature: whatsapp-ai-chatbot
// Implements Requirement 14: Visit History Flow

import { Injectable, Logger } from '@nestjs/common';
import { MembersService } from '../../members/members.service';
import { MetaApiService } from '../meta-api.service';
import { SessionService } from '../session.service';
import { ChatSession, ChatState } from '../session.service';
import * as en from '../i18n/en';
import * as sw from '../i18n/sw';

// Union type for the i18n catalogue — both catalogues share the same shape
type Messages = typeof en;

// Maximum number of recent visits to display (Requirement 14.1)
const MAX_VISITS = 5;

// ─── VisitHistoryFlow ─────────────────────────────────────────────────────────

@Injectable()
export class VisitHistoryFlow {
  private readonly logger = new Logger(VisitHistoryFlow.name);

  constructor(
    private readonly membersService: MembersService,
    private readonly metaApi: MetaApiService,
    private readonly sessionService: SessionService,
  ) {}

  // ─── Main entry point ───────────────────────────────────────────────────────

  /**
   * Called by WhatsAppService for VISIT_HISTORY state.
   * The third parameter matches the existing flow convention (phone string),
   * consistent with ClaimsFlow and DentalAiFlow.
   */
  async handle(
    session: ChatSession,
    message: string,
    phone: string,
  ): Promise<void> {
    const t: Messages =
      session.language === 'sw' ? (sw as unknown as Messages) : en;

    // First entry or re-entry: show visit history
    if (session.state !== ChatState.VISIT_HISTORY) {
      session.state = ChatState.VISIT_HISTORY;
      session.previousState = ChatState.MAIN_MENU;
    }

    // Check if the member is navigating back from the visit history display
    const msg = message.trim().toLowerCase();
    if (
      msg === 'visit_history_back' ||
      msg === 'back' ||
      msg === 'rudi' ||
      msg === 'menu' ||
      msg === 'menyu' ||
      msg === '0' ||
      msg === t.navigation.menuButton.toLowerCase()
    ) {
      session.state = ChatState.MAIN_MENU;
      session.previousState = ChatState.VISIT_HISTORY;
      await this.sessionService.set(phone, session);
      return;
    }

    // Display visit history
    await this.showVisitHistory(session, phone, t);
  }

  // ─── VISIT_HISTORY ──────────────────────────────────────────────────────────

  /**
   * Retrieve and display the member's 5 most recent dental visits.
   * Requirements 14.1–14.7
   */
  private async showVisitHistory(
    session: ChatSession,
    phone: string,
    t: Messages,
  ): Promise<void> {
    if (!session.memberId) {
      await this.metaApi.sendText(phone, t.genericError);
      await this.sessionService.set(phone, session);
      return;
    }

    try {
      // Requirement 14.1: retrieve visits via getMemberHistory(), limit to 5 most recent
      const result = await this.membersService.getMemberHistory(
        session.memberId,
        1,
        MAX_VISITS,
      );

      const visits = result.visits;

      // Requirement 14.6: no visits → inform member and suggest visiting a MenoHub clinic
      if (!visits || visits.length === 0) {
        await this.metaApi.sendButtons(phone, t.visitHistory.noVisits, [
          { id: 'visit_history_back', title: t.navigation.menuButton },
        ]);
        await this.sessionService.set(phone, session);
        return;
      }

      // Build the visit history message
      let historyMessage = t.visitHistory.header;

      visits.forEach((visit, index) => {
        const visitNumber = index + 1;

        // Requirement 14.2: date, clinic name, dentist name, procedures, total cost covered
        const date = new Date(visit.date).toLocaleDateString('en-KE', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });

        const clinicName = visit.clinic ?? 'MenoHub Clinic';
        const dentistName = visit.treatedBy ?? 'Unknown Provider';

        // Requirement 14.7: NEVER include chiefComplaint, medicalHistory, clinicalNotes, vitals
        // Only use procedures from the procedures array (not clinicalData)
        const procedureNames =
          visit.procedures && visit.procedures.length > 0
            ? visit.procedures.map((p: { name: string }) => p.name).join(', ')
            : 'General consultation';

        const costCovered = visit.totalCost ?? 0;

        historyMessage +=
          '\n' +
          t.visitHistory.visitEntry(
            visitNumber,
            date,
            clinicName,
            dentistName,
            procedureNames,
            costCovered,
          );

        // Requirement 14.3: VERIFIED + Hypercert token ID → show NFT status and metadataUrl
        // Requirement 14.4: PENDING → inform blockchain verification in progress
        if (visit.impactProof) {
          const { status, tokenId, metadataUrl } = visit.impactProof;

          if (status === 'VERIFIED' && tokenId) {
            const url = metadataUrl ?? '';
            historyMessage +=
              '\n' + t.visitHistory.hypercertVerified(String(tokenId), url);
          } else if (status === 'PENDING') {
            historyMessage += '\n' + t.visitHistory.hypercertPending;
          }
        }

        // Separator between visits (not after the last one)
        if (index < visits.length - 1) {
          historyMessage += '\n';
        }
      });

      historyMessage += t.visitHistory.footer;

      // Send the history with a "back to menu" button
      await this.metaApi.sendButtons(phone, historyMessage, [
        { id: 'visit_history_back', title: t.navigation.menuButton },
      ]);

      await this.sessionService.set(phone, session);
    } catch (err) {
      this.logger.error(
        `[VisitHistoryFlow] Error in showVisitHistory for ${this.hashPhone(phone)}: ${err instanceof Error ? err.message : String(err)}`,
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
