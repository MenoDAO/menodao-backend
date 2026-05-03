import { Injectable, Logger } from '@nestjs/common';
import { ClinicsService } from '../../clinics/clinics.service';
import { MetaApiService } from '../meta-api.service';
import { SessionService } from '../session.service';
import { ChatSession, ChatState } from '../session.service';
import { MetaMessage } from '../dto/webhook.dto';
import * as en from '../i18n/en';
import * as sw from '../i18n/sw';

// Union type for the i18n catalogue — both catalogues share the same shape
type Messages = typeof en;

// ─── Haversine distance helper ────────────────────────────────────────────────

/**
 * Calculate the great-circle distance between two points on Earth.
 * @returns Distance in kilometres.
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth's radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ─── Clinic shape returned by ClinicsService ─────────────────────────────────

interface ClinicRecord {
  id: string;
  name: string;
  subCounty: string;
  physicalLocation: string;
  googleMapsLink?: string | null;
  operatingHours: string;
  whatsappNumber: string;
  status: string;
  // latitude/longitude are not present in the current schema
  // but we define optional fields here for forward-compatibility
  latitude?: number | null;
  longitude?: number | null;
}

// ─── ClinicFlow ───────────────────────────────────────────────────────────────

@Injectable()
export class ClinicFlow {
  private readonly logger = new Logger(ClinicFlow.name);

  constructor(
    private readonly clinicsService: ClinicsService,
    private readonly metaApi: MetaApiService,
    private readonly sessionService: SessionService,
  ) {}

  // ─── Main entry point ───────────────────────────────────────────────────────

  /**
   * Handle all clinic-related states.
   * @param session  Current chat session
   * @param message  Inbound Meta message object
   * @param phone    Normalised E.164 phone number of the sender
   * @param lang     Active language for this session
   */
  async handle(
    session: ChatSession,
    message: MetaMessage,
    phone: string,
    lang: 'en' | 'sw',
  ): Promise<void> {
    const t: Messages = lang === 'sw' ? (sw as unknown as Messages) : en;

    switch (session.state) {
      case ChatState.CLINIC_PROMPT_LOCATION:
        return this.handlePromptLocation(session, message, phone, t);

      case ChatState.CLINIC_RESULTS:
        return this.handleClinicResults(session, message, phone, t);

      default:
        // Entry point: prompt for location
        return this.showLocationPrompt(session, phone, t);
    }
  }

  // ─── CLINIC_PROMPT_LOCATION ─────────────────────────────────────────────────

  /** Show the initial location prompt and set state. */
  private async showLocationPrompt(
    session: ChatSession,
    phone: string,
    t: Messages,
  ): Promise<void> {
    session.state = ChatState.CLINIC_PROMPT_LOCATION;
    session.previousState = ChatState.MAIN_MENU;
    await this.sessionService.set(phone, session);

    await this.metaApi.sendText(phone, t.clinic.promptLocation);
  }

  /**
   * Handle input while in CLINIC_PROMPT_LOCATION state.
   * Accepts either a WhatsApp location share or a text sub-county name.
   */
  private async handlePromptLocation(
    session: ChatSession,
    message: MetaMessage,
    phone: string,
    t: Messages,
  ): Promise<void> {
    if (message.type === 'location' && message.location) {
      // Member shared their GPS location
      await this.handleLocationMessage(
        session,
        message.location.latitude,
        message.location.longitude,
        phone,
        t,
      );
    } else if (message.type === 'text' && message.text?.body) {
      // Member typed a sub-county name
      await this.handleSubCountySearch(
        session,
        message.text.body.trim(),
        phone,
        t,
      );
    } else {
      // Unrecognised input — re-prompt
      await this.metaApi.sendText(phone, t.clinic.promptLocation);
    }
  }

  // ─── Location-based search ──────────────────────────────────────────────────

  /**
   * Find the 3 nearest approved clinics to the member's GPS coordinates.
   * Falls back to listing all approved clinics if no lat/lng data is stored
   * on clinic records (current schema does not include coordinates).
   */
  private async handleLocationMessage(
    session: ChatSession,
    memberLat: number,
    memberLon: number,
    phone: string,
    t: Messages,
  ): Promise<void> {
    try {
      const allClinics = (await this.clinicsService.listClinics(
        'APPROVED' as import('@prisma/client').ClinicStatus,
      )) as ClinicRecord[];

      if (!allClinics || allClinics.length === 0) {
        await this.metaApi.sendText(phone, t.clinic.noResults);
        return;
      }

      // Filter to only APPROVED clinics (belt-and-suspenders)
      const approved = allClinics.filter((c) => c.status === 'APPROVED');

      if (approved.length === 0) {
        await this.metaApi.sendText(phone, t.clinic.noResults);
        return;
      }

      // Sort by proximity if clinics have coordinates; otherwise use insertion order
      const clinicsWithDistance = approved.map((clinic) => {
        const distance =
          clinic.latitude != null && clinic.longitude != null
            ? haversineDistance(
                memberLat,
                memberLon,
                clinic.latitude,
                clinic.longitude,
              )
            : Infinity;
        return { clinic, distance };
      });

      clinicsWithDistance.sort((a, b) => a.distance - b.distance);

      // Return up to 3 nearest
      const nearest = clinicsWithDistance.slice(0, 3).map((c) => c.clinic);

      await this.sendClinicResults(session, nearest, phone, t);
    } catch (err) {
      this.logger.error(
        `[ClinicFlow] Error in handleLocationMessage for ${this.hashPhone(phone)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.metaApi.sendText(phone, t.genericError);
    }
  }

  // ─── Sub-county text search ─────────────────────────────────────────────────

  /**
   * Find up to 5 approved clinics matching the typed sub-county name.
   */
  private async handleSubCountySearch(
    session: ChatSession,
    subCountyInput: string,
    phone: string,
    t: Messages,
  ): Promise<void> {
    try {
      const allClinics = (await this.clinicsService.listClinics(
        'APPROVED' as import('@prisma/client').ClinicStatus,
      )) as ClinicRecord[];

      if (!allClinics || allClinics.length === 0) {
        await this.metaApi.sendText(phone, t.clinic.noResults);
        return;
      }

      // Case-insensitive sub-county match
      const normalised = subCountyInput.toLowerCase();
      const matched = allClinics
        .filter(
          (c) =>
            c.status === 'APPROVED' &&
            c.subCounty.toLowerCase().includes(normalised),
        )
        .slice(0, 5);

      if (matched.length === 0) {
        await this.metaApi.sendText(phone, t.clinic.noResults);
        return;
      }

      await this.sendClinicResults(session, matched, phone, t);
    } catch (err) {
      this.logger.error(
        `[ClinicFlow] Error in handleSubCountySearch for ${this.hashPhone(phone)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.metaApi.sendText(phone, t.genericError);
    }
  }

  // ─── Send results ───────────────────────────────────────────────────────────

  /**
   * Format and send clinic results, then transition to CLINIC_RESULTS state.
   */
  private async sendClinicResults(
    session: ChatSession,
    clinics: ClinicRecord[],
    phone: string,
    t: Messages,
  ): Promise<void> {
    // Build the results message
    const header = t.clinic.resultsHeader(clinics.length);
    const entries = clinics
      .map((clinic, idx) =>
        t.clinic.clinicEntry(
          idx + 1,
          clinic.name,
          clinic.physicalLocation,
          clinic.operatingHours,
          clinic.whatsappNumber || undefined,
          clinic.googleMapsLink || undefined,
        ),
      )
      .join('\n\n');

    await this.metaApi.sendText(phone, `${header}\n${entries}`);

    // Transition to CLINIC_RESULTS and offer follow-up buttons
    session.state = ChatState.CLINIC_RESULTS;
    session.previousState = ChatState.CLINIC_PROMPT_LOCATION;
    await this.sessionService.set(phone, session);

    await this.metaApi.sendButtons(phone, t.clinic.searchAgainPrompt, [
      { id: 'clinic_search_again', title: t.clinic.searchAgainButton },
      { id: 'clinic_back', title: t.navigation.menuButton },
    ]);
  }

  // ─── CLINIC_RESULTS ─────────────────────────────────────────────────────────

  /**
   * Handle button replies in the CLINIC_RESULTS state.
   * "Search again" → CLINIC_PROMPT_LOCATION
   * "Back" / "clinic_back" → MAIN_MENU
   */
  private async handleClinicResults(
    session: ChatSession,
    message: MetaMessage,
    phone: string,
    t: Messages,
  ): Promise<void> {
    // Extract the reply ID from interactive button or plain text
    const replyId =
      message.interactive?.button_reply?.id ??
      message.interactive?.list_reply?.id ??
      message.text?.body?.toLowerCase().trim() ??
      '';

    const isSearchAgain =
      replyId === 'clinic_search_again' ||
      replyId.includes('search') ||
      replyId.includes('tafuta') ||
      replyId === t.clinic.searchAgainButton.toLowerCase();

    const isBack =
      replyId === 'clinic_back' ||
      replyId === 'back' ||
      replyId === 'rudi' ||
      replyId === 'menu' ||
      replyId === 'menyu' ||
      replyId === '0' ||
      replyId === t.navigation.menuButton.toLowerCase();

    if (isSearchAgain) {
      session.state = ChatState.CLINIC_PROMPT_LOCATION;
      session.previousState = ChatState.CLINIC_RESULTS;
      await this.sessionService.set(phone, session);
      await this.metaApi.sendText(phone, t.clinic.promptLocation);
    } else if (isBack) {
      session.state = ChatState.MAIN_MENU;
      session.previousState = ChatState.CLINIC_RESULTS;
      await this.sessionService.set(phone, session);
      // WhatsAppService will render the main menu on next dispatch
    } else {
      // Unrecognised — re-show the options
      await this.metaApi.sendButtons(phone, t.clinic.searchAgainPrompt, [
        { id: 'clinic_search_again', title: t.clinic.searchAgainButton },
        { id: 'clinic_back', title: t.navigation.menuButton },
      ]);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** One-way hash of phone number for privacy-safe logging (last 4 digits). */
  private hashPhone(phone: string): string {
    return `***${phone.slice(-4)}`;
  }
}
