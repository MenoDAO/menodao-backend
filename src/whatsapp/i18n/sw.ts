/**
 * Swahili (Kiswahili) message catalogue for MenoAI WhatsApp chatbot.
 * All keys and function signatures match en.ts exactly.
 */

// ─── Welcome & Main Menu ──────────────────────────────────────────────────────

export const welcome = (name?: string): string =>
  name
    ? `👋 Karibu tena, *${name}*! Mimi ni MenoAI, msaidizi wako wa meno wa MenoDAO.\n\nNinaweza kukusaidia vipi leo?`
    : `👋 Karibu *MenoAI*, msaidizi wako wa meno wa MenoDAO!\n\nNinaweza kukusaidia vipi leo?`;

export const mainMenu = (name?: string): string =>
  `${name ? `Habari *${name}*! ` : ''}Hapa kuna ninachoweza kukusaidia nacho:\n\nJibu kwa nambari au bonyeza chaguo hapa chini.`;

export const mainMenuSections = {
  accountTitle: 'Akaunti',
  servicesTitle: 'Huduma',
  rows: {
    subscription: {
      id: 'menu_1',
      title: 'Usajili Wangu',
      description: 'Angalia au boresha mpango wako',
    },
    findClinic: {
      id: 'menu_2',
      title: 'Tafuta Kliniki',
      description: 'Pata MenoHub karibu nawe',
    },
    submitClaim: {
      id: 'menu_3',
      title: 'Wasilisha Dai',
      description: 'Angalia ustahili wa dai',
    },
    dentalHelp: {
      id: 'menu_4',
      title: 'Msaada wa Meno',
      description: 'Uliza MenoAI swali',
    },
    talkDentist: {
      id: 'menu_5',
      title: 'Zungumza na Daktari',
      description: 'Unganika na mtaalamu',
    },
    visitHistory: {
      id: 'menu_6',
      title: 'Historia ya Ziara',
      description: 'Ziara za meno zilizopita',
    },
    referrals: {
      id: 'menu_7',
      title: 'Marejeo Yangu',
      description: 'Takwimu za mpango wa champion',
    },
    blockchain: {
      id: 'menu_8',
      title: 'Historia ya Shughuli',
      description: 'Rekodi za huduma zilizothibitishwa',
    },
    accountSettings: {
      id: 'menu_9',
      title: 'Mipangilio ya Akaunti',
      description: 'Wasifu, lugha, malipo',
    },
  },
  buttonLabel: 'Angalia Chaguo',
  header: 'MenoAI — Msaidizi Wako wa Meno',
};

// ─── Registration ─────────────────────────────────────────────────────────────

export const registrationPrompt =
  `Inaonekana nambari yako ya simu haijasajiliwa na MenoDAO bado.\n\n` +
  `Tafadhali jisajili kwenye 👉 https://app.menodao.org kuanza.\n\n` +
  `Ungependa nikutumie kiungo?`;

export const registrationLink =
  'Hapa kuna kiungo chako cha usajili: https://app.menodao.org 🦷';

// ─── Generic / System ─────────────────────────────────────────────────────────

export const genericError =
  `Samahani, kuna tatizo upande wetu. Tafadhali jaribu tena baada ya muda mfupi.\n\n` +
  `Ikiwa tatizo linaendelea, andika *menyu* kuanza upya au jibu *5* kuzungumza na daktari.`;

export const rateLimitMessage = `⏳ Unatuma ujumbe haraka sana. Tafadhali subiri kidogo kabla ya kujaribu tena.`;

export const fallbackLlm = `Nina tatizo la kuunganika sasa hivi. Ungependa kuzungumza na daktari wa meno?\n\nJibu *5* au andika *daktari*.`;

export const unrecognisedInput = `Sikuelewa vizuri. Hapa kuna menyu kuu — tafadhali chagua chaguo:`;

export const sessionExpired = `Kikao chako kimeisha kwa sababu ya kutofanya kazi. Tuanze upya! 👋`;

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
    const capLine = `💰 Kiwango cha mwaka: KES ${capUsed.toLocaleString()} imetumika kati ya KES ${capLimit.toLocaleString()}`;
    const waitingLine =
      waitingPeriodActive && eligibleDate
        ? `⏳ Kipindi cha kusubiri: Hai — unastahili kudai kuanzia *${eligibleDate}*`
        : `✅ Kipindi cha kusubiri: Kimekamilika — unaweza kudai sasa`;
    return (
      `📋 *Usajili Wako*\n\n` +
      `Mpango: *${tier}*\n` +
      `Hali: *${status}*\n` +
      `${capLine}\n` +
      `${waitingLine}\n\n` +
      `Ungependa kuboresha mpango wako?`
    );
  },

  viewInactive:
    `Bado huna usajili unaofanya kazi.\n\n` +
    `Chagua mpango hapa chini kuanza na bima ya meno ya MenoDAO:`,

  selectTierPrompt: 'Tafadhali chagua kiwango cha usajili:',

  tierOption: (
    tier: string,
    monthlyPrice: number,
    annualPrice: number,
    benefits: string[],
  ): string =>
    `*${tier}*\n` +
    `Kila mwezi: KES ${monthlyPrice.toLocaleString()} | Kila mwaka: KES ${annualPrice.toLocaleString()}\n` +
    `Faida: ${benefits.join(', ')}`,

  selectFrequencyPrompt: (tier: string): string =>
    `Umechagua *${tier}*. Ungependa kulipa vipi?`,

  frequencyMonthly: (price: number): string =>
    `Kila mwezi — KES ${price.toLocaleString()}`,
  frequencyAnnual: (price: number): string =>
    `Kila mwaka — KES ${price.toLocaleString()} (okoa miezi 2)`,

  paymentConfirmPrompt: (
    tier: string,
    frequency: string,
    amount: number,
  ): string =>
    `Umechagua *${tier}* (${frequency} — KES ${amount.toLocaleString()}).\n\nOmbi la malipo la M-Pesa litatumwa kwa simu yako. Thibitisha kuendelea.`,

  stkPushSent: `📱 Angalia simu yako kwa ombi la malipo la M-Pesa.\n\nNitathibitisha usajili wako mara malipo yatapopokelewa (hadi dakika 3).`,

  paymentSuccess: (tier: string, eligibleDate: string): string =>
    `🎉 *Malipo yamethibitishwa!*\n\nUsajili wako wa *${tier}* sasa unafanya kazi.\nUnaweza kuanza kudai kuanzia *${eligibleDate}*.\n\nAndika *menyu* kurudi kwenye menyu kuu.`,

  paymentFailed: `❌ Malipo hayakufanikiwa. Tafadhali jaribu tena.\n\nUngependa kuchagua mpango tofauti au kujaribu tena?`,

  paymentTimeout: `⏰ Hatukupokea uthibitisho wa malipo ndani ya dakika 3.\n\nUngependa kujaribu tena?`,

  upgradePrompt: (currentTier: string): string =>
    `Uko kwenye *${currentTier}* sasa hivi. Ungependa kuboresha kwenda kiwango cha juu zaidi?`,

  upgradeConfirm: (newTier: string, amount: number): string =>
    `Kuboresha kwenda *${newTier}* kutagharimu ziada ya KES ${amount.toLocaleString()}.\n\nThibitisha kuendelea na malipo ya M-Pesa.`,

  pollingMessage: (attempt: number, max: number): string =>
    `⏳ Ninasubiri uthibitisho wa malipo... (${attempt}/${max})`,
};

// ─── Clinic Flow ──────────────────────────────────────────────────────────────

export const clinic = {
  promptLocation: `📍 *Tafuta Kliniki ya MenoHub*\n\nTafadhali shiriki eneo lako la WhatsApp au andika jina la kata yako kupata kliniki iliyo karibu nawe.`,

  noResults: `😔 Hakuna kliniki zilizoidhinishwa zilizopatikana kwa eneo lako.\n\nTafadhali angalia tena baadaye au wasiliana na msaada kwa support@menodao.org.`,

  resultsHeader: (count: number): string =>
    `🏥 Kliniki *${count}* zilizopatikana karibu nawe:\n`,

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

  searchAgainPrompt: 'Ungependa kutafuta tena au kurudi kwenye menyu kuu?',
  searchAgainButton: 'Tafuta Tena',
};

// ─── Claims Flow ──────────────────────────────────────────────────────────────

export const claims = {
  noSubscription: `Unahitaji usajili unaofanya kazi ili kuwasilisha dai.\n\nUngependa kuona mipango inayopatikana?`,

  inWaitingPeriod: (eligibleDate: string): string =>
    `⏳ Uko katika kipindi chako cha kusubiri sasa hivi.\n\nUtastahili kudai kuanzia *${eligibleDate}*.\n\nKuna kitu kingine ninachoweza kukusaidia nacho?`,

  eligible: `✅ Unastahili kudai!\n\nMadai lazima yawasilishwe kwenye *kliniki ya MenoHub* na daktari wako wa meno.\n\nUngependa nikupate kliniki iliyo karibu nawe?`,

  statusHeader: '📋 *Madai Yako ya Hivi Karibuni*\n',

  claimEntry: (
    date: string,
    status: string,
    amount: number,
    description?: string,
  ): string => {
    let entry = `• *${date}* — ${status}\n  Kiasi: KES ${amount.toLocaleString()}`;
    if (description) entry += `\n  ${description}`;
    return entry;
  },

  capBalance: (used: number, limit: number): string =>
    `\n💰 Kiwango kilichobaki cha mwaka: KES ${(limit - used).toLocaleString()} kati ya KES ${limit.toLocaleString()}`,

  noClaims: 'Bado huna madai yaliyorekodiwa.',
};

// ─── Dental AI Flow ───────────────────────────────────────────────────────────

export const dentalAi = {
  intro: `🦷 *Msaada wa Afya ya Meno*\n\nNiulize swali lolote kuhusu afya ya meno na nitajaribu kukusaidia!\n\nAndika swali lako hapa chini.`,

  disclaimer: `\n\n_⚠️ Hii ni taarifa ya jumla ya afya tu na haibadilishi ushauri wa kitaalamu wa meno._`,

  clinicOffer: `\n\nUngependa nikupate kliniki ya MenoHub iliyo karibu nawe, au kukuunganisha na daktari?`,

  escalationOffer: `\n\nUngependa kuzungumza na daktari wa meno wa binadamu? Jibu *5* au andika *daktari*.`,

  continuePrompt:
    'Jisikie huru kuuliza swali lingine la meno, au andika *menyu* kurudi kwenye menyu kuu.',
};

// ─── Escalation Flow ─────────────────────────────────────────────────────────

export const escalation = {
  optionsPrompt: `👨‍⚕️ *Zungumza na Daktari wa Meno*\n\nUngependa kuunganika vipi?`,

  optionWhatsApp: {
    id: 'escalate_whatsapp',
    title: 'Daktari wa WhatsApp',
    description: 'Unganika kupitia WhatsApp',
  },
  optionClinic: {
    id: 'escalate_clinic',
    title: 'Tafuta Kliniki',
    description: 'Tembelea MenoHub karibu nawe',
  },

  whatsAppContact: (contactNumber: string): string =>
    `📱 Unaweza kuwasiliana na daktari wetu mshirika wa meno kwenye WhatsApp:\n*${contactNumber}*\n\nBinadamu atajibu ndani ya masaa 24 wakati wa saa za kazi (8asubuhi–6jioni EAT, Jumatatu–Jumamosi).`,

  fallbackContact: (email: string): string =>
    `📧 Tafadhali wasiliana na timu yetu ya msaada kwa *${email}* au tembelea https://app.menodao.org kwa usaidizi.\n\nTutajibu ndani ya masaa 24 wakati wa saa za kazi (8asubuhi–6jioni EAT, Jumatatu–Jumamosi).`,

  initiated: `✅ Umeunganishwa. Binadamu atakuwasiliana nawe hivi karibuni.\n\nAndika *menyu* kurudi kwenye menyu kuu.`,
};

// ─── Visit History Flow ───────────────────────────────────────────────────────

export const visitHistory = {
  header: '🗓️ *Ziara Zako za Hivi Karibuni za Meno*\n',

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
    `👨‍⚕️ Dkt. ${dentist}\n` +
    `🦷 ${procedures}\n` +
    `💰 Iliyolipwa: KES ${costCovered.toLocaleString()}`,

  hypercertVerified: (_tokenId: string, metadataUrl: string): string =>
    metadataUrl
      ? `✅ *Rekodi ya Huduma Iliyothibitishwa*\nAngalia maelezo: ${metadataUrl}`
      : `✅ *Rekodi ya Huduma Iliyothibitishwa*`,

  hypercertPending: `⏳ Uthibitisho wa rekodi ya huduma kwa ziara hii bado unaendelea.`,

  noVisits: `Bado huna ziara za meno zilizorekodi.\n\nTembelea *kliniki ya MenoHub* kuanza safari yako ya utunzaji wa meno! 🦷`,

  footer: '\nAndika *menyu* kurudi kwenye menyu kuu.',
};

// ─── Referrals Flow ───────────────────────────────────────────────────────────

export const referrals = {
  header: '🏆 *Takwimu Zako za Marejeo ya Champion*\n',

  statsActive: (code: string, count: number, rewards: string): string =>
    `Nambari ya marejeo: *${code}*\n` +
    `Watu waliorejewa: *${count}*\n` +
    `Zawadi zilizopatikana: *${rewards}*`,

  statsEmpty: (code: string): string =>
    `Nambari yako ya marejeo: *${code}*\n\n` +
    `Bado hujawasilisha mtu yeyote — lakini unaweza kuanza sasa! 🚀\n\n` +
    `Shiriki nambari yako na marafiki na upate zawadi wanaposajiliwa kwenye MenoDAO.`,

  shareableMessage: (code: string): string =>
    `Habari! Ninatumia MenoDAO kwa huduma ya meno ya bei nafuu Kenya. Tumia nambari yangu ya marejeo *${code}* unaposajiliwa kwenye https://app.menodao.org na sote tutafaidika! 🦷`,

  sharePrompt:
    'Ungependa nikutumie ujumbe unaoweza kushirikiwa na nambari yako ya marejeo?',
  shareButton: 'Shiriki Nambari Yangu',

  footer: '\nAndika *menyu* kurudi kwenye menyu kuu.',
};

// ─── Blockchain Flow ──────────────────────────────────────────────────────────

export const blockchain = {
  header: '📋 *Rekodi Zako za Huduma Zilizothibitishwa*\n',

  nftEntry: (_tokenId: string, date: string, metadataUrl: string): string =>
    `✅ *Ziara Iliyothibitishwa*\n` +
    `Tarehe ya ziara: ${date}\n` +
    (metadataUrl ? `Angalia maelezo: ${metadataUrl}\n\n` : '\n') +
    `Hii ni rekodi inayoweza kuthibitishwa ya huduma yako ya meno kwenye kliniki ya MenoHub.`,

  txEntry: (type: string, amount: number, maskedHash: string): string =>
    `• ${type} — KES ${amount.toLocaleString()}\n  Rej: ${maskedHash}`,

  txHeader: '\n📜 *Historia ya Malipo na Michango*\n',

  nftHoldings: (count: number): string =>
    count === 1
      ? `\n🎖️ Una rekodi *1* ya huduma iliyothibitishwa.`
      : `\n🎖️ Una rekodi *${count}* za huduma zilizothibitishwa.`,

  rejectedVisit: `⚠️ Uthibitisho wa moja ya ziara zako haukuweza kukamilika.\n\nTafadhali wasiliana na msaada kwa support@menodao.org ikiwa unaamini hii ni kosa.`,

  noRecords:
    `Bado huna rekodi za huduma zilizothibitishwa.\n\n` +
    `Hivi ndivyo inavyofanya kazi:\n` +
    `1️⃣ Unatembelea kliniki ya MenoHub\n` +
    `2️⃣ Matibabu yako yanakaguliwa na kuthibitishwa\n` +
    `3️⃣ Rekodi salama ya huduma huundwa kwa ziara yako\n` +
    `4️⃣ Unaweza kuona ziara zako zilizothibitishwa wakati wowote kwenye Historia ya Ziara 🦷`,

  footer: '\nAndika *menyu* kurudi kwenye menyu kuu.',
};

// ─── Account Settings Flow ────────────────────────────────────────────────────

export const accountSettings = {
  menuPrompt: '⚙️ *Mipangilio ya Akaunti*\n\nUngependa kufanya nini?',

  optionProfile: {
    id: 'account_profile',
    title: 'Angalia Wasifu',
    description: 'Maelezo ya akaunti yako',
  },
  optionLanguage: {
    id: 'account_language',
    title: 'Badilisha Lugha',
    description: 'Badilisha kwa Kiingereza au Kiswahili',
  },
  optionPaymentHistory: {
    id: 'account_payments',
    title: 'Historia ya Malipo',
    description: 'Michango 5 ya mwisho',
  },

  profile: (
    name: string,
    maskedPhone: string,
    tier: string,
    memberSince: string,
  ): string =>
    `👤 *Wasifu Wako*\n\n` +
    `Jina: *${name}*\n` +
    `Simu: *${maskedPhone}*\n` +
    `Mpango: *${tier}*\n` +
    `Mwanachama tangu: *${memberSince}*`,

  languagePrompt: '🌐 *Badilisha Lugha*\n\nUnapendelea lugha gani?',
  languageEnglish: { id: 'lang_en', title: 'English' },
  languageSwahili: { id: 'lang_sw', title: 'Kiswahili' },
  languageUpdated: (lang: string): string =>
    `✅ Lugha imebadilishwa kwenda *${lang}*. Ujumbe wote utakuwa katika ${lang} sasa.`,

  paymentHistoryHeader: '💳 *Historia ya Malipo*\n',
  paymentEntry: (date: string, amount: number, status: string): string =>
    `• *${date}* — KES ${amount.toLocaleString()} (${status})`,
  noPayments: 'Hakuna historia ya malipo iliyopatikana.',

  footer: '\nAndika *menyu* kurudi kwenye menyu kuu.',
};

// ─── Navigation ───────────────────────────────────────────────────────────────

export const navigation = {
  backButton: '⬅️ Rudi',
  cancelButton: '❌ Acha',
  menuButton: '🏠 Menyu Kuu',
  confirmButton: '✅ Thibitisha',
  retryButton: '🔄 Jaribu Tena',
  findClinicButton: '📍 Tafuta Kliniki',
  yesButton: '✅ Ndiyo',
  noButton: '❌ Hapana',
};
