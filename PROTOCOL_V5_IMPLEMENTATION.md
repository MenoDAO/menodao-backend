# MenoDAO Protocol v5.0 Implementation Plan

## Status: FINAL LOCK-IN FOR MARCH 20TH LAUNCH

## Overview

This document outlines the implementation of Protocol v5.0 specifications including:

1. Package tier renaming (MenoBronze, MenoSilver, MenoGold)
2. Updated procedure costs and rate card
3. Waiting period enforcement
4. Frequency limits per tier
5. Annual financial caps
6. Antibiotic therapy details
7. KMPDC registration requirement
8. Patient treatment history viewer

## 1. Database Schema Updates

### 1.1 Procedure Updates

Update procedures table with new rate card:

- Consultation: 1,000 KES
- Simple Extraction: 1,500 KES
- Scaling & Polishing: 3,500 KES
- Composite Filling: 4,000 KES
- Anterior Root Canal: 10,000 KES
- Antibiotic Therapy: 1,000 KES

### 1.2 Subscription Model Updates

Add fields for tracking:

- `paymentFrequency`: MONTHLY | ANNUAL
- `subscriptionStartDate`: DateTime (for waiting period calculation)
- `annualCapUsed`: Int (tracks spending against cap)
- `annualCapLimit`: Int (6000, 10000, or 15000 based on tier)
- `procedureUsageCount`: Json (tracks procedure frequency)

### 1.3 Clinic Model Updates

Make `kmpdcRegNumber` required (NOT NULL)

## 2. Tier Specifications

### MenoBronze (BRONZE)

- Monthly: 350 KES
- Annual: 4,200 KES
- Annual Cap: 6,000 KES
- Waiting Period:
  - Monthly: 60 days (Consultation, Extraction), 90 days (others)
  - Annual: 15 days (all procedures)
- Allowed Procedures (max per year):
  - Consultation: 1
  - Simple Extraction: 1
  - Scaling & Polishing: 1
  - Composite Filling: LOCKED
  - Anterior Root Canal: LOCKED
  - Antibiotic Therapy: LOCKED

### MenoSilver (SILVER)

- Monthly: 550 KES
- Annual: 6,600 KES
- Annual Cap: 10,000 KES
- Waiting Period:
  - Monthly: 60 days (Consultation, Extraction), 90 days (others)
  - Annual: 15 days (all procedures)
- Allowed Procedures (max per year):
  - Consultation: 1
  - Simple Extraction: 1
  - Scaling & Polishing: 1
  - Composite Filling: 1
  - Anterior Root Canal: LOCKED
  - Antibiotic Therapy: LOCKED

### MenoGold (GOLD)

- Monthly: 700 KES
- Annual: 8,400 KES
- Annual Cap: 15,000 KES
- Waiting Period:
  - Monthly: 60 days (Consultation, Extraction), 90 days (others)
  - Annual: 15 days (all procedures)
- Allowed Procedures (max per year):
  - Consultation: 2
  - Simple Extraction: 2
  - Scaling & Polishing: 2
  - Composite Filling: 2
  - Anterior Root Canal: 1
  - Antibiotic Therapy: Unlimited (within cap)

## 3. Smart Contract Logic Checks

Before allowing a procedure claim, system MUST verify:

### 3.1 Wait Period Check

```typescript
function hasPassedWaitPeriod(
  subscriptionStartDate: Date,
  paymentFrequency: 'MONTHLY' | 'ANNUAL',
  procedureCode: string,
): boolean {
  const daysSinceStart = daysBetween(subscriptionStartDate, now());

  if (paymentFrequency === 'ANNUAL') {
    return daysSinceStart >= 15;
  }

  // Monthly payers
  const emergencyProcedures = ['CONSULT', 'EXTRACT_SIMPLE'];
  const waitDays = emergencyProcedures.includes(procedureCode) ? 60 : 90;

  return daysSinceStart >= waitDays;
}
```

### 3.2 Frequency Check

```typescript
function hasExceededFrequencyLimit(
  tier: PackageTier,
  procedureCode: string,
  currentUsageCount: number,
): boolean {
  const limits = FREQUENCY_LIMITS[tier][procedureCode];
  return currentUsageCount >= limits;
}
```

### 3.3 Cap Check

```typescript
function wouldExceedAnnualCap(
  tier: PackageTier,
  currentCapUsed: number,
  procedureCost: number,
): boolean {
  const caps = { BRONZE: 6000, SILVER: 10000, GOLD: 15000 };
  return currentCapUsed + procedureCost > caps[tier];
}
```

### 3.4 Co-Pay Rule

Co-pay is ALWAYS 0 KES. MenoDAO covers 100% of rate card.

## 4. Antibiotic Therapy Details

### Procedure: Antibiotic Therapy

- Code: `ANTIBIOTIC_THERAPY`
- Cost: 1,000 KES
- Includes:
  - First-line antibiotics (generic only)
  - Pain management medication
  - Standard 5-day course

### Medications Included:

**Antibiotics (Generic Only):**

- Amoxicillin 500mg (broad-spectrum)
- Metronidazole (Flagyl) 400mg (anaerobic coverage)

**Alternatives (Penicillin-Allergic):**

- Erythromycin 500mg
- Clindamycin 300mg

**Analgesics/Pain Management:**

- Ibuprofen 400mg
- Diclofenac 50mg
- Paracetamol 500mg

**Standard Dispensation Example:**
5-day course: Amoxicillin 500mg + Ibuprofen 400mg + Metronidazole 400mg

## 5. Patient Treatment History Viewer

### Requirements:

- View all visits chronologically (most recent first)
- Display procedures performed
- Show questionnaire data if available
- Privacy controls: obscure PII unless necessary
- Staff can only view patients from their clinic
- Show claim status and amounts

### Privacy Rules:

- Phone numbers: Show last 4 digits only (\*\*\*\*1234)
- Full name: Show only when viewing detailed record
- Medical history: Only visible to treating clinician
- Questionnaire data: Accessible but logged for audit

## 6. KMPDC Registration Requirement

### Database Change:

```prisma
model Clinic {
  kmpdcRegNumber String // Remove the ? to make it required
}
```

### Validation:

- Frontend: Required field with validation
- Backend: NOT NULL constraint
- Format: Alphanumeric, min 5 characters
- Verification: Manual admin verification during approval

## 7. Implementation Checklist

### Backend:

- [ ] Create migration for subscription model updates
- [ ] Update procedures service with new rate card
- [ ] Implement waiting period logic
- [ ] Implement frequency limit tracking
- [ ] Implement annual cap tracking
- [ ] Add antibiotic therapy procedure
- [ ] Make KMPDC field required in clinic model
- [ ] Create patient history endpoint
- [ ] Update tier display names (MenoBronze, MenoSilver, MenoGold)

### Frontend:

- [ ] Update tier names throughout UI
- [ ] Update package pricing display
- [ ] Create patient history viewer component
- [ ] Add privacy controls for PII
- [ ] Update clinic registration form (KMPDC required)
- [ ] Add waiting period indicators
- [ ] Add frequency limit indicators
- [ ] Add annual cap progress bars

### Testing:

- [ ] Test waiting period enforcement
- [ ] Test frequency limits
- [ ] Test annual caps
- [ ] Test procedure rejection logic
- [ ] Test patient history viewer
- [ ] Test KMPDC validation

## 8. Deployment Timeline

- **March 15**: Complete backend implementation
- **March 17**: Complete frontend implementation
- **March 18**: Testing on dev environment
- **March 19**: Final verification and bug fixes
- **March 20**: Production deployment

## 9. Rollback Plan

If issues arise:

1. Revert to previous procedure costs
2. Disable waiting period enforcement
3. Disable frequency limits
4. Keep KMPDC requirement (legal compliance)

---

**Last Updated**: 2026-03-01
**Status**: Implementation In Progress
