export type EvalIntent =
  | 'BOOK_APPOINTMENT'
  | 'HEALTH_INFO'
  | 'ACCOUNT_HELP'
  | 'SMALL_TALK'
  | 'UNCLEAR';

export type EvalLanguage = 'en' | 'sw' | 'mixed';

export interface EvalMemberFixture {
  id: string;
  phoneNumber: string;
  isVerified: boolean;
  preferredLanguage?: 'en' | 'sw' | string;
  fullName?: string;
  firstName?: string;
}

export interface EvalTurnExpectation {
  intent?: EvalIntent | string;
  sub_intent?: string;
  emergency?: boolean;
  must_include?: string[];
  must_not_include?: string[];
  canaryCheck?: boolean;
  canaryName?: string;
  isUnmatched?: boolean;
  isImage?: boolean;
  assertZeroLlmCalls?: boolean;
}

export interface EvalTurn {
  userMessage: string;
  messageType?: 'text' | 'audio' | 'image' | 'other';
  expect: EvalTurnExpectation;
}

export interface EvalCase {
  id: string;
  tags: string[];
  member_fixture: EvalMemberFixture | null;
  turns: EvalTurn[];
}

export interface CheckFailure {
  checkName: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface EvalTurnResult {
  turnIndex: number;
  userMessage: string;
  botReply: string;
  detectedIntent?: string;
  isEmergency?: boolean;
  llmCallsMade: number;
  llmPayloadsCaptured: string[];
  passed: boolean;
  failures: CheckFailure[];
}

export interface EvalCaseResult {
  caseId: string;
  tags: string[];
  passed: boolean;
  turnResults: EvalTurnResult[];
}

export interface EvalSummaryScorecard {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  accuracyRate: number;
  emergencyRecall: number;
  canaryLeakCount: number;
  menuPatternDetectedCount: number;
  swahiliLexiconFailures: number;
  placeholderFailures: number;
  unmatchedSenderViolations: number;
  timestamp: string;
}
