/**
 * English message catalogue for MenoAI WhatsApp chatbot.
 * All user-facing strings live here — no string literals in flow files.
 * Functions accept parameters and return formatted strings.
 */

// ─── Welcome & Main Menu ──────────────────────────────────────────────────────

export const welcome = (name?: string): string =>
  name
    ? `👋 Welcome back, *${name}*! I'm MenoAI, your MenoDAO dental assistant.\n\nHow can I help you today?`
    : `👋 Welcome to *MenoAI*, your MenoDAO dental assistant!\n\nHow can I help you today?`;

export const mainMenu = (name?: string): string =>
  `${name ? `Hi *${name}*! ` : ''}Here's what I can help you with:\n\nReply with a number or tap an option below.`;

export const mainMenuSections = {
  accountTitle: 'Account',
  servicesTitle: 'Services',
  rows: {
    subscription: {
      id: 'menu_1',
      title: 'My Subscription',
      description: 'View or upgrade your plan',
    },
    findClinic: {
      id: 'menu_2',
      title: 'Find a Clinic',
      description: 'Locate a MenoHub near you',
    },
    submitClaim: {
      id: 'menu_3',
      title: 'Submit a Claim',
      description: 'Check claim eligibility',
    },
    dentalHelp: {
      id: 'menu_4',
      title: 'Dental Health Help',
      description: 'Ask MenoAI a question',
    },
    talkDentist: {
      id: 'menu_5',
      title: 'Talk to a Dentist',
      description: 'Connect with a professional',
    },
    visitHistory: {
      id: 'menu_6',
      title: 'Visit History',
      description: 'Past dental visits',
    },
    referrals: {
      id: 'menu_7',
      title: 'My Referrals',
      description: 'Champion programme stats',
    },
    blockchain: {
      id: 'menu_8',
      title: 'Activity History',
      description: 'Verified care records',
    },
    accountSettings: {
      id: 'menu_9',
      title: 'Account Settings',
      description: 'Profile, language, payments',
    },
  },
  buttonLabel: 'View Options',
  header: 'MenoAI — Your Dental Assistant',
};

// ─── Registration ─────────────────────────────────────────────────────────────

export const registrationPrompt =
  `It looks like your phone number isn't registered with MenoDAO yet.\n\n` +
  `Please sign up at 👉 https://app.menodao.org to get started.\n\n` +
  `Would you like me to send you the link?`;

export const registrationLink =
  'Here is your registration link: https://app.menodao.org 🦷';

// ─── Generic / System ─────────────────────────────────────────────────────────

export const genericError =
  `Sorry, something went wrong on our end. Please try again in a moment.\n\n` +
  `If the problem persists, type *menu* to start over or reply *5* to speak with a dentist.`;

export const rateLimitMessage = `⏳ You're sending messages a bit too fast. Please wait a moment before trying again.`;

export const fallbackLlm = `I'm having trouble connecting right now. Would you like to speak with a human dentist instead?\n\nReply *5* or type *dentist*.`;

export const unrecognisedInput = `I didn't quite understand that. Here's the main menu — please choose an option:`;

export const sessionExpired = `Your session has expired due to inactivity. Let's start fresh! 👋`;

// ─── Subscription Flow ────────────────────────────────────────────────────────

export const subscription = {
  viewActive: (
    tier: string,
    status: string,
    capUsed: number,
    capLimit: number,
    waitingPeriodActive: boolean,
    eligibleDate?: string,
  ): string => {
    const capLine = `💰 Annual cap: KES ${capUsed.toLocaleString()} used of KES ${capLimit.toLocaleString()}`;
    const waitingLine =
      waitingPeriodActive && eligibleDate
        ? `⏳ Waiting period: Active — eligible to claim from *${eligibleDate}*`
        : `✅ Waiting period: Complete — you can claim now`;
    return (
      `📋 *Your Subscription*\n\n` +
      `Plan: *${tier}*\n` +
      `Status: *${status}*\n` +
      `${capLine}\n` +
      `${waitingLine}\n\n` +
      `Would you like to upgrade your plan?`
    );
  },

  viewInactive:
    `You don't have an active subscription yet.\n\n` +
    `Choose a plan below to get started with MenoDAO dental cover:`,

  selectTierPrompt: 'Please select a subscription tier:',

  tierOption: (
    tier: string,
    monthlyPrice: number,
    annualPrice: number,
    benefits: string[],
  ): string =>
    `*${tier}*\n` +
    `Monthly: KES ${monthlyPrice.toLocaleString()} | Annual: KES ${annualPrice.toLocaleString()}\n` +
    `Benefits: ${benefits.join(', ')}`,

  selectFrequencyPrompt: (tier: string): string =>
    `You selected *${tier}*. How would you like to pay?`,

  frequencyMonthly: (price: number): string =>
    `Monthly — KES ${price.toLocaleString()}`,
  frequencyAnnual: (price: number): string =>
    `Annual — KES ${price.toLocaleString()} (save 2 months)`,

  paymentConfirmPrompt: (
    tier: string,
    frequency: string,
    amount: number,
  ): string =>
    `You selected *${tier}* (${frequency} — KES ${amount.toLocaleString()}).\n\nAn M-Pesa STK Push will be sent to your phone. Confirm to proceed.`,

  stkPushSent: `📱 Check your phone for the M-Pesa payment prompt.\n\nI'll confirm your subscription once payment is received (up to 3 minutes).`,

  paymentSuccess: (tier: string, eligibleDate: string): string =>
    `🎉 *Payment confirmed!*\n\nYour *${tier}* subscription is now active.\nYou can start claiming from *${eligibleDate}*.\n\nType *menu* to return to the main menu.`,

  paymentFailed: `❌ Payment was not successful. Please try again.\n\nWould you like to select a different plan or retry?`,

  paymentTimeout: `⏰ We didn't receive payment confirmation within 3 minutes.\n\nWould you like to try again?`,

  upgradePrompt: (currentTier: string): string =>
    `You're currently on *${currentTier}*. Would you like to upgrade to a higher tier?`,

  upgradeConfirm: (newTier: string, amount: number): string =>
    `Upgrading to *${newTier}* will cost an additional KES ${amount.toLocaleString()}.\n\nConfirm to proceed with the M-Pesa payment.`,

  pollingMessage: (attempt: number, max: number): string =>
    `⏳ Waiting for payment confirmation... (${attempt}/${max})`,
};

// ─── Clinic Flow ──────────────────────────────────────────────────────────────

export const clinic = {
  promptLocation: `📍 *Find a MenoHub Clinic*\n\nPlease share your WhatsApp location or type your sub-county name to find the nearest clinic.`,

  noResults: `😔 No approved clinics were found for your location.\n\nPlease check back later or contact support at support@menodao.org.`,

  resultsHeader: (count: number): string =>
    `🏥 Found *${count}* clinic${count !== 1 ? 's' : ''} near you:\n`,

  clinicEntry: (
    index: number,
    name: string,
    address: string,
    hours: string,
    phone?: string,
    mapsLink?: string,
  ): string => {
    let entry = `*${index}. ${name}*\n📍 ${address}\n🕐 ${hours}`;
    if (phone) entry += `\n📞 ${phone}`;
    if (mapsLink) entry += `\n🗺️ ${mapsLink}`;
    return entry;
  },

  searchAgainPrompt:
    'Would you like to search again or return to the main menu?',
  searchAgainButton: 'Search Again',
};

// ─── Claims Flow ──────────────────────────────────────────────────────────────

export const claims = {
  noSubscription: `You need an active subscription to submit a claim.\n\nWould you like to view available plans?`,

  inWaitingPeriod: (eligibleDate: string): string =>
    `⏳ You're currently in your waiting period.\n\nYou'll be eligible to make claims from *${eligibleDate}*.\n\nIs there anything else I can help you with?`,

  eligible: `✅ You're eligible to make a claim!\n\nClaims must be submitted at a *MenoHub clinic* by your attending dentist.\n\nWould you like me to find the nearest clinic?`,

  statusHeader: '📋 *Your Recent Claims*\n',

  claimEntry: (
    date: string,
    status: string,
    amount: number,
    description?: string,
  ): string => {
    let entry = `• *${date}* — ${status}\n  Amount: KES ${amount.toLocaleString()}`;
    if (description) entry += `\n  ${description}`;
    return entry;
  },

  capBalance: (used: number, limit: number): string =>
    `\n💰 Annual cap remaining: KES ${(limit - used).toLocaleString()} of KES ${limit.toLocaleString()}`,

  noClaims: 'You have no claims on record yet.',
};

// ─── Dental AI Flow ───────────────────────────────────────────────────────────

export const dentalAi = {
  intro: `🦷 *Dental Health Help*\n\nAsk me any dental health question and I'll do my best to help!\n\nType your question below.`,

  disclaimer: `\n\n_⚠️ This is general health information only and does not replace professional dental advice._`,

  clinicOffer: `\n\nWould you like me to find a nearby MenoHub clinic, or connect you with a dentist?`,

  escalationOffer: `\n\nWould you like to speak with a human dentist? Reply *5* or type *dentist*.`,

  continuePrompt:
    'Feel free to ask another dental question, or type *menu* to return to the main menu.',
};

// ─── Escalation Flow ─────────────────────────────────────────────────────────

export const escalation = {
  optionsPrompt: `👨‍⚕️ *Talk to a Dentist*\n\nHow would you like to connect?`,

  optionWhatsApp: {
    id: 'escalate_whatsapp',
    title: 'WhatsApp Dentist',
    description: 'Connect via WhatsApp',
  },
  optionClinic: {
    id: 'escalate_clinic',
    title: 'Find a Clinic',
    description: 'Visit a MenoHub near you',
  },

  whatsAppContact: (contactNumber: string): string =>
    `📱 You can reach our partner dentist on WhatsApp:\n*${contactNumber}*\n\nA human will respond within 24 hours during business hours (8am–6pm EAT, Mon–Sat).`,

  fallbackContact: (email: string): string =>
    `📧 Please contact our support team at *${email}* or visit https://app.menodao.org for assistance.\n\nWe'll respond within 24 hours during business hours (8am–6pm EAT, Mon–Sat).`,

  initiated: `✅ Escalation initiated. A human will be in touch with you shortly.\n\nType *menu* to return to the main menu.`,
};

// ─── Visit History Flow ───────────────────────────────────────────────────────

export const visitHistory = {
  header: '🗓️ *Your Recent Dental Visits*\n',

  visitEntry: (
    index: number,
    date: string,
    clinic: string,
    dentist: string,
    procedures: string,
    costCovered: number,
  ): string =>
    `*${index}. ${date}*\n` +
    `🏥 ${clinic}\n` +
    `👨‍⚕️ Dr. ${dentist}\n` +
    `🦷 ${procedures}\n` +
    `💰 Covered: KES ${costCovered.toLocaleString()}`,

  hypercertVerified: (_tokenId: string, metadataUrl: string): string =>
    metadataUrl
      ? `✅ *Verified Care Record*\nView details: ${metadataUrl}`
      : `✅ *Verified Care Record*`,

  hypercertPending: `⏳ Verification of this visit's care record is in progress.`,

  noVisits: `You don't have any recorded dental visits yet.\n\nVisit a *MenoHub clinic* to get started with your dental care journey! 🦷`,

  footer: '\nType *menu* to return to the main menu.',
};

// ─── Referrals Flow ───────────────────────────────────────────────────────────

export const referrals = {
  header: '🏆 *Your Champion Referral Stats*\n',

  statsActive: (code: string, count: number, rewards: string): string =>
    `Referral code: *${code}*\n` +
    `People referred: *${count}*\n` +
    `Rewards earned: *${rewards}*`,

  statsEmpty: (code: string): string =>
    `Your referral code: *${code}*\n\n` +
    `You haven't referred anyone yet — but you can start now! 🚀\n\n` +
    `Share your code with friends and earn rewards when they subscribe to MenoDAO.`,

  shareableMessage: (code: string): string =>
    `Hey! I'm using MenoDAO for affordable dental care in Kenya. Use my referral code *${code}* when you sign up at https://app.menodao.org and we both benefit! 🦷`,

  sharePrompt:
    'Would you like me to send you a shareable message with your referral code?',
  shareButton: 'Share My Code',

  footer: '\nType *menu* to return to the main menu.',
};

// ─── Blockchain Flow ──────────────────────────────────────────────────────────

export const blockchain = {
  header: '📋 *Your Verified Care Records*\n',

  nftEntry: (_tokenId: string, date: string, metadataUrl: string): string =>
    `✅ *Verified Visit*\n` +
    `Visit date: ${date}\n` +
    (metadataUrl ? `View details: ${metadataUrl}\n\n` : '\n') +
    `This is a verifiable record of your dental care at a MenoHub clinic.`,

  txEntry: (type: string, amount: number, maskedHash: string): string =>
    `• ${type} — KES ${amount.toLocaleString()}\n  Ref: ${maskedHash}`,

  txHeader: '\n📜 *Payment & Contribution History*\n',

  nftHoldings: (count: number): string =>
    `\n🎖️ You have *${count}* verified care record${count !== 1 ? 's' : ''}.`,

  rejectedVisit: `⚠️ Verification for one of your visits could not be completed.\n\nPlease contact support at support@menodao.org if you believe this is an error.`,

  noRecords:
    `You don't have any verified care records yet.\n\n` +
    `Here's how it works:\n` +
    `1️⃣ You visit a MenoHub clinic\n` +
    `2️⃣ Your treatment is reviewed and verified\n` +
    `3️⃣ A secure care record is created for your visit\n` +
    `4️⃣ You can view your verified visits anytime in Visit History 🦷`,

  footer: '\nType *menu* to return to the main menu.',
};

// ─── Account Settings Flow ────────────────────────────────────────────────────

export const accountSettings = {
  menuPrompt: '⚙️ *Account Settings*\n\nWhat would you like to do?',

  optionProfile: {
    id: 'account_profile',
    title: 'View Profile',
    description: 'Your account details',
  },
  optionLanguage: {
    id: 'account_language',
    title: 'Change Language',
    description: 'Switch to English or Swahili',
  },
  optionPaymentHistory: {
    id: 'account_payments',
    title: 'Payment History',
    description: 'Last 5 contributions',
  },

  profile: (
    name: string,
    maskedPhone: string,
    tier: string,
    memberSince: string,
  ): string =>
    `👤 *Your Profile*\n\n` +
    `Name: *${name}*\n` +
    `Phone: *${maskedPhone}*\n` +
    `Plan: *${tier}*\n` +
    `Member since: *${memberSince}*`,

  languagePrompt: '🌐 *Change Language*\n\nWhich language would you prefer?',
  languageEnglish: { id: 'lang_en', title: 'English' },
  languageSwahili: { id: 'lang_sw', title: 'Kiswahili' },
  languageUpdated: (lang: string): string =>
    `✅ Language updated to *${lang}*. All messages will now be in ${lang}.`,

  paymentHistoryHeader: '💳 *Payment History*\n',
  paymentEntry: (date: string, amount: number, status: string): string =>
    `• *${date}* — KES ${amount.toLocaleString()} (${status})`,
  noPayments: 'No payment history found.',

  footer: '\nType *menu* to return to the main menu.',
};

// ─── Navigation ───────────────────────────────────────────────────────────────

export const navigation = {
  backButton: '⬅️ Back',
  cancelButton: '❌ Cancel',
  menuButton: '🏠 Main Menu',
  confirmButton: '✅ Confirm',
  retryButton: '🔄 Retry',
  findClinicButton: '📍 Find a Clinic',
  yesButton: '✅ Yes',
  noButton: '❌ No',
};
