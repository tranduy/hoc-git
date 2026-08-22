export async function runSessionMaintenance(
  tick: () => Promise<void>,
  report: (error: unknown) => void
): Promise<void> {
  try {
    await tick();
  } catch (error) {
    report(error);
  }
}

export function createSessionMaintenanceRunner(
  tick: () => Promise<void>,
  report: (error: unknown) => void
): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  return () => {
    if (inFlight !== null) return inFlight;
    const operation = runSessionMaintenance(tick, report).finally(() => {
      if (inFlight === operation) inFlight = null;
    });
    inFlight = operation;
    return operation;
  };
}

export type MaintenanceLevel = "INFO" | "WARN" | "ERROR";

export interface MaintenanceLogEntry {
  readonly id: string;
  readonly atMs: number;
  readonly level: MaintenanceLevel;
  readonly message: string;
}

export class MaintenanceJournal {
  readonly #clock: { nowMs(): number };
  readonly #entries: MaintenanceLogEntry[] = [];
  #sequence = 0;
  readonly #filePath: string | null;

  constructor(clock: { nowMs(): number } = { nowMs: Date.now }, filePath?: string) {
    this.#clock = clock;
    this.#filePath = filePath ?? null;
    if (this.#filePath !== null) {
      try {
        const lines = readFileSync(this.#filePath, "utf8").split(/\r?\n/u).filter(Boolean).slice(-500);
        for (const line of lines) this.#entries.push(JSON.parse(line) as MaintenanceLogEntry);
      } catch { /* missing/corrupt diagnostics must never block live readers */ }
    }
  }

  record(level: MaintenanceLevel, message: string): MaintenanceLogEntry {
    const entry = { id: `${this.#clock.nowMs()}-${this.#sequence++}`, atMs: this.#clock.nowMs(), level,
      message: message.replace(/\s+/gu, " ").trim().slice(0, 240) } satisfies MaintenanceLogEntry;
    this.#entries.push(entry);
    if (this.#entries.length > 500) this.#entries.splice(0, this.#entries.length - 500);
    if (this.#filePath !== null) {
      try {
        mkdirSync(dirname(this.#filePath), { recursive: true });
        writeFileSync(this.#filePath, `${this.#entries.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
      } catch { /* diagnostics are best-effort and never affect maintenance */ }
    }
    return entry;
  }

  logs(): readonly MaintenanceLogEntry[] {
    return [...this.#entries];
  }

  notifications(): readonly MaintenanceLogEntry[] {
    return this.#entries.slice(-10).reverse();
  }
}

export type MaintenanceTrigger = "MANUAL" | "SCHEDULED";

export interface MaintenanceStatus {
  readonly running: boolean;
  readonly scheduledHour: 3;
  readonly lastStartedAtMs: number | null;
  readonly lastCompletedAtMs: number | null;
  readonly lastResult: "SUCCESS" | "FAILED" | null;
  readonly notifications: readonly MaintenanceLogEntry[];
}

export class SessionRefreshControl {
  readonly #refresh: () => Promise<void>;
  readonly #journal: MaintenanceJournal;
  readonly #clock: { nowMs(): number };
  #operation: Promise<void> | null = null;
  #lastStartedAtMs: number | null = null;
  #lastCompletedAtMs: number | null = null;
  #lastResult: "SUCCESS" | "FAILED" | null = null;

  constructor(options: { refresh(): Promise<void>; journal?: MaintenanceJournal; clock?: { nowMs(): number } }) {
    this.#refresh = options.refresh;
    this.#clock = options.clock ?? { nowMs: Date.now };
    this.#journal = options.journal ?? new MaintenanceJournal(this.#clock);
  }

  start(trigger: MaintenanceTrigger): MaintenanceStatus {
    if (this.#operation !== null) return this.status();
    this.#lastStartedAtMs = this.#clock.nowMs();
    this.#journal.record("INFO", trigger === "MANUAL"
      ? "Đang làm mới session và khởi động lại toàn bộ reader"
      : "Bắt đầu bảo trì session và reader theo lịch 03:00");
    const operation = this.#refresh().then(() => {
      this.#lastResult = "SUCCESS";
      this.#journal.record("INFO", "Đã làm mới session và khởi động lại toàn bộ reader");
    }, (error: unknown) => {
      this.#lastResult = "FAILED";
      const detail = error instanceof Error ? error.message : String(error);
      this.#journal.record("ERROR", `Làm mới session/reader thất bại: ${detail}; Node server vẫn hoạt động`);
    }).finally(() => {
      this.#lastCompletedAtMs = this.#clock.nowMs();
      if (this.#operation === operation) this.#operation = null;
    });
    this.#operation = operation;
    return this.status();
  }

  async runScheduled(): Promise<void> {
    this.start("SCHEDULED");
    await this.#operation;
  }

  status(): MaintenanceStatus {
    return { running: this.#operation !== null, scheduledHour: 3,
      lastStartedAtMs: this.#lastStartedAtMs, lastCompletedAtMs: this.#lastCompletedAtMs,
      lastResult: this.#lastResult, notifications: this.#journal.notifications() };
  }

  logs(): readonly MaintenanceLogEntry[] { return this.#journal.logs(); }
}

interface DailySchedulerOptions {
  readonly now?: () => Date;
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
  readonly hour?: number;
}

export function createDailyMaintenanceScheduler(run: () => Promise<void>, options: DailySchedulerOptions = {}) {
  const now = options.now ?? (() => new Date());
  const setTimer = options.setTimer ?? ((callback, delayMs) => {
    const timer = setTimeout(callback, delayMs); timer.unref?.(); return timer;
  });
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const hour = options.hour ?? 3;
  let timer: unknown = null;
  const schedule = (): void => {
    const current = now();
    const next = new Date(current);
    next.setHours(hour, 0, 0, 0);
    if (next.getTime() <= current.getTime()) next.setDate(next.getDate() + 1);
    timer = setTimer(() => {
      timer = null;
      void run().finally(schedule);
    }, next.getTime() - current.getTime());
  };
  return {
    start(): void { if (timer === null) schedule(); },
    stop(): void { if (timer !== null) { clearTimer(timer); timer = null; } }
  };
}
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
