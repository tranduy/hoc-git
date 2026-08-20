import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const captureDir = process.env.CHROME_BRIDGE_CAPTURE_DIR ??
  join(process.env.LOCALAPPDATA ?? "", "tool-chenh", "chrome-bridge-captures");
const outputPath = process.argv[2] ?? "saba-cdp-capture-evidence.json";
const names = (await readdir(captureDir)).filter((name) => name.endsWith(".jsonl"));
const files = (await Promise.all(names.map(async (name) => ({ name, modifiedAtMs:
  (await stat(join(captureDir, name))).mtimeMs })))).sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)
  .slice(0, 5);
const frames = [];
for (const file of files) {
  const rows = (await readFile(join(captureDir, file.name), "utf8")).split(/\r?\n/u);
  for (const row of rows) {
    if (row.length === 0) continue;
    try {
      const envelope = JSON.parse(row);
      if (envelope.lobby !== "SABA" || envelope.transport !== "WS_FRAME" ||
        envelope.request?.pathnameClass !== "/socket.io/") continue;
      frames.push(envelope);
    } catch { /* ignore a line still being appended */ }
  }
}
frames.sort((left, right) => left.sequence - right.sequence);
const classifications = { reset: 0, done: 0, delta: 0 };
for (const frame of frames) {
  if (frame.payload?.encoding !== "UTF8" || !frame.payload.body.startsWith("42")) continue;
  try {
    const payload = JSON.parse(frame.payload.body.slice(2));
    const rows = Array.isArray(payload?.[2]) ? payload[2] : [];
    if (rows.some((item) => Array.isArray(item) && (item[1] === "reset" || item[1] === "empty"))) {
      classifications.reset += 1;
    } else if (rows.some((item) => Array.isArray(item) && item[1] === "done")) {
      classifications.done += 1;
    } else classifications.delta += 1;
  } catch { /* non-catalog Socket.IO event */ }
}
const result = { capturedAtMs: Date.now(), files: files.map((file) => file.name), frameCount: frames.length,
  sourceIds: [...new Set(frames.map((frame) => frame.sourceId))],
  sourceEpochs: [...new Set(frames.map((frame) => frame.sourceEpoch))],
  firstSequence: frames[0]?.sequence ?? null, lastSequence: frames.at(-1)?.sequence ?? null,
  firstObservedAtMs: frames[0]?.observedAtMs ?? null, lastObservedAtMs: frames.at(-1)?.observedAtMs ?? null,
  classifications };
await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
