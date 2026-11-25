import * as fs from 'fs';
import * as path from 'path';
import {
  EvalCase,
  EvalCaseResult,
  EvalSummaryScorecard,
  EvalTurnResult,
  CheckFailure,
} from './eval.types';
import {
  checkNameCanary,
  checkMenuPattern,
  checkSwahiliLexicon,
  checkPlaceholderResolution,
  checkPhrasingRequirements,
} from './checks/deterministic-checks';

export interface EvalExecutionHandler {
  processMessage(params: {
    messageText: string;
    messageType?: 'text' | 'audio' | 'image' | 'other';
    member: {
      id: string;
      phoneNumber: string;
      fullName?: string;
      preferredLanguage?: string;
    } | null;
  }): Promise<{
    replyText: string;
    detectedIntent?: string;
    isEmergency?: boolean;
    capturedLlmPayloads: string[];
    llmCallCount: number;
  }>;
}

export class EvalRunner {
  constructor(private readonly handler: EvalExecutionHandler) {}

  public loadDataset(filePath: string): EvalCase[] {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    return lines.map((line) => JSON.parse(line) as EvalCase);
  }

  public async runSuite(cases: EvalCase[]): Promise<{
    caseResults: EvalCaseResult[];
    scorecard: EvalSummaryScorecard;
  }> {
    const caseResults: EvalCaseResult[] = [];
    let emergencyCasesCount = 0;
    let emergencySuccessCount = 0;
    let canaryLeakCount = 0;
    let menuPatternDetectedCount = 0;
    let swahiliLexiconFailures = 0;
    let placeholderFailures = 0;
    let unmatchedSenderViolations = 0;

    for (const testCase of cases) {
      const turnResults: EvalTurnResult[] = [];
      let casePassed = true;

      for (let i = 0; i < testCase.turns.length; i++) {
        const turn = testCase.turns[i];
        const res = await this.handler.processMessage({
          messageText: turn.userMessage,
          messageType: turn.messageType,
          member: testCase.member_fixture,
        });

        const failures: CheckFailure[] = [];

        // Check 1: Unmatched sender & Zero LLM calls
        if (turn.expect.assertZeroLlmCalls && res.llmCallCount > 0) {
          unmatchedSenderViolations++;
          failures.push({
            checkName: 'Zero LLM Calls Enforcement',
            message: `Expected 0 LLM calls for turn, but ${res.llmCallCount} calls were made.`,
            details: { llmCallCount: res.llmCallCount },
          });
        }

        // Check 2: Name-Leak Canary
        if (turn.expect.canaryCheck && turn.expect.canaryName) {
          const canaryFailures = checkNameCanary(
            res.capturedLlmPayloads,
            turn.expect.canaryName,
          );
          if (canaryFailures.length > 0) {
            canaryLeakCount += canaryFailures.length;
            failures.push(...canaryFailures);
          }
        }

        // Check 3: Menu Pattern
        const menuFailures = checkMenuPattern(res.replyText);
        if (menuFailures.length > 0) {
          menuPatternDetectedCount++;
          failures.push(...menuFailures);
        }

        // Check 4: Swahili Lexicon Lint ("Kariba" -> "Karibu")
        const lexiconFailures = checkSwahiliLexicon(res.replyText);
        if (lexiconFailures.length > 0) {
          swahiliLexiconFailures += lexiconFailures.length;
          failures.push(...lexiconFailures);
        }

        // Check 5: Placeholder Resolution
        const placeholderFails = checkPlaceholderResolution(res.replyText);
        if (placeholderFails.length > 0) {
          placeholderFailures += placeholderFails.length;
          failures.push(...placeholderFails);
        }

        // Check 6: Content Requirements (must_include / must_not_include)
        const phrasingFails = checkPhrasingRequirements(
          res.replyText,
          turn.expect.must_include,
          turn.expect.must_not_include,
        );
        failures.push(...phrasingFails);

        // Check 7: Emergency Recall
        if (turn.expect.emergency !== undefined) {
          emergencyCasesCount++;
          if (res.isEmergency === turn.expect.emergency) {
            emergencySuccessCount++;
          } else {
            failures.push({
              checkName: 'Emergency Recall Check',
              message: `Expected emergency=${turn.expect.emergency}, got ${res.isEmergency}`,
            });
          }
        }

        const turnPassed = failures.length === 0;
        if (!turnPassed) casePassed = false;

        turnResults.push({
          turnIndex: i,
          userMessage: turn.userMessage,
          botReply: res.replyText,
          detectedIntent: res.detectedIntent,
          isEmergency: res.isEmergency,
          llmCallsMade: res.llmCallCount,
          llmPayloadsCaptured: res.capturedLlmPayloads,
          passed: turnPassed,
          failures,
        });
      }

      caseResults.push({
        caseId: testCase.id,
        tags: testCase.tags,
        passed: casePassed,
        turnResults,
      });
    }

    const passedCount = caseResults.filter((c) => c.passed).length;
    const accuracyRate = cases.length > 0 ? (passedCount / cases.length) * 100 : 0;
    const emergencyRecall =
      emergencyCasesCount > 0
        ? (emergencySuccessCount / emergencyCasesCount) * 100
        : 100;

    const scorecard: EvalSummaryScorecard = {
      totalCases: cases.length,
      passedCases: passedCount,
      failedCases: cases.length - passedCount,
      accuracyRate: Math.round(accuracyRate * 10) / 10,
      emergencyRecall: Math.round(emergencyRecall * 10) / 10,
      canaryLeakCount,
      menuPatternDetectedCount,
      swahiliLexiconFailures,
      placeholderFailures,
      unmatchedSenderViolations,
      timestamp: new Date().toISOString(),
    };

    return { caseResults, scorecard };
  }

  public saveReport(
    resultsDir: string,
    scorecard: EvalSummaryScorecard,
    caseResults: EvalCaseResult[],
  ): string {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = path.join(resultsDir, ts);
    fs.mkdirSync(outDir, { recursive: true });

    // Save JSON scorecard
    fs.writeFileSync(
      path.join(outDir, 'scorecard.json'),
      JSON.stringify({ scorecard, cases: caseResults }, null, 2),
    );

    // Save Markdown Report
    const lines: string[] = [
      `# Evaluation Run Report: ${scorecard.timestamp}`,
      ``,
      `## Summary Scorecard`,
      ``,
      `| Metric | Score | Gate | Status |`,
      `|---|---|---|---|`,
      `| Total Cases | ${scorecard.totalCases} | - | - |`,
      `| Passed Cases | ${scorecard.passedCases} (${scorecard.accuracyRate}%) | ≥ 92% | ${scorecard.accuracyRate >= 92 ? '✅ PASS' : '❌ FAIL'} |`,
      `| Name-Leak Canary | ${scorecard.canaryLeakCount} leaks | 0 leaks | ${scorecard.canaryLeakCount === 0 ? '✅ PASS' : '❌ FAIL'} |`,
      `| Emergency Recall | ${scorecard.emergencyRecall}% | 100% | ${scorecard.emergencyRecall === 100 ? '✅ PASS' : '❌ FAIL'} |`,
      `| Menu-Pattern Hits | ${scorecard.menuPatternDetectedCount} | < 10% | ${scorecard.menuPatternDetectedCount === 0 ? '✅ PASS' : '⚠️ WARN'} |`,
      `| Swahili Lexicon Typos | ${scorecard.swahiliLexiconFailures} | 0 | ${scorecard.swahiliLexiconFailures === 0 ? '✅ PASS' : '❌ FAIL'} |`,
      `| Unresolved Placeholders | ${scorecard.placeholderFailures} | 0 | ${scorecard.placeholderFailures === 0 ? '✅ PASS' : '❌ FAIL'} |`,
      `| Unmatched Sender LLM Violations | ${scorecard.unmatchedSenderViolations} | 0 | ${scorecard.unmatchedSenderViolations === 0 ? '✅ PASS' : '❌ FAIL'} |`,
      ``,
      `## Case Breakdown`,
      ``,
    ];

    for (const c of caseResults) {
      lines.push(`### Case ${c.caseId} [${c.tags.join(', ')}] — ${c.passed ? '✅ PASS' : '❌ FAIL'}`);
      for (const t of c.turnResults) {
        lines.push(`- **User:** "${t.userMessage}"`);
        lines.push(`- **Bot:** "${t.botReply.replace(/\n/g, ' ')}"`);
        if (!t.passed) {
          for (const f of t.failures) {
            lines.push(`  - ❌ **${f.checkName}:** ${f.message}`);
          }
        }
      }
      lines.push(``);
    }

    const reportPath = path.join(outDir, 'report.md');
    fs.writeFileSync(reportPath, lines.join('\n'));
    return reportPath;
  }
}
