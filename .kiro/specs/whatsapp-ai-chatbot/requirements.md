# Requirements Document

## Introduction

This feature adds a WhatsApp-based AI chatbot as an alternative channel to the MenoDAO web app. Members who prefer WhatsApp as their primary interface can use the chatbot to manage their dental insurance account, get dental health guidance, and access all core platform actions — without ever opening a browser. The chatbot integrates with the Meta WhatsApp Business API for messaging and uses an LLM (OpenAI or compatible) for conversational AI. It connects to the existing NestJS backend services for members, subscriptions, payments, clinics, claims, and notifications.

---

## Glossary

- **Chatbot**: The MenoDAO WhatsApp AI assistant, referred to as "MenoAI" in user-facing messages.
- **Member**: A registered MenoDAO user identified by their WhatsApp phone number.
- **Session**: A stateful conversation context maintained per phone number, tracking the current menu flow and conversation history.
- **Webhook**: The HTTPS endpoint in the NestJS backend that receives inbound WhatsApp messages from Meta.
- **LLM**: Large Language Model (OpenAI GPT-4o or compatible) used for dental AI assistance and intent detection.
- **Structured_Menu**: A numbered or button-based menu presented to the member for navigating account actions.
- **Escalation**: The act of connecting a member to a human dentist or support agent via WhatsApp.
- **Preferred_Language**: The member's stored language preference — either `en` (English) or `sw` (Swahili).
- **Intent**: The purpose of a member's free-text message as classified by the LLM (e.g., dental question, claim inquiry, escalation request).
- **STK_Push**: M-Pesa payment prompt sent to the member's phone via SasaPay.
- **Waiting_Period**: The number of days after subscription activation before a member can make claims.

---

## Requirements

### Requirement 1: WhatsApp Webhook Integration

**User Story:** As a MenoDAO platform operator, I want the backend to receive and verify WhatsApp messages from Meta, so that the chatbot can respond to member messages in real time.

#### Acceptance Criteria

1. THE Webhook SHALL expose a `GET /whatsapp/webhook` endpoint that responds to Meta's hub verification challenge using the `WHATSAPP_VERIFY_TOKEN` environment variable.
2. THE Webhook SHALL expose a `POST /whatsapp/webhook` endpoint that receives inbound message events from the Meta WhatsApp Business API.
3. WHEN a `POST /whatsapp/webhook` request is received, THE Webhook SHALL validate the `X-Hub-Signature-256` header using the `WHATSAPP_APP_SECRET` environment variable before processing the payload.
4. IF the `X-Hub-Signature-256` header is missing or invalid, THEN THE Webhook SHALL return HTTP 403 and discard the message.
5. WHEN a valid inbound message event is received, THE Webhook SHALL return HTTP 200 immediately and process the message asynchronously to avoid Meta delivery timeouts.
6. THE Webhook SHALL handle Meta's message deduplication by ignoring duplicate message IDs already processed within the last 24 hours.

---

### Requirement 2: Session and Conversation State Management

**User Story:** As a member, I want the chatbot to remember where I am in a conversation, so that I don't have to repeat myself or restart from scratch on every message.

#### Acceptance Criteria

1. THE Chatbot SHALL maintain a Session per unique WhatsApp phone number, storing the current menu state, conversation history, and detected Preferred_Language.
2. WHEN a member sends their first message or a session has been inactive for more than 30 minutes, THE Chatbot SHALL reset the session and present the main welcome menu.
3. WHILE a session is active, THE Chatbot SHALL retain the last 10 message turns in context when calling the LLM.
4. THE Session SHALL store the member's resolved `memberId` after successful phone number lookup, so that subsequent messages do not require re-authentication.
5. IF a member's phone number is not found in the MenoDAO member database, THEN THE Chatbot SHALL prompt the member to register via the web app at `https://app.menodao.org` and offer to send the link.
6. THE Chatbot SHALL persist session state in Redis (or an in-memory fallback for development) with a TTL of 30 minutes.

---

### Requirement 3: Language Detection and Bilingual Support

**User Story:** As a member, I want to interact with the chatbot in either English or Swahili, so that I can use the language I am most comfortable with.

#### Acceptance Criteria

1. WHEN a member's Preferred_Language is stored in the member record, THE Chatbot SHALL use that language for all system-generated messages in that session.
2. WHEN a member sends a message in Swahili and no Preferred_Language is stored, THE Chatbot SHALL detect the language and respond in Swahili for the remainder of the session.
3. WHEN a member sends a message in English and no Preferred_Language is stored, THE Chatbot SHALL respond in English for the remainder of the session.
4. THE Chatbot SHALL support a language toggle command (e.g., "switch to English" / "badilisha lugha") that updates the session language without resetting the conversation.
5. WHERE a member explicitly requests a language change, THE Chatbot SHALL update the member's `preferredLanguage` field in the database to persist the preference.
6. THE Chatbot SHALL render all Structured_Menu options, confirmation messages, and error messages in the active session language.

---

### Requirement 4: Main Menu and Navigation

**User Story:** As a member, I want a clear menu of available actions, so that I can quickly find what I need without typing long commands.

#### Acceptance Criteria

1. WHEN a session starts or a member sends "menu", "menyu", or "0", THE Chatbot SHALL present the main Structured_Menu with the following options: (1) My Subscription, (2) Find a Clinic, (3) Submit a Claim, (4) Dental Health Help, (5) Talk to a Dentist, (6) Visit History, (7) My Referrals, (8) Blockchain & NFTs, (9) Account Settings.
2. WHEN a member selects a menu option by number or button, THE Chatbot SHALL navigate to the corresponding sub-flow and update the session state.
3. WHEN a member sends a free-text message that does not match a menu option, THE Chatbot SHALL pass the message to the LLM for Intent classification before deciding whether to route to a menu flow or respond conversationally.
4. IF a member sends an unrecognised input three times in a row within the same session, THEN THE Chatbot SHALL present the main Structured_Menu again with a brief prompt.
5. THE Chatbot SHALL support a "back" command (e.g., "back", "rudi") that returns the member to the previous menu level.
6. THE Chatbot SHALL support a "cancel" command (e.g., "cancel", "acha") that returns the member to the main menu from any sub-flow.

---

### Requirement 5: Subscription Management Flow

**User Story:** As a member, I want to check my subscription status and get or upgrade a dental package via WhatsApp, so that I can manage my coverage without using the web app.

#### Acceptance Criteria

1. WHEN a member selects "My Subscription", THE Chatbot SHALL retrieve the member's current subscription from the SubscriptionsService and display the tier name, status (active/inactive), annual cap used vs. limit, and Waiting_Period status.
2. WHEN a member has no active subscription, THE Chatbot SHALL present the three available packages (MenoBronze, MenoSilver, MenoGold) with monthly and annual prices and benefits, and prompt the member to select one.
3. WHEN a member selects a package tier and payment frequency, THE Chatbot SHALL initiate the subscription via the SubscriptionsService and trigger an STK_Push to the member's registered phone number.
4. WHEN a member has an active subscription and selects "My Subscription", THE Chatbot SHALL offer the option to upgrade to a higher tier and display the upgrade cost difference.
5. WHEN a member confirms an upgrade, THE Chatbot SHALL trigger an STK_Push for the upgrade difference amount via the PaymentService.
6. WHEN an STK_Push is initiated, THE Chatbot SHALL inform the member to check their phone for the M-Pesa prompt and poll for payment confirmation for up to 3 minutes.
7. WHEN payment is confirmed, THE Chatbot SHALL send a confirmation message with the new subscription details and eligible claim date.
8. IF payment is not confirmed within 3 minutes, THEN THE Chatbot SHALL notify the member that the payment timed out and offer to retry.

---

### Requirement 6: Clinic Finder Flow

**User Story:** As a member, I want to find a nearby MenoHub clinic via WhatsApp, so that I can book a dental visit without searching online.

#### Acceptance Criteria

1. WHEN a member selects "Find a Clinic", THE Chatbot SHALL prompt the member to share their location or type their sub-county name.
2. WHEN a member shares a WhatsApp location, THE Chatbot SHALL query the ClinicsService for approved clinics and return the 3 nearest clinics with name, physical location, operating hours, and WhatsApp contact number.
3. WHEN a member types a sub-county name, THE Chatbot SHALL query the ClinicsService for approved clinics in that sub-county and return up to 5 results with name, physical location, and operating hours.
4. IF no approved clinics are found for the given location or sub-county, THEN THE Chatbot SHALL inform the member and suggest they check back later or contact support.
5. WHEN clinic results are returned, THE Chatbot SHALL include a Google Maps link for each clinic where available.
6. THE Chatbot SHALL only return clinics with `status = APPROVED` from the ClinicsService.

---

### Requirement 7: Claims Submission Flow

**User Story:** As a member, I want to submit or check the status of a dental claim via WhatsApp, so that I can manage my claims without logging into the web app.

#### Acceptance Criteria

1. WHEN a member selects "Submit a Claim", THE Chatbot SHALL check the member's subscription status and Waiting_Period before proceeding.
2. IF the member has no active subscription, THEN THE Chatbot SHALL inform the member and redirect to the subscription flow.
3. IF the member is within the Waiting_Period, THEN THE Chatbot SHALL inform the member of the exact date they become eligible to claim.
4. WHEN the member is eligible to claim, THE Chatbot SHALL inform the member that claims must be submitted at a MenoHub clinic by the attending dentist, and offer to find the nearest clinic.
5. WHEN a member asks about an existing claim status, THE Chatbot SHALL retrieve the member's most recent claims from the MembersService and display the claim status, amount, and date.
6. THE Chatbot SHALL display the member's remaining annual cap balance alongside claim status information.

---

### Requirement 8: Dental Health AI Assistance

**User Story:** As a member, I want to ask dental health questions and get helpful, accurate guidance from the chatbot, so that I can make informed decisions about my oral health.

#### Acceptance Criteria

1. WHEN a member selects "Dental Health Help" or sends a free-text message classified as a dental question by the LLM, THE Chatbot SHALL pass the message to the LLM with a dental-specialist system prompt.
2. THE LLM system prompt SHALL instruct the model to act as a knowledgeable dental health assistant for MenoDAO members in Kenya, to provide evidence-based guidance, and to recommend professional consultation for clinical decisions.
3. THE LLM system prompt SHALL include the member's current subscription tier and benefit limits as context, so that responses are relevant to the member's coverage.
4. WHEN the LLM response includes a recommendation to see a dentist, THE Chatbot SHALL append an offer to find a nearby clinic or escalate to a human dentist.
5. THE Chatbot SHALL limit LLM dental responses to a maximum of 300 words to keep messages readable on mobile.
6. IF the LLM returns an error or times out, THEN THE Chatbot SHALL respond with a fallback message and offer to connect the member to a human dentist.
7. THE Chatbot SHALL not provide specific diagnoses, prescribe medication, or replace professional dental advice, and SHALL include a brief disclaimer in dental health responses.

---

### Requirement 9: Escalation to Human Dentist

**User Story:** As a member, I want to be connected to a real dentist when I need professional advice, so that I can get help beyond what the AI can provide.

#### Acceptance Criteria

1. WHEN a member selects "Talk to a Dentist" or sends a message classified as an escalation request by the LLM, THE Chatbot SHALL present the escalation options: (a) connect via WhatsApp to a MenoDAO partner dentist, or (b) find the nearest clinic.
2. WHEN a member chooses to connect via WhatsApp, THE Chatbot SHALL send the member the WhatsApp contact number of an available MenoDAO partner dentist or support contact.
3. THE Chatbot SHALL log all escalation events with the member ID, timestamp, and reason for escalation.
4. WHEN an escalation is initiated, THE Chatbot SHALL notify the member that a human will respond within 24 hours during business hours (8am–6pm EAT, Monday–Saturday).
5. IF no partner dentist contact is configured in the system, THEN THE Chatbot SHALL fall back to directing the member to the MenoDAO support email or web app.

---

### Requirement 10: Account Settings Flow

**User Story:** As a member, I want to manage basic account settings via WhatsApp, so that I can keep my profile up to date.

#### Acceptance Criteria

1. WHEN a member selects "Account Settings" (option 9 on the main menu), THE Chatbot SHALL present options: (a) View profile, (b) Change language preference, (c) View payment history.
2. WHEN a member selects "View profile", THE Chatbot SHALL display the member's full name, phone number, subscription tier, and member since date.
3. WHEN a member selects "Change language preference", THE Chatbot SHALL present English and Swahili as options and update the member's `preferredLanguage` in the database upon selection.
4. WHEN a member selects "View payment history", THE Chatbot SHALL retrieve the last 5 contributions from the MembersService and display the amount, date, and status of each.
5. THE Chatbot SHALL not expose or allow modification of sensitive account data (e.g., phone number, password) via WhatsApp.

---

### Requirement 11: Message Delivery and Reliability

**User Story:** As a MenoDAO platform operator, I want the chatbot to reliably send and receive messages, so that members have a consistent experience.

#### Acceptance Criteria

1. THE Chatbot SHALL use the Meta WhatsApp Business API (Cloud API) to send outbound messages using the `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN` environment variables.
2. WHEN sending an outbound message fails with a transient error (HTTP 5xx or network timeout), THE Chatbot SHALL retry up to 3 times with exponential backoff before logging the failure.
3. IF an outbound message fails after all retries, THEN THE Chatbot SHALL log the failure with the member's phone number, message content, and error details for operator review.
4. THE Chatbot SHALL send typing indicators before responses that involve LLM calls or database queries to signal to the member that the bot is processing.
5. THE Chatbot SHALL respect Meta's messaging window policy: template messages SHALL be used for outbound messages sent outside the 24-hour customer service window.
6. THE Chatbot SHALL use WhatsApp interactive message types (buttons and lists) for Structured_Menu options where the number of options is 3 or fewer (buttons) or 4–10 (list messages).

---

### Requirement 12: Security and Authentication

**User Story:** As a MenoDAO platform operator, I want the chatbot to securely identify members and protect their data, so that account information is not exposed to unauthorised parties.

#### Acceptance Criteria

1. THE Chatbot SHALL identify members by matching the inbound WhatsApp phone number (normalised to E.164 format) against the `phoneNumber` field in the member database.
2. THE Chatbot SHALL not require a separate login or OTP for WhatsApp interactions, as phone number ownership is the authentication factor.
3. THE Chatbot SHALL not display full account numbers, payment references, or other sensitive identifiers in WhatsApp messages; partial masking SHALL be applied where identifiers must be shown.
4. THE Webhook SHALL validate the `X-Hub-Signature-256` signature on every inbound POST request before processing any payload data.
5. THE Chatbot SHALL rate-limit inbound messages to a maximum of 30 messages per phone number per minute, returning a polite throttle message if exceeded.
6. ALL environment variables containing secrets (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `OPENAI_API_KEY`) SHALL be loaded via the NestJS ConfigService and SHALL NOT be hardcoded.

---

### Requirement 13: Observability and Logging

**User Story:** As a MenoDAO platform operator, I want visibility into chatbot usage and errors, so that I can monitor health and debug issues.

#### Acceptance Criteria

1. THE Chatbot SHALL log every inbound message event with the phone number (hashed for privacy), session ID, detected intent, and processing duration.
2. THE Chatbot SHALL log every outbound message with the phone number (hashed), message type, and delivery status.
3. THE Chatbot SHALL log all LLM API calls with the model used, token count, latency, and whether the call succeeded or failed.
4. THE Chatbot SHALL log all escalation events with member ID, timestamp, and escalation reason.
5. WHEN an unhandled exception occurs in the chatbot module, THE Chatbot SHALL log the full error stack trace and continue processing subsequent messages without crashing the NestJS application.
6. THE Chatbot SHALL expose a `GET /whatsapp/health` endpoint that returns the status of the WhatsApp API connection and LLM API connection for operator monitoring.

---

### Requirement 14: Visit History Flow

**User Story:** As a member, I want to view my dental visit history via WhatsApp, so that I can review past treatments and costs without opening the web app.

#### Acceptance Criteria

1. WHEN a member requests their visit history, THE Chatbot SHALL retrieve the member's visits via `MembersService.getMemberHistory()` and display the 5 most recent visits.
2. WHEN displaying a visit, THE Chatbot SHALL include the visit date, clinic name, dentist name (`treatedBy`), procedures performed, and total cost covered.
3. WHEN a visit has a `web3VerificationStatus` of `VERIFIED` and a Hypercert token ID, THE Chatbot SHALL display the Hypercert NFT status and include the `metadataUrl` link so the member can view their impact proof.
4. WHEN a visit has a `web3VerificationStatus` of `PENDING`, THE Chatbot SHALL inform the member that the blockchain verification for that visit is still in progress.
5. WHEN a member asks for more details on a specific visit, THE Chatbot SHALL display the full procedure list with individual costs, the clinic name, and the dentist name for that visit.
6. IF the member has no recorded visits, THEN THE Chatbot SHALL inform the member that no visit history is available and suggest they visit a MenoHub clinic to get started.
7. THE Chatbot SHALL not display clinical data fields (`chiefComplaint`, `medicalHistory`, `clinicalNotes`, `vitals`) in WhatsApp messages to protect member health privacy.

---

### Requirement 15: Champions Referral Flow

**User Story:** As a member, I want to view and share my referral status via WhatsApp, so that I can track my champion activity and share my referral code with friends.

#### Acceptance Criteria

1. WHEN a member requests their referral status, THE Chatbot SHALL retrieve the member's champion/referral data and display their unique referral code, the number of people they have referred, and the referral rewards earned.
2. WHEN a member requests to share their referral code, THE Chatbot SHALL send a pre-formatted message containing the referral code or link that the member can forward directly from WhatsApp.
3. WHEN a member has referred at least one person, THE Chatbot SHALL display the referral count and the status of rewards associated with those referrals.
4. IF a member has no referral activity (zero referrals and no rewards), THEN THE Chatbot SHALL encourage the member to refer friends, explain the benefits of the champion programme, and display their referral code so they can start sharing.
5. THE Chatbot SHALL retrieve referral data from the member record using the existing member model referral fields.
6. WHEN displaying referral rewards, THE Chatbot SHALL show the reward amount or status in a format consistent with the member's Preferred_Language.

---

### Requirement 16: Blockchain and NFT Info Flow

**User Story:** As a member, I want to view my blockchain impact proof and NFT holdings via WhatsApp, so that I can understand and access the on-chain records of my dental care.

#### Acceptance Criteria

1. WHEN a member requests their blockchain impact proof, THE Chatbot SHALL retrieve the member's visits with a `web3VerificationStatus` of `VERIFIED` and display the Hypercert NFT token ID, verification status, and `metadataUrl` link for each verified visit.
2. WHEN a member requests their blockchain transaction history, THE Chatbot SHALL retrieve records via `MembersService.getTransactionHistory()` and display the transaction type, amount, and on-chain transaction hash for each entry.
3. WHEN displaying a Hypercert NFT, THE Chatbot SHALL explain in plain language that the NFT is a verifiable proof of dental care received, recorded permanently on the Filecoin Calibration blockchain.
4. WHEN a member has NFTs stored in `member.nfts`, THE Chatbot SHALL include a summary of the member's NFT holdings alongside the visit-level Hypercert information.
5. IF a member has no verified visits and no blockchain transactions, THEN THE Chatbot SHALL explain how the MenoDAO blockchain verification system works: dental visits are AI-verified, submitted on-chain via MenoDAOCases.sol on Filecoin Calibration, and a Hypercert NFT is minted as a permanent impact record.
6. THE Chatbot SHALL not display raw smart contract addresses or cryptographic hashes in full; THE Chatbot SHALL truncate transaction hashes to the first 8 and last 6 characters (e.g., `0x1a2b3c4d…e5f6`) for readability.
7. WHEN a visit has a `web3VerificationStatus` of `REJECTED`, THE Chatbot SHALL inform the member that the verification for that visit was not successful and suggest they contact support if they believe this is an error.
