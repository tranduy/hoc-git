import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { normalizeSabaLolRecords } from "@tool-chenh/adapters";
import { DpapiProtector } from "../../sessions/dpapi-protector.js";
import { SecretVault } from "../../sessions/secret-vault.js";
import { SabaPushDecoder } from "./saba-push-decoder.js";
import { parseSabaSocketFrame } from "./saba-socket-frame.js";
import { exactSabaLolUrl } from "./saba-esports-navigation.js";
import { clickSafeStructuralCategory, findCmdCatalogPage } from "../browser-protocol-inspector.js";

interface InspectableSessionRecord {
  readonly secret: { readonly kind: "LAUNCH_URL"; readonly value: string };
}

function inspectable(value: unknown): value is InspectableSessionRecord {
  if (typeof value !== "object" || value === null) return false;
  const secret = (value as Record<string, unknown>).secret;
  return typeof secret === "object" && secret !== null &&
    (secret as Record<string, unknown>).kind === "LAUNCH_URL" &&
    typeof (secret as Record<string, unknown>).value === "string";
}

async function main(): Promise<void> {
  const sessionId = process.argv[2];
  const durationMs = Number(process.argv[3] ?? "20000");
  const category = process.argv[4] ?? "LOL";
  const localAppData = process.env.LOCALAPPDATA;
  if (sessionId === undefined || !/^[A-Za-z0-9._-]{1,128}$/u.test(sessionId) || localAppData === undefined ||
    !Number.isSafeInteger(durationMs) || durationMs < 1_000 || durationMs > 60_000 ||
    !["FOOTBALL", "LOL"].includes(category)) {
    throw new Error("Usage: inspect-saba-push <redacted-session-id> [duration-ms] [FOOTBALL|LOL]");
  }
  const authRoot = resolve(join(localAppData, "tool-chenh", ".auth"));
  const vault = new SecretVault({ directory: join(authRoot, "vault"), protector: new DpapiProtector() });
  const record = await vault.load(`session-${sessionId}`);
  if (!inspectable(record)) throw new Error("Inspectable launch session not found");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  let page = await context.newPage();
  const channelRecords = new Map<string, number>();
  const channelSnapshots = new Map<string, readonly Readonly<Record<string, unknown>>[]>();
  let socketCount = 0;
  let receivedFrameCount = 0;
  let acceptedFrameCount = 0;
  let schemaErrorCount = 0;
  const schemaErrorShapes = new Set<string>();
  const attach = (target: typeof page): void => {
    target.on("websocket", (socket) => {
      socketCount += 1;
      const socketIndex = socketCount;
      const decoder = new SabaPushDecoder();
      socket.on("framereceived", (event) => {
      receivedFrameCount += 1;
      try {
        const frame = parseSabaSocketFrame(event.payload);
        if (frame === null) return;
        const applied = decoder.apply(frame);
        acceptedFrameCount += 1;
        const channelKey = `${socketIndex}:${frame.bridgeId}`;
        channelRecords.set(channelKey, applied.records.length);
        channelSnapshots.set(channelKey, applied.records);
      } catch (error) {
        schemaErrorCount += 1;
        let frame = null;
        try { frame = parseSabaSocketFrame(event.payload); } catch { /* Parser error is represented below. */ }
        const rows = frame?.rows;
        schemaErrorShapes.add(JSON.stringify({
          stage: frame === null ? "FRAME" : "DECODER",
          bridgeId: frame?.bridgeId ?? null,
          message: error instanceof Error ? error.message : "UNKNOWN",
          rows: Array.isArray(rows) ? rows.slice(0, 30).map((row) => {
            if (!Array.isArray(row)) return { kind: typeof row };
            if (row[0] === "f") return {
              control: "f", offset: row[1],
              fields: Array.isArray(row[2]) ? row[2].map((item) => typeof item === "string" ? item : typeof item) : null
            };
            if (row[0] === "c") return { control: "c", length: row.length };
            const typePair = row.findIndex((item, index) => index % 2 === 0 && item === 0);
            const rawType = typePair >= 0 ? row[typePair + 1] : null;
            return {
              length: row.length,
              type: typeof rawType === "string" && rawType.length <= 16 ? rawType : typeof rawType,
              indexes: row.filter((_item, index) => index % 2 === 0)
            };
          }) : null
        }));
      }
      });
    });
  };
  attach(page);
  context.on("page", attach);

  try {
    await page.goto(record.secret.value, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2_000);
    if (socketCount === 0 && await page.locator("body").innerText().catch(() => "") === "") {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    if (category === "LOL") {
      await page.goto(exactSabaLolUrl(page.url()), { waitUntil: "domcontentloaded", timeout: 30_000 });
    } else {
      page = await findCmdCatalogPage(context.pages()) ?? page;
      await clickSafeStructuralCategory(page, "1", 0).catch(() => false);
    }
    await page.waitForTimeout(durationMs);
    const pageSignals = await Promise.all(context.pages().map(async (item) => item.evaluate(() => {
      const bodyText = document.body?.innerText ?? "";
      return {
        title: document.title.slice(0, 120),
        bodyTextLength: bodyText.length,
        hasErrorText: /(?:error|expired|invalid|not found|close (?:this )?window)/iu.test(bodyText),
        hasSport43Control: document.querySelector(".c-iconcolor-sport43") !== null,
        scriptCount: document.scripts.length,
        hasSocketIoScript: [...document.scripts].some((script) => {
          try { return new URL(script.src).pathname.toLowerCase().includes("socket.io"); } catch { return false; }
        })
      };
    }).catch(() => ({ title: "", bodyTextLength: 0, hasErrorText: true, hasSport43Control: false,
      scriptCount: 0, hasSocketIoScript: false }))));
    const recordTypes = new Map<string, number>();
    const allRecords = [...channelSnapshots.values()].flat();
    const matchSamples: Record<string, unknown>[] = [];
    const oddsSamples: Record<string, unknown>[] = [];
    const betTypeSamples: Record<string, unknown>[] = [];
    const leagueSamples: Record<string, unknown>[] = [];
    for (const records of channelSnapshots.values()) for (const item of records) {
      if (typeof item.type !== "string") continue;
      const type = item.type.startsWith("-") ? item.type.slice(1) : item.type;
      recordTypes.set(type, (recordTypes.get(type) ?? 0) + 1);
      if (type === "m" && matchSamples.length < 20) matchSamples.push({
        matchid: item.matchid, leagueid: item.leagueid, leaguenameen: item.leaguenameen,
        hteamnameen: item.hteamnameen, ateamnameen: item.ateamnameen,
        kickofftime: item.kickofftime, eventstatus: item.eventstatus, marketid: item.marketid,
        bestofmap: item.bestofmap, gamestatus: item.gamestatus, sporttype: item.sporttype
      });
      if (type === "o" && oddsSamples.length < 100) oddsSamples.push({
        oddsid: item.oddsid, matchid: item.matchid, bettype: item.bettype,
        parenttypeid: item.parenttypeid, oddsstatus: item.oddsstatus,
        odds1a: item.odds1a, odds2a: item.odds2a, hdp1: item.hdp1, hdp2: item.hdp2,
        marketid: item.marketid, enable: item.enable, ocategory: item.ocategory,
        childmatchtype: item.childmatchtype, subtype: item.subtype, parentid: item.parentid,
        gamesession: item.gamesession, resourceid: item.resourceid,
        fields: Object.keys(item).sort()
      });
      if (type === "b" && betTypeSamples.length < 10) betTypeSamples.push({
        bettype: item.bettype, parenttypeid: item.parenttypeid, typenamee: item.typenamee,
        bettypename: item.bettypename, bettypenameen: item.bettypenameen, name: item.name,
        marketname: item.marketname, bettypegroupid: item.bettypegroupid,
        fields: Object.keys(item).sort()
      });
      if (type === "l" && leagueSamples.length < 12) leagueSamples.push({
        leagueid: item.leagueid, leaguenameen: item.leaguenameen, leaguegroupid: item.leaguegroupid,
        sporttype: item.sporttype, countrycode: item.countrycode, fields: Object.keys(item).sort()
      });
    }
    const normalized = category === "LOL" ? normalizeSabaLolRecords(allRecords, {
      observedAtMs: Date.now(), receivedMonotonicMs: performance.now(), sequence: 1
    }) : null;
    process.stdout.write(`${JSON.stringify({
      category,
      socketCount,
      pageCount: context.pages().length,
      pageSignals,
      finalHostnames: [...new Set(context.pages().map((item) => {
        try { return new URL(item.url()).hostname; } catch { return ""; }
      }).filter((hostname) => hostname.length > 0))].sort(),
      receivedFrameCount,
      acceptedFrameCount,
      schemaErrorCount,
      schemaErrorShapes: [...schemaErrorShapes].sort().map((value) => JSON.parse(value) as unknown),
      channelRecords: Object.fromEntries([...channelRecords].sort()),
      recordTypes: Object.fromEntries([...recordTypes].sort()),
      normalized: {
        eventCount: normalized?.events.length ?? 0,
        marketCount: normalized?.markets.length ?? 0,
        quoteCount: normalized?.quotes.length ?? 0,
        diagnosticCount: normalized?.diagnostics.length ?? 0,
        events: normalized?.events.slice(0, 5).map((event) => ({
          providerEventId: event.providerEventId, competition: event.competition,
          participantA: event.participantA, participantB: event.participantB,
          startAtUtcMs: event.startAtUtcMs, isLive: event.isLive
        })) ?? [],
        markets: normalized?.markets.slice(0, 10).map((market) => ({
          providerEventId: market.providerEventId, providerMarketId: market.providerMarketId,
          marketType: market.marketType, scope: market.scope, status: market.status
        })) ?? []
      },
      samples: { matches: matchSamples, odds: oddsSamples, betTypes: betTypeSamples, leagues: leagueSamples }
    }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

void main().catch(() => {
  process.stderr.write("SABA push inspection failed without exposing session material.\n");
  process.exitCode = 1;
});
