import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const latchSchema = z.strictObject({ tripped: z.literal(true), reason: z.string().min(1).max(128),
  ticketId: z.string().min(1).max(256), providers: z.array(z.enum(["SABA", "IM", "SBOBET", "CMD", "APSPORT", "BTI"]))
    .length(2).refine((providers) => providers[0] !== providers[1]),
  trippedAtMs: z.number().finite().nonnegative() });
export type KillSwitchStatus = z.infer<typeof latchSchema>;

export class FileKillSwitch {
  readonly #directory: string;
  readonly #clock: { nowMs(): number };
  constructor(directory: string, clock: { nowMs(): number } = { nowMs: Date.now }) {
    if (directory.trim().length === 0) throw new Error("KILL_SWITCH_DIRECTORY_INVALID");
    this.#directory = directory; this.#clock = clock;
  }

  async trip(input: { readonly reason: string; readonly ticketId: string;
    readonly providers: readonly [KillSwitchStatus["providers"][number], KillSwitchStatus["providers"][number]] }): Promise<void> {
    const latch = latchSchema.parse({ tripped: true, reason: input.reason, ticketId: input.ticketId,
      providers: input.providers, trippedAtMs: this.#clock.nowMs() });
    await mkdir(this.#directory, { recursive: true });
    try {
      await writeFile(join(this.#directory, "kill-switch.json"), JSON.stringify(latch), { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }

  async status(): Promise<KillSwitchStatus | { readonly tripped: false }> {
    try {
      const parsed = latchSchema.safeParse(JSON.parse(await readFile(join(this.#directory, "kill-switch.json"), "utf8")));
      if (!parsed.success) throw new Error("KILL_SWITCH_STORE_INVALID");
      return parsed.data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { tripped: false };
      if (error instanceof SyntaxError) throw new Error("KILL_SWITCH_STORE_INVALID");
      throw error;
    }
  }
}
