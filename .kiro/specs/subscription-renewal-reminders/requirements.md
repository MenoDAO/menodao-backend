# Requirements Document

## Introduction

MenoDAO members currently receive no automated notification when their dental subscription is about to expire, and there is no confirmation SMS when a subscription is renewed. This feature adds four capabilities spanning the backend (NestJS/Prisma) and admin frontend (Next.js 14):

1. **Automated renewal reminders** — a daily cron job that finds subscriptions expiring in 7 days and 1 day and sends templated SMS reminders.
2. **Post-renewal clinic notification** — when a subscription is activated or renewed, an SMS is sent confirming activation and listing up to 5 approved clinics in the member's sub-county.
3. **Admin manual reminder trigger** — admins can trigger the renewal reminder for a single member or for all members expiring within N days.
4. **Admin promotional SMS** — admins can send a custom SMS to a filtered group of members, with new filter dimensions for tier and sub-county added to the existing notification UI.

The `Subscription` model has no `expiryDate` field; expiry must be derived from `startDate + paymentFrequency`. The `Member` model has no `subCounty` field; one must be added. An `SmsReminderLog` table must be introduced to enforce idempotency and provide an audit trail.

---

## Glossary

- **Renewal_Reminder_Service**: The NestJS service responsible for computing subscription expiry dates, selecting members due for reminders, and dispatching SMS via `SMSService`.
- **Cron_Job**: The scheduled task registered with `@nestjs/schedule` that runs daily at 09:00 EAT and invokes `Renewal_Reminder_Service`.
- **Subscription**: The Prisma model representing a member's dental cover, containing `startDate`, `paymentFrequency` (MONTHLY | ANNUAL), `isActive`, and `tier`.
- **Expiry_Date**: The computed date on which a subscription lapses — `startDate + 30 days` for MONTHLY, `startDate + 365 days` for ANNUAL.
- **SmsReminderLog**: A new Prisma model that records each automated reminder SMS sent, used to enforce idempotency.
- **SMSService**: The existing `src/notifications/sms.service.ts` service that renders templates and dispatches SMS via the configured provider.
- **Clinic**: The existing Prisma model for partner dental clinics, with fields `status` (APPROVED | …), `subCounty`, `name`, and `whatsappNumber`.
- **Sub_County**: The administrative sub-county of a member, stored on the `Member` model (new field `subCounty`).
- **Admin_Reminder_Controller**: The new NestJS controller endpoint(s) that allow admins to manually trigger renewal reminders.
- **Notification_Panel**: The new React component in the admin dashboard for triggering renewal reminders.
- **SendNotification**: The existing `SendNotification.tsx` component in the admin dashboard, to be extended with tier and sub-county filters.
- **EAT**: East Africa Time (UTC+3), the timezone used for scheduling the cron job.

---

## Requirements

### Requirement 1: Subscription Expiry Date Derivation

**User Story:** As a backend service, I want to compute a subscription's expiry date from its `startDate` and `paymentFrequency`, so that reminder logic does not depend on a stored `expiryDate` field.

#### Acceptance Criteria

1. WHEN `paymentFrequency` is `MONTHLY`, THE `Renewal_Reminder_Service` SHALL compute `Expiry_Date` as `startDate` plus 30 calendar days.
2. WHEN `paymentFrequency` is `ANNUAL`, THE `Renewal_Reminder_Service` SHALL compute `Expiry_Date` as `startDate` plus 365 calendar days.
3. THE `Renewal_Reminder_Service` SHALL expose a pure function `computeExpiryDate(startDate: Date, frequency: PaymentFrequency): Date` that performs this calculation with no side effects.
4. FOR ALL valid `startDate` values and `paymentFrequency` values, the computed `Expiry_Date` SHALL be strictly after `startDate`.

---

### Requirement 2: Daily Automated Renewal Reminder Cron Job

**User Story:** As a MenoDAO member, I want to receive an SMS reminder 7 days and 1 day before my subscription expires, so that I have time to ensure my M-Pesa is funded for renewal.

#### Acceptance Criteria

1. THE `Cron_Job` SHALL execute once per calendar day at 09:00 EAT.
2. WHEN the `Cron_Job` executes, THE `Renewal_Reminder_Service` SHALL query all `Subscription` records where `isActive` is `true` and the computed `Expiry_Date` falls exactly 7 calendar days from the current date (midnight-to-midnight window in EAT).
3. WHEN the `Cron_Job` executes, THE `Renewal_Reminder_Service` SHALL query all `Subscription` records where `isActive` is `true` and the computed `Expiry_Date` falls exactly 1 calendar day from the current date (midnight-to-midnight window in EAT).
4. WHEN a subscription is identified as expiring in 7 days, THE `Renewal_Reminder_Service` SHALL send an SMS to the member's `phoneNumber` using the `subscription_renewal_7day` template.
5. WHEN a subscription is identified as expiring in 1 day, THE `Renewal_Reminder_Service` SHALL send an SMS to the member's `phoneNumber` using the `subscription_renewal_1day` template.
6. WHEN an SMS is dispatched by the `Cron_Job`, THE `Renewal_Reminder_Service` SHALL create an `SmsReminderLog` record containing `memberId`, `phoneNumber`, `templateKey`, `sentAt` (UTC timestamp), and `deliveryStatus`.
7. IF the `SMSService` returns a failure result for a member, THEN THE `Renewal_Reminder_Service` SHALL record `deliveryStatus` as `FAILED` in the `SmsReminderLog` and SHALL continue processing remaining members without aborting the job.
8. THE `Cron_Job` SHALL complete processing of all eligible members regardless of individual SMS delivery failures.

---

### Requirement 3: Idempotent Reminder Delivery

**User Story:** As a system operator, I want the reminder cron job to be safe to run multiple times in a day, so that infrastructure restarts or manual re-runs do not cause members to receive duplicate SMS messages.

#### Acceptance Criteria

1. BEFORE sending a reminder SMS, THE `Renewal_Reminder_Service` SHALL check the `SmsReminderLog` for an existing record with the same `memberId`, `templateKey`, and a `sentAt` date matching the current calendar date in EAT.
2. IF a matching `SmsReminderLog` record exists for the current day, THEN THE `Renewal_Reminder_Service` SHALL skip sending the SMS to that member and SHALL NOT create a duplicate log entry.
3. FOR ALL members eligible for a reminder on a given day, running the `Cron_Job` twice on that day SHALL produce the same number of `SmsReminderLog` records as running it once.

---

### Requirement 4: Post-Renewal Clinic Notification

**User Story:** As a MenoDAO member, I want to receive an SMS when my subscription is activated or renewed that confirms my cover is active and lists nearby approved clinics, so that I know where I can visit immediately.

#### Acceptance Criteria

1. WHEN a `Subscription` transitions to `isActive = true` (via `SubscriptionsService.activateSubscription`), THE `Renewal_Reminder_Service` SHALL send an SMS to the member's `phoneNumber` using the `subscription_active_with_clinics` template.
2. WHEN composing the `subscription_active_with_clinics` SMS, THE `Renewal_Reminder_Service` SHALL query the `Clinic` model for records where `status = APPROVED` and `subCounty` matches the member's `Sub_County`.
3. THE `Renewal_Reminder_Service` SHALL include up to 5 clinics in the SMS, each formatted as `{name} – {whatsappNumber}`.
4. IF fewer than 5 approved clinics exist in the member's `Sub_County`, THE `Renewal_Reminder_Service` SHALL include all available approved clinics without padding.
5. IF no approved clinics exist in the member's `Sub_County`, THE `Renewal_Reminder_Service` SHALL send the `subscription_active_with_clinics` SMS with a message indicating no clinics are currently listed for the area.
6. IF the member's `Sub_County` field is null or empty, THE `Renewal_Reminder_Service` SHALL send the `subscription_active_with_clinics` SMS without a clinic list and SHALL log a warning.
7. WHEN an SMS is dispatched for post-renewal notification, THE `Renewal_Reminder_Service` SHALL create an `SmsReminderLog` record with `templateKey = subscription_active_with_clinics`.

---

### Requirement 5: Member Sub-County Field

**User Story:** As the system, I need to know a member's sub-county so that post-renewal clinic notifications can be localised to their area.

#### Acceptance Criteria

1. THE `Member` model SHALL include a nullable `subCounty` field of type `String`.
2. THE `Member` model SHALL include a nullable `county` field of type `String`.
3. WHEN a member registers or updates their profile, THE system SHALL accept `subCounty` and `county` as optional input fields.
4. THE `subCounty` field SHALL be indexed in the database to support efficient clinic lookup queries.

---

### Requirement 6: SMS Template Extensions

**User Story:** As the SMS delivery system, I need distinct templates for 7-day reminders, 1-day reminders, and post-renewal clinic notifications, so that each message is appropriately worded.

#### Acceptance Criteria

1. THE `SMSService` template catalogue SHALL include a `subscription_renewal_7day` template with variables `{{name}}`, `{{expiryDate}}`, and `{{tier}}`.
2. THE `SMSService` template catalogue SHALL include a `subscription_renewal_1day` template with variables `{{name}}`, `{{expiryDate}}`, and `{{tier}}`.
3. THE `SMSService` template catalogue SHALL include a `subscription_active_with_clinics` template with variables `{{name}}`, `{{tier}}`, and `{{clinicList}}`.
4. WHEN `{{clinicList}}` is empty, THE `subscription_active_with_clinics` template SHALL render a fallback phrase indicating no clinics are listed for the area.
5. THE `SMSService` template catalogue SHALL provide English (`en`) and Swahili (`sw`) variants for all three new templates.
6. FOR ALL new templates, rendering the template with a complete set of variables SHALL produce a string containing each variable's value.

---

### Requirement 7: SmsReminderLog Model

**User Story:** As a system operator, I want a persistent log of all automated reminder SMS sends, so that I can audit delivery, debug failures, and enforce idempotency.

#### Acceptance Criteria

1. THE `SmsReminderLog` Prisma model SHALL contain fields: `id` (UUID), `memberId` (String), `phoneNumber` (String), `templateKey` (String), `sentAt` (DateTime, UTC), `deliveryStatus` (`SENT` | `FAILED`), and `providerMessageId` (nullable String).
2. THE `SmsReminderLog` model SHALL be indexed on `(memberId, templateKey, sentAt)` to support idempotency checks.
3. THE `SmsReminderLog` model SHALL be indexed on `sentAt` to support date-range queries for admin reporting.
4. THE `SmsReminderLog` SHALL be a standalone model with no cascading deletes — log records SHALL be retained even if the associated member is deleted.

---

### Requirement 8: Admin Manual Reminder Trigger

**User Story:** As an admin, I want to manually trigger renewal reminder SMS messages for a specific member or for all members expiring within a given number of days, so that I can handle edge cases and support members who missed automated reminders.

#### Acceptance Criteria

1. THE `Admin_Reminder_Controller` SHALL expose a `POST /admin/reminders/trigger-member` endpoint that accepts `{ memberId: string }` and sends the appropriate renewal reminder SMS to that member.
2. WHEN `POST /admin/reminders/trigger-member` is called, THE `Admin_Reminder_Controller` SHALL determine whether the member's subscription expires in 7 days (send `subscription_renewal_7day`) or 1 day (send `subscription_renewal_1day`), and SHALL default to `subscription_renewal_7day` if the expiry is more than 7 days away.
3. THE `Admin_Reminder_Controller` SHALL expose a `POST /admin/reminders/trigger-bulk` endpoint that accepts `{ daysUntilExpiry: number }` where `daysUntilExpiry` is an integer between 1 and 30 inclusive.
4. WHEN `POST /admin/reminders/trigger-bulk` is called, THE `Admin_Reminder_Controller` SHALL find all active subscriptions with a computed `Expiry_Date` within `daysUntilExpiry` calendar days from today and send the `subscription_renewal_7day` template to each member.
5. IF `daysUntilExpiry` is less than 1 or greater than 30, THEN THE `Admin_Reminder_Controller` SHALL return HTTP 400 with a descriptive error message.
6. IF `memberId` does not correspond to an existing member with an active subscription, THEN THE `Admin_Reminder_Controller` SHALL return HTTP 404.
7. WHEN admin-triggered reminders are sent, THE `Renewal_Reminder_Service` SHALL create `SmsReminderLog` records for each SMS dispatched, with the same idempotency check applied as for automated sends.
8. ALL endpoints on `Admin_Reminder_Controller` SHALL require `AdminAuthGuard` authentication.

---

### Requirement 9: Admin Promotional SMS — Sub-County and Tier Filters

**User Story:** As an admin, I want to send a custom promotional SMS to a filtered group of members by tier, subscription status, and sub-county, so that I can run targeted campaigns (e.g., re-engagement for inactive BRONZE members in Westlands).

#### Acceptance Criteria

1. THE `FilterService` SHALL accept an optional `subCounty` filter parameter that restricts recipients to members whose `Sub_County` matches the provided value (case-insensitive).
2. THE `FilterService` SHALL accept an optional `tier` filter parameter with values `BRONZE`, `SILVER`, `GOLD`, or `ALL` that restricts recipients to members with a matching subscription tier.
3. WHEN both `subCounty` and `tier` filters are provided, THE `FilterService` SHALL apply both filters with AND logic, returning only members matching both criteria.
4. THE `SendNotification` frontend component SHALL display a "Sub-County" text input field in the Recipient Filters section.
5. THE `SendNotification` frontend component SHALL display a "Tier" selector with options `All`, `Bronze`, `Silver`, `Gold` in the Recipient Filters section.
6. WHEN the admin selects a tier or enters a sub-county, THE `SendNotification` component SHALL update the recipient preview count within 500ms using the existing debounced preview mechanism.
7. WHEN the admin submits the notification form with tier and/or sub-county filters set, THE `SendNotification` component SHALL include those filter values in the API request payload.
8. THE recipient set for filter `(tier=BRONZE, subCounty=X)` SHALL always be a subset of the recipient set for filter `(tier=BRONZE)` alone.

---

### Requirement 10: Admin Renewal Reminder UI Panel

**User Story:** As an admin, I want a dedicated panel in the admin dashboard to trigger renewal reminders, so that I can support members without using the general notification tool.

#### Acceptance Criteria

1. THE `Notification_Panel` SHALL render a form with a "Member ID" text input and a "Send Reminder" button for triggering a single-member reminder.
2. WHEN the admin submits a valid member ID, THE `Notification_Panel` SHALL call `POST /admin/reminders/trigger-member` and display a success message showing the member's phone number and the template used.
3. THE `Notification_Panel` SHALL render a "Bulk Reminder" section with a numeric input for "Days Until Expiry" (range 1–30) and a "Send to All Expiring" button.
4. WHEN the admin submits the bulk reminder form, THE `Notification_Panel` SHALL call `POST /admin/reminders/trigger-bulk` and display a success message showing the count of members notified.
5. IF either API call returns an error, THE `Notification_Panel` SHALL display the error message returned by the API.
6. WHILE an API call is in progress, THE `Notification_Panel` SHALL disable the submit buttons and display a loading indicator.
7. THE `Notification_Panel` SHALL be accessible from the existing admin notifications page alongside the `SendNotification` and `NotificationHistory` components.

---

### Requirement 11: SMS Delivery Logging and Observability

**User Story:** As a system operator, I want all automated and admin-triggered SMS sends to be logged with delivery status, so that I can monitor delivery rates and investigate failures.

#### Acceptance Criteria

1. THE `Renewal_Reminder_Service` SHALL log a structured message at INFO level for each SMS successfully dispatched, including `memberId`, `templateKey`, and `providerMessageId`.
2. THE `Renewal_Reminder_Service` SHALL log a structured message at ERROR level for each SMS that fails delivery, including `memberId`, `templateKey`, and the provider error message.
3. WHEN the `Cron_Job` completes a run, THE `Renewal_Reminder_Service` SHALL log a summary at INFO level including: total subscriptions checked, count of 7-day reminders sent, count of 1-day reminders sent, count of failures, and count of skipped (idempotency).
4. THE `Admin_Reminder_Controller` SHALL return a response body for bulk trigger calls that includes `{ triggered: number, skipped: number, failed: number }`.
