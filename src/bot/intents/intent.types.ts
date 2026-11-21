/**
 * The bot's intent taxonomy.
 *
 * The first four intents are the original routing paths (booking, availability,
 * clinical intake, education). The rest exist because real members ask for
 * things that do not fit those four: prices, directions, procedure explanations,
 * aftercare, account questions, complaints, and staff requests. Keeping them
 * explicit makes routing predictable and keeps the LLM from forcing every
 * message into "book" or "education".
 *
 * Each intent maps to exactly one downstream behaviour. Intents never carry
 * permission on their own — privileged work is executed through the bounded
 * action registry, which enforces capabilities server-side.
 */
export const BOT_INTENT_DEFINITIONS = {
  BOOKING_SESSION: {
    description:
      'The user wants to create a specific appointment now (date/time/service/clinic), or is mid-way through a booking and answering booking questions.',
    examples: [
      'book me a cleaning on Saturday at 10',
      'nataka kupanga miadi kesho asubuhi',
      'can I come in next Monday?',
    ],
  },
  AVAILABILITY_INQUIRY: {
    description:
      'The user asks which times/slots are free, when a clinic or doctor is open, or whether there is space on a day/week, without asking to lock a specific slot yet.',
    examples: [
      'what slots are open at Mikindani this week?',
      'are you free tomorrow afternoon?',
      'mna nafasi gani wiki hii?',
    ],
  },
  APPOINTMENT_MANAGEMENT: {
    description:
      'The user wants to view, reschedule, or cancel an existing appointment, or asks whether a booking went through. These actions need the member to be verified.',
    examples: [
      'cancel my appointment',
      'move my Friday booking to Monday',
      'did my booking go through?',
      'nataka kubadilisha miadi yangu',
    ],
  },
  CLINICAL_INTAKE: {
    description:
      'The user describes active personal pain, bleeding, swelling, trauma, or another symptom and is not asking for a specific slot. This is triage, not general education.',
    examples: [
      'my tooth has been aching for three days',
      'my gum is bleeding and my face is swollen',
      'jino linaniuma sana',
    ],
  },
  HEALTH_EDUCATION: {
    description:
      'A general oral-health question: brushing, flossing, diet, children’s teeth, bad breath, prevention, or how a common dental concept works.',
    examples: [
      'how often should I brush?',
      'why do my gums bleed when I floss?',
      'je, ni mswaki gani bora?',
    ],
  },
  PRICING_AND_COVERAGE: {
    description:
      'The user asks about cost, fees, payment plans, insurance, membership tiers, or whether a treatment is covered.',
    examples: [
      'how much is a filling?',
      'does Gold cover extractions?',
      'bei ya kusafisha meno ni ngapi?',
    ],
  },
  CLINIC_INFO: {
    description:
      'The user asks where a clinic is, for directions, branches, opening hours, phone/WhatsApp contacts, parking, or accessibility.',
    examples: [
      'where is your Mikindani clinic?',
      'which branches do you have in Mombasa?',
      'kliniki yenu iko wapi?',
    ],
  },
  PROCEDURE_EXPLAINER: {
    description:
      'The user asks what a named procedure is, why it is done, how long it takes, or what to expect, without describing their own active emergency.',
    examples: [
      'what happens during a root canal?',
      'is scaling painful?',
      'kutoa jino la hekima ni nini?',
    ],
  },
  PREPARATION_AND_AFTERCARE: {
    description:
      'The user asks how to prepare for a visit/procedure or what to do after one (eating, bleeding, pain, medication timing, when to call back).',
    examples: [
      'what should I eat after an extraction?',
      'can I drink tea before my filling?',
      'nifanye nini baada ya kutoa jino?',
    ],
  },
  ACCOUNT_AND_BILLING: {
    description:
      'The user asks about their own membership, payments, balance, receipts, claims, or account status. This needs verification before any record is shared.',
    examples: [
      'what is my membership status?',
      'have I paid this month?',
      'what happened to my claim?',
    ],
  },
  HUMAN_HANDOFF: {
    description:
      'The user explicitly asks for a person, a callback, a manager, or says the bot is not helping. Escalate rather than keep automating.',
    examples: [
      'can I talk to a human?',
      'please call me',
      'nataka mtu wa kuzungumza naye',
    ],
  },
  COMPLAINT_OR_FEEDBACK: {
    description:
      'The user reports a bad experience, complains about service or a clinic, or gives deliberate feedback/compliments.',
    examples: [
      'I waited two hours and nobody helped me',
      'the receptionist was rude',
      'asante, huduma ilikuwa nzuri',
    ],
  },
  ADMIN_DATA_REQUEST: {
    description:
      'A staff/admin sender asks for another member’s record or an operational lookup. This is privilege-gated and must never be answered from an unverified admin session.',
    examples: [
      'look up member 0712 345 678',
      'check the account for this phone number',
      'show me that member’s appointments',
    ],
  },
  GENERAL_CONVERSATION: {
    description:
      'Greetings, thanks, small talk, acknowledgements, or messages with no dental/account request. Reply warmly and offer a concrete next step.',
    examples: ['hi', 'habari', 'asante', 'ok', 'how are you?'],
  },
} as const;

export type IntentType = keyof typeof BOT_INTENT_DEFINITIONS;

export const INTENT_NAMES = Object.keys(BOT_INTENT_DEFINITIONS) as IntentType[];

/** Data scopes a member or admin may request. Mirrors MemberDataScope. */
export type IntentDataScope =
  | 'ACCOUNT'
  | 'PAYMENTS'
  | 'APPOINTMENTS'
  | 'VISITS'
  | 'CLAIMS';

/** Bounded action names the planner may choose. Execution is server-side only. */
export type BotActionName =
  | 'GET_AVAILABILITY'
  | 'START_BOOKING'
  | 'GET_MY_RECORDS'
  | 'GET_MEMBER_RECORDS'
  | 'ESCALATE_TO_HUMAN'
  | 'LOG_FEEDBACK';

export const BOT_ACTION_NAMES: BotActionName[] = [
  'GET_AVAILABILITY',
  'START_BOOKING',
  'GET_MY_RECORDS',
  'GET_MEMBER_RECORDS',
  'ESCALATE_TO_HUMAN',
  'LOG_FEEDBACK',
];

export interface IntentEntities {
  clinic?: string;
  doctor?: string;
  date?: string;
  time?: string;
  service?: string;
  memberPhone?: string;
  scope?: IntentDataScope;
}

export interface IntentClassification {
  intent: IntentType;
  confidence: number;
  /** Optional action the model believes should run now. Server validates it. */
  action?: BotActionName | null;
  entities?: IntentEntities;
  /** Short model rationale; logged, never shown to the member. */
  reasoning?: string;
}

export function normalizeIntent(raw: unknown): IntentType | null {
  if (typeof raw !== 'string') return null;
  const candidate = raw.trim().toUpperCase();
  return (INTENT_NAMES as string[]).includes(candidate)
    ? (candidate as IntentType)
    : null;
}

export function normalizeAction(raw: unknown): BotActionName | null {
  if (typeof raw !== 'string') return null;
  const candidate = raw.trim().toUpperCase();
  return (BOT_ACTION_NAMES as string[]).includes(candidate)
    ? (candidate as BotActionName)
    : null;
}

/**
 * Per-intent conversational guidance injected into the reply prompt. This is
 * what makes the bot answer the actual question instead of reciting a menu.
 */
export const INTENT_GUIDANCE: Record<IntentType, string> = {
  BOOKING_SESSION:
    'Help them finish the booking. Confirm what you already know, ask only for the one missing detail, and never claim a slot is reserved until the system confirms it.',
  AVAILABILITY_INQUIRY:
    'Answer with the real available times you were given. Do not list procedures or ask them to start a new booking unless they ask.',
  APPOINTMENT_MANAGEMENT:
    'They are asking about an existing appointment. Do not claim you changed or cancelled anything. Explain that you will verify them first, then help.',
  CLINICAL_INTAKE:
    'Start with genuine empathy for the discomfort, then ask one short triage question (how long, how severe, swelling or bleeding). Do not mention booking, availability or prices until the member asks or you understand the problem. Advise urgent care for red flags. Never diagnose or prescribe.',
  HEALTH_EDUCATION:
    'Teach the concept in plain language, give one practical action, and avoid lecturing. No diagnosis or prescriptions.',
  PRICING_AND_COVERAGE:
    'Use only verified prices/plans. Separate the consultation fee from procedure costs, say what the membership tier covers, and point to the app/site for the final quote. Never invent a price.',
  CLINIC_INFO:
    'Give the verified clinic name, area, hours, and contact. If they asked for directions, describe the landmark only if it is in your verified context; otherwise offer the clinic phone number.',
  PROCEDURE_EXPLAINER:
    'Explain what the procedure is, why it is recommended, roughly what the visit involves, and one aftercare point. Keep it calm and non-scary; no diagnosis.',
  PREPARATION_AND_AFTERCARE:
    'Give practical general guidance (eating, hygiene, rest, when to seek help). Be clear about red flags and avoid prescribing medication or exact doses.',
  ACCOUNT_AND_BILLING:
    'Use only the member’s verified records. If you do not have them, say verification is needed rather than guessing a balance or payment status.',
  HUMAN_HANDOFF:
    'Reassure them that a person will follow up, ask for the best time/number only if needed, and do not promise a specific response time.',
  COMPLAINT_OR_FEEDBACK:
    'Acknowledge the experience without defensiveness, apologise where appropriate, and say it is being escalated. Do not argue or explain internal processes.',
  ADMIN_DATA_REQUEST:
    'This is a privileged request. Never reveal another member’s data without a verified admin session. If verification is missing, tell them to send ADMIN and complete the SMS code.',
  GENERAL_CONVERSATION:
    'Reply warmly and briefly like a real person. Do not dump a menu; offer one concrete way you can help.',
};

export function intentGuidance(intent: IntentType): string {
  return INTENT_GUIDANCE[intent];
}
