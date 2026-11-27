import { AppointmentStatus, Prisma } from '@prisma/client';

export const OCCUPIED_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.BOOKED,
  AppointmentStatus.RESCHEDULED,
  AppointmentStatus.AWAITING_PAYMENT,
];

export async function lockAppointmentReservation(
  tx: Prisma.TransactionClient,
  memberId: string,
  clinicId: string,
) {
  // All booking writers acquire these rows in the same order.
  await tx.$queryRaw`SELECT id FROM "Member" WHERE id = ${memberId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Clinic" WHERE id = ${clinicId} FOR UPDATE`;
}

export async function hasReservationConflict(
  db: Prisma.TransactionClient,
  slot: {
    clinicId: string;
    doctorId?: string | null;
    scheduledAt: Date;
    durationMinutes: number;
    chairs: number;
    ignoreId?: string;
  },
): Promise<boolean> {
  const end = new Date(
    slot.scheduledAt.getTime() + slot.durationMinutes * 60_000,
  );
  const [result] = await db.$queryRaw<
    Array<{ taken: number; doctorBusy: boolean }>
  >`
    SELECT count(*)::integer AS taken,
           coalesce(bool_or("doctorId" = ${slot.doctorId ?? null}), false) AS "doctorBusy"
    FROM "Appointment"
    WHERE "clinicId" = ${slot.clinicId}
      AND status IN ('BOOKED', 'RESCHEDULED', 'AWAITING_PAYMENT')
      AND "scheduledAt" < ${end}
      AND "scheduledAt" + "durationMinutes" * interval '1 minute' > ${slot.scheduledAt}
      AND (${slot.ignoreId ?? null}::text IS NULL OR id <> ${slot.ignoreId ?? null})
  `;
  return result.taken >= Math.max(slot.chairs, 1) || result.doctorBusy;
}
