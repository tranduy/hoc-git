import { footballRefreshPolicy, type FootballCollectionPlan } from "@tool-chenh/contracts";

/** Self-contained: the same implementation runs in the worker and the owned provider document. */
export function createFootballCollectionScheduler(
  policyFor: typeof footballRefreshPolicy, now: () => number = Date.now
) {
  let revision = -1;
  let receivedPlanAt = 0;
  let manualId: string | undefined;
  const events = new Map<string, FootballCollectionPlan["events"][number]>();
  const receipts = new Map<string, { at: number; tier: string }>();
  const manual = new Set<string>();
  const discoveredAt = new Map<string, number>();
  const nativeTiming = new Map<string, { startAtUtcMs?: number | null; isLive?: boolean }>();
  const timing = (id: string, fallbackStart?: number | null, fallbackLive?: boolean) => {
    let native = nativeTiming.get(id);
    if (fallbackStart !== undefined || fallbackLive !== undefined) {
      native = { ...native, ...(fallbackStart === undefined ? {} : { startAtUtcMs: fallbackStart }),
        ...(fallbackLive === undefined ? {} : { isLive: fallbackLive }) };
      nativeTiming.delete(id);
      nativeTiming.set(id, native);
      if (nativeTiming.size > 10_000) nativeTiming.delete(nativeTiming.keys().next().value!);
    }
    const event = events.get(id);
    return { start: native?.startAtUtcMs === undefined ? event?.startAtUtcMs ?? null : native.startAtUtcMs,
      live: native?.isLive ?? event?.isLive ?? false };
  };
  const policy = (id: string, fallbackStart?: number | null, fallbackLive?: boolean) => {
    const effective = timing(id, fallbackStart, fallbackLive);
    return policyFor(effective.start, effective.live,
      events.get(id)?.urgent === true && now() - receivedPlanAt < 120_000, now());
  };
  return {
    setPlan(plan: FootballCollectionPlan): void {
      if (!Number.isSafeInteger(plan.revision) || plan.revision < revision) return;
      revision = plan.revision;
      receivedPlanAt = now();
      const ids = new Set(plan.events.map(e => e.eventId));
      for (const id of events.keys()) if (!ids.has(id)) {
        events.delete(id); receipts.delete(id); manual.delete(id); discoveredAt.delete(id); nativeTiming.delete(id);
      }
      for (const event of plan.events) {
        const prior = events.get(event.eventId);
        if (prior && (prior.startAtUtcMs !== event.startAtUtcMs || prior.isLive !== event.isLive)) {
          nativeTiming.delete(event.eventId);
        }
        events.set(event.eventId, event);
        if (!discoveredAt.has(event.eventId)) discoveredAt.set(event.eventId, now());
      }
      if (plan.manualRequestId !== undefined && plan.manualRequestId !== manualId) {
        manualId = plan.manualRequestId;
        for (const id of events.keys()) if (policy(id).refreshMs !== null) manual.add(id);
      }
    },
    policy,
    due(id: string, lastRealReceiptMs: number | null, fallbackStart?: number | null, fallbackLive?: boolean): boolean {
      if (revision >= 0 && !events.has(id)) return false;
      const effective = timing(id, fallbackStart, fallbackLive);
      if (!effective.live && typeof effective.start === "number" && Number.isFinite(effective.start) &&
        effective.start > 0 && effective.start < now()) return false;
      const p = policy(id);
      if (p.refreshMs === null) return false;
      if (manual.has(id)) return true;
      const prior = receipts.get(id);
      if (prior !== undefined && prior.tier !== p.tier) return true;
      const receivedAt = Math.max(prior?.at ?? 0, lastRealReceiptMs ?? 0);
      return receivedAt === 0 || now() - receivedAt >= p.refreshMs;
    },
    completed(id: string, realReceiptMs: number): void {
      if (!Number.isFinite(realReceiptMs) || realReceiptMs <= 0) return;
      if ((receipts.get(id)?.at ?? 0) > realReceiptMs) return;
      receipts.set(id, { at: realReceiptMs, tier: policy(id).tier });
      manual.delete(id);
      // Unknown native IDs may arrive between roster plans. Bound their memory too.
      if (receipts.size > 10_000) {
        for (const key of receipts.keys()) { if (!events.has(key)) receipts.delete(key); if (receipts.size <= 10_000) break; }
      }
    },
    sort(ids: readonly string[]): string[] {
      const startedAt = now();
      const values = [...new Set(ids)].sort((a, b) => {
        const pa = policy(a), pb = policy(b);
        return (pa.refreshMs ?? Infinity) - (pb.refreshMs ?? Infinity) ||
          Number(manual.has(b)) - Number(manual.has(a)) ||
          (receipts.get(a)?.at ?? discoveredAt.get(a) ?? 0) - (receipts.get(b)?.at ?? discoveredAt.get(b) ?? 0) || a.localeCompare(b);
      });
      // Reserve one physical slot in each batch for 24-72 hour discovery so
      // distant paired fixtures receive their first full market book promptly.
      // Subsequent reads still obey the one-hour per-event refresh policy.
      const background = values.filter(id => policy(id).tier === "24_72H");
      const far = (background.length > 0 ? background : values.filter(id =>
        (policy(id).refreshMs ?? 0) >= 600_000))
        .sort((a, b) => (receipts.get(a)?.at ?? discoveredAt.get(a) ?? startedAt) -
          (receipts.get(b)?.at ?? discoveredAt.get(b) ?? startedAt))[0];
      const farIndex = far === undefined ? -1 : values.indexOf(far);
      if (far !== undefined && farIndex >= 4) {
        values.splice(farIndex, 1);
        const firstNonLive = values.findIndex(id => !timing(id).live);
        values.splice(firstNonLive < 0 ? values.length : firstNonLive, 0, far);
      }
      return values;
    },
    snapshot() { return { revision, events: events.size, completed: receipts.size, manualPending: manual.size }; }
  };
}

export type FootballCollectionScheduler = ReturnType<typeof createFootballCollectionScheduler>;

/** Install only into the already-owned sports document. No navigation or network requests. */
export function collectionPlanExpression(plan: FootballCollectionPlan): string {
  return `(() => { const root = document.documentElement;
    const scheduler = root.__fieldlineCollectionSchedulerV1 ||
      (root.__fieldlineCollectionSchedulerV1 = (${createFootballCollectionScheduler.toString()})(${footballRefreshPolicy.toString()}));
    const plan = ${JSON.stringify(plan)};
    scheduler.setPlan(plan);
    root.__fieldlineCollectionPlanV1 = plan;
    return scheduler.snapshot();
  })()`;
}
