import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Reproduce the observed read-only More request for known fixture/league pairs.
// Retain raw data without inferring market settlement, odds format, or completeness.
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}
if (!args.get('--input') || !args.get('--output')) {
  throw Error('Usage: --input <saved-roster.json> --output <new-file.json>');
}
const input = JSON.parse(await readFile(resolve(args.get('--input')), 'utf8'));
if (input.provider !== 'SBOBET' || !Array.isArray(input.results)) {
  throw Error('SBOBET_SAVED_ROSTER_REQUIRED');
}
const owners = input.results.map(({ eventId, leagueId, competition, home, away, start }) =>
  ({ eventId, leagueId, competition, home, away, start }));
if (!owners.length || owners.length > 60
    || new Set(owners.map(x => x.eventId)).size !== owners.length
    || owners.some(x => !/^\d{1,20}$/.test(x.eventId)
      || !Number.isSafeInteger(x.leagueId) || x.leagueId < 1)) {
  throw Error('OWNER_SCOPE_INVALID');
}

const started = Date.now();
const results = [];
let cursor = 0;
async function worker() {
  while (cursor < owners.length) {
    const owner = owners[cursor++];
    if (Date.now() - started > 60000) {
      results.push({ ...owner, error: 'BATCH_DEADLINE' });
      continue;
    }
    const url = new URL('https://be.sb21.net/api/v2/getEventBetMore');
    for (const [key, value] of Object.entries({
      eventId: owner.eventId, oddsStyle: 'ma', leagueId: String(owner.leagueId),
      sportId: '1', sportType: '1_1',
    })) {
      url.searchParams.set(key, value);
    }
    try {
      const response = await fetch(url, {
        redirect: 'error', signal: AbortSignal.timeout(6500),
      });
      const text = await response.text();
      if (response.status !== 200 || text.length > 250000) {
        throw Error('DETAIL_STATUS_OR_SIZE_' + response.status);
      }
      const groups = JSON.parse(text);
      if (!groups || typeof groups !== 'object' || Array.isArray(groups)) {
        throw Error('DETAIL_SHAPE');
      }
      let pricedGroups = 0;
      let rows = 0;
      const ids = new Set();
      for (const [group, values] of Object.entries(groups)) {
        if (!/^\d{1,4}$/.test(group) || !Array.isArray(values)
            || values.some(v => typeof v !== 'string' || v.length > 1500
              || /https?:\/\//i.test(v))) {
          throw Error('GROUP_SHAPE');
        }
        let priced = false;
        for (const value of values) {
          const matches = [...value.matchAll(/(-?\d+(?:\.\d+)?)\*(\d+[had])\b/g)];
          if (matches.length) {
            priced = true;
            rows++;
            for (const match of matches) {
              if (!match[2].startsWith(owner.eventId)) {
                throw Error('SELECTION_OWNER_MISMATCH');
              }
              ids.add(match[2]);
            }
          }
        }
        if (priced) pricedGroups++;
      }
      results.push({
        ...owner, status: response.status, receivedAt: Date.now(), bytes: text.length,
        pricedGroups, rows, selections: ids.size, groups,
      });
    } catch (error) {
      results.push({ ...owner, error: String(error.message).slice(0, 160) });
    }
    await new Promise(r => setTimeout(r, 350));
  }
}
await Promise.all([worker(), worker()]);
const ended = Date.now();
const ok = results.filter(r => !r.error);
const output = {
  provider: 'SBOBET', kind: 'CORE_NODE_MORE_BATCH', started, ended,
  rosterReceivedAt: input.rosterReceivedAt, rosterSource: 'SAVED_OBSERVED_HTTP_OWNERS',
  rosterEvents: owners.length, concurrency: 2,
  endpoint: 'https://be.sb21.net/api/v2/getEventBetMore',
  parameters: { oddsStyle: 'ma', sportId: '1', sportType: '1_1' },
  requestHeadersExplicit: false, credentialsCopied: false, results,
};
await writeFile(resolve(args.get('--output')), JSON.stringify(output, null, 2), { flag: 'wx' });
console.log(JSON.stringify({
  owners: owners.length, success: ok.length,
  failed: results.filter(r => r.error).map(r => ({ eventId: r.eventId, error: r.error })),
  pricedGroups: ok.reduce((n, r) => n + r.pricedGroups, 0),
  rows: ok.reduce((n, r) => n + r.rows, 0),
  selections: ok.reduce((n, r) => n + r.selections, 0), elapsedMs: ended - started,
}));
if (ok.length !== owners.length) process.exitCode = 1;
