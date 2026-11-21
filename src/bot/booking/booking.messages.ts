/**
 * booking.messages.ts
 *
 * All user-facing strings for the booking flow.
 * Each key has an English (en) and Swahili (sw) variant.
 *
 * The booking state machine still needs concrete details, but the copy reads
 * like a helpful person rather than a numbered form. Users can answer with a
 * name or a number; the parser accepts both.
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
  '🦷 What can I help with today? A cleaning, check-up, filling, extraction, whitening, or X-ray?',
  "🦷 Ni huduma gani unahitaji leo? Kusafisha meno, ukaguzi, kuziba jino, kung'oa jino, kupamba meno, au X-ray?",
);

export const ASK_SERVICE_CHOICE = msg(
  '🦷 The services here are {serviceList}. Which one would you like?',
  '🦷 Huduma zilizopo ni {serviceList}. Unataka ipi?',
);

export const ASK_DATE_TIME = msg(
  '📅 When would you like to come in? For example, "tomorrow around 10 AM" or "Monday the 26th at 2 PM".',
  '📅 Ungependa kuja siku na wakati gani? Kwa mfano, "kesho saa nne asubuhi" au "Jumatatu tarehe 26 saa nane mchana".',
);

export const ASK_NAME = msg(
  '👤 What name should I put on the appointment?',
  '👤 Nitatumia jina gani kwa miadi hii?',
);

// ── Clinic choice ─────────────────────────────────────────────────────────────

export const ASK_CLINIC = msg(
  '🏥 Which clinic suits you best? {clinicList}',
  '🏥 Ni kliniki ipi inakufaa zaidi? {clinicList}',
);

export const ASK_DOCTOR = msg(
  '🦷 Is there a doctor you prefer? {doctorList} You can also just tell me the name.',
  '🦷 Kuna daktari unayempendelea? {doctorList} Unaweza pia kunitajia jina lake tu.',
);

export const CLINIC_NOT_FOUND = msg(
  '🏥 I couldn\'t find a clinic called "{name}". The clinics we have are {clinicList}. Which one would you like?',
  '🏥 Sikupata kliniki yenye jina "{name}". Kliniki zilizopo ni {clinicList}. Unataka ipi?',
);

// ── Service choice ────────────────────────────────────────────────────────────

export const SERVICE_NOT_OFFERED = msg(
  '🦷 "{service}" isn\'t offered at {clinic}. They do {serviceList}. Which one would you like?',
  '🦷 "{service}" haifanyiki kwa {clinic}. Wao hufanya {serviceList}. Unataka ipi?',
);

export const BOOKING_UNAVAILABLE = msg(
  "📅 Online booking isn't open just yet. For now, please call one of our clinics directly: Palm Beach Hospital or Mikindani Hospital.",
  '📅 Kuweka miadi mtandaoni bado hakufunguliwa. Kwa sasa, tafadhali piga simu moja ya kliniki zetu moja kwa moja: Palm Beach Hospital au Mikindani Hospital.',
);

// ── Slot validation errors ────────────────────────────────────────────────────

export const SLOT_PAST = msg(
  '⏰ That time has already passed. Could you give me another date and time?',
  '⏰ Wakati huo umepita. Unaweza kunipa tarehe na wakati mwingine?',
);

export const SLOT_CLOSED_DAY = msg(
  "📅 The clinic is closed on {dayName}. We're open on {openDays}. What day works for you?",
  '📅 Kliniki imefungwa {dayName}. Tunafungua {openDays}. Siku gani inakufaa?',
);

export const SLOT_OUTSIDE_HOURS = msg(
  "🕐 We're open {openTime} to {closeTime}. Could you choose a time in between?",
  '🕐 Kliniki inafungua {openTime} hadi {closeTime}. Unaweza kuchagua wakati ndani ya hayo?',
);

export const SLOT_NOT_ON_BOUNDARY = msg(
  '🕐 We book appointments every {slotMinutes} minutes. The nearest time is {nearestSlot}. Does that work?',
  '🕐 Miadi huwekwa kila dakika {slotMinutes}. Nafasi iliyo karibu ni {nearestSlot}. Inakufaa?',
);

export const SLOT_TAKEN = msg(
  '📅 That time is already taken. The next free times are:\n{alternatives}\nWhich one works for you?',
  '📅 Wakati huo umeshachukuliwa. Nafasi zinazofuata ni:\n{alternatives}\nIpi inakufaa?',
);

// ── Read-back / confirmation ──────────────────────────────────────────────────

export const READ_BACK = msg(
  '📋 Let me check the details with you:\n\n🦷 *Service:* {service}\n📅 *Date:* {date}\n🕐 *Time:* {time}\n🏥 *Clinic:* {clinic}\n👤 *Name:* {name}\n🦷 *Doctor:* {doctor}\n\nDoes everything look right? (Yes / No)\n\n_Replying Yes lets us share these details with the clinic._',
  '📋 Tafadhali angalia maelezo ya miadi yako:\n\n🦷 *Huduma:* {service}\n📅 *Tarehe:* {date}\n🕐 *Wakati:* {time}\n🏥 *Kliniki:* {clinic}\n👤 *Jina:* {name}\n🦷 *Daktari:* {doctor}\n\nYote ni sawa? (Ndiyo / Hapana)\n\n_Kwa kujibu Ndiyo, unakubali maelezo haya kushirikiwa na kliniki._',
);

export const BOOKING_AWAITING_CONFIRMATION = msg(
  "Your appointment isn't confirmed yet. Reply *Yes* to confirm, or *No* to cancel.",
  'Miadi yako bado haijathibitishwa. Jibu *Ndiyo* kuthibitisha, au *Hapana* kuifuta.',
);

export const BOOKING_CONFIRMED = msg(
  "✅ *You're booked!*\n\n📋 *Name:* {name}\n🦷 *Service:* {service}\n📅 *Date:* {date}\n🕐 *Time:* {time}\n🏥 *Clinic:* {clinic}\n\nYour reference is *#{ref}*. See you soon 😊",
  '✅ *Miadi imethibitishwa!*\n\n📋 *Jina:* {name}\n🦷 *Huduma:* {service}\n📅 *Tarehe:* {date}\n🕐 *Wakati:* {time}\n🏥 *Kliniki:* {clinic}\n\nNambari yako ya rejea ni *#{ref}*. Tutaonana hivi karibuni 😊',
);

// ── Emergency ────────────────────────────────────────────────────────────────

export const EMERGENCY_GUIDANCE = msg(
  "🚨 *This sounds urgent.* Please go to the nearest clinic now or call emergency services.\n\nOur clinic: {clinicName}. Call {clinicPhone}.\n\nPlease don't wait. I'm flagging your message for urgent review.",
  '🚨 *Hii inaonekana ya dharura.* Tafadhali nenda kliniki iliyo karibu sasa au piga huduma ya dharura.\n\nKliniki yetu: {clinicName}. Piga {clinicPhone}.\n\nUsisubiri. Nimeashiria ujumbe wako kwa tathmini ya haraka.',
);

// ── Cancellation ─────────────────────────────────────────────────────────────

export const BOOKING_CANCELLED = msg(
  "👍 No problem, I've cancelled that booking request. Tell me if you want to start again.",
  '👍 Sawa, nimeifuta ombi hilo la miadi. Niambie ukitaka kuanza tena.',
);

// ── Parse failure / retry ─────────────────────────────────────────────────────

export const PARSE_FAILURE = msg(
  '😅 Sorry, I didn\'t catch that. Could you say it another way? For example: "I\'d like a cleaning next Monday at 10 AM."',
  '😅 Samahani, sikukamata vizuri. Unaweza kusema kwa njia nyingine? Kwa mfano: "Nataka kusafisha meno Jumatatu ijayo saa nne asubuhi."',
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
