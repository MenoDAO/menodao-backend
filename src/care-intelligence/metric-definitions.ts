/**
 * Canonical metric definitions for the Care Intelligence dashboard.
 * Every number shown in admin UI should map to one of these IDs.
 */

export const MIN_SAMPLE_RATE = 10;
export const MIN_SAMPLE_MEDIAN = 5;
export const MIN_SAMPLE_TREND = 5;
export const RETENTION_LOOKBACK_DAYS = 90;

export type DataStatus = 'ok' | 'insufficient' | 'not_tracked';

export type CareLoopStageId =
  | 'reach'
  | 'lead'
  | 'registered'
  | 'member'
  | 'paid'
  | 'booked'
  | 'attended'
  | 'treated'
  | 'completed'
  | 'follow_up'
  | 'retained'
  | 'referred';

export interface StageDefinition {
  id: CareLoopStageId;
  label: string;
  metricId: string;
  definition: string;
  tracked: boolean;
  untrackedReason?: string;
}

export const CARE_LOOP_STAGES: StageDefinition[] = [
  {
    id: 'reach',
    label: 'Reach',
    metricId: 'website_sessions',
    definition:
      'Unique website sessions in the period. This is a reach proxy, not qualified patient demand.',
    tracked: true,
  },
  {
    id: 'lead',
    label: 'Lead',
    metricId: 'qualified_leads',
    definition:
      'Qualified patient leads captured before registration (community, WhatsApp intake, partner lists).',
    tracked: false,
    untrackedReason:
      'Qualified leads are not stored independently of registration yet.',
  },
  {
    id: 'registered',
    label: 'Registered',
    metricId: 'registered_members',
    definition: 'Members with an account in the MenoDAO database.',
    tracked: true,
  },
  {
    id: 'member',
    label: 'Member',
    metricId: 'members_with_subscription',
    definition: 'Registered members who have a membership record (paid or unpaid).',
    tracked: true,
  },
  {
    id: 'paid',
    label: 'Paid',
    metricId: 'paid_members',
    definition: 'Members with an active (currently paying) subscription.',
    tracked: true,
  },
  {
    id: 'booked',
    label: 'Booked',
    metricId: 'appointments_booked',
    definition:
      'Unique members who created a clinic appointment scheduled in the period (booked or later rescheduled/attended/no-show). Cancellations remain in the created count for leakage.',
    tracked: true,
  },
  {
    id: 'attended',
    label: 'Attended',
    metricId: 'appointments_attended',
    definition:
      'Unique patients who checked in for a clinic visit, or camp registrations marked ATTENDED.',
    tracked: true,
  },
  {
    id: 'treated',
    label: 'Treated',
    metricId: 'patients_treated',
    definition:
      'Unique patients who received at least one procedure during a visit in the period.',
    tracked: true,
  },
  {
    id: 'completed',
    label: 'Completed',
    metricId: 'completed_treatments',
    definition:
      'Treatment episodes closed by discharging a visit that included at least one procedure.',
    tracked: true,
  },
  {
    id: 'follow_up',
    label: 'Follow-up',
    metricId: 'followup_completed',
    definition:
      'Patients with a subsequent visit after a completed treatment episode in the lookback window. Recommended follow-up is not yet coded per treatment type.',
    tracked: true,
  },
  {
    id: 'retained',
    label: 'Retained',
    metricId: 'retention_90d',
    definition: `Patients treated in the ${RETENTION_LOOKBACK_DAYS} days before this period who returned for additional care in this period.`,
    tracked: true,
  },
  {
    id: 'referred',
    label: 'Referred',
    metricId: 'referred_new_members',
    definition:
      'New members in the period whose acquisition source is an existing member referral code.',
    tracked: true,
  },
];

export const DEFAULT_TARGETS: Record<
  string,
  {
    targetValue: number;
    minSampleSize: number;
    impactWeight: number;
    controllability: number;
  }
> = {
  completed_treatments_monthly: {
    targetValue: 175,
    minSampleSize: 1,
    impactWeight: 1,
    controllability: 0.7,
  },
  demand_to_registration: {
    targetValue: 0.4,
    minSampleSize: 20,
    impactWeight: 0.5,
    controllability: 0.5,
  },
  registration_to_paid: {
    targetValue: 0.15,
    minSampleSize: 20,
    impactWeight: 0.7,
    controllability: 0.85,
  },
  paid_to_booking: {
    targetValue: 0.7,
    minSampleSize: 10,
    impactWeight: 0.8,
    controllability: 0.6,
  },
  booking_to_attendance: {
    targetValue: 0.85,
    minSampleSize: 10,
    impactWeight: 0.9,
    controllability: 0.7,
  },
  attendance_to_treatment: {
    targetValue: 0.9,
    minSampleSize: 10,
    impactWeight: 1,
    controllability: 0.8,
  },
  treatment_completion: {
    targetValue: 0.85,
    minSampleSize: 10,
    impactWeight: 1,
    controllability: 0.85,
  },
  treatment_to_followup: {
    targetValue: 0.8,
    minSampleSize: 10,
    impactWeight: 0.8,
    controllability: 0.75,
  },
  retention_90d: {
    targetValue: 0.35,
    minSampleSize: 15,
    impactWeight: 0.85,
    controllability: 0.6,
  },
  referral_rate: {
    targetValue: 0.15,
    minSampleSize: 15,
    impactWeight: 0.7,
    controllability: 0.7,
  },
};

export const TREATMENT_CATEGORY_MAP: Record<string, string> = {
  DENTAL_CHECKUP: 'examination',
  CONSULT: 'examination',
  CONSULTATION: 'examination',
  DENTAL_CLEANING: 'cleaning',
  CLEANING: 'cleaning',
  PROPHYLAXIS: 'cleaning',
  DENTAL_EXTRACTION: 'extraction',
  EXTRACT: 'extraction',
  EXTRACT_SIMPLE: 'extraction',
  EXTRACT_SURGICAL: 'extraction',
  DENTAL_FILLING: 'restoration',
  FILLING: 'restoration',
  RESTORATION: 'restoration',
  ROOT_CANAL: 'other',
  EMERGENCY: 'emergency',
  PERIO: 'periodontal',
  PERIODONTAL: 'periodontal',
  PEDIATRIC: 'pediatric',
  OTHER: 'other',
};

export function mapTreatmentCategory(codeOrType: string): string {
  const key = codeOrType.toUpperCase().replace(/[^A-Z]/g, '_');
  if (TREATMENT_CATEGORY_MAP[key]) return TREATMENT_CATEGORY_MAP[key];
  if (key.includes('EXTRACT')) return 'extraction';
  if (key.includes('CLEAN') || key.includes('PROPHY')) return 'cleaning';
  if (key.includes('FILL') || key.includes('RESTOR')) return 'restoration';
  if (key.includes('CONSULT') || key.includes('EXAM') || key.includes('CHECK'))
    return 'examination';
  if (key.includes('EMERG')) return 'emergency';
  if (key.includes('PERIO')) return 'periodontal';
  if (key.includes('PEDIA') || key.includes('CHILD')) return 'pediatric';
  return 'other';
}

export const METRIC_CATALOG = {
  completed_treatments: {
    id: 'completed_treatments',
    label: 'Completed treatments',
    definition:
      'Count of discharged clinic visits in the period. Discharge requires at least one procedure.',
  },
  patients_treated: {
    id: 'patients_treated',
    label: 'Patients treated',
    definition:
      'Unique members who received at least one procedure during the period.',
  },
  registration_to_paid: {
    id: 'registration_to_paid',
    label: 'Registration → paid',
    definition: 'Active subscriptions / registered members (stock, as of period end).',
  },
  retention_90d: {
    id: 'retention_90d',
    label: 'Patient retention',
    definition: `Returning eligible patients / eligible previous patients. Eligible = unique patients with a discharged visit in the ${RETENTION_LOOKBACK_DAYS} days before the period. Returning = those with another visit in the selected period.`,
  },
  referral_rate: {
    id: 'referral_rate',
    label: 'Referral rate',
    definition:
      'New members in the period with an existing-member referral code / new members in the period.',
  },
  time_to_first_care: {
    id: 'time_to_first_care',
    label: 'Time to first care',
    definition:
      'Median days from member registration to first clinic check-in, for members whose first visit falls in the period.',
  },
} as const;
