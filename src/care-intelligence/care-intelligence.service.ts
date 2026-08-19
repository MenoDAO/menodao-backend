import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, VisitStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CARE_LOOP_STAGES,
  DEFAULT_TARGETS,
  mapTreatmentCategory,
  METRIC_CATALOG,
  MIN_SAMPLE_MEDIAN,
  MIN_SAMPLE_RATE,
  MIN_SAMPLE_TREND,
  RETENTION_LOOKBACK_DAYS,
} from './metric-definitions';
import {
  addDays,
  addMonths,
  bottleneckNarrative,
  dataStatus,
  healthFromRate,
  median,
  parsePeriod,
  pctChange,
  rankOpportunities,
  ratio,
  startOfMonth,
} from './care-math';

interface GeoFilter {
  county?: string;
  subCounty?: string;
}

@Injectable()
export class CareIntelligenceService {
  private cache = new Map<string, { expires: number; value: unknown }>();

  constructor(private prisma: PrismaService) {}

  async getDashboard(query: {
    from?: string;
    to?: string;
    county?: string;
    subCounty?: string;
  }) {
    const period = parsePeriod(query.from, query.to);
    const geo: GeoFilter = {
      county: query.county?.trim() || undefined,
      subCounty: query.subCounty?.trim() || undefined,
    };
    const cacheKey = JSON.stringify({
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      ...geo,
    });
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.value;
    }

    const dashboard = await this.buildDashboard(period, geo);
    this.cache.set(cacheKey, {
      expires: Date.now() + 45_000,
      value: dashboard,
    });
    return dashboard;
  }

  async getDefinitions() {
    return {
      stages: CARE_LOOP_STAGES,
      catalog: METRIC_CATALOG,
      retentionLookbackDays: RETENTION_LOOKBACK_DAYS,
      minSampleRate: MIN_SAMPLE_RATE,
      minSampleMedian: MIN_SAMPLE_MEDIAN,
    };
  }

  async getTargets() {
    const rows = await this.prisma.careLoopTarget.findMany({
      orderBy: { metricId: 'asc' },
    });
    const byId = new Map(rows.map((r) => [r.metricId, r]));
    return Object.entries(DEFAULT_TARGETS).map(([metricId, fallback]) => {
      const row = byId.get(metricId);
      return {
        metricId,
        targetValue: row?.targetValue ?? fallback.targetValue,
        minSampleSize: row?.minSampleSize ?? fallback.minSampleSize,
        impactWeight: row?.impactWeight ?? fallback.impactWeight,
        controllability: row?.controllability ?? fallback.controllability,
        notes: row?.notes ?? null,
        updatedAt: row?.updatedAt ?? null,
      };
    });
  }

  async upsertTarget(
    metricId: string,
    body: {
      targetValue: number;
      minSampleSize?: number;
      impactWeight?: number;
      controllability?: number;
      notes?: string;
    },
    updatedBy?: string,
  ) {
    if (!DEFAULT_TARGETS[metricId]) {
      throw new BadRequestException(`Unknown metric ${metricId}`);
    }
    this.cache.clear();
    return this.prisma.careLoopTarget.upsert({
      where: { metricId },
      create: {
        metricId,
        targetValue: body.targetValue,
        minSampleSize: body.minSampleSize ?? DEFAULT_TARGETS[metricId].minSampleSize,
        impactWeight: body.impactWeight ?? DEFAULT_TARGETS[metricId].impactWeight,
        controllability:
          body.controllability ?? DEFAULT_TARGETS[metricId].controllability,
        notes: body.notes,
        updatedBy,
      },
      update: {
        targetValue: body.targetValue,
        ...(body.minSampleSize != null && { minSampleSize: body.minSampleSize }),
        ...(body.impactWeight != null && { impactWeight: body.impactWeight }),
        ...(body.controllability != null && {
          controllability: body.controllability,
        }),
        ...(body.notes != null && { notes: body.notes }),
        updatedBy,
      },
    });
  }

  async listExperiments() {
    return this.prisma.careExperiment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async createExperiment(body: {
    name: string;
    hypothesis: string;
    metricId: string;
    baseline?: number;
    target?: number;
    startDate: string;
    endDate?: string;
    owner?: string;
  }) {
    return this.prisma.careExperiment.create({
      data: {
        name: body.name,
        hypothesis: body.hypothesis,
        metricId: body.metricId,
        baseline: body.baseline,
        target: body.target,
        startDate: new Date(body.startDate),
        endDate: body.endDate ? new Date(body.endDate) : null,
        owner: body.owner,
      },
    });
  }

  async updateExperiment(
    id: string,
    body: {
      status?: 'DRAFT' | 'RUNNING' | 'COMPLETED' | 'KILLED' | 'KEPT' | 'MODIFIED';
      result?: string;
      decision?: string;
      endDate?: string;
    },
  ) {
    return this.prisma.careExperiment.update({
      where: { id },
      data: {
        ...(body.status && { status: body.status }),
        ...(body.result != null && { result: body.result }),
        ...(body.decision != null && { decision: body.decision }),
        ...(body.endDate && { endDate: new Date(body.endDate) }),
      },
    });
  }

  async listInsights() {
    return this.prisma.careInsight.findMany({
      orderBy: { generatedAt: 'desc' },
      take: 50,
    });
  }

  async getCohort(key: string) {
    const allowed = new Set([
      'unpaid_registered_7_30',
      'overdue_followup',
      'unpaid_all',
    ]);
    if (!allowed.has(key)) {
      throw new BadRequestException('Unknown cohort');
    }

    if (key === 'unpaid_all') {
      const members = await this.prisma.member.findMany({
        where: {
          OR: [
            { subscription: { is: null } },
            { subscription: { isActive: false } },
          ],
        },
        select: {
          id: true,
          fullName: true,
          phoneNumber: true,
          createdAt: true,
          county: true,
          subCounty: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return { key, definition: 'Registered members without an active subscription.', members };
    }

    if (key === 'unpaid_registered_7_30') {
      const now = new Date();
      const members = await this.prisma.member.findMany({
        where: {
          createdAt: { gte: addDays(now, -30), lt: addDays(now, -7) },
          OR: [
            { subscription: { is: null } },
            { subscription: { isActive: false } },
          ],
        },
        select: {
          id: true,
          fullName: true,
          phoneNumber: true,
          createdAt: true,
          county: true,
          subCounty: true,
        },
        take: 200,
      });
      return {
        key,
        definition: 'Members registered 7–30 days ago who have never had an active subscription.',
        members,
      };
    }

    const overdue = await this.overdueFollowup();
    const members = await this.prisma.member.findMany({
      where: { id: { in: overdue.sampleIds } },
      select: {
        id: true,
        fullName: true,
        phoneNumber: true,
        createdAt: true,
        county: true,
        subCounty: true,
      },
    });
    return {
      key,
      definition:
        'Patients with a discharged visit 14+ days ago and no later visit. Clinical notes are not included.',
      members,
    };
  }

  async getDataRoom(query: { from?: string; to?: string }) {
    const dashboard = (await this.getDashboard(query)) as Record<string, unknown>;
    return {
      generatedAt: dashboard.generatedAt,
      period: dashboard.period,
      framing:
        'MenoDAO is proving that a low-cost, community-oriented model can continuously expand access to dental care.',
      reach: {
        websiteSessions: (dashboard.careLoop as { stages: { id: string; count: number | null }[] }).stages.find(
          (s) => s.id === 'reach',
        )?.count,
        note: 'Website sessions are a reach proxy. Qualified community demand is not independently tracked yet.',
      },
      access: {
        registered: (dashboard.membership as { registered: number }).registered,
        paid: (dashboard.membership as { paid: number }).paid,
        paidConversion: (dashboard.membershipConversion as { rate: number | null })
          .rate,
      },
      care: {
        completedTreatments: (dashboard.northStar as { current: number }).current,
        patientsTreated: (dashboard.secondary as { patientsTreated: { value: number } })
          .patientsTreated.value,
        treatmentCompletionRate: (
          dashboard.secondary as { treatmentCompletionRate: { value: number | null } }
        ).treatmentCompletionRate.value,
      },
      outcomes: {
        followUp: (dashboard.secondary as { patientRetention: unknown }).patientRetention,
        note: 'Clinical outcome coding beyond visit discharge is limited. Satisfaction uses questionnaire responses when present.',
      },
      retention: (dashboard.secondary as { patientRetention: unknown }).patientRetention,
      community: {
        referralRate: (dashboard.secondary as { referralRate: unknown }).referralRate,
      },
      membership: dashboard.membership,
      sustainability: (dashboard as { sustainability: unknown }).sustainability,
      geography: (dashboard as { geography: unknown }).geography,
      treatmentMix: (dashboard as { treatmentMix: unknown }).treatmentMix,
      dataHealth: (dashboard as { dataHealth: unknown }).dataHealth,
      appointments: (dashboard as { appointments: unknown }).appointments,
    };
  }

  async snapshotDailyMetrics() {
    const now = new Date();
    const from = startOfMonth(now);
    const dashboard = (await this.buildDashboard(
      {
        from,
        to: now,
        previousFrom: addMonths(from, -1),
        previousTo: from,
        label: 'snapshot',
      },
      {},
    )) as {
      northStar: { current: number; sampleSize: number };
      secondary: {
        patientsTreated: { value: number };
        paidMembers: { value: number };
      };
      membershipConversion: { rate: number | null; registered: number };
    };

    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const rows = [
      {
        metricId: 'completed_treatments',
        value: dashboard.northStar.current,
        sampleSize: dashboard.northStar.sampleSize,
      },
      {
        metricId: 'patients_treated',
        value: dashboard.secondary.patientsTreated.value,
        sampleSize: dashboard.secondary.patientsTreated.value,
      },
      {
        metricId: 'paid_members',
        value: dashboard.secondary.paidMembers.value,
        sampleSize: dashboard.secondary.paidMembers.value,
      },
      {
        metricId: 'registration_to_paid',
        value: dashboard.membershipConversion.rate ?? 0,
        sampleSize: dashboard.membershipConversion.registered,
      },
    ];

    for (const row of rows) {
      await this.prisma.careMetricSnapshot.upsert({
        where: {
          metricId_period_periodStart_geography: {
            metricId: row.metricId,
            period: 'day',
            periodStart: day,
            geography: 'ALL',
          },
        },
        create: {
          metricId: row.metricId,
          period: 'day',
          periodStart: day,
          geography: 'ALL',
          value: row.value,
          sampleSize: row.sampleSize,
        },
        update: { value: row.value, sampleSize: row.sampleSize },
      });
    }
  }

  private memberGeoWhere(geo: GeoFilter): Prisma.MemberWhereInput {
    const where: Prisma.MemberWhereInput = {};
    if (geo.county) where.county = geo.county;
    if (geo.subCounty) where.subCounty = geo.subCounty;
    return where;
  }

  private async buildDashboard(
    period: ReturnType<typeof parsePeriod>,
    geo: GeoFilter,
  ) {
    const memberGeo = this.memberGeoWhere(geo);
    const hasGeo = Boolean(geo.county || geo.subCounty);
    const memberFilter = hasGeo ? memberGeo : {};

    const visitWhere = (from: Date, to: Date): Prisma.VisitWhereInput => ({
      checkedInAt: { gte: from, lt: to },
      ...(hasGeo ? { member: memberFilter } : {}),
    });

    const dischargedWhere = (from: Date, to: Date): Prisma.VisitWhereInput => ({
      status: VisitStatus.DISCHARGED,
      dischargedAt: { gte: from, lt: to },
      ...(hasGeo ? { member: memberFilter } : {}),
    });

    const targets = await this.loadTargets();

    const [
      registeredStock,
      registeredInPeriod,
      registeredPrev,
      membersWithSub,
      paidStock,
      expiredStock,
      pendingPayments,
      failedPaymentsPeriod,
      cancelledInactive,
      newPaidInPeriod,
      visitsPeriod,
      visitsPrev,
      dischargedPeriod,
      dischargedPrev,
      treatedMembersPeriod,
      treatedMembersPrev,
      initiatedEpisodesPeriod,
      initiatedEpisodesPrev,
      campBooked,
      campAttended,
      siteSessions,
      siteSessionsPrev,
      firstVisitDelays,
      followupPairs,
      retention,
      referredInPeriod,
      newMembersPeriod,
      treatmentMixNow,
      treatmentMixPrev,
      geography,
      acquisition,
      satisfaction,
      dataQuality,
      monthlyCompleted,
      unpaidRecent,
      overdueFollowup,
      membershipDurationDays,
      completedContributionSum,
      disbursedSum,
      providerUtilization,
      appointmentNow,
      appointmentPrev,
    ] = await Promise.all([
      this.prisma.member.count({ where: memberFilter }),
      this.prisma.member.count({
        where: { ...memberFilter, createdAt: { gte: period.from, lt: period.to } },
      }),
      this.prisma.member.count({
        where: {
          ...memberFilter,
          createdAt: { gte: period.previousFrom, lt: period.previousTo },
        },
      }),
      this.prisma.subscription.count({
        where: hasGeo ? { member: memberFilter } : {},
      }),
      this.prisma.subscription.count({
        where: { isActive: true, ...(hasGeo ? { member: memberFilter } : {}) },
      }),
      this.prisma.subscription.count({
        where: {
          isActive: false,
          endDate: { not: null, lt: period.to },
          ...(hasGeo ? { member: memberFilter } : {}),
        },
      }),
      this.prisma.contribution.count({
        where: {
          status: 'PENDING',
          ...(hasGeo ? { member: memberFilter } : {}),
        },
      }),
      this.prisma.contribution.count({
        where: {
          status: 'FAILED',
          createdAt: { gte: period.from, lt: period.to },
          ...(hasGeo ? { member: memberFilter } : {}),
        },
      }),
      this.prisma.subscription.count({
        where: {
          isActive: false,
          ...(hasGeo ? { member: memberFilter } : {}),
        },
      }),
      this.prisma.subscription.count({
        where: {
          isActive: true,
          startDate: { gte: period.from, lt: period.to },
          ...(hasGeo ? { member: memberFilter } : {}),
        },
      }),
      this.prisma.visit.groupBy({
        by: ['status'],
        where: visitWhere(period.from, period.to),
        _count: { _all: true },
      }),
      this.prisma.visit.groupBy({
        by: ['status'],
        where: visitWhere(period.previousFrom, period.previousTo),
        _count: { _all: true },
      }),
      this.prisma.visit.count({ where: dischargedWhere(period.from, period.to) }),
      this.prisma.visit.count({
        where: dischargedWhere(period.previousFrom, period.previousTo),
      }),
      this.uniqueTreatedMembers(period.from, period.to, hasGeo ? memberFilter : undefined),
      this.uniqueTreatedMembers(
        period.previousFrom,
        period.previousTo,
        hasGeo ? memberFilter : undefined,
      ),
      this.initiatedEpisodeCount(period.from, period.to, hasGeo ? memberFilter : undefined),
      this.initiatedEpisodeCount(
        period.previousFrom,
        period.previousTo,
        hasGeo ? memberFilter : undefined,
      ),
      this.prisma.campRegistration.count({
        where: {
          createdAt: { gte: period.from, lt: period.to },
          ...(hasGeo ? { member: memberFilter } : {}),
        },
      }),
      this.prisma.campRegistration.count({
        where: {
          status: 'ATTENDED',
          createdAt: { gte: period.from, lt: period.to },
          ...(hasGeo ? { member: memberFilter } : {}),
        },
      }),
      this.uniqueSiteSessions(period.from, period.to),
      this.uniqueSiteSessions(period.previousFrom, period.previousTo),
      this.firstVisitDelays(period.from, period.to, hasGeo ? memberFilter : undefined),
      this.followUpAfterDischarge(period.from, period.to, hasGeo ? memberFilter : undefined),
      this.retentionCohort(period.from, period.to, hasGeo ? memberFilter : undefined),
      this.prisma.member.count({
        where: {
          ...memberFilter,
          createdAt: { gte: period.from, lt: period.to },
          referredBy: { not: null },
        },
      }),
      this.prisma.member.count({
        where: {
          ...memberFilter,
          createdAt: { gte: period.from, lt: period.to },
        },
      }),
      this.treatmentMix(period.from, period.to, hasGeo ? memberFilter : undefined),
      this.treatmentMix(
        period.previousFrom,
        period.previousTo,
        hasGeo ? memberFilter : undefined,
      ),
      this.geographyBreakdown(period.from, period.to),
      this.acquisitionBreakdown(period.from, period.to, hasGeo ? memberFilter : undefined),
      this.satisfactionStats(period.from, period.to, hasGeo ? memberFilter : undefined),
      this.dataHealth(memberFilter),
      this.monthlyCompletedTrend(hasGeo ? memberFilter : undefined),
      this.unpaidRecentMembers(hasGeo ? memberFilter : undefined),
      this.overdueFollowup(hasGeo ? memberFilter : undefined),
      this.avgMembershipDays(hasGeo ? memberFilter : undefined),
      this.prisma.contribution.aggregate({
        _sum: { amount: true },
        where: {
          status: 'COMPLETED',
          createdAt: { gte: period.from, lt: period.to },
          ...(hasGeo ? { member: memberFilter } : {}),
        },
      }),
      this.prisma.disbursal.aggregate({
        _sum: { amount: true },
        where: {
          status: 'COMPLETED',
          createdAt: { gte: period.from, lt: period.to },
        },
      }),
      this.providerUtilization(period.from, period.to),
      this.appointmentStats(period.from, period.to, hasGeo ? memberFilter : undefined),
      this.appointmentStats(
        period.previousFrom,
        period.previousTo,
        hasGeo ? memberFilter : undefined,
      ),
    ]);

    const visitCount = (rows: { status: VisitStatus; _count: { _all: number } }[]) =>
      rows.reduce((sum, r) => sum + r._count._all, 0);
    const visitCountStatus = (
      rows: { status: VisitStatus; _count: { _all: number } }[],
      status: VisitStatus,
    ) => rows.find((r) => r.status === status)?._count._all ?? 0;

    const attendedPeriod = visitCount(visitsPeriod) + campAttended;
    const attendedPrev = visitCount(visitsPrev);
    const bookedTracked = true;
    const bookedCount = appointmentNow.bookedMembers;
    const cancelledVisits = visitCountStatus(visitsPeriod, VisitStatus.CANCELLED);

    const paidConversion = ratio(paidStock, registeredStock);

    const completionRate = ratio(dischargedPeriod, initiatedEpisodesPeriod);
    const completionRatePrev = ratio(dischargedPrev, initiatedEpisodesPrev);

    const attendanceToTreatment = ratio(treatedMembersPeriod, attendedPeriod);
    const attendanceToTreatmentPrev = ratio(treatedMembersPrev, attendedPrev);

    const paidToCare = ratio(treatedMembersPeriod, paidStock);
    const referralRate = ratio(referredInPeriod, newMembersPeriod);
    const followUpRate = ratio(followupPairs.completed, followupPairs.required);

    const timeToFirst = median(firstVisitDelays.current);
    const timeToFirstPrev = median(firstVisitDelays.previous);
    const timeToFirstChange = pctChange(timeToFirst ?? 0, timeToFirstPrev ?? 0);

    const momCompleted = pctChange(dischargedPeriod, dischargedPrev);
    const trailing3 =
      monthlyCompleted.slice(-3).reduce((s, m) => s + m.value, 0) /
      Math.max(monthlyCompleted.slice(-3).length, 1);

    const northStarTarget =
      targets.completed_treatments_monthly.targetValue;
    const northStarStatus = dataStatus(dischargedPeriod, MIN_SAMPLE_TREND);

    const secondary = {
      patientsTreated: {
        metricId: 'patients_treated',
        label: 'Patients treated',
        value: treatedMembersPeriod,
        previous: treatedMembersPrev,
        changePct: pctChange(treatedMembersPeriod, treatedMembersPrev),
        definition: METRIC_CATALOG.patients_treated.definition,
        dataStatus: dataStatus(treatedMembersPeriod, 1),
      },
      activeMembers: {
        metricId: 'active_members',
        label: 'Active members',
        value: paidStock,
        definition:
          'Members with a current/valid membership (active subscription). In the current data model this matches paid members.',
        dataStatus: 'ok' as const,
      },
      paidMembers: {
        metricId: 'paid_members',
        label: 'Paid members',
        value: paidStock,
        definition: 'Members currently paying / subscribed (subscription.isActive).',
        dataStatus: 'ok' as const,
      },
      treatmentCompletionRate: {
        metricId: 'treatment_completion',
        label: 'Treatment completion rate',
        value: completionRate,
        previous: completionRatePrev,
        sampleSize: initiatedEpisodesPeriod,
        target: targets.treatment_completion.targetValue,
        definition:
          'Completed treatment episodes (discharged visits) / treatment episodes initiated (visits with at least one procedure).',
        dataStatus: dataStatus(
          initiatedEpisodesPeriod,
          targets.treatment_completion.minSampleSize,
        ),
      },
      patientRetention: {
        metricId: 'retention_90d',
        label: 'Patient retention',
        value: retention.rate,
        sampleSize: retention.eligible,
        returning: retention.returning,
        eligible: retention.eligible,
        cohortDefinition: METRIC_CATALOG.retention_90d.definition,
        target: targets.retention_90d.targetValue,
        dataStatus: dataStatus(
          retention.eligible,
          targets.retention_90d.minSampleSize,
        ),
      },
      referralRate: {
        metricId: 'referral_rate',
        label: 'Referral rate',
        value: referralRate,
        sampleSize: newMembersPeriod,
        referred: referredInPeriod,
        totalNew: newMembersPeriod,
        cohortDefinition: METRIC_CATALOG.referral_rate.definition,
        target: targets.referral_rate.targetValue,
        dataStatus: dataStatus(
          newMembersPeriod,
          targets.referral_rate.minSampleSize,
        ),
      },
    };

    const stages = CARE_LOOP_STAGES.map((stage) => {
      const counts: Record<string, number | null> = {
        reach: siteSessions,
        lead: null,
        registered: registeredStock,
        member: membersWithSub,
        paid: paidStock,
        booked: bookedCount,
        attended: attendedPeriod,
        treated: treatedMembersPeriod,
        completed: dischargedPeriod,
        follow_up: followupPairs.completed,
        retained: retention.returning,
        referred: referredInPeriod,
      };
      const prev: Record<string, number | null> = {
        reach: siteSessionsPrev,
        lead: null,
        registered: registeredStock - registeredInPeriod,
        member: membersWithSub,
        paid: paidStock,
        booked: appointmentPrev.bookedMembers,
        attended: attendedPrev,
        treated: treatedMembersPrev,
        completed: dischargedPrev,
        follow_up: null,
        retained: null,
        referred: null,
      };
      return {
        id: stage.id,
        label: stage.label,
        metricId: stage.metricId,
        definition: stage.definition,
        tracked: stage.tracked,
        untrackedReason: stage.untrackedReason,
        count: counts[stage.id],
        previous: prev[stage.id],
        changePct:
          counts[stage.id] != null && prev[stage.id] != null
            ? pctChange(counts[stage.id] as number, prev[stage.id] as number)
            : null,
        dataStatus: stage.tracked
          ? dataStatus(counts[stage.id] ?? 0, stage.id === 'reach' ? 1 : 1)
          : 'not_tracked',
      };
    });

    const transitions = this.buildTransitions(targets, {
      registered: registeredStock,
      paid: paidStock,
      paidConversion,
      booked: bookedCount,
      bookedTracked,
      attended: attendedPeriod,
      treated: treatedMembersPeriod,
      initiated: initiatedEpisodesPeriod,
      completed: dischargedPeriod,
      followUpRequired: followupPairs.required,
      followUpCompleted: followupPairs.completed,
      followUpRate,
      retention: retention.rate,
      retentionEligible: retention.eligible,
      referralRate,
      newMembers: newMembersPeriod,
      siteSessions,
      attendanceToTreatment,
      paidToCare,
    });

    const ranked = rankOpportunities(transitions);
    const usable = ranked.find((r) => r.dataStatus === 'ok' && r.opportunity > 0) || null;
    const narrative = bottleneckNarrative(usable);

    const careLoopHealth = [
      {
        key: 'demand',
        label: 'Demand',
        status: healthFromRate({
          current: siteSessions > 0 ? 1 : null,
          target: 1,
          sampleSize: siteSessions,
          minSample: 1,
        }),
        reason:
          siteSessions > 0
            ? `${siteSessions} website sessions in period (reach proxy).`
            : 'No independent qualified-lead stream yet.',
      },
      {
        key: 'membership_conversion',
        label: 'Membership conversion',
        status: healthFromRate({
          current: paidConversion,
          target: targets.registration_to_paid.targetValue,
          sampleSize: registeredStock,
          minSample: targets.registration_to_paid.minSampleSize,
        }),
        reason: `${paidStock} paid / ${registeredStock} registered.`,
      },
      {
        key: 'booking',
        label: 'Booking',
        status: healthFromRate({
          current: ratio(appointmentNow.bookedMembers, paidStock),
          target: targets.paid_to_booking.targetValue,
          sampleSize: paidStock,
          minSample: targets.paid_to_booking.minSampleSize,
        }),
        reason: `${appointmentNow.created} appointments created · ${appointmentNow.noShow} no-shows · ${appointmentNow.cancelled} cancelled.`,
      },
      {
        key: 'attendance',
        label: 'Attendance',
        status: healthFromRate({
          current: appointmentNow.keptRate,
          target: targets.booking_to_attendance.targetValue,
          sampleSize: appointmentNow.due,
          minSample: targets.booking_to_attendance.minSampleSize,
        }),
        reason:
          appointmentNow.due === 0
            ? `${attendedPeriod} walk-in check-ins. No booked appointments were due in this period.`
            : `${appointmentNow.attended} attended / ${appointmentNow.due} due appointments (no-show ${appointmentNow.noShow}).`,
      },
      {
        key: 'treatment_delivery',
        label: 'Treatment delivery',
        status: healthFromRate({
          current: completionRate,
          target: targets.treatment_completion.targetValue,
          sampleSize: initiatedEpisodesPeriod,
          minSample: targets.treatment_completion.minSampleSize,
        }),
        reason: `${dischargedPeriod} completed / ${initiatedEpisodesPeriod} initiated episodes.`,
      },
      {
        key: 'follow_up',
        label: 'Follow-up',
        status: healthFromRate({
          current: followUpRate,
          target: targets.treatment_to_followup.targetValue,
          sampleSize: followupPairs.required,
          minSample: targets.treatment_to_followup.minSampleSize,
        }),
        reason:
          followupPairs.required === 0
            ? 'No completed treatments old enough to assess follow-up.'
            : `${followupPairs.completed} of ${followupPairs.required} discharged patients returned.`,
      },
      {
        key: 'retention',
        label: 'Retention',
        status: healthFromRate({
          current: retention.rate,
          target: targets.retention_90d.targetValue,
          sampleSize: retention.eligible,
          minSample: targets.retention_90d.minSampleSize,
          early: true,
        }),
        reason: METRIC_CATALOG.retention_90d.definition,
      },
      {
        key: 'referral',
        label: 'Referral',
        status: healthFromRate({
          current: referralRate,
          target: targets.referral_rate.targetValue,
          sampleSize: newMembersPeriod,
          minSample: targets.referral_rate.minSampleSize,
          early: true,
        }),
        reason: `${referredInPeriod} of ${newMembersPeriod} new members were referred.`,
      },
    ];

    const weakestId = usable?.transitionId;
    const membershipToCare = {
      paidMembers: paidStock,
      usedCarePct: paidToCare,
      patientsTreated: treatedMembersPeriod,
      treatmentsCompleted: dischargedPeriod,
      definition:
        'Of currently paid members, the share who received at least one procedure in the selected period.',
    };

    const funding = completedContributionSum._sum.amount || 0;
    const careCost = disbursedSum._sum.amount || 0;
    const sustainability = {
      membershipContributionsKes: funding,
      careDisbursedKes: careCost,
      fundingPerCompletedTreatment:
        dischargedPeriod > 0 ? funding / dischargedPeriod : null,
      costPerCompletedTreatment:
        dischargedPeriod > 0 && careCost > 0 ? careCost / dischargedPeriod : null,
      costPerPatientTreated:
        treatedMembersPeriod > 0 && careCost > 0
          ? careCost / treatedMembersPeriod
          : null,
      membershipContributionPerMember:
        paidStock > 0 ? funding / paidStock : null,
      subsidyPerTreatment:
        dischargedPeriod > 0 && careCost > 0
          ? Math.max(careCost - funding, 0) / dischargedPeriod
          : null,
      unitImpact:
        funding > 0 && dischargedPeriod > 0
          ? {
              kesPerTreatment: funding / dischargedPeriod,
              treatmentsPer1000Kes: (dischargedPeriod / funding) * 1000,
            }
          : null,
      note:
        careCost === 0
          ? 'Care-delivery cost uses completed clinic disbursals. If disbursals are not recorded, subsidy figures stay empty rather than showing 0.'
          : 'Subsidy is disbursed care cost minus membership contributions in the period. This is unit impact economics, not profit.',
      dataStatus:
        dischargedPeriod >= MIN_SAMPLE_TREND && (funding > 0 || careCost > 0)
          ? 'ok'
          : 'insufficient',
    };

    const mix = this.mergeMix(treatmentMixNow, treatmentMixPrev);

    const actionCenter = this.buildActionCenter({
      unpaidRecent,
      overdueFollowup,
      paidConversion,
      registeredStock,
      paidStock,
      targetPaid: targets.registration_to_paid.targetValue,
      appointmentNoShows: appointmentNow.noShow,
      appointmentDue: appointmentNow.due,
    });

    const conversionAssistant = {
      title: 'Conversion assistant',
      question: 'Who should we follow up with today?',
      cohort: unpaidRecent,
      note: 'Ranking uses membership engagement signals only — not clinical records.',
    };

    return {
      generatedAt: new Date().toISOString(),
      period: {
        from: period.from.toISOString(),
        to: period.to.toISOString(),
        previousFrom: period.previousFrom.toISOString(),
        previousTo: period.previousTo.toISOString(),
        label: period.label,
      },
      filters: geo,
      northStar: {
        metricId: 'completed_treatments',
        label: 'Completed treatments',
        current: dischargedPeriod,
        previous: dischargedPrev,
        momPct: momCompleted,
        trailing3mAvg: monthlyCompleted.length ? Math.round(trailing3 * 10) / 10 : null,
        trailing6m: monthlyCompleted,
        target: northStarTarget,
        sampleSize: dischargedPeriod,
        dataStatus: northStarStatus,
        definition: METRIC_CATALOG.completed_treatments.definition,
      },
      secondary,
      membershipFunnel: {
        registered: registeredStock,
        paid: paidStock,
        paidConversion,
        booked: bookedCount,
        bookedTracked,
        treated: treatedMembersPeriod,
        paidToTreated: paidToCare,
      },
      membershipConversion: {
        metricId: 'registration_to_paid',
        paid: paidStock,
        registered: registeredStock,
        rate: paidConversion,
        target: targets.registration_to_paid.targetValue,
        gapPp:
          paidConversion == null
            ? null
            : (paidConversion - targets.registration_to_paid.targetValue) * 100,
        byGeography: geography.conversion,
        byChannel: acquisition,
      },
      membership: {
        registered: registeredStock,
        active: paidStock,
        paid: paidStock,
        expired: expiredStock,
        cancelled: Math.max(cancelledInactive - expiredStock, 0),
        pendingPayment: pendingPayments,
        failedPayments: failedPaymentsPeriod,
        newSubscriptions: newPaidInPeriod,
        newRegistrations: registeredInPeriod,
        previousRegistrations: registeredPrev,
        conversion: paidConversion,
        avgMembershipDays: membershipDurationDays,
        membersWithSubscription: membersWithSub,
      },
      membershipToCare,
      careLoop: {
        stages,
        transitions: ranked,
        bottleneck: {
          ...narrative,
          ranked: usable,
          disclaimer:
            'This is probably where management attention is most valuable — not a mathematically determined strategy.',
        },
      },
      careLoopHealth,
      timeToCare: {
        registrationToFirstVisit: {
          metricId: 'time_to_first_care',
          label: 'Time to first care',
          medianDays: timeToFirst,
          previousMedianDays: timeToFirstPrev,
          changePct:
            timeToFirst != null && timeToFirstPrev != null ? timeToFirstChange : null,
          sampleSize: firstVisitDelays.current.length,
          definition: METRIC_CATALOG.time_to_first_care.definition,
          dataStatus: dataStatus(
            firstVisitDelays.current.length,
            MIN_SAMPLE_MEDIAN,
          ),
        },
        bookingToAppointment: {
          metricId: 'booking_to_appointment',
          label: 'Booking → appointment',
          medianDays: appointmentNow.waitMedianDays,
          sampleSize: appointmentNow.waitSamples,
          definition:
            'Median days from booking createdAt to scheduledAt for appointments in the period.',
          dataStatus: dataStatus(appointmentNow.waitSamples, MIN_SAMPLE_MEDIAN),
        },
        appointmentToTreatment: {
          metricId: 'appointment_to_checkin',
          medianMinutes: appointmentNow.checkInLagMedianMinutes,
          sampleSize: appointmentNow.checkInLagSamples,
          definition:
            'Median minutes from scheduled time to visit check-in for attended appointments.',
          dataStatus: dataStatus(
            appointmentNow.checkInLagSamples,
            MIN_SAMPLE_MEDIAN,
          ),
        },
        treatmentToFollowup: {
          medianDays: followupPairs.medianDays,
          sampleSize: followupPairs.intervals.length,
          dataStatus: dataStatus(followupPairs.intervals.length, MIN_SAMPLE_MEDIAN),
        },
      },
      patientImpact: {
        uniquePatientsTreated: treatedMembersPeriod,
        totalTreatments: initiatedEpisodesPeriod,
        completedTreatments: dischargedPeriod,
        cancelledVisits,
        firstTimePatients: firstVisitDelays.firstTimeInPeriod,
        returningPatients: Math.max(
          treatedMembersPeriod - firstVisitDelays.firstTimeInPeriod,
          0,
        ),
        followUpCompletion: followUpRate,
        patientSatisfaction: satisfaction,
        patientsReferred: referredInPeriod,
        geographicReach: geography.areas,
      },
      treatmentMix: mix,
      geography,
      acquisition,
      dataHealth: dataQuality,
      actionCenter,
      conversionAssistant,
      sustainability,
      operations: {
        providerUtilization,
        waitingTimeDays: timeToFirst,
        attendance: attendedPeriod,
        capacityNote:
          'Provider utilization is visits per staff member who checked patients in during the period.',
      },
      appointments: {
        created: appointmentNow.created,
        bookedMembers: appointmentNow.bookedMembers,
        attended: appointmentNow.attended,
        noShow: appointmentNow.noShow,
        cancelled: appointmentNow.cancelled,
        rescheduled: appointmentNow.rescheduled,
        keptRate: appointmentNow.keptRate,
        noShowRate: appointmentNow.noShowRate,
        previous: {
          created: appointmentPrev.created,
          attended: appointmentPrev.attended,
          noShow: appointmentPrev.noShow,
        },
        definition:
          'Clinic appointments in the period. Kept rate = attended / (attended + no-show) among due appointments.',
      },
      observedFacts: this.observedFacts({
        dischargedPeriod,
        dischargedPrev,
        momCompleted,
        paidStock,
        registeredStock,
        paidConversion,
        treatedMembersPeriod,
        weakestLabel: usable?.label,
        appointmentsCreated: appointmentNow.created,
        appointmentsAttended: appointmentNow.attended,
        appointmentsNoShow: appointmentNow.noShow,
        appointmentsCancelled: appointmentNow.cancelled,
      }),
    };
  }

  private observedFacts(input: {
    dischargedPeriod: number;
    dischargedPrev: number;
    momCompleted: number | null;
    paidStock: number;
    registeredStock: number;
    paidConversion: number | null;
    treatedMembersPeriod: number;
    weakestLabel?: string;
    appointmentsCreated: number;
    appointmentsAttended: number;
    appointmentsNoShow: number;
    appointmentsCancelled: number;
  }) {
    const facts: { kind: 'OBSERVED'; text: string; metricId: string }[] = [];
    if (input.momCompleted != null) {
      facts.push({
        kind: 'OBSERVED',
        metricId: 'completed_treatments',
        text: `Completed treatments moved from ${input.dischargedPrev} last period to ${input.dischargedPeriod} (${input.momCompleted >= 0 ? '+' : ''}${input.momCompleted.toFixed(1)}%).`,
      });
    }
    if (input.paidConversion != null) {
      facts.push({
        kind: 'OBSERVED',
        metricId: 'registration_to_paid',
        text: `Paid conversion is ${input.paidStock} / ${input.registeredStock} = ${(input.paidConversion * 100).toFixed(1)}%.`,
      });
    }
    facts.push({
      kind: 'OBSERVED',
      metricId: 'patients_treated',
      text: `${input.treatedMembersPeriod} unique patients received at least one procedure in the selected period.`,
    });
    if (input.appointmentsCreated > 0) {
      facts.push({
        kind: 'OBSERVED',
        metricId: 'appointments_booked',
        text: `${input.appointmentsCreated} appointments created: ${input.appointmentsAttended} attended, ${input.appointmentsNoShow} no-shows, ${input.appointmentsCancelled} cancelled.`,
      });
    }
    return facts;
  }

  private buildActionCenter(input: {
    unpaidRecent: { count: number; sampleIds: string[] };
    overdueFollowup: { count: number; sampleIds: string[] };
    paidConversion: number | null;
    registeredStock: number;
    paidStock: number;
    targetPaid: number;
    appointmentNoShows: number;
    appointmentDue: number;
  }) {
    const items: Array<{
      problem: string;
      evidence: string;
      metricId: string;
      suggestedAction: string;
      expectedImpact: string;
      confidence: string;
      status: string;
      cohortKey: string;
      count: number;
      actions: string[];
    }> = [];
    if (input.unpaidRecent.count > 0) {
      items.push({
        problem: 'Low registration → paid conversion among recent members.',
        evidence: `${input.unpaidRecent.count} members registered 7–30 days ago have never had an active subscription.`,
        metricId: 'registration_to_paid',
        suggestedAction: 'Run a membership education follow-up with that cohort.',
        expectedImpact: 'Increase registration → paid conversion.',
        confidence: input.unpaidRecent.count >= 10 ? 'medium' : 'low',
        status: 'RECOMMENDED',
        cohortKey: 'unpaid_registered_7_30',
        count: input.unpaidRecent.count,
        actions: ['view_cohort'],
      });
    }
    if (input.overdueFollowup.count > 0) {
      items.push({
        problem: 'Completed treatments without a recorded return visit.',
        evidence: `${input.overdueFollowup.count} patients completed treatment 14+ days ago and have no later visit.`,
        metricId: 'treatment_to_followup',
        suggestedAction: 'Send an approved follow-up reminder.',
        expectedImpact: 'Increase follow-up completion.',
        confidence: 'medium',
        status: 'RECOMMENDED',
        cohortKey: 'overdue_followup',
        count: input.overdueFollowup.count,
        actions: ['view_cohort'],
      });
    }
    if (
      input.paidConversion != null &&
      input.paidConversion < input.targetPaid &&
      input.registeredStock >= 20
    ) {
      items.push({
        problem: 'Paid conversion is below the configured target.',
        evidence: `${input.registeredStock - input.paidStock} of ${input.registeredStock} registered members are unpaid. Rate ${(input.paidConversion * 100).toFixed(1)}% vs ${(input.targetPaid * 100).toFixed(0)}% target.`,
        metricId: 'registration_to_paid',
        suggestedAction:
          'Contact users who registered within the last 30 days and have demonstrated treatment intent.',
        expectedImpact: 'Increase paid conversion.',
        confidence: 'medium',
        status: 'RECOMMENDED',
        cohortKey: 'unpaid_all',
        count: input.registeredStock - input.paidStock,
        actions: ['view_cohort'],
      });
    }
    if (input.appointmentDue >= 5 && input.appointmentNoShows > 0) {
      const rate = input.appointmentNoShows / input.appointmentDue;
      if (rate >= 0.15) {
        items.push({
          problem: 'Booked appointments are leaking at attendance.',
          evidence: `${input.appointmentNoShows} of ${input.appointmentDue} due appointments were no-shows (${(rate * 100).toFixed(0)}%).`,
          metricId: 'appointments_attended',
          suggestedAction:
            'Review reminder delivery and clinic confirmation for the no-show cohort; keep day-before and hour-before SMS only.',
          expectedImpact: 'Increase appointment kept rate.',
          confidence: input.appointmentDue >= 20 ? 'medium' : 'low',
          status: 'RECOMMENDED',
          cohortKey: 'appointment_no_show',
          count: input.appointmentNoShows,
          actions: [],
        });
      }
    }
    return items;
  }

  private buildTransitions(
    targets: Record<
      string,
      {
        targetValue: number;
        minSampleSize: number;
        impactWeight: number;
        controllability: number;
      }
    >,
    v: {
      registered: number;
      paid: number;
      paidConversion: number | null;
      booked: number | null;
      bookedTracked: boolean;
      attended: number;
      treated: number;
      initiated: number;
      completed: number;
      followUpRequired: number;
      followUpCompleted: number;
      followUpRate: number | null;
      retention: number | null;
      retentionEligible: number;
      referralRate: number | null;
      newMembers: number;
      siteSessions: number;
      attendanceToTreatment: number | null;
      paidToCare: number | null;
    },
  ) {
    return [
      {
        transitionId: 'demand_to_registration',
        label: 'Demand → registration',
        current: null,
        previous: null,
        target: targets.demand_to_registration.targetValue,
        volume: v.siteSessions,
        sampleSize: v.siteSessions,
        impactWeight: targets.demand_to_registration.impactWeight,
        controllability: targets.demand_to_registration.controllability,
        tracked: false,
      },
      {
        transitionId: 'registration_to_paid',
        label: 'Registration → paid',
        current: v.paidConversion,
        previous: null,
        target: targets.registration_to_paid.targetValue,
        volume: v.registered,
        sampleSize: v.registered,
        impactWeight: targets.registration_to_paid.impactWeight,
        controllability: targets.registration_to_paid.controllability,
        tracked: true,
      },
      {
        transitionId: 'paid_to_booking',
        label: 'Paid → booking',
        current: v.bookedTracked ? ratio(v.booked ?? 0, v.paid) : v.paidToCare,
        previous: null,
        target: targets.paid_to_booking.targetValue,
        volume: v.paid,
        sampleSize: v.paid,
        impactWeight: targets.paid_to_booking.impactWeight,
        controllability: targets.paid_to_booking.controllability,
        tracked: v.bookedTracked,
      },
      {
        transitionId: 'booking_to_attendance',
        label: 'Booking → attendance',
        current: v.bookedTracked ? ratio(v.attended, v.booked ?? 0) : null,
        previous: null,
        target: targets.booking_to_attendance.targetValue,
        volume: v.booked ?? 0,
        sampleSize: v.booked ?? 0,
        impactWeight: targets.booking_to_attendance.impactWeight,
        controllability: targets.booking_to_attendance.controllability,
        tracked: v.bookedTracked,
      },
      {
        transitionId: 'attendance_to_treatment',
        label: 'Attendance → treatment',
        current: v.attendanceToTreatment,
        previous: null,
        target: targets.attendance_to_treatment.targetValue,
        volume: v.attended,
        sampleSize: v.attended,
        impactWeight: targets.attendance_to_treatment.impactWeight,
        controllability: targets.attendance_to_treatment.controllability,
        tracked: true,
      },
      {
        transitionId: 'treatment_completion',
        label: 'Treatment completion',
        current: ratio(v.completed, v.initiated),
        previous: null,
        target: targets.treatment_completion.targetValue,
        volume: v.initiated,
        sampleSize: v.initiated,
        impactWeight: targets.treatment_completion.impactWeight,
        controllability: targets.treatment_completion.controllability,
        tracked: true,
      },
      {
        transitionId: 'treatment_to_followup',
        label: 'Treatment → follow-up',
        current: v.followUpRate,
        previous: null,
        target: targets.treatment_to_followup.targetValue,
        volume: v.followUpRequired,
        sampleSize: v.followUpRequired,
        impactWeight: targets.treatment_to_followup.impactWeight,
        controllability: targets.treatment_to_followup.controllability,
        tracked: true,
      },
      {
        transitionId: 'retention_90d',
        label: 'Retention (90-day cohort)',
        current: v.retention,
        previous: null,
        target: targets.retention_90d.targetValue,
        volume: v.retentionEligible,
        sampleSize: v.retentionEligible,
        impactWeight: targets.retention_90d.impactWeight,
        controllability: targets.retention_90d.controllability,
        tracked: true,
      },
      {
        transitionId: 'referral_rate',
        label: 'Referral rate',
        current: v.referralRate,
        previous: null,
        target: targets.referral_rate.targetValue,
        volume: v.newMembers,
        sampleSize: v.newMembers,
        impactWeight: targets.referral_rate.impactWeight,
        controllability: targets.referral_rate.controllability,
        tracked: true,
      },
    ];
  }

  private async loadTargets() {
    const rows = await this.prisma.careLoopTarget.findMany();
    const merged = { ...DEFAULT_TARGETS };
    for (const row of rows) {
      merged[row.metricId] = {
        targetValue: row.targetValue,
        minSampleSize: row.minSampleSize,
        impactWeight: row.impactWeight,
        controllability: row.controllability,
      };
    }
    return merged;
  }

  private async appointmentStats(
    from: Date,
    to: Date,
    memberWhere?: Prisma.MemberWhereInput,
  ) {
    const rows = await this.prisma.appointment.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        ...(memberWhere ? { member: memberWhere } : {}),
      },
      select: {
        memberId: true,
        status: true,
        createdAt: true,
        scheduledAt: true,
        visit: { select: { checkedInAt: true } },
      },
    });
    const attended = rows.filter((r) => r.status === 'ATTENDED').length;
    const noShow = rows.filter((r) => r.status === 'NO_SHOW').length;
    const cancelled = rows.filter(
      (r) =>
        r.status === 'CANCELLED_BY_MEMBER' || r.status === 'CANCELLED_BY_CLINIC',
    ).length;
    const rescheduled = rows.filter((r) => r.status === 'RESCHEDULED').length;
    const waits = rows.map(
      (r) => (r.scheduledAt.getTime() - r.createdAt.getTime()) / 86_400_000,
    );
    const lags = rows
      .filter((r) => r.visit?.checkedInAt)
      .map(
        (r) =>
          (r.visit!.checkedInAt.getTime() - r.scheduledAt.getTime()) / 60_000,
      );
    const dueCount = attended + noShow;
    return {
      created: rows.length,
      bookedMembers: new Set(rows.map((r) => r.memberId)).size,
      attended,
      noShow,
      cancelled,
      rescheduled,
      due: dueCount,
      keptRate: ratio(attended, dueCount),
      noShowRate: ratio(noShow, dueCount),
      waitMedianDays: median(waits),
      waitSamples: waits.length,
      checkInLagMedianMinutes: median(lags),
      checkInLagSamples: lags.length,
    };
  }

  private async uniqueTreatedMembers(
    from: Date,
    to: Date,
    memberWhere?: Prisma.MemberWhereInput,
  ): Promise<number> {
    const rows = await this.prisma.visitProcedure.findMany({
      where: {
        addedAt: { gte: from, lt: to },
        visit: {
          status: { not: VisitStatus.CANCELLED },
          ...(memberWhere ? { member: memberWhere } : {}),
        },
      },
      select: { visitId: true, visit: { select: { memberId: true } } },
      distinct: ['visitId'],
    });
    return new Set(rows.map((r) => r.visit.memberId)).size;
  }

  private async initiatedEpisodeCount(
    from: Date,
    to: Date,
    memberWhere?: Prisma.MemberWhereInput,
  ): Promise<number> {
    const rows = await this.prisma.visit.findMany({
      where: {
        status: { not: VisitStatus.CANCELLED },
        procedures: { some: {} },
        OR: [
          { checkedInAt: { gte: from, lt: to } },
          { dischargedAt: { gte: from, lt: to } },
        ],
        ...(memberWhere ? { member: memberWhere } : {}),
      },
      select: { id: true },
    });
    return rows.length;
  }

  private async uniqueSiteSessions(from: Date, to: Date): Promise<number> {
    const rows = await this.prisma.siteVisit.groupBy({
      by: ['sessionId'],
      where: {
        createdAt: { gte: from, lt: to },
        sessionId: { not: null },
      },
    });
    return rows.length;
  }

  private async firstVisitDelays(
    from: Date,
    to: Date,
    memberWhere?: Prisma.MemberWhereInput,
  ) {
    const visits = await this.prisma.visit.findMany({
      where: {
        status: { not: VisitStatus.CANCELLED },
        ...(memberWhere ? { member: memberWhere } : {}),
      },
      select: {
        memberId: true,
        checkedInAt: true,
        member: { select: { createdAt: true } },
      },
      orderBy: { checkedInAt: 'asc' },
    });

    const firstByMember = new Map<string, { checkedInAt: Date; createdAt: Date }>();
    for (const v of visits) {
      if (!firstByMember.has(v.memberId)) {
        firstByMember.set(v.memberId, {
          checkedInAt: v.checkedInAt,
          createdAt: v.member.createdAt,
        });
      }
    }

    const current: number[] = [];
    const previous: number[] = [];
    let firstTimeInPeriod = 0;
    const prevFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));

    for (const row of firstByMember.values()) {
      const days =
        (row.checkedInAt.getTime() - row.createdAt.getTime()) / 86_400_000;
      if (days < 0) continue;
      if (row.checkedInAt >= from && row.checkedInAt < to) {
        current.push(days);
        firstTimeInPeriod += 1;
      } else if (row.checkedInAt >= prevFrom && row.checkedInAt < from) {
        previous.push(days);
      }
    }

    return { current, previous, firstTimeInPeriod };
  }

  private async followUpAfterDischarge(
    from: Date,
    to: Date,
    memberWhere?: Prisma.MemberWhereInput,
  ) {
    const lookbackStart = addDays(from, -90);
    const discharged = await this.prisma.visit.findMany({
      where: {
        status: VisitStatus.DISCHARGED,
        dischargedAt: { gte: lookbackStart, lt: addDays(to, -7) },
        ...(memberWhere ? { member: memberWhere } : {}),
      },
      select: { memberId: true, dischargedAt: true },
    });

    const requiredMembers = new Set(discharged.map((d) => d.memberId));
    if (requiredMembers.size === 0) {
      return { required: 0, completed: 0, medianDays: null, intervals: [] as number[] };
    }

    const laterVisits = await this.prisma.visit.findMany({
      where: {
        memberId: { in: [...requiredMembers] },
        checkedInAt: { gte: from, lt: to },
        ...(memberWhere ? { member: memberWhere } : {}),
      },
      select: { memberId: true, checkedInAt: true },
    });

    const firstDischarge = new Map<string, Date>();
    for (const d of discharged) {
      if (!d.dischargedAt) continue;
      const prev = firstDischarge.get(d.memberId);
      if (!prev || d.dischargedAt < prev) firstDischarge.set(d.memberId, d.dischargedAt);
    }

    const intervals: number[] = [];
    const returned = new Set<string>();
    for (const v of laterVisits) {
      const base = firstDischarge.get(v.memberId);
      if (!base) continue;
      if (v.checkedInAt <= base) continue;
      returned.add(v.memberId);
      intervals.push((v.checkedInAt.getTime() - base.getTime()) / 86_400_000);
    }

    return {
      required: requiredMembers.size,
      completed: returned.size,
      medianDays: median(intervals),
      intervals,
    };
  }

  private async retentionCohort(
    from: Date,
    to: Date,
    memberWhere?: Prisma.MemberWhereInput,
  ) {
    const eligibleFrom = addDays(from, -RETENTION_LOOKBACK_DAYS);
    const eligible = await this.prisma.visit.findMany({
      where: {
        status: VisitStatus.DISCHARGED,
        dischargedAt: { gte: eligibleFrom, lt: from },
        ...(memberWhere ? { member: memberWhere } : {}),
      },
      select: { memberId: true },
      distinct: ['memberId'],
    });
    const ids = eligible.map((e) => e.memberId);
    if (ids.length === 0) {
      return { eligible: 0, returning: 0, rate: null as number | null };
    }
    const returning = await this.prisma.visit.findMany({
      where: {
        memberId: { in: ids },
        checkedInAt: { gte: from, lt: to },
        status: { not: VisitStatus.CANCELLED },
      },
      select: { memberId: true },
      distinct: ['memberId'],
    });
    return {
      eligible: ids.length,
      returning: returning.length,
      rate: ratio(returning.length, ids.length),
    };
  }

  private async treatmentMix(
    from: Date,
    to: Date,
    memberWhere?: Prisma.MemberWhereInput,
  ) {
    const rows = await this.prisma.visitProcedure.findMany({
      where: {
        addedAt: { gte: from, lt: to },
        visit: {
          status: { not: VisitStatus.CANCELLED },
          ...(memberWhere ? { member: memberWhere } : {}),
        },
      },
      select: {
        procedure: { select: { code: true, name: true } },
      },
    });
    const counts = new Map<string, number>();
    for (const row of rows) {
      const category = mapTreatmentCategory(row.procedure.code);
      counts.set(category, (counts.get(category) || 0) + 1);
    }
    return counts;
  }

  private mergeMix(now: Map<string, number>, prev: Map<string, number>) {
    const keys = new Set([...now.keys(), ...prev.keys()]);
    const rows = [...keys].map((category) => {
      const current = now.get(category) || 0;
      const previous = prev.get(category) || 0;
      return {
        category,
        current,
        previous,
        changePct: pctChange(current, previous),
      };
    });
    rows.sort((a, b) => b.current - a.current);
    return rows;
  }

  private async geographyBreakdown(from: Date, to: Date) {
    const members = await this.prisma.member.groupBy({
      by: ['county'],
      _count: { _all: true },
    });
    const paidMembers = await this.prisma.subscription.findMany({
      where: { isActive: true },
      select: { member: { select: { county: true } } },
    });
    const treated = await this.prisma.visitProcedure.findMany({
      where: {
        addedAt: { gte: from, lt: to },
        visit: { status: { not: VisitStatus.CANCELLED } },
      },
      select: { visit: { select: { member: { select: { id: true, county: true } } } } },
    });
    const completed = await this.prisma.visit.findMany({
      where: {
        status: VisitStatus.DISCHARGED,
        dischargedAt: { gte: from, lt: to },
      },
      select: { member: { select: { county: true } } },
    });

    const areaMap = new Map<
      string,
      {
        area: string;
        members: number;
        paid: number;
        treated: number;
        completed: number;
      }
    >();
    const bump = (area: string, field: 'members' | 'paid' | 'treated' | 'completed') => {
      const key = area || 'Unknown';
      const row = areaMap.get(key) || {
        area: key,
        members: 0,
        paid: 0,
        treated: 0,
        completed: 0,
      };
      row[field] += 1;
      areaMap.set(key, row);
    };

    for (const m of members) {
      const key = m.county || 'Unknown';
      areaMap.set(key, {
        area: key,
        members: m._count._all,
        paid: 0,
        treated: 0,
        completed: 0,
      });
    }
    for (const m of paidMembers) {
      const key = m.member.county || 'Unknown';
      const row = areaMap.get(key) || {
        area: key,
        members: 0,
        paid: 0,
        treated: 0,
        completed: 0,
      };
      row.paid += 1;
      areaMap.set(key, row);
    }
    const treatedIds = new Set<string>();
    for (const t of treated) {
      const id = t.visit.member.id;
      if (treatedIds.has(id)) continue;
      treatedIds.add(id);
      bump(t.visit.member.county || 'Unknown', 'treated');
    }
    for (const c of completed) bump(c.member.county || 'Unknown', 'completed');

    const areas = [...areaMap.values()].sort((a, b) => b.completed - a.completed);
    const totalCompleted = areas.reduce((s, a) => s + a.completed, 0) || 1;
    const totalMembers = areas.reduce((s, a) => s + a.members, 0) || 1;
    const conversion = areas.map((a) => ({
      area: a.area,
      members: a.members,
      paid: a.paid,
      paidConversion: ratio(a.paid, a.members),
      completedShare: a.completed / totalCompleted,
      demandShare: a.members / totalMembers,
      patientsTreated: a.treated,
      completed: a.completed,
      membersToPatients: ratio(a.treated, a.members),
    }));

    return { areas: conversion, conversion };
  }

  private async acquisitionBreakdown(
    from: Date,
    to: Date,
    memberWhere?: Prisma.MemberWhereInput,
  ) {
    const members = await this.prisma.member.findMany({
      where: { createdAt: { gte: from, lt: to }, ...memberWhere },
      select: {
        id: true,
        referredBy: true,
        subscription: { select: { isActive: true } },
        visits: {
          where: { procedures: { some: {} } },
          select: { id: true },
          take: 1,
        },
      },
    });
    const buckets = {
      referral: { leads: 0, registered: 0, paid: 0, treated: 0 },
      unknown: { leads: 0, registered: 0, paid: 0, treated: 0 },
    };
    for (const m of members) {
      const key = m.referredBy ? 'referral' : 'unknown';
      buckets[key].registered += 1;
      buckets[key].leads += 1;
      if (m.subscription?.isActive) buckets[key].paid += 1;
      if (m.visits.length > 0) buckets[key].treated += 1;
    }
    return Object.entries(buckets).map(([channel, row]) => ({
      channel,
      ...row,
      treatmentYield: ratio(row.treated, row.registered),
      paidConversion: ratio(row.paid, row.registered),
      referralYield: channel === 'referral' ? 1 : 0,
    }));
  }

  private async satisfactionStats(
    from: Date,
    to: Date,
    memberWhere?: Prisma.MemberWhereInput,
  ) {
    const rows = await this.prisma.questionnaireData.findMany({
      where: {
        dateOfVisit: { gte: from, lt: to },
        smileSatisfaction: { not: null },
        ...(memberWhere ? { visit: { member: memberWhere } } : {}),
      },
      select: { smileSatisfaction: true },
    });
    const total = rows.length;
    const high = rows.filter((r) =>
      (r.smileSatisfaction || '').toLowerCase().includes('very'),
    ).length;
    return {
      responses: total,
      highSatisfaction: high,
      highSatisfactionRate: ratio(high, total),
      dataStatus: dataStatus(total, MIN_SAMPLE_RATE),
      definition:
        'Share of questionnaire responses in the period with smile satisfaction containing “very” (Very Satisfied).',
    };
  }

  private async dataHealth(memberWhere: Prisma.MemberWhereInput) {
    const [total, withGeo, withSource, visitsOpenStale, outcomes, questionnaires] =
      await Promise.all([
        this.prisma.member.count({ where: memberWhere }),
        this.prisma.member.count({
          where: {
            ...memberWhere,
            OR: [
              { county: { not: null } },
              { subCounty: { not: null } },
              { location: { not: null } },
            ],
          },
        }),
        this.prisma.member.count({
          where: { ...memberWhere, referredBy: { not: null } },
        }),
        this.prisma.visit.count({
          where: {
            status: VisitStatus.OPEN,
            checkedInAt: { lt: addDays(new Date(), -1) },
            ...(Object.keys(memberWhere).length ? { member: memberWhere } : {}),
          },
        }),
        this.prisma.visit.count({
          where: {
            status: VisitStatus.DISCHARGED,
            procedures: { some: {} },
          },
        }),
        this.prisma.questionnaireData.count({
          where: { smileSatisfaction: { not: null } },
        }),
      ]);
    const discharged = await this.prisma.visit.count({
      where: { status: VisitStatus.DISCHARGED },
    });
    const issues: string[] = [];
    if (total > 0 && withSource / total < 0.85) {
      issues.push('Acquisition source missing on a large share of members.');
    }
    if (total > 0 && withGeo / total < 0.9) {
      issues.push('Geography missing on some member records.');
    }
    if (visitsOpenStale > 0) {
      issues.push(`${visitsOpenStale} visits have been open for more than 24 hours.`);
    }
    return {
      patientRecordsComplete: total === 0 ? null : withGeo / total,
      acquisitionSourceCaptured: total === 0 ? null : withSource / total,
      geographyCaptured: total === 0 ? null : withGeo / total,
      treatmentOutcomesCaptured: discharged === 0 ? null : outcomes / discharged,
      satisfactionCaptured: questionnaires,
      staleOpenVisits: visitsOpenStale,
      issues,
      totals: { members: total, discharged },
    };
  }

  private async monthlyCompletedTrend(memberWhere?: Prisma.MemberWhereInput) {
    const from = addMonths(startOfMonth(new Date()), -5);
    const visits = await this.prisma.visit.findMany({
      where: {
        status: VisitStatus.DISCHARGED,
        dischargedAt: { gte: from },
        ...(memberWhere ? { member: memberWhere } : {}),
      },
      select: { dischargedAt: true },
    });
    const buckets = new Map<string, number>();
    for (let i = 0; i < 6; i++) {
      const d = addMonths(from, i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      buckets.set(key, 0);
    }
    for (const v of visits) {
      if (!v.dischargedAt) continue;
      const key = `${v.dischargedAt.getFullYear()}-${String(v.dischargedAt.getMonth() + 1).padStart(2, '0')}`;
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    return [...buckets.entries()].map(([month, value]) => ({ month, value }));
  }

  private async unpaidRecentMembers(memberWhere?: Prisma.MemberWhereInput) {
    const now = new Date();
    const from = addDays(now, -30);
    const to = addDays(now, -7);
    const members = await this.prisma.member.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        ...memberWhere,
        OR: [{ subscription: { is: null } }, { subscription: { isActive: false } }],
      },
      select: { id: true },
      take: 200,
    });
    return { count: members.length, sampleIds: members.slice(0, 20).map((m) => m.id) };
  }

  private async overdueFollowup(memberWhere?: Prisma.MemberWhereInput) {
    const cutoff = addDays(new Date(), -14);
    const discharged = await this.prisma.visit.findMany({
      where: {
        status: VisitStatus.DISCHARGED,
        dischargedAt: { lte: cutoff },
        ...(memberWhere ? { member: memberWhere } : {}),
      },
      select: { memberId: true, dischargedAt: true },
      distinct: ['memberId'],
    });
    if (discharged.length === 0) return { count: 0, sampleIds: [] as string[] };
    const later = await this.prisma.visit.findMany({
      where: {
        memberId: { in: discharged.map((d) => d.memberId) },
        checkedInAt: { gt: cutoff },
      },
      select: { memberId: true },
      distinct: ['memberId'],
    });
    const returned = new Set(later.map((l) => l.memberId));
    const overdue = discharged.filter((d) => !returned.has(d.memberId));
    return {
      count: overdue.length,
      sampleIds: overdue.slice(0, 20).map((d) => d.memberId),
    };
  }

  private async avgMembershipDays(memberWhere?: Prisma.MemberWhereInput) {
    const subs = await this.prisma.subscription.findMany({
      where: {
        isActive: true,
        ...(memberWhere ? { member: memberWhere } : {}),
      },
      select: { startDate: true },
    });
    if (subs.length === 0) return null;
    const now = Date.now();
    const days = subs.map((s) => (now - s.startDate.getTime()) / 86_400_000);
    return median(days);
  }

  private async providerUtilization(from: Date, to: Date) {
    const rows = await this.prisma.visit.groupBy({
      by: ['staffId'],
      where: {
        checkedInAt: { gte: from, lt: to },
        status: { not: VisitStatus.CANCELLED },
      },
      _count: { _all: true },
    });
    if (rows.length === 0) {
      return { providers: 0, visits: 0, visitsPerProvider: null, dataStatus: 'insufficient' };
    }
    const visits = rows.reduce((s, r) => s + r._count._all, 0);
    return {
      providers: rows.length,
      visits,
      visitsPerProvider: visits / rows.length,
      dataStatus: dataStatus(visits, MIN_SAMPLE_TREND),
    };
  }
}
