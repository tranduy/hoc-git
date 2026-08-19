import { ComparisonWorkerEngine } from "./comparison-worker-engine.js";
import type { ComparisonWorkerCommand, ComparisonWorkerOutput } from "./comparison-worker-protocol.js";

const engine = new ComparisonWorkerEngine();
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ComparisonWorkerCommand>) => void) | null;
  postMessage(message: ComparisonWorkerOutput): void;
};

scope.onmessage = (event) => scope.postMessage(engine.apply(event.data));
