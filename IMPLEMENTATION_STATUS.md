# Protocol v5.0 Implementation Status

## March 20th Launch Preparation

## Completed ✅

### 1. Database Schema Updates

- ✅ Created migration file: `20260301170000_protocol_v5_updates/migration.sql`
- ✅ Added `PaymentFrequency` enum (MONTHLY, ANNUAL)
- ✅ Updated Subscription model with new fields:
  - `paymentFrequency`
  - `subscriptionStartDate`
  - `annualCapUsed`
  - `annualCapLimit`
  - `procedureUsageCount`
  - `lastResetDate`
- ✅ Made `kmpdcRegNumber` required for Clinic model
- ✅ Added indexes for performance

### 2. Procedures Service Updates

- ✅ Updated rate card to Protocol v5.0 specifications:
  - Consultation: 1,000 KES
  - Simple Extraction: 1,500 KES
  - Scaling & Polishing: 3,500 KES
  - Composite Filling: 4,000 KES
  - Anterior Root Canal: 10,000 KES
  - Antibiotic Therapy: 1,000 KES
- ✅ Removed old procedures (SCREEN_BASIC, PAIN_RELIEF, etc.)
- ✅ Added new procedures matching v5.0 spec

### 3. Subscriptions Service Updates

- ✅ Updated pricing structure (monthly + annual)
- ✅ Added tier display names (MenoBronze, MenoSilver, MenoGold)
- ✅ Updated package benefits
- ✅ Added annual caps (6k, 10k, 15k)
- ✅ Added frequency limits per tier
- ✅ Updated subscribe() method to support payment frequency

### 4. Subscription Rules Service

- ✅ Created new service: `subscription-rules.service.ts`
- ✅ Implemented waiting period logic (14/60/90 days)
- ✅ Implemented frequency limit checking
- ✅ Implemented annual cap checking
- ✅ Implemented comprehensive eligibility checks
- ✅ Implemented usage tracking and reset logic

### 5. Documentation

- ✅ Created `PROTOCOL_V5_IMPLEMENTATION.md`
- ✅ Created `IMPLEMENTATION_STATUS.md` (this file)

## In Progress 🚧

### 6. Visits Service Integration

- ⏳ Integrate SubscriptionRulesService into visits workflow
- ⏳ Update searchMember() to check waiting period
- ⏳ Update addProcedure() to check eligibility
- ⏳ Add override mechanism for out-of-pocket payments
- ⏳ Update claim limits to use annual caps

### 7. Patient History Endpoint

- ⏳ Create endpoint to fetch member visit history
- ⏳ Implement privacy controls (phone masking, etc.)
- ⏳ Filter by clinic (staff see own clinic visits)
- ⏳ Show other MenoDAO visits (labeled)
- ⏳ Include questionnaire data

### 8. Clinic Registration Updates

- ⏳ Update DTO to make KMPDC required
- ⏳ Add validation for KMPDC format
- ⏳ Update frontend form

## Pending ⏸️

### 9. Frontend Updates

- ⏸️ Update tier names throughout UI
- ⏸️ Create patient history viewer component
- ⏸️ Add waiting period indicators
- ⏸️ Add frequency limit warnings
- ⏸️ Add annual cap progress bars
- ⏸️ Update clinic registration form (KMPDC required)
- ⏸️ Add out-of-pocket payment flow

### 10. Testing

- ⏸️ Test waiting period enforcement
- ⏸️ Test frequency limits with override
- ⏸️ Test annual caps with override
- ⏸️ Test patient history viewer
- ⏸️ Test KMPDC validation
- ⏸️ End-to-end testing on dev environment

### 11. Data Migration

- ⏸️ Run migration on dev database
- ⏸️ Verify existing subscriptions updated correctly
- ⏸️ Test with real data on dev
- ⏸️ Prepare production migration plan

## Next Steps (Priority Order)

1. **Complete Visits Service Integration** (2-3 hours)
   - Integrate eligibility checks
   - Add override mechanism
   - Update claim creation logic

2. **Create Patient History Endpoint** (1-2 hours)
   - New controller method
   - Privacy controls
   - Clinic filtering

3. **Update Clinic Registration** (30 mins)
   - Make KMPDC required
   - Add validation

4. **Run Database Migration** (30 mins)
   - Test on dev database
   - Verify data integrity

5. **Frontend Implementation** (4-6 hours)
   - Patient history viewer
   - Waiting period UI
   - Frequency limit warnings
   - Annual cap indicators
   - KMPDC form update

6. **Testing & Bug Fixes** (2-3 hours)
   - Comprehensive testing
   - Fix any issues
   - User acceptance testing

7. **Production Deployment** (1 hour)
   - Deploy backend
   - Deploy frontend
   - Monitor for issues

## Timeline

- **March 1 (Today)**: Complete backend implementation
- **March 2-3**: Frontend implementation
- **March 4-5**: Testing and bug fixes
- **March 6-19**: Buffer for issues and refinements
- **March 20**: Production launch

## Risks & Mitigation

### Risk 1: Data Migration Issues

- **Mitigation**: Test thoroughly on dev, have rollback plan

### Risk 2: Waiting Period Blocks Existing Members

- **Mitigation**: Grandfather existing members (set subscriptionStartDate to past)

### Risk 3: Frontend Complexity

- **Mitigation**: Implement incrementally, test each feature

### Risk 4: Out-of-Pocket Payment Integration

- **Mitigation**: Use existing SasaPay integration, add new flow

## Notes

- All existing subscriptions will be migrated with waiting periods
- Staff can override frequency limits and caps (triggers out-of-pocket payment)
- Annual caps reset 365 days from subscription start
- KMPDC registration is now legally required for all clinics

---

**Last Updated**: 2026-03-01 17:30
**Status**: Backend 70% Complete, Frontend 0% Complete
