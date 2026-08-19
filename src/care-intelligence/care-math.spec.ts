import {
  dataStatus,
  healthFromRate,
  median,
  pctChange,
  rankOpportunities,
  ratio,
} from './care-math';

describe('care-math', () => {
  it('computes paid conversion 9/120 = 7.5%', () => {
    expect(ratio(9, 120)).toBeCloseTo(0.075);
  });

  it('returns null for empty denominators instead of 0', () => {
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(5, 0)).toBeNull();
  });

  it('computes median rather than mean so outliers do not dominate', () => {
    expect(median([1, 2, 100])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('does not invent infinity when previous period is 0', () => {
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(122, 100)).toBeCloseTo(22);
  });

  it('marks rates with too few observations as insufficient', () => {
    expect(dataStatus(3, 10)).toBe('insufficient');
    expect(dataStatus(12, 10)).toBe('ok');
    expect(dataStatus(100, 10, false)).toBe('not_tracked');
  });

  it('does not score an untracked stage as healthy', () => {
    expect(
      healthFromRate({
        current: 0.9,
        target: 0.8,
        sampleSize: 50,
        minSample: 10,
        tracked: false,
      }),
    ).toBe('NEEDS_DATA');
  });

  it('ranks high-volume conversion gaps above larger % gaps with tiny volume', () => {
    const ranked = rankOpportunities([
      {
        transitionId: 'registration_to_paid',
        label: 'Registration → paid',
        current: 0.075,
        previous: null,
        target: 0.15,
        volume: 120,
        sampleSize: 120,
        impactWeight: 0.7,
        controllability: 0.85,
        tracked: true,
      },
      {
        transitionId: 'treatment_to_followup',
        label: 'Treatment → follow-up',
        current: 0.61,
        previous: null,
        target: 0.8,
        volume: 5,
        sampleSize: 5,
        impactWeight: 0.8,
        controllability: 0.75,
        tracked: true,
      },
    ]);

    expect(ranked[0].transitionId).toBe('registration_to_paid');
    expect(ranked[0].opportunity).toBeGreaterThan(ranked[1].opportunity);
  });
});
