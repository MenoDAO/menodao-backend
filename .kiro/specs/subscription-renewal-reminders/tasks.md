# Implementation Plan: Subscription Renewal Reminders

## Overview

Implement automated SMS renewal reminders, post-renewal clinic notifications, admin manual trigger endpoints, and extended promotional SMS filters. Work proceeds schema-first, then backend module, then frontend.

## Tasks

- [x] 1. Install `@nestjs/schedule` and update `AppModule`
  - Run `npm install @nestjs/schedule` in `menodao-backend`
  - Add `@types/cron` if needed (check peer deps)
  - Import `ScheduleModule.forRoot()` in `src/app.module.ts`
  - Import `RenewalReminderModule` in `src/app.module.ts` (stub module created in task 3 first — wire here after task 3)
  - _Requirements: 2.1_

- [x] 2. Add Prisma schema changes and migration
  - [x] 2.1 Update `prisma/schema.prisma`
    - Add `subCounty String?` and `county String?` fields to `Member` model
    - Add `@@index([subCounty])` to `Member`
    - Add new `ReminderLogStatus` enum with values `SENT` and `FAILED`
    - Add new `SmsReminderLog` model with fields: `id` (UUID), `memberId` (String), `phoneNumber` (String), `templateKey` (String), `sentAt` (DateTime default now), `deliveryStatus` (ReminderLogStatus), `providerMessageId` (String?)
    - Add `@@index([memberId, templateKey, sentAt])` and `@@index([sentAt])` to `SmsReminderLog`
    - No foreign key from `SmsReminderLog` to `Member`
    - _Requirements: 5.1, 5.2, 5.4, 7.1, 7.2, 7.3, 7.4_

  - [x] 2.2 Create migration file
    - Create `prisma/migrations/20260504100000_add_renewal_reminders/migration.sql`
    - `ALTER TABLE "Member" ADD COLUMN "subCounty" TEXT, ADD COLUMN "county" TEXT;`
    - `CREATE INDEX "Member_subCounty_idx" ON "Member"("subCounty");`
    - `CREATE TYPE "ReminderLogStatus" AS ENUM ('SENT', 'FAILED');`
    - `CREATE TABLE "SmsReminderLog" (...)` with all fields and indexes
    - _Requirements: 5.1, 5.2, 5.4, 7.1, 7.2, 7.3_

  - [x] 2.3 Regenerate Prisma client
    - Run `npx prisma generate` to regenerate the client with new types
    - _Requirements: 5.1, 7.1_

- [x] 3. Create `RenewalReminderModule` skeleton
  - Create directory `src/renewal-reminders/` with subdirectory `dto/`
  - Create `src/renewal-reminders/renewal-reminder.module.ts`
    - Import `PrismaModule` and `NotificationsModule`
    - Provide and export `RenewalReminderService`
    - Declare `RenewalReminderController`
  - Create stub `src/renewal-reminders/renewal-reminder.service.ts` (empty class with constructor injecting `PrismaService` and `SMSService`)
  - Create stub `src/renewal-reminders/renewal-reminder.controller.ts`
  - _Requirements: 2.1, 8.1_

- [x] 4. Extend SMS templates with three new keys
  - Modify `src/notifications/sms-templates.ts`
  - Extend `SmsTemplateKey` union type to include `'subscription_renewal_7day'`, `'subscription_renewal_1day'`, `'subscription_active_with_clinics'`
  - Add English and Swahili entries to `SMS_TEMPLATES` for all three keys
    - `subscription_renewal_7day`: variables `{{name}}`, `{{expiryDate}}`, `{{tier}}`
    - `subscription_renewal_1day`: variables `{{name}}`, `{{expiryDate}}`, `{{tier}}`
    - `subscription_active_with_clinics`: variables `{{name}}`, `{{tier}}`, `{{clinicList}}`; fallback phrase when `{{clinicList}}` is empty
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]\* 4.1 Write property test for template rendering (Property 6)
    - File: `src/renewal-reminders/renewal-reminder.service.spec.ts` (template section)
    - Use `fast-check` to generate arbitrary variable values for all three new template keys in both `en` and `sw`
    - Assert rendered string contains each variable's value as a substring
    - **Property 6: Template rendering contains all variable values**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.6**

- [x] 5. Implement `computeExpiryDate` and `selectTemplateForDaysRemaining`
  - In `src/renewal-reminders/renewal-reminder.service.ts`:
    - Implement `computeExpiryDate(startDate: Date, frequency: PaymentFrequency): Date`
      - MONTHLY → startDate + 30 days
      - ANNUAL → startDate + 365 days
    - Implement `selectTemplateForDaysRemaining(daysRemaining: number): ReminderTemplateKey`
      - `<= 1` → `subscription_renewal_1day`
      - all other values → `subscription_renewal_7day`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 8.2_

  - [ ]\* 5.1 Write property tests for `computeExpiryDate` (Properties 1 & 2)
    - File: `src/renewal-reminders/renewal-reminder.service.spec.ts`
    - Property 1: for any valid `startDate` and either frequency, result is strictly after `startDate`
    - Property 2: MONTHLY offset is exactly 30 days, ANNUAL is exactly 365 days
    - **Property 1: Expiry date is always after start date**
    - **Validates: Requirements 1.4**
    - **Property 2: Expiry date offset matches payment frequency**
    - **Validates: Requirements 1.1, 1.2**

  - [ ]\* 5.2 Write property test for `selectTemplateForDaysRemaining` (Property 7)
    - File: `src/renewal-reminders/renewal-reminder.service.spec.ts`
    - For any integer `daysRemaining`, assert correct template key is returned
    - **Property 7: Template selection maps days-remaining to correct key**
    - **Validates: Requirements 8.1, 8.2**

- [x] 6. Implement idempotency check and `SmsReminderLog` persistence
  - In `src/renewal-reminders/renewal-reminder.service.ts`:
    - Implement `private isAlreadySentToday(memberId: string, templateKey: string): Promise<boolean>`
      - Query `SmsReminderLog` for matching `memberId`, `templateKey`, and `sentAt` date matching current calendar date in EAT (UTC+3)
    - Implement `private persistLog(memberId: string, phoneNumber: string, templateKey: string, deliveryStatus: ReminderLogStatus, providerMessageId?: string): Promise<SmsReminderLog>`
  - _Requirements: 3.1, 3.2, 3.3, 7.1, 7.2_

  - [ ]\* 6.1 Write unit tests for `isAlreadySentToday`
    - Mock `PrismaService`, test found/not-found cases and date boundary behaviour
    - _Requirements: 3.1, 3.2_

- [x] 7. Implement `sendRenewalReminder` and the daily cron job
  - In `src/renewal-reminders/renewal-reminder.service.ts`:
    - Implement `sendRenewalReminder(memberId: string, templateKey: ReminderTemplateKey): Promise<SmsReminderLog>`
      - Check idempotency via `isAlreadySentToday`; skip and return existing log if already sent
      - Fetch member (name, phoneNumber, subscription startDate + frequency + tier)
      - Compute expiry date, render template, call `SMSService.sendSms`
      - Persist `SmsReminderLog` with `SENT` or `FAILED` status
      - Log INFO on success, ERROR on failure (Requirements 11.1, 11.2)
    - Implement `handleDailyReminderCron()` decorated with `@Cron('0 6 * * *')` (09:00 EAT = 06:00 UTC)
      - Query active subscriptions expiring in exactly 7 days (midnight-to-midnight EAT window)
      - Query active subscriptions expiring in exactly 1 day
      - Call `sendRenewalReminder` for each; never abort on individual failure
      - Log summary at INFO level: total checked, 7-day sent, 1-day sent, failed, skipped (Requirement 11.3)
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.1, 3.2, 11.1, 11.2, 11.3_

  - [ ]\* 7.1 Write property test for subscription window filter (Property 3)
    - File: `src/renewal-reminders/renewal-reminder.service.spec.ts`
    - Generate arbitrary sets of subscriptions with random `startDate` and `paymentFrequency`
    - Assert the window filter returns exactly those whose computed expiry falls within the target window
    - **Property 3: Subscription window filter correctness**
    - **Validates: Requirements 2.2, 2.3, 8.3, 8.4**

  - [ ]\* 7.2 Write property test for idempotency (Property 4)
    - Simulate running the dispatch logic twice on the same reference date for the same member set
    - Assert the second run creates zero new `SmsReminderLog` records
    - **Property 4: Idempotency — running the job twice produces the same log count**
    - **Validates: Requirements 3.1, 3.2, 3.3, 8.7**

- [x] 8. Implement `getApprovedClinicsForSubCounty` and `sendPostRenewalNotification`
  - In `src/renewal-reminders/renewal-reminder.service.ts`:
    - Implement `private getApprovedClinicsForSubCounty(subCounty: string | null): Promise<ClinicSummary[]>`
      - Query `Clinic` where `status = APPROVED` and `subCounty` matches (case-insensitive); limit 5
      - Return `[]` if `subCounty` is null/empty (log WARNING with memberId)
    - Implement `sendPostRenewalNotification(memberId: string): Promise<void>`
      - Fetch member subCounty, name, phoneNumber, subscription tier
      - Call `getApprovedClinicsForSubCounty`; format as `{name} – {whatsappNumber}`
      - Render `subscription_active_with_clinics` template (fallback phrase if no clinics)
      - Call `SMSService.sendSms`, persist `SmsReminderLog` with `templateKey = subscription_active_with_clinics`
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ]\* 8.1 Write property test for clinic list (Property 5)
    - Generate arbitrary sets of clinics with random statuses and sub-counties
    - Assert result contains only APPROVED clinics matching the sub-county and has at most 5 entries
    - **Property 5: Clinic list is bounded and filtered**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5**

- [x] 9. Implement admin DTOs and `RenewalReminderController`
  - Create `src/renewal-reminders/dto/trigger-member.dto.ts`
    - `memberId: string` with `@IsString()` and `@IsNotEmpty()`
  - Create `src/renewal-reminders/dto/trigger-bulk.dto.ts`
    - `daysUntilExpiry: number` with `@IsInt()`, `@Min(1)`, `@Max(30)`
  - Create `src/renewal-reminders/dto/trigger-bulk-response.dto.ts`
    - Interface `TriggerBulkResult { triggered: number; skipped: number; failed: number }`
  - Implement `src/renewal-reminders/renewal-reminder.controller.ts`
    - `@Controller('admin/reminders')` with `@UseGuards(AdminAuthGuard)`
    - `POST trigger-member` → calls `triggerMemberReminder(dto.memberId)`
    - `POST trigger-bulk` → calls `triggerBulkReminder(dto.daysUntilExpiry)`
  - _Requirements: 8.1, 8.3, 8.5, 8.6, 8.8_

- [x] 10. Implement `triggerMemberReminder` and `triggerBulkReminder` in service
  - In `src/renewal-reminders/renewal-reminder.service.ts`:
    - Implement `triggerMemberReminder(memberId: string): Promise<TriggerMemberResult>`
      - Fetch active subscription; throw `NotFoundException` (HTTP 404) if not found
      - Compute days remaining; select template via `selectTemplateForDaysRemaining`
      - Call `sendRenewalReminder` with idempotency check applied
      - Return `{ phoneNumber, templateKey }`
    - Implement `triggerBulkReminder(daysUntilExpiry: number): Promise<TriggerBulkResult>`
      - Find all active subscriptions with computed expiry within `daysUntilExpiry` days
      - Call `sendRenewalReminder` for each; accumulate triggered/skipped/failed counts
      - Return `TriggerBulkResult`
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 11.4_

  - [ ]\* 10.1 Write unit tests for `triggerMemberReminder`
    - Test 404 path (no active subscription) and success path (correct template selected)
    - _Requirements: 8.2, 8.6_

  - [ ]\* 10.2 Write unit tests for `triggerBulkReminder`
    - Test response shape `{ triggered, skipped, failed }` with mocked service
    - _Requirements: 8.3, 8.4, 11.4_

- [x] 11. Wire `RenewalReminderService` into `SubscriptionsService`
  - Modify `src/subscriptions/subscriptions.module.ts`
    - Import `RenewalReminderModule`
  - Modify `src/subscriptions/subscriptions.service.ts`
    - Inject `RenewalReminderService` via constructor
    - In `activateSubscription()`, after the subscription `isActive = true` update and before NFT minting, add non-blocking call:
      ```typescript
      try {
        await this.renewalReminderService.sendPostRenewalNotification(memberId);
      } catch (error) {
        this.logger.error('Post-renewal notification failed:', error);
      }
      ```
  - _Requirements: 4.1_

- [x] 12. Checkpoint — ensure backend compiles and all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Extend `FilterService` with `subCounty` and `tier` filters
  - Modify `src/notifications/dto/recipient-filters.dto.ts`
    - Add `subCounty?: string` and `tier?: PackageTier | 'ALL'` to `RecipientFilters`
  - Modify `src/notifications/filter.service.ts` in `buildWhereClause`:
    - Add `subCounty` branch: `{ subCounty: { equals: filters.subCounty, mode: 'insensitive' } }`
    - Add `tier` branch (skip when `'ALL'`): `{ subscription: { tier: filters.tier as PackageTier } }`
  - _Requirements: 9.1, 9.2, 9.3_

  - [ ]\* 13.1 Write unit tests for new `FilterService` branches
    - Test `subCounty` filter (case-insensitive), `tier` filter, combined AND logic, and `tier = ALL` passthrough
    - _Requirements: 9.1, 9.2, 9.3_

  - [ ]\* 13.2 Write property test for combined filter subset (Property 8)
    - File: `src/notifications/filter.service.spec.ts`
    - Generate arbitrary member datasets, tier values, and subCounty values
    - Assert `(tier + subCounty)` result is a subset of `(tier only)` and `(subCounty only)` results
    - **Property 8: Combined filter is a subset of each individual filter**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.8**

- [x] 14. Extend `admin-api.ts` with reminder endpoints and filter types
  - Modify `menodao-frontend/src/lib/admin-api.ts`
  - Add `subCounty?: string` and `tier?: string` to the `RecipientFilters` interface
  - Add `triggerMemberReminder(memberId: string)` method → `POST /admin/reminders/trigger-member`
    - Returns `{ phoneNumber: string; templateKey: string }`
  - Add `triggerBulkReminder(daysUntilExpiry: number)` method → `POST /admin/reminders/trigger-bulk`
    - Returns `{ triggered: number; skipped: number; failed: number }`
  - _Requirements: 8.1, 8.3, 9.4, 9.7, 10.2, 10.4_

- [x] 15. Create `NotificationPanel` component
  - Create `menodao-frontend/src/app/admin/components/NotificationPanel.tsx`
  - Single Member section: Member ID text input + "Send Reminder" button
    - On submit: call `adminApi.triggerMemberReminder(memberId)`
    - Show success message with phone number and template key used
    - Show API error message on failure
    - Disable button and show loading indicator while in-flight
  - Bulk Reminder section: numeric input for Days Until Expiry (1–30) + "Send to All Expiring" button
    - On submit: call `adminApi.triggerBulkReminder(daysUntilExpiry)`
    - Show success message with count of members notified
    - Show API error message on failure
    - Disable button and show loading indicator while in-flight
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [ ]\* 15.1 Write unit tests for `NotificationPanel`
    - File: `menodao-frontend/src/app/admin/components/NotificationPanel.test.tsx`
    - Test renders member ID input, days input, and both submit buttons
    - Test submitting valid member ID calls `POST /admin/reminders/trigger-member` and shows success state
    - Test submitting bulk form calls `POST /admin/reminders/trigger-bulk` and shows count
    - Test API error displays error message and re-enables buttons
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [x] 16. Extend `SendNotification` component with sub-county and tier filters
  - Modify `menodao-frontend/src/app/admin/components/SendNotification.tsx`
  - Add `subCounty: string` and `tier: 'ALL' | 'BRONZE' | 'SILVER' | 'GOLD'` to the local `RecipientFilters` interface (default `''` and `'ALL'`)
  - Add Sub-County text input (`placeholder="e.g. Westlands"`) in the Recipient Filters section
  - Add Tier `<select>` with options `All | Bronze | Silver | Gold` in the Recipient Filters section
  - Include `subCounty` and `tier` in the `apiFilters` object passed to `previewRecipients` and `sendNotification` (omit `subCounty` when empty; send `tier` as `ALL` when "All" is selected)
  - Reset both fields in the post-send form reset block
  - _Requirements: 9.4, 9.5, 9.6, 9.7_

  - [ ]\* 16.1 Write unit tests for `SendNotification` filter extensions
    - File: `menodao-frontend/src/app/admin/components/SendNotification.test.tsx`
    - Test sub-county text input renders and updates state
    - Test tier selector renders with correct options
    - Test changing tier/sub-county triggers debounced preview update
    - _Requirements: 9.4, 9.5, 9.6_

- [x] 17. Add `NotificationPanel` to the admin alerts page
  - Modify `menodao-frontend/src/app/admin/alerts/page.tsx`
  - Import `NotificationPanel` component
  - Add a "Renewal Reminders" navigation card (alongside the existing Send and History cards) that links to a new sub-page, OR render `NotificationPanel` inline on the alerts overview page
  - The panel must be accessible from the existing admin notifications page alongside `SendNotification` and `NotificationHistory`
  - _Requirements: 10.7_

- [x] 18. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Cron expression `0 6 * * *` = 09:00 EAT (UTC+3)
- `SmsReminderLog` has no FK to `Member` — log records survive member deletion
- `RenewalReminderModule` must NOT import `SubscriptionsModule` to avoid circular deps; instead `SubscriptionsModule` imports `RenewalReminderModule`
- Property tests use `fast-check` (already in devDependencies)
