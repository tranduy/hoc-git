# CMD realtime report

## INVESTIGATED

- Provider: `CMD` (`catalog-source:CMD:FOOTBALL`).
- Transport: HTTP polling; không có WebSocket.
- Ground truth ngày 2026-08-25: cadence tự nhiên khoảng 30 giây; `DataOdds.ashx` có gap 60 giây (các bucket 0, 60, 90, 120 trong cửa sổ 150 giây).
- Capture có sẵn: `capture-1787551154126.jsonl` chứa 3 response `DataOdds.ashx` (sequence 452–454); cả 3 envelope đều thiếu `request.providerFunctionCode`.
- CDP `127.0.0.1:9333` không sẵn tại thời điểm điều tra; không ghi capture mới.

## Trace 120 giây

Lệnh đã chạy:

```powershell
node scripts/diag-pipeline.mjs CMD 120
```

Kết quả quan sát được:

- `firstFailingHop: null`.
- `HOP4_ADAPTER`: `ok: true`; mẫu cuối có `decoded: 42`, `ignored: 5`, các reject reason đều `0`, `forcedUnlocks: 0`.
- `HOP6_FEED`: `ok: true`, `state: LIVE`; mẫu cuối có `baselineAgeMs: 19962`, `maxBaselineAgeMs: 90000`, `evidenceAgeMs: 19962`, `expectedEvidenceCadenceMs: 45000`, cadence quan sát `p50: 12331`, `p95: 22187`, `samples: 22`.
- `HOP7_CATALOG`: `ok: true`, `sessionState: ACTIVE`, `snapshotState: FRESH`; mẫu cuối có `events: 191`, `markets: 478`, `quotes: 956`.
- `HOP8_SEMANTIC`: `ok: true`; mẫu cuối có `quoteChanges60s: 74`, `quoteChanges300s: 393`, `lastSemanticChangeAgeMs: 19962`.

Không có chặng hỏng đầu tiên để viết RED đúng yêu cầu bước 3. Chưa sửa code và chưa ghi `LOCAL_GREEN`.

## Phiên điều tra tiếp theo — 2026-08-25

### INVESTIGATED

- CDP `127.0.0.1:9333` không sẵn; không ghi capture mới.
- Capture hiện có: 8 envelope CMD, gồm 4 `HTTP_RESPONSE`; 3 response `DataOdds.ashx` đều thiếu `request.providerFunctionCode`.
- Ground truth giữ nguyên: HTTP polling, cadence tự nhiên khoảng 30 giây, `DataOdds.ashx` có gap 60 giây.

### Diagnostic vòng 1

Lệnh:

```powershell
node scripts/diag-pipeline.mjs CMD 120
```

Kết quả A từ phần output được command runner trả về:

- `firstFailingHop: HOP1_TAB` ở tất cả 7 mẫu còn trong output trả về.
- `HOP8.quoteChanges60s: 0` ở tất cả các mẫu; `quoteChanges300s` giảm từ `158` xuống `50`.
- Authority: `ACTIVE`.
- `baselineAgeMs`: tăng từ `252075` lên `282146`, vượt `maxBaselineAgeMs: 90000`.
- Recovery: `HARD`, attempt `2`, `consecutiveFailures: 2`, `lastFailureCode: BASELINE_TIMEOUT`, `nextAttemptInMs: 0`.
- `forcedUnlocks: 0`.
- Mẫu semantic còn trong cửa sổ 300 giây: selection `CMD:25311352:25311352:8:25311352:8:over`, giá `-0.77` → `-0.78`, tại `1787662980392`.

Command runner báo `Total output lines: 2762` nhưng chỉ trả lại 40094 ký tự (7 object JSON đầu); vì vậy không thể trung thực gọi phần nhận được là FULL output.

### Diagnostic vòng 2

Lệnh:

```powershell
node scripts/diag-pipeline.mjs CMD 120
```

Kết quả A từ phần output được command runner trả về:

- `firstFailingHop: HOP1_TAB` ở tất cả 7 mẫu còn trong output trả về.
- Chi tiết HOP1: `sourceId: null`, `tabId: null`, `authorityDisposition: null`.
- `HOP8.quoteChanges60s: 0`, `quoteChanges300s: 0`, `sampleChange: null` ở tất cả các mẫu.
- HOP5 authority: `ACTIVE`.
- `baselineAgeMs`: tăng từ `488800` lên `518866`, vượt `maxBaselineAgeMs: 90000`.
- Recovery: `HARD`, attempt `2`, `consecutiveFailures: 2`, `lastFailureCode: BASELINE_TIMEOUT`, `nextAttemptInMs: 0`.
- `forcedUnlocks: 0`.

Command runner báo `Total output lines: 2712` nhưng chỉ trả lại 40094 ký tự (7 object JSON đầu); vì vậy không thể trung thực gọi phần nhận được là FULL output.

## BLOCKED

Sau đúng hai vòng chẩn đoán, chặng hỏng đầu tiên vẫn là `HOP1_TAB`. Ở vòng 2, HOP1 không còn `sourceId` hoặc `tabId`; đây là ranh giới tab/source, nằm ngoài whitelist file của worker CMD. Các giả thuyết H1–H4 trong `PROVIDER-CMD.md` đều ở phía sau HOP1 và không thể tạo một RED tái hiện đúng chặng hỏng đầu tiên trong whitelist. HOP8 đồng thời không có đổi giá trong cả cửa sổ 60 giây và 300 giây của vòng 2.

Không sửa code, không chạy test/typecheck/replay, không ghi `LOCAL_GREEN`.

## Diagnostic 120 giây — GATE 0 đạt

Evidence đầy đủ: `.run/realtime/cmd/diag-1787664209972.full.txt`.

```json
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664210069,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 96762
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 346,
        "lastSequence": 53,
        "byTransport": {
          "HTTP_RESPONSE": 24,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 8,
          "TAB_STATE": 22
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 14,
        "ignored": 2,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 13944,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12938443",
        "baselineAgeMs": 14935,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 14935,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 8377,
          "p95": 21109,
          "samples": 7
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "PkuQ1mQQ03abgEkpJiQYqtLMK4D25955UJYLBFpDaAY",
        "catalogAgeMs": 14935,
        "events": 191,
        "markets": 476,
        "quotes": 952
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 50,
        "quoteChanges300s": 270,
        "lastSemanticChangeAgeMs": 14935,
        "sampleChange": {
          "selectionKey": "CMD:25310229:25310229:1:25310229:1:home",
          "before": "0.85",
          "after": "0.86",
          "atMs": 1787664195134
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664215087,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 101780
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 5364,
        "lastSequence": 53,
        "byTransport": {
          "HTTP_RESPONSE": 24,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 8,
          "TAB_STATE": 22
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 14,
        "ignored": 2,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 18962,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12938443",
        "baselineAgeMs": 19953,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 19953,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 8377,
          "p95": 21109,
          "samples": 7
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "PkuQ1mQQ03abgEkpJiQYqtLMK4D25955UJYLBFpDaAY",
        "catalogAgeMs": 19953,
        "events": 191,
        "markets": 476,
        "quotes": 952
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 50,
        "quoteChanges300s": 270,
        "lastSemanticChangeAgeMs": 19953,
        "sampleChange": {
          "selectionKey": "CMD:25310229:25310229:1:25310229:1:home",
          "before": "0.85",
          "after": "0.86",
          "atMs": 1787664195134
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664220091,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 106784
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 365,
        "lastSequence": 62,
        "byTransport": {
          "HTTP_RESPONSE": 30,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 9,
          "TAB_STATE": 24
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 17,
        "ignored": 2,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 2113,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12938718:observation:511",
        "baselineAgeMs": 3258,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 3258,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 8377,
          "p95": 21109,
          "samples": 9
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "11Yv9yrTsL5dyXk6s6Fb-gRfzUtAKcNSoq1AsGYTCkw",
        "catalogAgeMs": 3258,
        "events": 191,
        "markets": 477,
        "quotes": 954
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 66,
        "quoteChanges300s": 306,
        "lastSemanticChangeAgeMs": 5000,
        "sampleChange": {
          "selectionKey": "CMD:25310230:25310230:3:25310230:3:over",
          "before": "-0.98",
          "after": "-0.96",
          "atMs": 1787664215091
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664225099,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 111792
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 5373,
        "lastSequence": 62,
        "byTransport": {
          "HTTP_RESPONSE": 30,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 9,
          "TAB_STATE": 24
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 17,
        "ignored": 2,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 7121,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12938718:observation:511",
        "baselineAgeMs": 8266,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 8266,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 8377,
          "p95": 21109,
          "samples": 9
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "11Yv9yrTsL5dyXk6s6Fb-gRfzUtAKcNSoq1AsGYTCkw",
        "catalogAgeMs": 8266,
        "events": 191,
        "markets": 477,
        "quotes": 954
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 66,
        "quoteChanges300s": 306,
        "lastSemanticChangeAgeMs": 10008,
        "sampleChange": {
          "selectionKey": "CMD:25310230:25310230:3:25310230:3:over",
          "before": "-0.98",
          "after": "-0.96",
          "atMs": 1787664215091
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664230103,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 116796
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 359,
        "lastSequence": 64,
        "byTransport": {
          "HTTP_RESPONSE": 30,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 9,
          "TAB_STATE": 26
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 17,
        "ignored": 2,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 12125,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12938718:observation:511",
        "baselineAgeMs": 13270,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 13270,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 8377,
          "p95": 21109,
          "samples": 9
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "11Yv9yrTsL5dyXk6s6Fb-gRfzUtAKcNSoq1AsGYTCkw",
        "catalogAgeMs": 13270,
        "events": 191,
        "markets": 477,
        "quotes": 954
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 66,
        "quoteChanges300s": 306,
        "lastSemanticChangeAgeMs": 15012,
        "sampleChange": {
          "selectionKey": "CMD:25310230:25310230:3:25310230:3:over",
          "before": "-0.98",
          "after": "-0.96",
          "atMs": 1787664215091
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664235118,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 121811
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1283,
        "lastSequence": 66,
        "byTransport": {
          "HTTP_RESPONSE": 30,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 10,
          "TAB_STATE": 27
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 17,
        "ignored": 3,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 17140,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12938718:observation:511",
        "baselineAgeMs": 18285,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 18285,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 8377,
          "p95": 21109,
          "samples": 9
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "11Yv9yrTsL5dyXk6s6Fb-gRfzUtAKcNSoq1AsGYTCkw",
        "catalogAgeMs": 18285,
        "events": 191,
        "markets": 477,
        "quotes": 954
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 66,
        "quoteChanges300s": 306,
        "lastSemanticChangeAgeMs": 20027,
        "sampleChange": {
          "selectionKey": "CMD:25310230:25310230:3:25310230:3:over",
          "before": "-0.98",
          "after": "-0.96",
          "atMs": 1787664215091
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664240129,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 126822
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 409,
        "lastSequence": 70,
        "byTransport": {
          "HTTP_RESPONSE": 33,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 10,
          "TAB_STATE": 28
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 18,
        "ignored": 3,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 819,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12939091",
        "baselineAgeMs": 819,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 819,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 8377,
          "p95": 22477,
          "samples": 10
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "Hc_wCeTgQ4brL6QcSclDS2ChWMbHLvafjYTxsq3qYT4",
        "catalogAgeMs": 819,
        "events": 191,
        "markets": 477,
        "quotes": 954
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 80,
        "quoteChanges300s": 338,
        "lastSemanticChangeAgeMs": 819,
        "sampleChange": {
          "selectionKey": "CMD:25311352:25311352:3:25311352:3:over",
          "before": "-0.98",
          "after": "-0.95",
          "atMs": 1787664239310
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664245146,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 131839
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 662,
        "lastSequence": 74,
        "byTransport": {
          "HTTP_RESPONSE": 36,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 10,
          "TAB_STATE": 29
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 19,
        "ignored": 3,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 729,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12939182",
        "baselineAgeMs": 729,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 729,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 8377,
          "p95": 22477,
          "samples": 11
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "W0TMZGXPUkcnlW5OLCw69IPK1rlCjoKyey_dZ81PoIo",
        "catalogAgeMs": 729,
        "events": 191,
        "markets": 477,
        "quotes": 954
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 90,
        "quoteChanges300s": 348,
        "lastSemanticChangeAgeMs": 729,
        "sampleChange": {
          "selectionKey": "CMD:25310229:25310229:1:25310229:1:home",
          "before": "0.93",
          "after": "0.88",
          "atMs": 1787664244417
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664250160,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 136853
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 439,
        "lastSequence": 78,
        "byTransport": {
          "HTTP_RESPONSE": 39,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 10,
          "TAB_STATE": 30
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 20,
        "ignored": 3,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 3720,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12939182:observation:680",
        "baselineAgeMs": 3720,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 3720,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5107,
          "p95": 22477,
          "samples": 12
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "4Y6sPBecbSbzX9uheOSt4svgtw3EITSrQoXX7mKW6A4",
        "catalogAgeMs": 3720,
        "events": 191,
        "markets": 477,
        "quotes": 954
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 78,
        "quoteChanges300s": 348,
        "lastSemanticChangeAgeMs": 5743,
        "sampleChange": {
          "selectionKey": "CMD:25310229:25310229:1:25310229:1:home",
          "before": "0.93",
          "after": "0.88",
          "atMs": 1787664244417
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664255170,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 141863
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 5449,
        "lastSequence": 78,
        "byTransport": {
          "HTTP_RESPONSE": 39,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 10,
          "TAB_STATE": 30
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 20,
        "ignored": 3,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 8730,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12939182:observation:680",
        "baselineAgeMs": 8730,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 8730,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5107,
          "p95": 22477,
          "samples": 12
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "4Y6sPBecbSbzX9uheOSt4svgtw3EITSrQoXX7mKW6A4",
        "catalogAgeMs": 8730,
        "events": 191,
        "markets": 477,
        "quotes": 954
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 78,
        "quoteChanges300s": 348,
        "lastSemanticChangeAgeMs": 10753,
        "sampleChange": {
          "selectionKey": "CMD:25310229:25310229:1:25310229:1:home",
          "before": "0.93",
          "after": "0.88",
          "atMs": 1787664244417
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664260185,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 146878
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 461,
        "lastSequence": 80,
        "byTransport": {
          "HTTP_RESPONSE": 39,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 10,
          "TAB_STATE": 32
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 20,
        "ignored": 3,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 13745,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12939182:observation:680",
        "baselineAgeMs": 13745,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 13745,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5107,
          "p95": 22477,
          "samples": 12
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "4Y6sPBecbSbzX9uheOSt4svgtw3EITSrQoXX7mKW6A4",
        "catalogAgeMs": 13745,
        "events": 191,
        "markets": 477,
        "quotes": 954
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 78,
        "quoteChanges300s": 348,
        "lastSemanticChangeAgeMs": 15768,
        "sampleChange": {
          "selectionKey": "CMD:25310229:25310229:1:25310229:1:home",
          "before": "0.93",
          "after": "0.88",
          "atMs": 1787664244417
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664265197,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 151890
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 3330,
        "lastSequence": 85,
        "byTransport": {
          "HTTP_RESPONSE": 42,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 11,
          "TAB_STATE": 33
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 22,
        "ignored": 3,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 3330,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12939382",
        "baselineAgeMs": 3649,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 3649,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 8377,
          "p95": 22477,
          "samples": 13
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "zyR5KAGzyLNsQJn3fJekCCX0INVqwC13yQd-9UY_B3E",
        "catalogAgeMs": 3649,
        "events": 191,
        "markets": 478,
        "quotes": 956
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 122,
        "quoteChanges300s": 392,
        "lastSemanticChangeAgeMs": 3649,
        "sampleChange": {
          "selectionKey": "CMD:25310230:25310230:3:25310230:3:over",
          "before": "-0.96",
          "after": "-0.94",
          "atMs": 1787664261548
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664270212,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 156905
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 497,
        "lastSequence": 86,
        "byTransport": {
          "HTTP_RESPONSE": 42,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 11,
          "TAB_STATE": 34
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 22,
        "ignored": 3,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 8345,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12939382",
        "baselineAgeMs": 8664,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 8664,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 8377,
          "p95": 22477,
          "samples": 13
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "zyR5KAGzyLNsQJn3fJekCCX0INVqwC13yQd-9UY_B3E",
        "catalogAgeMs": 8664,
        "events": 191,
        "markets": 478,
        "quotes": 956
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 86,
        "quoteChanges300s": 392,
        "lastSemanticChangeAgeMs": 8664,
        "sampleChange": {
          "selectionKey": "CMD:25310230:25310230:3:25310230:3:over",
          "before": "-0.96",
          "after": "-0.94",
          "atMs": 1787664261548
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664275226,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 161919
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 2670,
        "lastSequence": 88,
        "byTransport": {
          "HTTP_RESPONSE": 42,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 12,
          "TAB_STATE": 35
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 23,
        "ignored": 3,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 2672,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12939382",
        "baselineAgeMs": 13678,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 13678,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 8377,
          "p95": 22477,
          "samples": 13
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "zyR5KAGzyLNsQJn3fJekCCX0INVqwC13yQd-9UY_B3E",
        "catalogAgeMs": 13678,
        "events": 191,
        "markets": 478,
        "quotes": 956
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 86,
        "quoteChanges300s": 392,
        "lastSemanticChangeAgeMs": 13678,
        "sampleChange": {
          "selectionKey": "CMD:25310230:25310230:3:25310230:3:over",
          "before": "-0.96",
          "after": "-0.94",
          "atMs": 1787664261548
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664280241,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 166934
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 464,
        "lastSequence": 93,
        "byTransport": {
          "HTTP_RESPONSE": 45,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 12,
          "TAB_STATE": 37
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 24,
        "ignored": 3,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 995,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12939637",
        "baselineAgeMs": 995,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 995,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 8377,
          "p95": 22477,
          "samples": 14
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "4DHQ6roxhF7ttanH1f8_ZZW9F5nmnGpl4GF67UOWqiQ",
        "catalogAgeMs": 995,
        "events": 191,
        "markets": 477,
        "quotes": 954
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 116,
        "quoteChanges300s": 422,
        "lastSemanticChangeAgeMs": 995,
        "sampleChange": {
          "selectionKey": "CMD:25311352:25311352:3:25311352:3:over",
          "before": "-0.95",
          "after": "-0.92",
          "atMs": 1787664279246
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664285251,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 171944
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 2268,
        "lastSequence": 94,
        "byTransport": {
          "HTTP_RESPONSE": 45,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 13,
          "TAB_STATE": 37
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 25,
        "ignored": 3,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 2268,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12939637",
        "baselineAgeMs": 6005,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 6005,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 8377,
          "p95": 22477,
          "samples": 14
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "4DHQ6roxhF7ttanH1f8_ZZW9F5nmnGpl4GF67UOWqiQ",
        "catalogAgeMs": 6005,
        "events": 191,
        "markets": 477,
        "quotes": 954
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 116,
        "quoteChanges300s": 422,
        "lastSemanticChangeAgeMs": 6005,
        "sampleChange": {
          "selectionKey": "CMD:25311352:25311352:3:25311352:3:over",
          "before": "-0.95",
          "after": "-0.92",
          "atMs": 1787664279246
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664290254,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 176947
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 538,
        "lastSequence": 96,
        "byTransport": {
          "HTTP_RESPONSE": 45,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 13,
          "TAB_STATE": 39
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 25,
        "ignored": 3,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 7271,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12939637",
        "baselineAgeMs": 11008,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 11008,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 8377,
          "p95": 22477,
          "samples": 14
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "4DHQ6roxhF7ttanH1f8_ZZW9F5nmnGpl4GF67UOWqiQ",
        "catalogAgeMs": 11008,
        "events": 191,
        "markets": 477,
        "quotes": 954
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 84,
        "quoteChanges300s": 422,
        "lastSemanticChangeAgeMs": 11008,
        "sampleChange": {
          "selectionKey": "CMD:25311352:25311352:3:25311352:3:over",
          "before": "-0.95",
          "after": "-0.92",
          "atMs": 1787664279246
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664295270,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 181963
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 302,
        "lastSequence": 101,
        "byTransport": {
          "HTTP_RESPONSE": 48,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 14,
          "TAB_STATE": 40
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 27,
        "ignored": 3,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 304,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12939909",
        "baselineAgeMs": 4508,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 4508,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 11508,
          "p95": 22477,
          "samples": 15
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "26C0GKVHrYkFFIAI0WG7CB8c2-8C0PhzEJnOeH3Jswo",
        "catalogAgeMs": 4508,
        "events": 191,
        "markets": 478,
        "quotes": 956
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 124,
        "quoteChanges300s": 462,
        "lastSemanticChangeAgeMs": 4508,
        "sampleChange": {
          "selectionKey": "CMD:25311352:25311352:3:25311352:3:over",
          "before": "-0.92",
          "after": "-0.94",
          "atMs": 1787664290762
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664300275,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 186968
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 558,
        "lastSequence": 102,
        "byTransport": {
          "HTTP_RESPONSE": 48,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 14,
          "TAB_STATE": 41
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 27,
        "ignored": 3,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 5309,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12939909",
        "baselineAgeMs": 9513,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 9513,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 11508,
          "p95": 22477,
          "samples": 15
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "26C0GKVHrYkFFIAI0WG7CB8c2-8C0PhzEJnOeH3Jswo",
        "catalogAgeMs": 9513,
        "events": 191,
        "markets": 478,
        "quotes": 956
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 114,
        "quoteChanges300s": 462,
        "lastSemanticChangeAgeMs": 9513,
        "sampleChange": {
          "selectionKey": "CMD:25311352:25311352:3:25311352:3:over",
          "before": "-0.92",
          "after": "-0.94",
          "atMs": 1787664290762
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664305291,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 191984
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 279,
        "lastSequence": 104,
        "byTransport": {
          "HTTP_RESPONSE": 48,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 15,
          "TAB_STATE": 42
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 28,
        "ignored": 3,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 325,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12939909",
        "baselineAgeMs": 14529,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 14529,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 11508,
          "p95": 22477,
          "samples": 15
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "26C0GKVHrYkFFIAI0WG7CB8c2-8C0PhzEJnOeH3Jswo",
        "catalogAgeMs": 14529,
        "events": 191,
        "markets": 478,
        "quotes": 956
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 114,
        "quoteChanges300s": 462,
        "lastSemanticChangeAgeMs": 14529,
        "sampleChange": {
          "selectionKey": "CMD:25311352:25311352:3:25311352:3:over",
          "before": "-0.92",
          "after": "-0.94",
          "atMs": 1787664290762
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664310296,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 196989
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 579,
        "lastSequence": 105,
        "byTransport": {
          "HTTP_RESPONSE": 48,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 15,
          "TAB_STATE": 43
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 28,
        "ignored": 3,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 5330,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12939909",
        "baselineAgeMs": 19534,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 19534,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 11508,
          "p95": 22477,
          "samples": 15
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "26C0GKVHrYkFFIAI0WG7CB8c2-8C0PhzEJnOeH3Jswo",
        "catalogAgeMs": 19534,
        "events": 191,
        "markets": 478,
        "quotes": 956
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 114,
        "quoteChanges300s": 462,
        "lastSemanticChangeAgeMs": 19534,
        "sampleChange": {
          "selectionKey": "CMD:25311352:25311352:3:25311352:3:over",
          "before": "-0.92",
          "after": "-0.94",
          "atMs": 1787664290762
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664315303,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 201996
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 709,
        "lastSequence": 113,
        "byTransport": {
          "HTTP_RESPONSE": 54,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 16,
          "TAB_STATE": 44
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 31,
        "ignored": 3,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 711,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12940279:observation:1041",
        "baselineAgeMs": 2724,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 2724,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 11508,
          "p95": 22477,
          "samples": 17
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "zFhaSOktMfq0TTEJR1tafqd813JylUXI2nOaeIa4kZU",
        "catalogAgeMs": 2724,
        "events": 190,
        "markets": 471,
        "quotes": 942
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 150,
        "quoteChanges300s": 498,
        "lastSemanticChangeAgeMs": 3429,
        "sampleChange": {
          "selectionKey": "CMD:25311352:25311352:3:25311352:3:over",
          "before": "-0.94",
          "after": "-0.85",
          "atMs": 1787664311874
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664320319,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 207012
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 599,
        "lastSequence": 114,
        "byTransport": {
          "HTTP_RESPONSE": 54,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 16,
          "TAB_STATE": 45
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 31,
        "ignored": 3,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 5727,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12940279:observation:1041",
        "baselineAgeMs": 7740,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 7740,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 11508,
          "p95": 22477,
          "samples": 17
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "zFhaSOktMfq0TTEJR1tafqd813JylUXI2nOaeIa4kZU",
        "catalogAgeMs": 7740,
        "events": 190,
        "markets": 471,
        "quotes": 942
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 106,
        "quoteChanges300s": 498,
        "lastSemanticChangeAgeMs": 8445,
        "sampleChange": {
          "selectionKey": "CMD:25311352:25311352:3:25311352:3:over",
          "before": "-0.94",
          "after": "-0.85",
          "atMs": 1787664311874
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 1787664325326,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:CMD:2105815648",
        "tabId": 2105815648,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:2",
        "attachedForMs": 212019
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1457,
        "lastSequence": 121,
        "byTransport": {
          "HTTP_RESPONSE": 60,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 16,
          "TAB_STATE": 46
        },
        "rejected": {
          "SEQUENCE_GAP": 0,
          "RETIRED_EPOCH": 0,
          "TOO_OLD": 0
        }
      }
    },
    {
      "hop": "HOP4_ADAPTER",
      "ok": true,
      "detail": {
        "decoded": 33,
        "ignored": 3,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 1457,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": true,
      "detail": {
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP6_FEED",
      "ok": true,
      "detail": {
        "state": "LIVE",
        "reason": "NO_FEED",
        "activeGeneration": "cmd:12940408:observation:1100",
        "baselineAgeMs": 1457,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 1457,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 10234,
          "p95": 22477,
          "samples": 19
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 0,
        "nextAttemptInMs": null,
        "lastFailureCode": null
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "G7Nr-i4TTyOqI_ivCkINsff9gGKYqYaMrb2kdex3xns",
        "catalogAgeMs": 1457,
        "events": 190,
        "markets": 471,
        "quotes": 942
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 124,
        "quoteChanges300s": 516,
        "lastSemanticChangeAgeMs": 2513,
        "sampleChange": {
          "selectionKey": "CMD:25310229:25310229:1:25310229:1:home",
          "before": "0.89",
          "after": "0.93",
          "atMs": 1787664322813
        }
      }
    }
  ]
}
```

### A — số liệu quyết định

- GATE 0: có `chrome:CMD:2105815648`; state `LIVE`, authority `ACTIVE`, `lastSequence: 34`.
- 24/24 mẫu diag: `firstFailingHop: null`.
- `HOP8.quoteChanges60s`: min `50`, max `150`; mẫu cuối `124`.
- `HOP8.quoteChanges300s`: min `270`, max `516`; mẫu cuối `516`.
- Authority: `ACTIVE` trong mọi mẫu.
- `baselineAgeMs`: min `729`, max `19953`; `maxBaselineAgeMs: 90000`.
- Recovery: `NONE`, attempt `0`, `lastFailureCode: null`.
- `forcedUnlocks: 0` trong mọi mẫu.
- Mẫu giá thật cuối: selection `CMD:25310229:25310229:1:25310229:1:home`, `0.89` → `0.93`, tại `1787664322813`.

### Replay capture thật

Lệnh:

```powershell
node scripts/replay-capture.mjs --capture $env:LOCALAPPDATA\tool-chenh\chrome-bridge-captures\capture-1787551154126.jsonl --provider CMD --assert-semantic-changes 3
```

Output thật, exit code `1`:

```json
{"provider":"CMD","capture":"capture-1787551154126.jsonl","envelopes":6,"baselines":0,"deltas":0,"rejected":{"total":6,"reasons":{"TAB_STATE_TRANSPORT_ONLY":1,"NETWORK_BODY_INCOMPLETE":2,"ADAPTER_FINGERPRINT_UNMATCHED":2,"CANDIDATE_DOM_FALLBACK:cmd-public-dom-v1":1}},"semanticChanges":0}
```

## SHARED_REQUEST

- Hop: `HOP4_ADAPTER` trên đường replay capture; live trace HOP4 vẫn xanh.
- File shared: `scripts/record-capture.mjs` và `apps/chrome-extension/src/network-observer.ts`.
- Lý do: capture CMD hiện có chứa 3 response `DataOdds.ashx` nhưng cả 3 thiếu `request.providerFunctionCode`; replay còn từ chối 2 envelope vì `NETWORK_BODY_INCOMPLETE`. Adapter production vì vậy không nhận được baseline/delta từ artifact (`baselines: 0`, `deltas: 0`, `semanticChanges: 0`).
- Yêu cầu Opus: cung cấp capture CMD mới qua `scripts/record-capture.mjs` khi CDP 9333 sẵn; nếu capture mới vẫn thiếu function code/body hoàn chỉnh thì sửa đường capture shared ở `network-observer.ts`/recorder. Không nới adapter fail-closed để chấp nhận artifact thiếu dữ liệu.

Không sửa code CMD và không ghi `LOCAL_GREEN` vì replay chưa đạt `--assert-semantic-changes 3`.

## LOCAL_GREEN CMD — NO_CODE_CHANGE

Luật nghiệm thu hiện hành dùng live HOP8; replay không còn là cổng vì lỗi BASE B3 `NETWORK_BODY_INCOMPLETE`.

- GATE 0: có source `chrome:CMD:2105815662`, state `LIVE`, authority `ACTIVE`.
- Lần 1 (`nowMs: 1787665275570`): `firstFailingHop: null`; `HOP8.quoteChanges60s: 128`; `HOP8.quoteChanges300s: 666`; `HOP7.sessionState: ACTIVE`; sample selection `CMD:25311352:25311352:3:25311352:3:over`, `0.91` → `0.96`, `atMs: 1787665271412`.
- Lần 2 (`nowMs: 1787665358338`): `firstFailingHop: null`; `HOP8.quoteChanges60s: 166`; `HOP8.quoteChanges300s: 708`; `HOP7.sessionState: ACTIVE`; sample selection `CMD:25312919:25312919:1:25312919:1:home`, `0.43` → `0.41`, `atMs: 1787665350863`.
- Lần 3 (`nowMs: 1787665438332`): `firstFailingHop: null`; `HOP8.quoteChanges60s: 122`; `HOP8.quoteChanges300s: 670`; `HOP7.sessionState: ACTIVE`; sample selection `CMD:25310230:25310230:3:25310230:3:over`, `-0.75` → `-0.71`, `atMs: 1787665431535`.
- Khoảng cách thời điểm bắt đầu các lần đo: `82740 ms` và `80007 ms`, đều `>= 60000 ms`.
- Evidence: `.run/realtime/cmd/diag-live-1-1787665220352.txt`, `.run/realtime/cmd/diag-live-2-1787665303092.txt`, `.run/realtime/cmd/diag-live-3-1787665383099.txt`.

Không có RED, không có fix và không có thay đổi code CMD.

## PROVISIONAL_ACCEPTANCE CMD

- Build identity trước/sau: `sha256:ab26b3b3f844d69b28dc4ecd9c938695d561990a504e10575fc5e1f35f605266` / `sha256:ab26b3b3f844d69b28dc4ecd9c938695d561990a504e10575fc5e1f35f605266`.
- Lệnh live: `node scripts/diag-pipeline.mjs CMD 600`.
- Evidence: `.run/realtime/cmd/diag-acceptance-600-1787680362716.txt`.
- Thời lượng quan sát: `596242 ms`; `120` mẫu.
- Chặng hỏng thật: `null` suốt 10 phút. Có đúng 1 mẫu bẫy telemetry `HOP1_TAB sourceId: null`; ở mẫu này HOP3–HOP8 vẫn xanh, HOP8 có `quoteChanges60s: 391`, và source `chrome:CMD:2105816135` có mặt trước/sau phép đo nên không tính là chặng hỏng thật.
- `HOP7.sessionState`: `ACTIVE` tại đủ 10 mốc cửa sổ.
- `forcedUnlocks`: max `0`; `baselineAgeMs`: min `132`, max `14913`.

### 10 cửa sổ 60 giây liên tiếp

| Cửa sổ | firstFailingHop thật | quoteChanges60s | quoteChanges300s | HOP7 |
|---:|---|---:|---:|---|
| 1 | null | 222 | 844 | ACTIVE |
| 2 | null | 238 | 1082 | ACTIVE |
| 3 | null | 226 | 1184 | ACTIVE |
| 4 | null | 226 | 1182 | ACTIVE |
| 5 | null | 210 | 1156 | ACTIVE |
| 6 | null | 242 | 1176 | ACTIVE |
| 7 | null | 234 | 1172 | ACTIVE |
| 8 | null | 269 | 1215 | ACTIVE |
| 9 | null | 336 | 1291 | ACTIVE |
| 10 | null | 482 | 1563 | ACTIVE |

Kết quả: `10/10` cửa sổ có `quoteChanges60s > 0` (ngưỡng yêu cầu `>= 8/10`).

### Ba lần đổi giá thật

| selection | giá trước | giá sau | độ trễ quan sát |
|---|---:|---:|---:|
| `CMD:25310663:25310663:3:25310663:3:over` | -0.35 | -0.32 | 1374 ms |
| `CMD:25274781:25274781:3:25274781:3:over` | -0.98 | -0.96 | 3844 ms |
| `CMD:25312359:25312359:3:25312359:3:over` | 0.46 | 0.47 | 4759 ms |

- Cadence p95 đo được: min `10687 ms`, max `15320 ms`, mẫu cuối `13243 ms`.
- SLA đề xuất: p95 `<= 20000 ms`, bám cadence live đo được và không nới rộng tới deadline `45000 ms`.

### Bảng 6 sàn từ `/api/diag/pipeline`

Evidence: `.run/realtime/cmd/pipeline-after-600-1787681004916.json`.

| Lobby | firstFailingHop | HOP6 | HOP7 | quoteChanges60s |
|---|---|---|---|---:|
| CMD | null | LIVE | ACTIVE | 490 |
| IM | null | LIVE | ACTIVE | 72 |
| SABA | HOP7_CATALOG | LIVE | ACTIVE | 128 |
| SBOBET | HOP4_ADAPTER | HARD_RECOVERY | ACTION_REQUIRED | 0 |
| APSPORT | HOP4_ADAPTER | HARD_RECOVERY | ACTION_REQUIRED | 0 |
| BTI | null | LIVE | ACTIVE | 450 |

Cả 6 account vẫn có mặt trong pipeline; 6 lobby bridge tương ứng đều `state: LIVE` trước và sau phép đo, không lobby nào biến mất hoặc tụt source state trong lúc nghiệm thu CMD. Trạng thái hop ngoài CMD được dán nguyên số liệu, không sửa provider ngoài whitelist.

USER_CHECK_PENDING

### Soak status

- Theo chỉ thị user, dừng sau nghiệm thu 600 giây đã đạt.
- Lệnh soak 1800 giây chưa chạy đủ thời lượng; không dùng artifact rỗng `.run/realtime/cmd/diag-soak-1800-1787681691623.txt` làm bằng chứng.
- Chưa ghi `READY_FOR_24H_SOAK CMD`.
