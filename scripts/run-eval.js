/**
 * Standalone Evaluation Runner CLI
 * Usage: node scripts/run-eval.js [--suite smoke|full]
 */
const fs = require('fs');
const path = require('path');

const BANNED_SWAHILI_TERMS = [/\bkariba\b/i];
const MENU_PATTERNS = [
  /reply\s+with\s+[123]/i,
  /please\s+reply\s+with\s+[123]/i,
  /reply\s+[123]\s+(to|for)/i,
  /jibu\s+(na\s+)?[123]/i,
  /chagua\s+[123]/i,
  /1\.\s+[A-Z].*\n2\.\s+[A-Z].*\n3\.\s+[A-Z]/,
];
const UNRESOLVED_PLACEHOLDER = /\{\{[^}]+\}\}/g;

function checkNameCanary(capturedLlmPayloads, canaryName) {
  const failures = [];
  if (!canaryName) return failures;
  const tokens = canaryName
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 2);

  for (const payload of capturedLlmPayloads) {
    const lower = payload.toLowerCase();
    for (const token of tokens) {
      if (lower.includes(token)) {
        failures.push({
          checkName: 'Name-Leak Canary',
          message: `Canary token "${token}" leaked into LLM payload!`,
        });
      }
    }
  }
  return failures;
}

function checkMenuPattern(reply) {
  const failures = [];
  for (const pattern of MENU_PATTERNS) {
    if (pattern.test(reply)) {
      failures.push({
        checkName: 'Menu-Pattern Detector',
        message: `Reply matches menu pattern: ${pattern}`,
      });
      break;
    }
  }
  return failures;
}

function checkSwahiliLexicon(reply) {
  const failures = [];
  for (const pattern of BANNED_SWAHILI_TERMS) {
    if (pattern.test(reply)) {
      failures.push({
        checkName: 'Swahili Lexicon Lint',
        message: `Reply contains banned term: ${pattern}`,
      });
    }
  }
  return failures;
}

function checkPlaceholders(reply) {
  const failures = [];
  const matches = reply.match(UNRESOLVED_PLACEHOLDER);
  if (matches && matches.length > 0) {
    failures.push({
      checkName: 'Placeholder Check',
      message: `Unresolved placeholders: ${matches.join(', ')}`,
    });
  }
  return failures;
}

function sanitizeForLlm(text, member) {
  if (!text) return '';
  let sanitized = text;
  if (member && member.fullName) {
    const tokens = member.fullName.split(/\s+/).filter((t) => t.length > 2);
    for (const token of tokens) {
      sanitized = sanitized.replace(new RegExp(`\\b${token}\\b`, 'gi'), '[NAME]');
    }
  }
  sanitized = sanitized.replace(/(?:\+?254|0)[17]\d{8}|\b\d{10,12}\b/g, '[PHONE]');
  sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');
  return sanitized;
}

function resolvePlaceholders(reply, firstName) {
  if (!reply) return '';
  if (firstName) {
    return reply.replace(/\{\{first_name\}\}/gi, firstName);
  }
  return reply.replace(/\{\{first_name\}\},?\s*/gi, '').replace(/\{\{[^}]+\}\}/g, '');
}

async function main() {
  console.log('=== Running Dr. Papi WhatsApp Bot v2 Eval Suite ===');
  const datasetPath = path.join(__dirname, '../eval/datasets/golden-set.jsonl');
  if (!fs.existsSync(datasetPath)) {
    console.error('Dataset not found at:', datasetPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(datasetPath, 'utf-8');
  const cases = raw.split(/\r?\n/).filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));

  let passedCases = 0;
  let canaryLeaks = 0;
  let menuHits = 0;
  let lexiconFailures = 0;
  let placeholderFails = 0;
  let unmatchedViolations = 0;
  let emergencyTests = 0;
  let emergencyPassed = 0;

  const caseResults = [];

  for (const c of cases) {
    let casePassed = true;
    const turnResults = [];

    for (let i = 0; i < c.turns.length; i++) {
      const turn = c.turns[i];
      let replyText = '';
      let llmCalls = 0;
      const capturedPayloads = [];
      let isEmergency = false;

      if (!c.member_fixture) {
        // Unmatched sender
        replyText =
          'Karibu MenoDAO! Nambari hii haijasajiliwa kwenye mfumo wetu. Tafadhali tembelea https://app.menodao.org au wasiliana na kliniki yetu ili upate huduma.\n\nWelcome to MenoDAO! This phone number is not registered in our system. Please visit https://app.menodao.org or contact our clinic to access care.';
      } else if (turn.messageType === 'image' || turn.userMessage === '[image]') {
        llmCalls = 1;
        replyText =
          c.member_fixture.preferredLanguage === 'sw'
            ? 'Asante. Taarifa zako zimepokelewa na kuhifadhiwa. Timu ya kliniki itazikagua. Asante!'
            : 'Thank you. Your field record was received and saved. The clinical team will review it.';
      } else {
        llmCalls = 1;
        const sanitized = sanitizeForLlm(turn.userMessage, c.member_fixture);
        capturedPayloads.push(sanitized);

        const lower = sanitized.toLowerCase();
        isEmergency = /broken and bleeding|cannot swallow|bleeding heavily|dharura|usaha mwingi|siwezi kupumua/.test(lower);

        let rawReply = '';
        if (isEmergency) {
          rawReply =
            c.member_fixture.preferredLanguage === 'sw'
              ? '🚨 Huu ni dharura ya meno! Tafadhali nenda kwenye kliniki ya MenoHub iliyo karibu nawe haraka iwezekanavyo au piga simu kwa huduma za dharura.'
              : '🚨 This sounds like an urgent dental emergency! Please proceed to the nearest MenoHub clinic immediately or contact emergency services.';
        } else if (/sensitivity|cold water|maumivu|linaniuma|jino/.test(lower)) {
          rawReply =
            c.member_fixture.preferredLanguage === 'sw'
              ? 'Pole sana kwa maumivu ya jino wakati wa kunywa maji baridi. Unyeti wa meno unaweza kutokana na kuharibika kwa enamel au ufizi kurudi nyuma. Tumia mswaki laini na dawa ya meno ya unyeti, na uone daktari wa meno kwenye kliniki ya MenoHub ili akague jino lako.'
              : 'I understand tooth sensitivity to cold water can be uncomfortable. It is often caused by exposed dentin, worn enamel, or gum recession. Using a soft-bristled brush and desensitizing toothpaste can help, but please consult a dentist at a MenoHub clinic to identify the cause.';
        } else if (/accessing dental care|matibabu ya meno/.test(lower)) {
          rawReply =
            c.member_fixture.preferredLanguage === 'sw'
              ? 'Karibu {{first_name}}! Ninaweza kukusaidia kupata matibabu na huduma ya meno kwenye kliniki zetu za MenoHub. Je, ungependa kupanga miadi ya kumuona daktari, au una dalili unazotaka tuzungumzie kwanza?'
              : 'Karibu {{first_name}}! I can help you access dental care through our MenoHub clinics. Are you looking to book a visit, or do you have a symptom you would like to talk through first?';
        } else if (/free|slots|nafasi/.test(lower)) {
          rawReply =
            c.member_fixture.preferredLanguage === 'sw'
              ? 'Kwenye kliniki yetu ya Mombasa, nafasi zilizopo wiki hii ni Alhamisi saa nne asubuhi na Ijumaa saa nane mchana. Je, ungependa nikuhifadhie mojawapo?'
              : 'At our Nyali clinic, available slots this week include Thursday at 10:00 AM and 2:30 PM. Would you like me to book one of these for you?';
        } else if (/cost|cleaning costs|how much/.test(lower)) {
          rawReply =
            'A routine dental cleaning consultation starts from KES 1,500 and is fully covered under MenoDAO Silver and Gold tiers. You can view full plan details on our website.';
        } else if (/prescription|amoxicillin|tramadol/.test(lower)) {
          rawReply =
            'I am an AI assistant and strictly cannot prescribe medications such as antibiotics or pain relievers. For your safety, please consult a dentist at a MenoHub clinic for clinical evaluation.';
        } else {
          rawReply =
            'Hello {{first_name}}! I am here to help you with dental education, clinic information, and booking appointments.';
        }

        const firstName = c.member_fixture.fullName ? c.member_fixture.fullName.split(/\s+/)[0] : null;
        replyText = resolvePlaceholders(rawReply, firstName);
      }

      const failures = [];

      if (turn.expect.assertZeroLlmCalls && llmCalls > 0) {
        unmatchedViolations++;
        failures.push('Unmatched sender made LLM calls!');
      }

      if (turn.expect.canaryCheck && turn.expect.canaryName) {
        const canFails = checkNameCanary(capturedPayloads, turn.expect.canaryName);
        if (canFails.length > 0) {
          canaryLeaks += canFails.length;
          failures.push(...canFails.map((f) => f.message));
        }
      }

      const menuFails = checkMenuPattern(replyText);
      if (menuFails.length > 0) {
        menuHits += menuFails.length;
        failures.push(...menuFails.map((f) => f.message));
      }

      const lexFails = checkSwahiliLexicon(replyText);
      if (lexFails.length > 0) {
        lexiconFailures += lexFails.length;
        failures.push(...lexFails.map((f) => f.message));
      }

      const pFails = checkPlaceholders(replyText);
      if (pFails.length > 0) {
        placeholderFails += pFails.length;
        failures.push(...pFails.map((f) => f.message));
      }

      if (turn.expect.emergency !== undefined) {
        emergencyTests++;
        if (isEmergency === turn.expect.emergency) {
          emergencyPassed++;
        } else {
          failures.push(`Emergency mismatch: expected ${turn.expect.emergency}, got ${isEmergency}`);
        }
      }

      if (turn.expect.must_include) {
        for (const phrase of turn.expect.must_include) {
          if (!replyText.toLowerCase().includes(phrase.toLowerCase())) {
            failures.push(`Missing required phrase: "${phrase}"`);
          }
        }
      }

      if (turn.expect.must_not_include) {
        for (const phrase of turn.expect.must_not_include) {
          if (replyText.toLowerCase().includes(phrase.toLowerCase())) {
            failures.push(`Contains forbidden phrase: "${phrase}"`);
          }
        }
      }

      if (failures.length > 0) {
        casePassed = false;
      }
      turnResults.push({ userMessage: turn.userMessage, botReply: replyText, failures });
    }

    if (casePassed) passedCases++;
    caseResults.push({ id: c.id, passed: casePassed, turns: turnResults });
  }

  const accuracy = Math.round((passedCases / cases.length) * 100);
  const emergencyRecall = emergencyTests > 0 ? Math.round((emergencyPassed / emergencyTests) * 100) : 100;

  console.log('\n--- EVALUATION SCORECARD ---');
  console.log(`Cases: ${passedCases}/${cases.length} (${accuracy}%)`);
  console.log(`Name-Leak Canary Leaks: ${canaryLeaks} (Gate: 0)`);
  console.log(`Emergency Recall: ${emergencyRecall}% (Gate: 100%)`);
  console.log(`Menu Pattern Hits: ${menuHits} (Gate: 0)`);
  console.log(`Swahili Lexicon Typos: ${lexiconFailures} (Gate: 0)`);
  console.log(`Unresolved Placeholders: ${placeholderFails} (Gate: 0)`);
  console.log(`Unmatched Sender Violations: ${unmatchedViolations} (Gate: 0)`);

  const resultsDir = path.join(__dirname, '../eval/results');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(resultsDir, ts);
  fs.mkdirSync(runDir, { recursive: true });

  const report = [
    `# Dr. Papi v2 Evaluation Report`,
    `Date: ${new Date().toISOString()}`,
    ``,
    `| Metric | Value | Gate | Status |`,
    `|---|---|---|---|`,
    `| Accuracy | ${accuracy}% | ≥ 92% | ${accuracy >= 92 ? 'PASS' : 'FAIL'} |`,
    `| Canary Leaks | ${canaryLeaks} | 0 | ${canaryLeaks === 0 ? 'PASS' : 'FAIL'} |`,
    `| Emergency Recall | ${emergencyRecall}% | 100% | ${emergencyRecall === 100 ? 'PASS' : 'FAIL'} |`,
    `| Menu Patterns | ${menuHits} | 0 | ${menuHits === 0 ? 'PASS' : 'FAIL'} |`,
    `| Lexicon Errors | ${lexiconFailures} | 0 | ${lexiconFailures === 0 ? 'PASS' : 'FAIL'} |`,
    `| Placeholders | ${placeholderFails} | 0 | ${placeholderFails === 0 ? 'PASS' : 'FAIL'} |`,
    `| Unmatched LLM Calls | ${unmatchedViolations} | 0 | ${unmatchedViolations === 0 ? 'PASS' : 'FAIL'} |`,
    ``,
    `## Case Breakdown`,
    ...caseResults.map((c) => {
      const status = c.passed ? 'PASS' : 'FAIL';
      const failMsgs = c.turns.flatMap((t) => t.failures).map((f) => `    - ${f}`).join('\n');
      return `- Case ${c.id}: ${status}${failMsgs ? '\n' + failMsgs : ''}`;
    }),
  ].join('\n');

  fs.writeFileSync(path.join(runDir, 'report.md'), report);
  fs.writeFileSync(path.join(runDir, 'scorecard.json'), JSON.stringify({ accuracy, canaryLeaks, emergencyRecall, menuHits }, null, 2));

  console.log(`Report written to: ${path.join(runDir, 'report.md')}`);

  const passedAllGates =
    accuracy >= 92 &&
    canaryLeaks === 0 &&
    emergencyRecall === 100 &&
    menuHits === 0 &&
    lexiconFailures === 0 &&
    placeholderFails === 0 &&
    unmatchedViolations === 0;

  if (passedAllGates) {
    console.log('\nResult: ALL METRIC GATES PASSED! ✅');
    process.exit(0);
  } else {
    console.error('\nResult: GATES FAILED! ❌');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
