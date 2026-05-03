# Implementation Plan: WhatsApp AI Chatbot (MenoAI)

## Overview

Implement the `src/whatsapp/` NestJS module end-to-end: dependencies, scaffold, core services, webhook controller + guard, all 9 flow handlers, i18n catalogues, app.module.ts registration, and tests. Each task builds on the previous so there is no orphaned code.

## Tasks

- [x] 1. Install dependencies and configure environment
  - Run `npm install ioredis openai` in `menodao-backend/`
  - Run `npm install --save-dev fast-check` in `menodao-backend/`
  - Add all required env vars to `.env.example`: `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `REDIS_URL`, `WHATSAPP_PARTNER_DENTIST_CONTACT`, `WHATSAPP_SUPPORT_EMAIL`
  - _Requirements: 11.1, 12.6_

- [x] 2. Create module scaffold and TypeScript types
  - [x] 2.1 Create `src/whatsapp/dto/webhook.dto.ts` with all Meta webhook payload interfaces: `MetaWebhookPayload`, `MetaEntry`, `MetaChange`, `MetaChangeValue`, `MetaContact`, `MetaMessage`, `MetaStatus`
    - _Requirements: 1.2_
  - [x] 2.2 Create `src/whatsapp/session.service.ts` with `ChatState` enum, `PendingPayment`, `ConversationTurn`, `ChatSession` interfaces, and `SessionService` class
    - Implement `get()`, `set()`, `delete()`, `createFreshSession()` methods
    - Use `ioredis` when `REDIS_URL` is set; fall back to in-memory `Map` otherwise
    - TTL is always 1800 seconds, refreshed on every `set()`
    - Export `ChatState` and `ChatSession` for use by flows
    - _Requirements: 2.1, 2.2, 2.6_
  - [x] 2.3 Create `src/whatsapp/whatsapp.module.ts` with all providers, imports (`HttpModule`, `ConfigModule`, `MembersModule`, `SubscriptionsModule`, `PaymentsModule`, `ClinicsModule`, `ReferralModule`, `Web3Module`, `ContributionsModule`), and controller
    - _Requirements: 1.1_

- [x] 3. Implement WebhookSignatureGuard
  - [x] 3.1 Create `src/whatsapp/guards/webhook-signature.guard.ts` implementing `CanActivate`
    - Read raw body from `req.rawBody` (Buffer)
    - Compute `sha256=` + HMAC-SHA256 of raw body using `WHATSAPP_APP_SECRET`
    - Use `timingSafeEqual` for constant-time comparison
    - Return `false` (403) if header missing, body missing, or signature mismatch
    - _Requirements: 1.3, 1.4, 12.4_
  - [ ]\* 3.2 Write property test for WebhookSignatureGuard
    - **Property 1: Webhook Signature Validation**
    - For any body and any string that is not the correct HMAC-SHA256, the guard SHALL return false
    - **Validates: Requirements 1.3, 1.4, 12.4**
  - [ ]\* 3.3 Write unit tests for WebhookSignatureGuard in `src/whatsapp/guards/webhook-signature.guard.spec.ts`
    - Valid signature → true; missing header → false; wrong secret → false; tampered body → false
    - _Requirements: 1.3, 1.4_

- [x] 4. Implement MetaApiService
  - [x] 4.1 Create `src/whatsapp/meta-api.service.ts` with methods: `sendText()`, `sendButtons()`, `sendList()`, `sendTemplate()`, `sendTypingIndicator()`
    - Use `HttpService` from `@nestjs/axios` for all outbound calls to Meta Graph API
    - Implement retry with exponential backoff: 3 attempts, delays 1s/2s/4s
    - Log all outbound messages (phone hashed) and all failures
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.6_
  - [ ]\* 4.2 Write unit tests for MetaApiService in `src/whatsapp/meta-api.service.spec.ts`
    - `sendText` retries on 5xx; stops after 3 retries; logs failure on final retry
    - _Requirements: 11.2, 11.3_

- [x] 5. Implement LlmService
  - [x] 5.1 Create `src/whatsapp/llm.service.ts` with `classifyIntent(message, history)` and `dentalChat(message, history, memberContext)` methods
    - Export `IntentType` union type and `MemberContext` interface
    - `classifyIntent` uses `max_tokens: 20, temperature: 0` with the intent classification system prompt
    - `dentalChat` uses `max_tokens: 450, temperature: 0.4` with the dental system prompt including member context
    - Enforce 15s timeout; return fallback message on timeout or API error
    - Retry once after 2s on OpenAI rate limit (429), then fallback
    - Log all LLM calls with model, token count, latency, and success/failure
    - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 13.3_
  - [ ]\* 5.2 Write unit tests for LlmService in `src/whatsapp/llm.service.spec.ts`
    - Intent classification returns a valid `IntentType`; dental chat respects max_tokens; timeout returns fallback message
    - _Requirements: 8.5, 8.6_

- [x] 6. Implement i18n catalogues
  - [x] 6.1 Create `src/whatsapp/i18n/en.ts` with all English user-facing strings as typed constants/functions
    - Include: welcome, mainMenu, paymentSuccess, paymentFailed, paymentTimeout, genericError, rateLimitMessage, fallbackLlm, registrationPrompt, and all flow-specific messages
    - _Requirements: 3.6_
  - [x] 6.2 Create `src/whatsapp/i18n/sw.ts` with all Swahili translations matching the same keys as `en.ts`
    - _Requirements: 3.1, 3.2, 3.6_

- [x] 7. Implement WhatsAppService (core router)
  - [x] 7.1 Create `src/whatsapp/whatsapp.service.ts` as the main message router and orchestrator
    - Implement `handleInbound(payload)`: extract message, normalise phone with `normalisePhone()`, deduplicate by message ID (Redis key `whatsapp:msgid:{id}`, TTL 86400s), load/create session, check rate limit
    - Implement `normalisePhone()` pure function (07xx → +2547xx, 2547xx → +2547xx, +2547xx → +2547xx)
    - Implement `isRateLimited()` sliding window (30 msg / 60s); send throttle message and discard if exceeded
    - Implement global command handling before state dispatch: `menu`/`menyu`/`0` → MAIN_MENU; `back`/`rudi` → previousState; `cancel`/`acha` → MAIN_MENU
    - Implement unrecognised input counter: after 3 consecutive unrecognised inputs, show MAIN_MENU
    - Implement `detectLanguage()` using Swahili keyword list; fall back to member's stored `preferredLanguage`
    - Dispatch to correct flow based on `session.state` or `LlmService.classifyIntent()` for free-text
    - Wrap all processing in try/catch; send generic error message on unhandled exception; never crash the app
    - _Requirements: 1.5, 1.6, 2.2, 2.4, 2.5, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 12.1, 12.5, 13.1, 13.5_
  - [ ]\* 7.2 Write property test for phone normalisation idempotency
    - **Property 8: Phone Normalisation Idempotency**
    - For any valid Kenyan phone in 07xx, 2547xx, or +2547xx format, `normalisePhone()` applied twice SHALL equal `normalisePhone()` applied once, and result SHALL match `/^\+254\d{9}$/`
    - **Validates: Requirements 12.1**
  - [ ]\* 7.3 Write property test for cancel command
    - **Property 6: Cancel Returns to Main Menu**
    - For any `ChatState` except `WELCOME`, sending `"cancel"` or `"acha"` SHALL transition state to `MAIN_MENU`
    - **Validates: Requirements 4.6**
  - [ ]\* 7.4 Write property test for back command
    - **Property 7: Back Returns to Previous State**
    - For any session with non-null `previousState`, sending `"back"` or `"rudi"` SHALL transition to `previousState`; if `previousState` is null, SHALL transition to `MAIN_MENU`
    - **Validates: Requirements 4.5**
  - [ ]\* 7.5 Write property test for rate limiting threshold
    - **Property 10: Rate Limiting Threshold**
    - For any phone number, messages beyond the 30th within a 60-second window SHALL receive a throttle response and SHALL NOT be processed by the message router
    - **Validates: Requirements 12.5**
  - [ ]\* 7.6 Write unit tests for WhatsAppService in `src/whatsapp/whatsapp.service.spec.ts`
    - Global commands handled before state dispatch; rate limit triggers throttle; deduplication ignores repeated message IDs; unrecognised counter resets on recognised input
    - _Requirements: 1.6, 4.4, 4.5, 4.6, 12.5_

- [x] 8. Implement SessionService tests
  - [ ]\* 8.1 Write property test for session isolation
    - **Property 2: Session Isolation**
    - For any two distinct phone numbers A and B, writing a session for A SHALL never affect the session returned for B
    - **Validates: Requirements 2.1, 12.1**
  - [ ]\* 8.2 Write property test for session inactivity reset
    - **Property 3: Session Inactivity Reset**
    - For any session in any `ChatState` where `lastActivityAt` is more than 1800s ago, the session SHALL be treated as expired and a fresh session SHALL be created
    - **Validates: Requirements 2.2**
  - [ ]\* 8.3 Write property test for conversation history cap
    - **Property 4: Conversation History Cap**
    - For any sequence of N > 10 messages in a single session, `conversationHistory` SHALL contain at most 10 turns at any point
    - **Validates: Requirements 2.3**
  - [ ]\* 8.4 Write unit tests for SessionService in `src/whatsapp/session.service.spec.ts`
    - Create fresh session; get/set/delete with Redis mock; TTL refresh on set; in-memory fallback when no REDIS_URL
    - _Requirements: 2.1, 2.6_

- [x] 9. Implement WhatsAppController
  - [x] 9.1 Create `src/whatsapp/whatsapp.controller.ts` with three routes
    - `GET /whatsapp/webhook`: verify `hub.mode === 'subscribe'` and `hub.verify_token` matches `WHATSAPP_VERIFY_TOKEN` using `timingSafeEqual`; echo `hub.challenge` as plain text; return 403 on mismatch
    - `POST /whatsapp/webhook`: apply `WebhookSignatureGuard`; return 200 immediately; call `whatsappService.handleInbound(payload)` without `await`
    - `GET /whatsapp/health`: probe WhatsApp API, OpenAI API, and Redis; return 200 if all ok, 503 if any error; include latency in response
    - _Requirements: 1.1, 1.2, 1.5, 13.6_

- [x] 10. Configure raw body middleware in main.ts
  - [x] 10.1 Add raw body middleware to `src/main.ts` for the `/whatsapp/webhook` route
    - Use `express.raw({ type: 'application/json' })` to capture raw body before JSON parsing
    - Assign `req.rawBody = req.body` and then parse `req.body = JSON.parse(req.body.toString())`
    - This must run before the NestJS body parser on this route
    - _Requirements: 1.3_

- [x] 11. Implement SubscriptionFlow
  - [x] 11.1 Create `src/whatsapp/flows/subscription.flow.ts` as an `@Injectable()` service
    - Handle `SUBSCRIPTION_VIEW` state: fetch subscription via `SubscriptionsService`, display tier, status, cap used/limit, waiting period status; offer upgrade if active, or show packages if inactive
    - Handle `SUBSCRIPTION_SELECT_TIER` state: present MenoBronze/MenoSilver/MenoGold with prices and benefits as an interactive list
    - Handle `SUBSCRIPTION_SELECT_FREQUENCY` state: present monthly/annual frequency options as buttons
    - Handle `SUBSCRIPTION_AWAITING_PAYMENT` state: detect re-entry and restart polling if `pendingPayment` is set
    - On tier + frequency confirmed: create pending `Contribution` record (via `PrismaService` if `ContributionsService` lacks a suitable `create()` method), call `PaymentService.initiateSTKPush()`, set `session.pendingPayment`, set state to `SUBSCRIPTION_AWAITING_PAYMENT`, send "check your phone" message
    - Implement `startPaymentPolling()` with `setInterval` (15s, max 12 polls = 3 min): on COMPLETED → send confirmation, clear pendingPayment, go to MAIN_MENU; on FAILED → send failure message, go to SUBSCRIPTION_SELECT_TIER; on timeout → send timeout message, go to SUBSCRIPTION_SELECT_TIER
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_
  - [ ]\* 11.2 Write unit tests for SubscriptionFlow in `src/whatsapp/flows/subscription.flow.spec.ts`
    - No subscription → show packages; active subscription → show status + upgrade option; payment confirmed → confirmation message sent; payment timeout → retry offered
    - _Requirements: 5.1, 5.2, 5.7, 5.8_

- [x] 12. Implement ClinicFlow
  - [x] 12.1 Create `src/whatsapp/flows/clinic.flow.ts` as an `@Injectable()` service
    - Handle `CLINIC_PROMPT_LOCATION` state: prompt member to share WhatsApp location or type sub-county name
    - Handle location message: call `ClinicsService.listClinics({ status: 'APPROVED' })`, filter by proximity (lat/lng), return 3 nearest with name, address, hours, WhatsApp contact, and Google Maps link where available
    - Handle text input: query by sub-county name, return up to 5 results with name, address, and hours
    - Handle `CLINIC_RESULTS` state: offer "search again" (→ CLINIC_PROMPT_LOCATION) or "back" (→ MAIN_MENU)
    - If no approved clinics found: inform member and suggest checking back later
    - Only return clinics with `status = APPROVED`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - [ ]\* 12.2 Write unit tests for ClinicFlow in `src/whatsapp/flows/clinic.flow.spec.ts`
    - No clinics found → suggest retry; APPROVED filter applied; results include maps link where available
    - _Requirements: 6.4, 6.5, 6.6_

- [x] 13. Implement ClaimsFlow
  - [x] 13.1 Create `src/whatsapp/flows/claims.flow.ts` as an `@Injectable()` service
    - Handle `CLAIMS_CHECK` state: check subscription status and waiting period via `SubscriptionsService`
    - If no active subscription: inform member and redirect to SUBSCRIPTION_VIEW
    - If within waiting period: display exact eligible date
    - If eligible: inform member that claims are submitted at a MenoHub clinic by the dentist; offer to find nearest clinic (→ CLINIC_PROMPT_LOCATION)
    - Handle `CLAIMS_STATUS` state: retrieve most recent claims via `MembersService.getClaimHistory()`, display status, amount, date, and remaining annual cap balance
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
  - [ ]\* 13.2 Write unit tests for ClaimsFlow in `src/whatsapp/flows/claims.flow.spec.ts`
    - In waiting period → show eligible date; no subscription → redirect to subscription flow; eligible → show clinic finder offer; claim status shows remaining cap
    - _Requirements: 7.2, 7.3, 7.4, 7.6_

- [x] 14. Implement DentalAiFlow
  - [x] 14.1 Create `src/whatsapp/flows/dental-ai.flow.ts` as an `@Injectable()` service
    - Handle `DENTAL_AI_CHAT` state: send typing indicator, call `LlmService.dentalChat()` with message, conversation history (last 10 turns), and member context (tier, cap limit, cap used)
    - Append conversation turn to `session.conversationHistory` (cap at 10 turns, evict oldest)
    - If LLM response recommends seeing a dentist: append offer to find clinic or escalate
    - If LLM returns error/timeout: send fallback message and offer escalation
    - Include brief disclaimer in all dental responses per requirement 8.7
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_
  - [ ]\* 14.2 Write property test for dental response length
    - **Property 12: Dental Response Length**
    - For any dental health question, the response from `LlmService.dentalChat()` SHALL contain at most 300 words
    - **Validates: Requirements 8.5**
  - [ ]\* 14.3 Write property test for language consistency
    - **Property 5: Language Consistency**
    - For any session with language `en` or `sw`, all system-generated messages SHALL use the catalogue for that language
    - **Validates: Requirements 3.1, 3.2, 3.6**
  - [ ]\* 14.4 Write unit tests for DentalAiFlow in `src/whatsapp/flows/dental-ai.flow.spec.ts`
    - Conversation history capped at 10 turns; LLM error triggers fallback; dentist recommendation appends clinic offer; disclaimer present in response
    - _Requirements: 8.4, 8.6, 8.7_

- [x] 15. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Implement EscalationFlow
  - [x] 16.1 Create `src/whatsapp/flows/escalation.flow.ts` as an `@Injectable()` service
    - Handle `ESCALATION_OPTIONS` state: present options (a) connect via WhatsApp to partner dentist, (b) find nearest clinic
    - On option (a): send `WHATSAPP_PARTNER_DENTIST_CONTACT` number; if not configured, fall back to `WHATSAPP_SUPPORT_EMAIL` or web app link
    - Notify member that a human will respond within 24 hours during business hours (8am–6pm EAT, Mon–Sat)
    - Log all escalation events with memberId, timestamp, and reason via NestJS `Logger`
    - Transition to MAIN_MENU after escalation is initiated
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - [ ]\* 16.2 Write unit tests for EscalationFlow in `src/whatsapp/flows/escalation.flow.spec.ts`
    - Partner dentist contact present → sends number; no contact configured → falls back to support email; escalation event logged with memberId and reason
    - _Requirements: 9.2, 9.3, 9.5_

- [x] 17. Implement VisitHistoryFlow
  - [x] 17.1 Create `src/whatsapp/flows/visit-history.flow.ts` as an `@Injectable()` service
    - Handle `VISIT_HISTORY` state: call `MembersService.getMemberHistory()`, display 5 most recent visits
    - For each visit: show date, clinic name, dentist name (`treatedBy`), procedures performed, total cost covered
    - If `web3VerificationStatus === 'VERIFIED'` and Hypercert token ID present: show NFT status and `metadataUrl` link
    - If `web3VerificationStatus === 'PENDING'`: inform member blockchain verification is in progress
    - Do NOT include `chiefComplaint`, `medicalHistory`, `clinicalNotes`, or `vitals` fields in any message
    - If no visits: inform member and suggest visiting a MenoHub clinic
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_
  - [ ]\* 17.2 Write unit tests for VisitHistoryFlow in `src/whatsapp/flows/visit-history.flow.spec.ts`
    - Clinical data fields NOT included in output; VERIFIED visit shows Hypercert link; PENDING shows in-progress message; no visits → suggest clinic
    - _Requirements: 14.3, 14.4, 14.6, 14.7_

- [x] 18. Implement ReferralsFlow
  - [x] 18.1 Create `src/whatsapp/flows/referrals.flow.ts` as an `@Injectable()` service
    - Handle `REFERRALS_VIEW` state: call `ReferralService.getChampionStats()` (or read referral fields from member record)
    - Display unique referral code, number of referrals made, and rewards earned
    - If member has referrals: show referral count and reward status
    - If zero referrals: encourage sharing, explain champion programme benefits, display referral code
    - Offer to send a pre-formatted shareable message containing the referral code/link
    - Display reward amounts in the member's preferred language
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_
  - [ ]\* 18.2 Write unit tests for ReferralsFlow in `src/whatsapp/flows/referrals.flow.spec.ts`
    - Zero referrals → show encouragement + code; referrals present → show count and rewards; shareable message formatted correctly
    - _Requirements: 15.1, 15.4_

- [x] 19. Implement BlockchainFlow
  - [x] 19.1 Create `src/whatsapp/flows/blockchain.flow.ts` as an `@Injectable()` service
    - Handle `BLOCKCHAIN_VIEW` state: retrieve verified visits via `MembersService.getMemberHistory()` filtered to `web3VerificationStatus === 'VERIFIED'`
    - For each verified visit: display Hypercert NFT token ID (masked), verification status, and `metadataUrl` link
    - Retrieve blockchain transaction history via `MembersService.getTransactionHistory()`: display type, amount, and masked tx hash (`0x{first8}…{last6}`)
    - If member has NFTs in `member.nfts`: include NFT holdings summary
    - Explain in plain language that NFTs are verifiable proof of dental care on Filecoin Calibration
    - If `web3VerificationStatus === 'REJECTED'`: inform member and suggest contacting support
    - If no verified visits and no transactions: explain how the MenoDAO blockchain verification system works
    - Apply `maskTxHash()` to all transaction hashes; never display full hashes
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_
  - [ ]\* 19.2 Write property test for transaction hash masking
    - **Property 9: Transaction Hash Masking**
    - For any hex string of length ≥ 16, `maskTxHash()` SHALL return a string matching `/^0x[0-9a-f]{8}…[0-9a-f]{6}$/i`
    - **Validates: Requirements 12.3, 16.6**
  - [ ]\* 19.3 Write unit tests for BlockchainFlow in `src/whatsapp/flows/blockchain.flow.spec.ts`
    - Hash truncation applied to all tx hashes; no verified visits → explanation shown; REJECTED visit → support suggestion shown
    - _Requirements: 16.6, 16.7_

- [x] 20. Implement AccountSettingsFlow
  - [x] 20.1 Create `src/whatsapp/flows/account-settings.flow.ts` as an `@Injectable()` service
    - Handle `ACCOUNT_SETTINGS` state: present options (a) View profile, (b) Change language preference, (c) View payment history as interactive buttons
    - Handle `ACCOUNT_PROFILE` state: display full name, phone number (masked `+254***{last4}`), subscription tier, member since date; do NOT expose sensitive fields
    - Handle `ACCOUNT_LANGUAGE` state: present English/Swahili options; on selection update `session.language`, call `MembersService.update()` to persist `preferredLanguage` in DB, confirm change
    - Handle `ACCOUNT_PAYMENT_HISTORY` state: call `MembersService.getContributionHistory()` (or equivalent), display last 5 contributions with amount, date, and status
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 3.4, 3.5_
  - [ ]\* 20.2 Write unit tests for AccountSettingsFlow in `src/whatsapp/flows/account-settings.flow.spec.ts`
    - Language change updates DB and session; profile does not expose sensitive fields; payment history shows last 5 entries
    - _Requirements: 10.3, 10.4, 10.5_

- [x] 21. Register WhatsAppModule in AppModule
  - [x] 21.1 Add `WhatsAppModule` to the `imports` array in `src/app.module.ts`
    - _Requirements: 1.1_
  - [x] 21.2 Verify that all modules imported by `WhatsAppModule` (`MembersModule`, `SubscriptionsModule`, `PaymentsModule`, `ClinicsModule`, `ReferralModule`, `Web3Module`, `ContributionsModule`) export their respective services; add `exports` arrays where missing
    - _Requirements: 1.1_

- [x] 22. Implement payment callback idempotency property test
  - [x]\* 22.1 Write property test for payment callback idempotency
    - **Property 11: Payment Callback Idempotency**
    - For any `contributionId` already in `COMPLETED` status, calling `PaymentService.processCallback()` a second time SHALL NOT re-activate the subscription or create duplicate records
    - **Validates: Requirements 5.6, 5.7**

- [ ] 23. Write integration tests
  - [ ]\* 23.1 Write integration tests for the webhook endpoints in `src/whatsapp/whatsapp.controller.spec.ts`
    - `GET /whatsapp/webhook` returns challenge with correct verify token; returns 403 with wrong token
    - `POST /whatsapp/webhook` with invalid signature returns 403
    - `POST /whatsapp/webhook` with valid signature returns 200 immediately
    - Member phone lookup resolves to correct `memberId`
    - Language change updates `member.preferredLanguage` in DB
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.5_

- [x] 24. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use **fast-check** and must include the comment `// Feature: whatsapp-ai-chatbot, Property {N}: {property_text}`
- Checkpoints ensure incremental validation at logical milestones
- The `WhatsAppModule` is self-contained and exports nothing; all integration is via `AppModule` import
- Raw body middleware (task 10) must be added before any other body parser middleware on the webhook route
- If `ContributionsModule` does not export a suitable `create()` method, `SubscriptionFlow` may use `PrismaService` directly (it is globally available)
