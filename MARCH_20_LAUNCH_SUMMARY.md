# Protocol v5.0 - March 20th Launch Summary

## What's Been Completed (Part 1 - Backend Core) ✅

### 1. Database Schema & Migration

**Status**: ✅ Complete and pushed to dev

**Changes**:

- Created migration: `20260301170000_protocol_v5_updates/migration.sql`
- Added `PaymentFrequency` enum (MONTHLY, ANNUAL)
- Updated `Subscription` model with 6 new fields for tracking:
  - `paymentFrequency`: Monthly or annual payment
  - `subscriptionStartDate`: For waiting period calculation
  - `annualCapUsed`: Tracks spending against annual cap
  - `annualCapLimit`: 6k, 10k, or 15k based on tier
  - `procedureUsageCount`: JSON tracking procedure frequency
  - `lastResetDate`: Last annual reset date
- Made `Clinic.kmpdcRegNumber` required (NOT NULL) - legal requirement
- Added performance indexes

**Migration Notes**:

- Existing subscriptions will be updated with default values
- `subscriptionStartDate` set to existing `startDate`
- Annual caps set based on tier (6k/10k/15k)
- KMPDC numbers set to 'PENDING_VERIFICATION' if NULL

### 2. Tier Renaming & Pricing

**Status**: ✅ Complete

**New Names**:

- BRONZE → **MenoBronze**
- SILVER → **MenoSilver**
- GOLD → **MenoGold**

**Pricing (Protocol v5.0)**:
| Tier | Monthly | Annual | Annual Cap |
|------|---------|--------|------------|
| MenoBronze | 350 KES | 4,200 KES | 6,000 KES |
| MenoSilver | 550 KES | 6,600 KES | 10,000 KES |
| MenoGold | 700 KES | 8,400 KES | 15,000 KES |

### 3. Procedure Rate Card Update

**Status**: ✅ Complete

**New Rate Card**:

- Consultation: **1,000 KES** (was 500)
- Simple Extraction: **1,500 KES** (was 800)
- Scaling & Polishing: **3,500 KES** (NEW)
- Composite Filling: **4,000 KES** (was 1,200)
- Anterior Root Canal: **10,000 KES** (was 5,000)
- Antibiotic Therapy: **1,000 KES** (NEW)

**Removed Old Procedures**:

- Basic Screening (300 KES)
- Pain Relief/Panadol (200 KES)
- Complex Extraction (1,500 KES)
- X-Ray (1,000 KES)
- Root Canal Emergency (5,000 KES)

### 4. Frequency Limits Per Tier

**Status**: ✅ Complete

**MenoBronze** (per year):

- Consultation: 1
- Simple Extraction: 1
- Scaling & Polishing: 1
- All others: LOCKED (0)

**MenoSilver** (per year):

- Consultation: 1
- Simple Extraction: 1
- Scaling & Polishing: 1
- Composite Filling: 1
- Root Canal & Antibiotics: LOCKED (0)

**MenoGold** (per year):

- Consultation: 2
- Simple Extraction: 2
- Scaling & Polishing: 2
- Composite Filling: 2
- Anterior Root Canal: 1
- Antibiotic Therapy: Unlimited (within cap)

### 5. Waiting Periods

**Status**: ✅ Complete

**Annual Payers**: 14 days for ALL procedures

**Monthly Payers**:

- Emergency (Consultation, Extraction): 60 days
- Restorative (Scaling, Filling, Root Canal, Antibiotics): 90 days

**Implementation**: Hard block - system prevents check-in/procedures during waiting period

### 6. Subscription Rules Service

**Status**: ✅ Complete

**New Service**: `subscription-rules.service.ts`

**Features**:

- `checkWaitingPeriod()`: Validates if waiting period passed
- `checkFrequencyLimit()`: Validates procedure usage count
- `checkAnnualCap()`: Validates spending against cap
- `checkProcedureEligibility()`: Comprehensive check (all 3 above)
- `incrementProcedureUsage()`: Updates counters after procedure
- `resetAnnualCounters()`: Resets on anniversary (365 days)
- `checkAndResetIfDue()`: Auto-reset check

### 7. Antibiotic Therapy Details

**Status**: ✅ Complete

**Procedure**: Antibiotic Therapy (1,000 KES)

**Includes**:

- First-line antibiotics (generic):
  - Amoxicillin 500mg
  - Metronidazole (Flagyl) 400mg
- Alternatives (penicillin-allergic):
  - Erythromycin 500mg
  - Clindamycin 300mg
- Pain management:
  - Ibuprofen 400mg
  - Diclofenac 50mg
  - Paracetamol 500mg

**Standard Dispensation**: 5-day course (Amoxicillin + Ibuprofen + Metronidazole)

---

## What Remains (Part 2 - Integration & Frontend) ⏳

### 8. Visits Service Integration

**Status**: ⏳ Pending
**Priority**: HIGH
**Estimated Time**: 2-3 hours

**Tasks**:

- Inject `SubscriptionRulesService` into `VisitsService`
- Update `searchMember()` to check waiting period and show status
- Update `addProcedure()` to:
  - Check eligibility before adding
  - Show warnings for frequency limits
  - Show warnings for cap exceeded
  - Allow staff override (triggers out-of-pocket payment)
- Update claim creation to use `incrementProcedureUsage()`
- Replace old claim limits with annual caps

### 9. Patient Treatment History

**Status**: ⏳ Pending
**Priority**: HIGH
**Estimated Time**: 2-3 hours

**Requirements**:

- New endpoint: `GET /visits/history/:memberId`
- Return all visits chronologically (most recent first)
- Include:
  - Visit date, procedures, costs
  - Questionnaire data (if available)
  - Clinic name
  - Staff who treated
- Privacy controls:
  - Phone: Show last 4 digits only (\*\*\*\*1234)
  - Full details only when viewing specific visit
- Filtering:
  - Staff see own clinic visits primarily
  - Show other MenoDAO visits (labeled "Other Clinic")
- Search functionality:
  - By phone number
  - By name
  - Filter by date range

### 10. Clinic Registration Updates

**Status**: ⏳ Pending
**Priority**: MEDIUM
**Estimated Time**: 30 minutes

**Tasks**:

- Update `CreateClinicDto` to make `kmpdcRegNumber` required
- Add validation: alphanumeric, min 5 characters
- Update frontend form to show required field
- Add validation error messages

### 11. Out-of-Pocket Payment Flow

**Status**: ⏳ Pending
**Priority**: HIGH
**Estimated Time**: 3-4 hours

**Requirements**:

- When frequency limit reached or cap exceeded:
  - Show warning dialog
  - Display procedure cost
  - Offer options:
    - Cancel procedure
    - Pay out-of-pocket (M-Pesa)
- Integrate with existing SasaPay flow
- Create new payment type: "OUT_OF_POCKET"
- After successful payment, allow procedure
- Don't count against frequency limits or caps

### 12. Frontend Implementation

**Status**: ⏳ Pending
**Priority**: HIGH
**Estimated Time**: 6-8 hours

**Components to Create/Update**:

**a) Patient History Viewer** (3-4 hours)

- New tab in staff dashboard: "Patient History"
- Search bar (phone/name)
- Visit list with expandable details
- Privacy controls (masked PII)
- Questionnaire data viewer
- Filter by date range

**b) Waiting Period Indicators** (1 hour)

- Show waiting period status on check-in
- Display days remaining
- Block check-in button if not eligible
- Clear error messages

**c) Frequency Limit Warnings** (1-2 hours)

- Show usage count when adding procedures
- Warning dialog when limit reached
- Override option with payment prompt

**d) Annual Cap Progress** (1 hour)

- Progress bar showing cap usage
- Display: "KES X,XXX / X,XXX used"
- Warning when approaching limit
- Override option with payment

**e) Tier Name Updates** (30 mins)

- Update all references to show "Meno" prefix
- Update package selection UI
- Update member cards/badges

**f) KMPDC Form Update** (30 mins)

- Make field required
- Add validation
- Update error messages

### 13. Database Migration

**Status**: ⏳ Pending
**Priority**: HIGH
**Estimated Time**: 1 hour

**Steps**:

1. Backup dev database
2. Run migration on dev: `npx prisma migrate deploy`
3. Verify data integrity:
   - Check subscription fields populated
   - Check KMPDC numbers updated
   - Check indexes created
4. Test with real data
5. Document any issues
6. Prepare production migration plan

### 14. Testing

**Status**: ⏳ Pending
**Priority**: CRITICAL
**Estimated Time**: 4-6 hours

**Test Cases**:

**Waiting Period**:

- [ ] New subscription blocks procedures during waiting period
- [ ] Annual payer: 14-day wait
- [ ] Monthly payer: 60-day wait (emergency), 90-day wait (restorative)
- [ ] Clear error messages shown
- [ ] Existing members grandfathered (no wait)

**Frequency Limits**:

- [ ] Bronze: 1 consultation, 1 extraction, 1 scaling
- [ ] Silver: +1 filling
- [ ] Gold: 2 of each, 1 root canal, unlimited antibiotics
- [ ] Warning shown when limit reached
- [ ] Override triggers payment flow
- [ ] Payment successful allows procedure

**Annual Caps**:

- [ ] Bronze: 6,000 KES cap enforced
- [ ] Silver: 10,000 KES cap enforced
- [ ] Gold: 15,000 KES cap enforced
- [ ] Warning when approaching cap
- [ ] Override triggers payment flow
- [ ] Reset after 365 days

**Patient History**:

- [ ] Shows all visits chronologically
- [ ] Privacy controls work (masked phone)
- [ ] Search by phone works
- [ ] Search by name works
- [ ] Filter by date works
- [ ] Questionnaire data displays correctly
- [ ] Staff see own clinic visits
- [ ] Other clinic visits labeled correctly

**KMPDC Validation**:

- [ ] Field required on clinic registration
- [ ] Validation errors shown
- [ ] Cannot submit without KMPDC
- [ ] Existing clinics updated

**End-to-End**:

- [ ] Complete patient journey (subscribe → wait → check-in → procedures → discharge)
- [ ] Out-of-pocket payment flow
- [ ] Annual reset simulation
- [ ] Multi-tier testing

### 15. Production Deployment

**Status**: ⏳ Pending
**Priority**: CRITICAL
**Estimated Time**: 2 hours

**Pre-Deployment Checklist**:

- [ ] All tests passing on dev
- [ ] Database migration tested on dev
- [ ] Backup production database
- [ ] Prepare rollback plan
- [ ] Schedule maintenance window
- [ ] Notify users of changes

**Deployment Steps**:

1. Merge dev → main (backend)
2. Merge dev → main (frontend)
3. Run database migration on production
4. Deploy backend (ECS)
5. Deploy frontend (Amplify)
6. Monitor logs for errors
7. Test critical flows
8. Send launch announcement

---

## Timeline

| Date            | Tasks                                                      | Status      |
| --------------- | ---------------------------------------------------------- | ----------- |
| **March 1**     | Backend core (Part 1)                                      | ✅ Complete |
| **March 2-3**   | Visits integration, patient history, out-of-pocket payment | ⏳ Pending  |
| **March 4-6**   | Frontend implementation                                    | ⏳ Pending  |
| **March 7-10**  | Testing and bug fixes                                      | ⏳ Pending  |
| **March 11-18** | Buffer for issues, refinements, UAT                        | ⏳ Pending  |
| **March 19**    | Final testing, deployment prep                             | ⏳ Pending  |
| **March 20**    | **PRODUCTION LAUNCH** 🚀                                   | ⏳ Pending  |

---

## Key Decisions Made

1. **Waiting Period**: 14 days (not 15) for annual payers - confirmed by user
2. **Frequency Limits**: Hard limits with override option (triggers payment)
3. **Annual Caps**: Resets 365 days from subscription start (not calendar year)
4. **Existing Members**: Migrated with waiting periods (not grandfathered)
5. **Antibiotic Therapy**: Standalone procedure (not auto-included)
6. **Patient History**: Integrated in check-in + separate tab with search
7. **Privacy**: Staff see own clinic visits, other MenoDAO visits labeled

---

## Risks & Mitigation

### Risk 1: Waiting Period Blocks Too Many Users

**Impact**: High - Could frustrate existing members
**Mitigation**:

- Clear communication about waiting periods
- Consider grandfathering existing active members
- Provide override mechanism for emergencies

### Risk 2: Out-of-Pocket Payment Complexity

**Impact**: Medium - New payment flow could have bugs
**Mitigation**:

- Reuse existing SasaPay integration
- Thorough testing on dev
- Fallback to manual payment if needed

### Risk 3: Data Migration Issues

**Impact**: High - Could corrupt production data
**Mitigation**:

- Test migration multiple times on dev
- Full database backup before production migration
- Rollback plan ready

### Risk 4: Frontend Complexity

**Impact**: Medium - Many UI changes could introduce bugs
**Mitigation**:

- Implement incrementally
- Test each feature independently
- User acceptance testing before launch

---

## Next Steps (Immediate)

1. **Continue Backend Integration** (Today/Tomorrow)
   - Integrate SubscriptionRulesService into VisitsService
   - Create patient history endpoint
   - Update clinic registration validation

2. **Run Database Migration on Dev** (Tomorrow)
   - Test migration
   - Verify data integrity
   - Document any issues

3. **Start Frontend Implementation** (March 2-3)
   - Patient history viewer
   - Waiting period UI
   - Frequency limit warnings
   - Annual cap indicators

4. **Testing** (March 4-10)
   - Comprehensive testing
   - Bug fixes
   - User acceptance testing

5. **Production Deployment** (March 20)
   - Deploy and monitor
   - Launch announcement

---

## Support & Questions

For questions or issues during implementation:

1. Check `PROTOCOL_V5_IMPLEMENTATION.md` for specifications
2. Check `IMPLEMENTATION_STATUS.md` for progress
3. Review this summary for decisions made
4. Contact CEO for clarifications

---

**Document Created**: March 1, 2026
**Last Updated**: March 1, 2026 17:45
**Status**: Part 1 Complete (Backend Core), Part 2 Pending (Integration & Frontend)
**Target Launch**: March 20, 2026
