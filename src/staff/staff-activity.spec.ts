import {
  activityFromAppointmentEvents,
  activityFromVisits,
  mergeActivity,
} from './staff-activity';

describe('staff activity timeline', () => {
  it('emits check-in and discharge as separate events', () => {
    const items = activityFromVisits([
      {
        id: 'v1',
        checkedInAt: new Date('2026-08-19T08:00:00Z'),
        dischargedAt: new Date('2026-08-19T09:00:00Z'),
        member: { fullName: 'Jane Wanjiku', phoneNumber: '+254700' },
      },
    ]);
    expect(items.map((item) => item.title)).toEqual([
      'Checked in Jane Wanjiku',
      'Discharged Jane Wanjiku',
    ]);
  });

  it('labels appointment actions with member and clinic', () => {
    const [item] = activityFromAppointmentEvents([
      {
        id: 'e1',
        type: 'NO_SHOW',
        reason: 'Did not arrive',
        createdAt: new Date('2026-08-19T10:00:00Z'),
        appointment: {
          clinic: { name: 'Kilimani Dental' },
          member: { fullName: null, phoneNumber: '+254711' },
        },
      },
    ]);
    expect(item.title).toBe('Marked a no-show');
    expect(item.detail).toContain('Kilimani Dental');
    expect(item.detail).toContain('Did not arrive');
  });

  it('keeps the newest events within the limit', () => {
    const merged = mergeActivity(
      [
        {
          id: 'old',
          at: new Date('2026-01-01'),
          kind: 'VISIT',
          title: 'old',
        },
        {
          id: 'new',
          at: new Date('2026-08-01'),
          kind: 'VISIT',
          title: 'new',
        },
      ],
      1,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('new');
  });
});
