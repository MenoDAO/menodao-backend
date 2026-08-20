export type ActivityKind = 'VISIT' | 'APPOINTMENT' | 'ACCOUNT';

export interface ActivityItem {
  id: string;
  at: Date;
  kind: ActivityKind;
  title: string;
  detail?: string;
}

function personLabel(person?: {
  fullName?: string | null;
  phoneNumber?: string | null;
} | null) {
  const name = person?.fullName?.trim();
  if (name) return name;
  return person?.phoneNumber || 'a member';
}

const APPOINTMENT_TITLES: Record<string, string> = {
  BOOKED: 'Booked an appointment',
  NOTE: 'Added a clinic note',
  ATTENDED: 'Marked an appointment as attended',
  RESCHEDULED: 'Rescheduled an appointment',
  CANCELLED: 'Cancelled an appointment',
  NO_SHOW: 'Marked a no-show',
};

export function activityFromVisits(
  visits: Array<{
    id: string;
    checkedInAt: Date;
    dischargedAt: Date | null;
    member: { fullName: string | null; phoneNumber: string } | null;
  }>,
): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const visit of visits) {
    const who = personLabel(visit.member);
    items.push({
      id: `visit-in-${visit.id}`,
      at: visit.checkedInAt,
      kind: 'VISIT',
      title: `Checked in ${who}`,
    });
    if (visit.dischargedAt) {
      items.push({
        id: `visit-out-${visit.id}`,
        at: visit.dischargedAt,
        kind: 'VISIT',
        title: `Discharged ${who}`,
      });
    }
  }
  return items;
}

export function activityFromAppointmentEvents(
  events: Array<{
    id: string;
    type: string;
    reason: string | null;
    createdAt: Date;
    appointment: {
      clinic?: { name: string } | null;
      member?: { fullName: string | null; phoneNumber: string } | null;
    } | null;
  }>,
): ActivityItem[] {
  return events.map((event) => {
    const who = personLabel(event.appointment?.member);
    const clinic = event.appointment?.clinic?.name;
    const title = APPOINTMENT_TITLES[event.type] || event.type.replace(/_/g, ' ');
    const bits = [who, clinic].filter(Boolean);
    return {
      id: `appt-${event.id}`,
      at: event.createdAt,
      kind: 'APPOINTMENT' as const,
      title,
      detail: [bits.join(' · '), event.reason].filter(Boolean).join(' — ') || undefined,
    };
  });
}

export function mergeActivity(items: ActivityItem[], limit: number): ActivityItem[] {
  return [...items]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit);
}
