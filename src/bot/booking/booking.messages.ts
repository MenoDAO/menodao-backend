/**
 * booking.messages.ts
 *
 * All user-facing strings for the booking flow.
 * Each key has an English (en) and Swahili (sw) variant.
 * Strings marked "needs native speaker review" should be verified by a
 * native Swahili speaker before going to production.
 */

export type BookingLang = 'en' | 'sw';

export interface BilingualMessage {
  en: string;
  sw: string;
}

function msg(en: string, sw: string): BilingualMessage {
  return { en, sw };
}

// ── Field prompts ─────────────────────────────────────────────────────────────

export const ASK_SERVICE = msg(
  '🦷 What dental service would you like? (e.g. Cleaning, Check-up, Filling, Extraction, Whitening, X-Ray)',
  "🦷 Unataka huduma gani ya meno? (mfano: Kusafisha, Ukaguzi, Kuziba, Kung'oa, Kupamba, X-Ray)", // needs native speaker review
);

export const ASK_DATE_TIME = msg(
  '📅 What date and time would you prefer? (e.g. "tomorrow at 10 AM" or "Monday the 26th at 2 PM")',
  '📅 Unapenda siku na wakati gani? (mfano: "kesho saa nne asubuhi" au "Jumatatu tarehe 26 saa nane mchana")', // needs native speaker review
);

export const ASK_NAME = msg(
  '👤 What name should the appointment be booked under?',
  '👤 Jina gani tutumie kwa miadi hii?', // needs native speaker review
);

// ── Clinic choice ─────────────────────────────────────────────────────────────

export const ASK_CLINIC = msg(
  '🏥 Which clinic would you like to visit? Please choose one:\n{clinicList}',
  '🏥 Unataka kwenda kliniki ipi? Tafadhali chagua:\n{clinicList}', // needs native speaker review
);

export const CLINIC_NOT_FOUND = msg(
  '🏥 I couldn\'t find a clinic matching "{name}". Please choose from the available clinics:\n{clinicList}',
  '🏥 Sikupata kliniki inayoitwa "{name}". Tafadhali chagua kliniki moja kati ya hizi:\n{clinicList}', // needs native speaker review
);

// ── Service choice ────────────────────────────────────────────────────────────

export const SERVICE_NOT_OFFERED = msg(
  '🦷 "{service}" doesn\'t match the services offered at {clinic}. Please choose one:\n{serviceList}',
  '🦷 "{service}" haipo katika huduma za {clinic}. Tafadhali chagua:\n{serviceList}', // needs native speaker review
);

// ── Slot validation errors ────────────────────────────────────────────────────

export const SLOT_PAST = msg(
  '⏰ That date/time has already passed. Could you give me a future date and time?',
  '⏰ Wakati huo umepita. Tafadhali nipe tarehe na wakati ujao.', // needs native speaker review
);

export const SLOT_CLOSED_DAY = msg(
  "📅 Sorry, the clinic is closed on {dayName}. We're open on {openDays}. Which day works for you?",
  '📅 Samahani, kliniki imefungwa {dayName}. Tunafungua {openDays}. Siku gani inakufaa?', // needs native speaker review
);

export const SLOT_OUTSIDE_HOURS = msg(
  '🕐 Our clinic hours are {openTime} – {closeTime}. Could you pick a time within those hours?',
  '🕐 Kliniki inafungua {openTime} hadi {closeTime}. Je, unaweza kuchagua wakati ndani ya masaa hayo?', // needs native speaker review
);

export const SLOT_NOT_ON_BOUNDARY = msg(
  '🕐 Appointments are booked every {slotMinutes} minutes. The closest slot would be {nearestSlot}. Does that work?',
  '🕐 Miadi inapangwa kila dakika {slotMinutes}. Nafasi ya karibu ni {nearestSlot}. Je, inakufaa?', // needs native speaker review
);

export const SLOT_TAKEN = msg(
  '📅 That slot is already taken. Here are the next available times:\n{alternatives}\nWhich one works for you?',
  '📅 Nafasi hiyo imeshachukuliwa. Hizi ni nafasi zilizobaki:\n{alternatives}\nIpi inakufaa?', // needs native speaker review
);

// ── Read-back / confirmation ──────────────────────────────────────────────────

export const READ_BACK = msg(
  '📋 Please confirm your appointment:\n\n🦷 *Service:* {service}\n📅 *Date:* {date}\n🕐 *Time:* {time}\n🏥 *Clinic:* {clinic}\n👤 *Name:* {name}\n\nIs everything correct? (Yes / No)',
  '📋 Tafadhali thibitisha miadi yako:\n\n🦷 *Huduma:* {service}\n📅 *Tarehe:* {date}\n🕐 *Wakati:* {time}\n🏥 *Kliniki:* {clinic}\n👤 *Jina:* {name}\n\nJe, kila kitu ni sawa? (Ndiyo / Hapana)', // needs native speaker review
);

export const BOOKING_AWAITING_CONFIRMATION = msg(
  'Your appointment is not confirmed yet. Please reply *Yes* to confirm this booking, or *No* to cancel it.',
  'Miadi yako bado haijathibitishwa. Tafadhali jibu *Ndiyo* kuthibitisha miadi hii, au *Hapana* kuufuta.', // needs native speaker review
);

export const BOOKING_CONFIRMED = msg(
  '✅ *Appointment Confirmed!*\n\n📋 *Name:* {name}\n🦷 *Service:* {service}\n📅 *Date:* {date}\n🕐 *Time:* {time}\n🏥 *Clinic:* {clinic}\n\nYour booking reference is *#{ref}*. See you soon! 😊',
  '✅ *Miadi Imethibitishwa!*\n\n📋 *Jina:* {name}\n🦷 *Huduma:* {service}\n📅 *Tarehe:* {date}\n🕐 *Wakati:* {time}\n🏥 *Kliniki:* {clinic}\n\nNambari yako ya kuthibitisha ni *#{ref}*. Tutaonana hivi karibuni! 😊', // needs native speaker review
);

// ── Emergency ────────────────────────────────────────────────────────────────

export const EMERGENCY_GUIDANCE = msg(
  "🚨 *This sounds like a dental emergency.* Please go to the nearest clinic immediately or call emergency services.\n\nOur clinic: {clinicName} — {clinicPhone}\n\nDo not delay. I'm also passing your message to our clinical team for urgent review.",
  '🚨 *Hii inaonekana kama dharura ya meno.* Tafadhali nenda kliniki iliyo karibu nawe haraka au piga simu ya dharura.\n\nKliniki yetu: {clinicName} — {clinicPhone}\n\nUsichelewe. Ninapeleka ujumbe wako kwa timu yetu ya kliniki kwa tathmini ya haraka.', // needs native speaker review
);

// ── Cancellation ─────────────────────────────────────────────────────────────

export const BOOKING_CANCELLED = msg(
  "👍 No problem — your booking request has been cancelled. Let me know if you'd like to start again.",
  '👍 Sawa — ombi lako la miadi limefutwa. Niambie ukitaka kuanza tena.', // needs native speaker review
);

// ── Parse failure / retry ─────────────────────────────────────────────────────

export const PARSE_FAILURE = msg(
  '😅 Sorry, I didn\'t quite catch that. Could you rephrase? For example: "I\'d like a cleaning appointment next Monday at 10 AM."',
  '😅 Samahani, sikuelewa vizuri. Je, unaweza kusema tena? Mfano: "Nataka kusafisha meno Jumatatu ijayo saa nne asubuhi."', // needs native speaker review
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Retrieves the correct language variant and replaces {placeholder} tokens.
 */
export function t(
  msg: BilingualMessage,
  lang: BookingLang,
  vars: Record<string, string> = {},
): string {
  let text = msg[lang] ?? msg.en;
  for (const [key, val] of Object.entries(vars)) {
    text = text.replaceAll(`{${key}}`, val);
  }
  return text;
}
