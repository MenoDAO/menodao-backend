import type {
  BotActionName,
  IntentClassification,
  IntentDataScope,
  IntentType,
} from './intent.types';

interface Rule {
  intent: IntentType;
  patterns: RegExp[];
  action?: BotActionName;
  scope?: IntentDataScope;
}

/**
 * Deterministic fallback used when the LLM classifier is unavailable or returns
 * unusable JSON. It is intentionally ordered: safety and explicit requests win
 * over broad topic keywords, and availability is checked before booking so
 * "what slots are free?" never falls into the booking state machine.
 */
const RULES: Rule[] = [
  {
    intent: 'HUMAN_HANDOFF',
    patterns: [
      /\b(human|real person|agent|manager|supervisor|call me|phone me|talk to someone)\b/,
      /\b(mtu|mtaalamu|meneja|nipigie|nizungumze na mtu)\b/,
      /\b(you are not helping|bot is useless|stop the bot)\b/,
    ],
    action: 'ESCALATE_TO_HUMAN',
  },
  {
    intent: 'COMPLAINT_OR_FEEDBACK',
    patterns: [
      /\b(complaint|complain|not happy|unhappy|bad service|poor service|rude|waited (for )?(hours|too long)|terrible|worst)\b/,
      /\b(malalamiko|lalamika|huduma mbaya|nilikuwa nasubiri)\b/,
      /\b(feedback|compliment|well done|great service|asante sana)\b/,
    ],
    action: 'LOG_FEEDBACK',
  },
  {
    intent: 'APPOINTMENT_MANAGEMENT',
    patterns: [
      /\b(cancel|reschedule|move|change|shift)\b.*\b(appointment|booking|miadi)\b/,
      /\b(appointment|booking|miadi)\b.*\b(cancel|reschedule|move|change|status|confirmed|went through)\b/,
      /\bmy (appointment|booking|miadi)\b/,
      /\b(kufuta|badilisha|hamisha)\b.*\b(miadi)\b/,
    ],
  },
  {
    intent: 'AVAILABILITY_INQUIRY',
    patterns: [
      /\b(available|availability|open slot|open slots|free slot|free slots|free time|openings?)\b/,
      /\b(what|which) (time|times|day|days)\b.*\b(free|open|available)\b/,
      /\b(when are you|when is the clinic|are you) (open|free|available)\b/,
      /\b(working|office|opening) hours\b/,
      /\b(any|is there) (space|room|slot)\b/,
      /\b(nafasi gani|nafasi zipo|kuna nafasi|mnafungua saa ngapi|muda gani)\b/,
    ],
    action: 'GET_AVAILABILITY',
  },
  {
    intent: 'BOOKING_SESSION',
    patterns: [
      /\b(book|booking|schedule|reserve|appointment)\b/,
      /\b(i want to come|can i come|book me)\b/,
      /\b(miadi|kupanga|nataka kuja|nipange)\b/,
    ],
    action: 'START_BOOKING',
  },
  {
    intent: 'CLINICAL_INTAKE',
    patterns: [
      /\b(pain|ache|aching|hurts?|sore|tender|toothache|bleed(ing)?|swell(ing|ed)?|abscess|broken tooth|knocked out|trauma|sensitive|ulcer|pus)\b/,
      /\b(tooth|teeth|gum|gums)\b.*\b(sore|hurt|ache|pain|bleed|swollen|sensitive)\b/,
      /\b(maumivu|jino|jino linauma|meno|ufizi|damu|uvimbe|kuuma|tibu|naniuma|linaniuma|yananiuma)\b/,
      /\b(can'?t (eat|sleep|chew)|difficulty (eating|swallowing|breathing))\b/,
    ],
  },
  {
    intent: 'PREPARATION_AND_AFTERCARE',
    patterns: [
      /\b(before|after)\b.*\b(visit|procedure|extraction|filling|root canal|cleaning|scaling|surgery)\b/,
      /\b(aftercare|after care|recovery|what should i eat|can i (eat|drink|smoke))\b/,
      /\b(baada ya|kabla ya)\b.*\b(jino|kutoa|kufunga|kliniki)\b/,
    ],
  },
  {
    intent: 'PRICING_AND_COVERAGE',
    patterns: [
      /\b(price|prices|cost|costs|fee|fees|charge|charges|how much|quote)\b/,
      /\b(insurance|cover(ed|age)?|tier|bronze|silver|gold|membership plan|bima)\b/,
      /\b(bei|gharama|shilingi|pesa ngapi)\b/,
    ],
  },
  {
    intent: 'CLINIC_INFO',
    patterns: [
      /\b(where (is|are)|location|directions?|address|branch|branches|parking|accessible)\b/,
      /\b(clinic|hospital)\b.*\b(near|in|at|around)\b/,
      /\b(iko wapi|mahali|tawi|kliniki yenu)\b/,
    ],
  },
  {
    intent: 'PROCEDURE_EXPLAINER',
    patterns: [
      /\b(what is|what happens during|how does|explain)\b.*\b(root canal|extraction|filling|cleaning|scaling|braces|implant|wisdom tooth|crown|denture|bridge)\b/,
      /\b(is|are)\b.*\b(painful|safe|necessary)\b/,
      /\b(kutoa jino|kuzima jino|kufunga jino|meno ya hekima)\b/,
    ],
  },
  {
    intent: 'ACCOUNT_AND_BILLING',
    patterns: [
      /\bmy (account|membership|subscription|payment|payments|balance|receipt|claim|claims|plan)\b/,
      /\b(have i paid|did i pay|am i paid up|account status|claim status)\b/,
      /\b(akaunti|malipo|bima yangu|risiti|madai)\b/,
    ],
    action: 'GET_MY_RECORDS',
  },
  {
    intent: 'HEALTH_EDUCATION',
    patterns: [
      /\b(brush|brushing|floss|flossing|toothpaste|fluoride|plaque|tartar|bad breath|diet|sugar|baby teeth|milk teeth|oral health|hygiene)\b/,
      /\b(mswaki|kupiga mswaki|meno ya mtoto|harufu|sukari|afya ya kinywa)\b/,
      /\b(why|how|should i)\b.*\b(teeth|gums|mouth|dental)\b/,
    ],
  },
  {
    intent: 'GENERAL_CONVERSATION',
    patterns: [
      /^\s*(hi|hello|hey|habari|jambo|mambo|salama|asante|thanks|thank you|ok|okay|sawa|good (morning|afternoon|evening))\b/,
    ],
  },
];

/**
 * Explicit request to lock an appointment. If this is present, the member is
 * allowed to skip triage and go straight to the booking state machine.
 */
const EXPLICIT_BOOKING_RE =
  /\b(book|booking|schedule|reserve|appointment|miadi|nipange|nataka kuja|nafasi)\b/;

const SYMPTOM_RE =
  /\b(sore|aching|ache|pain|painful|hurts?|tender|toothache|bleed(ing)?|swell(ing|ed)?|sensitive|abscess|pus|trauma|maumivu|kuuma|naniuma|linaniuma|yananiuma|uvimbe|ufizi|damu)\b/;

/**
 * A symptom-only message must never be treated as a booking request. This is a
 * deterministic guard over the LLM classifier, not a replacement for it.
 */
export function isSymptomOnlyMessage(transcript: string): boolean {
  const text = (transcript ?? '').toLowerCase().trim();
  return SYMPTOM_RE.test(text) && !EXPLICIT_BOOKING_RE.test(text);
}

const PHONE_RE = /(?:\+?254|0)?7\d{2}[\s-]?\d{3}[\s-]?\d{3}/;

export function fallbackClassification(
  transcript: string,
): IntentClassification {
  const text = (transcript || '').toLowerCase().trim();
  if (!text) {
    return { intent: 'GENERAL_CONVERSATION', confidence: 0.4 };
  }

  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      const scope =
        rule.intent === 'ACCOUNT_AND_BILLING'
          ? (detectScope(text) ?? rule.scope)
          : rule.scope;
      return {
        intent: rule.intent,
        confidence: 0.72,
        action: rule.action ?? null,
        entities: scope ? { scope } : undefined,
        reasoning: 'fallback_rule_match',
      };
    }
  }

  // A phone number plus record language is a staff lookup attempt.
  if (
    PHONE_RE.test(text) &&
    /\b(member|account|record|look ?up|check)\b/.test(text)
  ) {
    return {
      intent: 'ADMIN_DATA_REQUEST',
      confidence: 0.6,
      action: 'GET_MEMBER_RECORDS',
      entities: { memberPhone: text.match(PHONE_RE)?.[0] },
      reasoning: 'fallback_phone_lookup',
    };
  }

  return { intent: 'HEALTH_EDUCATION', confidence: 0.55 };
}

export function detectScope(text: string): IntentDataScope | null {
  if (
    /\b(payment|payments|paid|pay|contribution|receipt|transaction|malipo|risiti)\b/.test(
      text,
    )
  )
    return 'PAYMENTS';
  if (/\b(appointment|appointments|booking|bookings|miadi)\b/.test(text))
    return 'APPOINTMENTS';
  if (
    /\b(visit|visits|treatment|treatments|procedure|procedures|matibabu)\b/.test(
      text,
    )
  )
    return 'VISITS';
  if (/\b(claim|claims|madai)\b/.test(text)) return 'CLAIMS';
  if (
    /\b(account|membership|subscription|plan|profile|akaunti|bima)\b/.test(text)
  )
    return 'ACCOUNT';
  return null;
}
