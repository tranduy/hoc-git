import assert from "node:assert/strict";
import { test } from "node:test";
import { waitForFixtureStack } from "./fixture-stack-readiness.mjs";

const apiHealthUrl = "http://127.0.0.1:4310/api/health";
const webUrl = "http://127.0.0.1:4311/";
const liveChildren = [{ exitCode: null, signalCode: null }];

test("waits for both observe-only API health and a successful web root", async () => {
  let webAttempts = 0;
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url === apiHealthUrl) {
      return new Response(JSON.stringify({ status: "ok", mode: "OBSERVE", executionReady: false }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    webAttempts += 1;
    return new Response(webAttempts === 1 ? "starting" : "ready", { status: webAttempts === 1 ? 503 : 200 });
  };

  await waitForFixtureStack({
    children: liveChildren,
    apiHealthUrl,
    webUrl,
    fetchImpl,
    timeoutMs: 100,
    pollIntervalMs: 0
  });

  assert.equal(webAttempts, 2);
  assert.deepEqual(requests, [apiHealthUrl, webUrl, apiHealthUrl, webUrl]);
});

test("fails immediately when a child exits before both endpoints are ready", async () => {
  const exitedChildren = [{ exitCode: 1, signalCode: null }];
  let requests = 0;

  await assert.rejects(
    waitForFixtureStack({
      children: exitedChildren,
      apiHealthUrl,
      webUrl,
      fetchImpl: async () => {
        requests += 1;
        return new Response("ready");
      },
      timeoutMs: 100,
      pollIntervalMs: 0
    }),
    /child exited before API and web readiness/u
  );
  assert.equal(requests, 0);
});

test("does not report ready when a child exits during endpoint checks", async () => {
  const children = [{ exitCode: null, signalCode: null }];

  await assert.rejects(
    waitForFixtureStack({
      children,
      apiHealthUrl,
      webUrl,
      fetchImpl: async (url) => {
        if (url === apiHealthUrl) children[0].exitCode = 1;
        return url === apiHealthUrl
          ? new Response(JSON.stringify({ status: "ok", mode: "OBSERVE", executionReady: false }), {
              status: 200,
              headers: { "content-type": "application/json" }
            })
          : new Response("ready");
      },
      timeoutMs: 100,
      pollIntervalMs: 0
    }),
    /child exited before API and web readiness/u
  );
});
