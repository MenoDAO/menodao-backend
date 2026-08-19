import { DataStatus, MIN_SAMPLE_RATE } from './metric-definitions';

export type HealthStatus =
  | 'GOOD'
  | 'WATCH'
  | 'NEEDS_WORK'
  | 'NEEDS_DATA'
  | 'EARLY';

export function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  return numerator / denominator;
}

export function pctPoints(current: number | null, target: number): number | null {
  if (current == null) return null;
  return (current - target) * 100;
}

export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export function median(values: number[]): number | null {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 1) return nums[mid];
  return (nums[mid - 1] + nums[mid]) / 2;
}

export function dataStatus(
  sampleSize: number,
  minSample: number,
  tracked = true,
): DataStatus {
  if (!tracked) return 'not_tracked';
  if (sampleSize < minSample) return 'insufficient';
  return 'ok';
}

export function healthFromRate(opts: {
  current: number | null;
  target: number;
  sampleSize: number;
  minSample: number;
  tracked?: boolean;
  early?: boolean;
}): HealthStatus {
  if (opts.tracked === false) return 'NEEDS_DATA';
  if (opts.early && opts.sampleSize < opts.minSample) return 'EARLY';
  if (opts.current == null || opts.sampleSize < opts.minSample) return 'NEEDS_DATA';

  const gapPp = (opts.target - opts.current) * 100;
  if (gapPp <= 2) return 'GOOD';
  if (gapPp <= 10) return 'WATCH';
  return 'NEEDS_WORK';
}

export interface OpportunityInput {
  transitionId: string;
  label: string;
  current: number | null;
  previous: number | null;
  target: number;
  volume: number;
  sampleSize: number;
  impactWeight: number;
  controllability: number;
  tracked: boolean;
}

export interface RankedOpportunity {
  transitionId: string;
  label: string;
  current: number | null;
  previous: number | null;
  target: number;
  gapPp: number | null;
  volume: number;
  sampleSize: number;
  opportunity: number;
  confidence: number;
  dataStatus: DataStatus;
}

/**
 * Rank leakage by expected care impact, not by the largest percentage gap.
 * Opportunity is a ranking aid, not a precise forecast.
 */
export function rankOpportunities(
  inputs: OpportunityInput[],
  minSample = MIN_SAMPLE_RATE,
): RankedOpportunity[] {
  return inputs
    .map((item) => {
      const status = dataStatus(item.sampleSize, minSample, item.tracked);
      const gap =
        item.current == null ? null : Math.max(0, item.target - item.current);
      const gapPp = gap == null ? null : gap * 100;
      const confidence = Math.min(1, item.sampleSize / 30);
      const opportunity =
        item.tracked && gap != null
          ? item.volume * gap * item.impactWeight * confidence * item.controllability
          : 0;
      return {
        transitionId: item.transitionId,
        label: item.label,
        current: item.current,
        previous: item.previous,
        target: item.target,
        gapPp,
        volume: item.volume,
        sampleSize: item.sampleSize,
        opportunity,
        confidence,
        dataStatus: status,
      };
    })
    .sort((a, b) => b.opportunity - a.opportunity);
}

export function bottleneckNarrative(top: RankedOpportunity | null): {
  headline: string;
  detail: string;
} {
  if (!top || top.dataStatus !== 'ok' || top.opportunity <= 0) {
    return {
      headline: 'No statistically useful bottleneck yet.',
      detail:
        'Funnel conversions need more observations before ranking leakage is meaningful.',
    };
  }

  const currentPct =
    top.current != null ? `${(top.current * 100).toFixed(1)}%` : 'n/a';
  const targetPct = `${(top.target * 100).toFixed(1)}%`;
  const gap =
    top.gapPp != null ? `${top.gapPp.toFixed(1)} percentage points below target` : '';

  return {
    headline: `${top.label} is currently the largest leakage in the patient journey.`,
    detail: `Observed conversion is ${currentPct} versus a target of ${targetPct} (${gap}), across ${top.volume} people at the previous stage. This ranking weights volume, conversion gap, care impact, sample size, and how controllable the step is — it is a management attention aid, not a proven strategy.`,
  };
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1, 0, 0, 0, 0);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function parsePeriod(from?: string, to?: string): {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  label: string;
} {
  const now = new Date();
  const periodFrom = from ? new Date(from) : startOfMonth(now);
  const periodTo = to ? new Date(to) : now;
  if (Number.isNaN(periodFrom.getTime()) || Number.isNaN(periodTo.getTime())) {
    throw new Error('Invalid date range');
  }
  const durationMs = Math.max(periodTo.getTime() - periodFrom.getTime(), 0);
  const previousTo = new Date(periodFrom.getTime());
  const previousFrom = new Date(periodFrom.getTime() - durationMs);
  const label = `${periodFrom.toISOString().slice(0, 10)} → ${periodTo.toISOString().slice(0, 10)}`;
  return { from: periodFrom, to: periodTo, previousFrom, previousTo, label };
}
