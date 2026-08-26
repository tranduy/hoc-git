# BTI realtime report

## INVESTIGATED

- Ground truth: BTI dùng HTTP polling, cadence catalog khoảng 15 giây; gap lớn nhất đã đo là 30 giây.
- `/trpc/getLoginStatus` và `/api/betslip/bets/updates` là nhiễu, không phải bằng chứng catalog sống.
- CDP `127.0.0.1:9333` không sẵn, vì vậy không ghi capture mới.
- Capture thật có sẵn:
  - `capture-1787551154125.jsonl`: 24 envelope BTI trong 732 ms; 4 prematch-initial trong 2 ms và 19 event-detail trong 233 ms.
  - `capture-1787551154128.jsonl`: 30 envelope event-detail BTI trong 285 ms.
- Hai capture cũ là burst ngắn, không chứa cửa sổ cadence đủ dài để đo gap hoặc kết luận đồng pha generation. Số gap 30 giây lấy từ `00-EVIDENCE.md`.

## Diagnostic round 1 — full output

```json
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663380477,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 3900697
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 388333,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 388333,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 389816,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 389816,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 389816,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 389816,
        "sampleChange": null
      }
    }
  ]
}
```

## Branch A

- Số snapshot: 60 trong 300 giây.
- `firstFailingHop`: `HOP1_TAB` ở cả 60 snapshot.
- HOP8: `quoteChanges60s=0`, `quoteChanges300s=0`; không có sample giá trước/sau.
- Authority: HOP1 `authorityDisposition=null`; HOP5 `authorityDisposition=ACTIVE`.
- Baseline age: `389816 ms` ở snapshot đầu, tăng tới `685365 ms` ở snapshot cuối; giới hạn `90000 ms`.
- Recovery: `state=HARD_RECOVERY`, `reason=RECOVERY_HARD`, `recoveryStage=HARD`, `recoveryAttempt=2`.

## BLOCKED

Chặng hỏng đầu tiên là `HOP1_TAB`: telemetry không có BTI source/tab trong toàn bộ cửa sổ 300 giây. HOP1 không thuộc whitelist BTI, và không giả thuyết H1–H4 nào trong `PROVIDER-BTI.md` có thể tái hiện hoặc sửa lỗi mất source/tab bằng `bti-http-adapter.ts` hay `bti-direct-catalog.ts`. Viết RED/fix trong whitelist lúc này sẽ không tái hiện đúng chặng hỏng đầu tiên và trái plan. Không sửa code, không chạy replay, không ghi `LOCAL_GREEN`.

---

## Retry with GATE 0

### GATE 0 output

```json
{"sources":[{"lobby":"CMD","sourceId":"chrome:CMD:2105815648","tabId":2105815648,"state":"LIVE","lastSequence":53,"lastAcceptedAtMs":1787664209723,"reason":null,"authorityDisposition":"ACTIVE"},{"lobby":"IM","sourceId":"chrome:IM:2105815596","tabId":2105815596,"state":"LIVE","lastSequence":389,"lastAcceptedAtMs":1787664209830,"reason":null,"authorityDisposition":"ACTIVE"},{"lobby":"SABA","sourceId":"chrome:SABA:2105815586","tabId":2105815586,"state":"LIVE","lastSequence":155,"lastAcceptedAtMs":1787664210884,"reason":null,"authorityDisposition":"CANDIDATE"},{"lobby":"KSPORT","sourceId":"chrome:KSPORT:2105815583","tabId":2105815583,"state":"LIVE","lastSequence":45,"lastAcceptedAtMs":1787664209723,"reason":null,"authorityDisposition":"CANDIDATE"},{"lobby":"TSPORT","sourceId":"chrome:TSPORT:2105815593","tabId":2105815593,"state":"LIVE","lastSequence":26,"lastAcceptedAtMs":1787664209722,"reason":null,"authorityDisposition":"CANDIDATE"},{"lobby":"BTI","sourceId":"chrome:BTI:2105815599","tabId":2105815599,"state":"LIVE","lastSequence":1142,"lastAcceptedAtMs":1787664209723,"reason":null,"authorityDisposition":"ACTIVE"}]}
```

GATE 0 đạt: có source `chrome:BTI:2105815599`.

### INVESTIGATED

- BTI dùng HTTP polling; cadence catalog khoảng 15 giây và gap lớn nhất đã đo là 30 giây theo `00-EVIDENCE.md`.
- `/trpc/getLoginStatus` và `/api/betslip/bets/updates` không phải bằng chứng catalog sống.
- CDP 9333 không sẵn nên không ghi capture mới.
- Capture thật có sẵn: `capture-1787551154125.jsonl` và `capture-1787551154128.jsonl`, đều là `HTTP_RESPONSE` của BTI.

### Diagnostic retry — full output

```json
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663385493,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 3905713
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 393349,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 393349,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 394832,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 394832,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 394832,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 394832,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663390501,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 3910721
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 398357,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 398357,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 399840,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 399840,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 399840,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 399840,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663395513,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 3915733
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 403369,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 403369,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 404852,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 404852,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 404852,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 404852,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663400531,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 3920751
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 408387,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 408387,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 409870,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 409870,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 409870,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 409870,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663405544,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 3925764
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 413400,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 413400,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 414883,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 414883,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 414883,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 414883,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663410546,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 3930766
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 418402,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 418402,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 419885,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 419885,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 419885,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 419885,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663415550,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 3935770
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 423406,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 423406,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 424889,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 424889,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 424889,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 424889,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663420558,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 3940778
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 428414,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 428414,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 429897,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 429897,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 429897,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 429897,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663425572,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 3945792
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 433428,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 433428,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 434911,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 434911,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 434911,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 434911,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663430589,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 3950809
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 438445,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 438445,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 439928,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 439928,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 439928,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 439928,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663435598,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 3955818
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 443454,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 443454,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 444937,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 444937,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 444937,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 444937,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663440601,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 3960821
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 448457,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 448457,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 449940,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 449940,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 449940,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 449940,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663445616,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 3965836
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 453472,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 453472,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 454955,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 454955,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 454955,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 454955,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663450632,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 3970852
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 458488,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 458488,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 459971,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 459971,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 459971,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 459971,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663455643,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 3975863
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 463499,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 463499,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 464982,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 464982,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 464982,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 464982,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663460652,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 3980872
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 468508,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 468508,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 469991,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 469991,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 469991,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 469991,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663465655,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 3985875
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 473511,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 473511,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 474994,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 474994,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 474994,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 474994,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663470665,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 3990885
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 478521,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 478521,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 480004,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 480004,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 480004,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 480004,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663475674,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 3995894
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 483530,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 483530,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 485013,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 485013,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 485013,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 485013,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663480683,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4000903
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 488539,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 488539,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 490022,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 490022,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 490022,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 490022,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663485698,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4005918
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 493554,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 493554,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 495037,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 495037,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 495037,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 495037,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663490700,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4010920
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 498556,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 498556,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 500039,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 500039,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 500039,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 500039,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663495701,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4015921
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 503557,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 503557,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 505040,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 505040,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 505040,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 505040,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663500714,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4020934
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 508570,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 508570,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 510053,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 510053,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 510053,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 510053,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663505723,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4025943
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 513579,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 513579,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 515062,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 515062,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 515062,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 515062,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663510739,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4030959
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 518595,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 518595,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 520078,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 520078,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 520078,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 520078,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663515751,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4035971
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 523607,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 523607,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 525090,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 525090,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 525090,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 525090,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663520757,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4040977
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 528613,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 528613,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 530096,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 530096,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 530096,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 530096,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663525763,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4045983
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 533619,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 533619,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 535102,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 535102,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 535102,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 535102,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663530781,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4051001
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 538637,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 538637,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 540120,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 540120,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 540120,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 540120,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663535791,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4056011
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 543647,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 543647,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 545130,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 545130,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 545130,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 545130,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663540807,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4061027
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 548663,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 548663,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 550146,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 550146,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 550146,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 550146,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663545810,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4066030
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 553666,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 553666,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 555149,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 555149,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 555149,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 555149,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663550813,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4071033
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 558669,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 558669,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 560152,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 560152,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 560152,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 560152,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663555818,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4076038
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 563674,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 563674,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 565157,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 565157,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 565157,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 565157,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663560828,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4081048
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 568684,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 568684,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 570167,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 570167,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 570167,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 570167,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663565839,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4086059
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 573695,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 573695,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 575178,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 575178,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 575178,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 575178,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663570841,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4091061
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 578697,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 578697,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 580180,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 580180,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 580180,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 580180,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663575854,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4096074
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 583710,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 583710,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 585193,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 585193,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 585193,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 585193,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663580858,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4101078
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 588714,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 588714,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 590197,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 590197,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 590197,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 590197,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663585867,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4106087
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 593723,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 593723,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 595206,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 595206,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 595206,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 595206,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663590885,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4111105
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 598741,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 598741,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 600224,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 600224,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 600224,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 600224,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663595889,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4116109
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 603745,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 603745,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 605228,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 605228,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 605228,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 605228,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663600898,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4121118
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 608754,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 608754,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 610237,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 610237,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 610237,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 610237,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663605902,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4126122
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 613758,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 613758,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 615241,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 615241,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 615241,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 615241,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663610904,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4131124
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 618760,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 618760,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 620243,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 620243,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 620243,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 620243,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663615916,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4136136
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 623772,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 623772,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 625255,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 625255,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 625255,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 625255,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663620921,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4141141
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 628777,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 628777,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 630260,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 630260,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 630260,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 630260,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663625935,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4146155
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 633791,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 633791,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 635274,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 635274,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 635274,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 635274,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663630948,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4151168
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 638804,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 638804,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 640287,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 640287,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 640287,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 640287,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663635950,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4156170
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 643806,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 643806,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 645289,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 645289,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 645289,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 645289,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663640953,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4161173
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 648809,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 648809,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 650292,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 650292,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 650292,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 650292,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663645963,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4166183
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 653819,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 653819,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 655302,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 655302,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 655302,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 655302,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663650965,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4171185
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 658821,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 658821,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 660304,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 660304,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 660304,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 660304,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663655981,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4176201
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 663837,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 663837,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 665320,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 665320,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 665320,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 665320,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663661000,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4181220
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 668856,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 668856,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 670339,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 670339,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 670339,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 670339,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663666006,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4186226
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 673862,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 673862,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 675345,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 675345,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 675345,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 675345,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663671023,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4191243
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 678879,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 678879,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 680362,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 680362,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 680362,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 680362,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787663676026,
  "firstFailingHop": "HOP1_TAB",
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": false,
      "detail": {
        "sourceId": null,
        "tabId": null,
        "authorityDisposition": null
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": false,
      "detail": {
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49",
        "attachedForMs": 4196246
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 683882,
        "lastSequence": 35662,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 0
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
      "ok": false,
      "detail": {
        "decoded": 0,
        "ignored": 0,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 683882,
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
      "ok": false,
      "detail": {
        "state": "HARD_RECOVERY",
        "reason": "RECOVERY_HARD",
        "activeGeneration": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:49:35646",
        "baselineAgeMs": 685365,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 685365,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": false,
      "detail": {
        "sessionState": "ACTION_REQUIRED",
        "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE",
        "revision": "H3ebpCwMLVB2FsNNZSS3cnpmIkFh9Ye3uLxbNPgzmXc",
        "catalogAgeMs": 685365,
        "events": 52,
        "markets": 314,
        "quotes": 628
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 685365,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664258008,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 141719
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1334,
        "lastSequence": 1685,
        "byTransport": {
          "HTTP_RESPONSE": 1651,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
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
        "decoded": 282,
        "ignored": 90,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 254
        },
        "lastDecodedAgeMs": 1351,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:1684",
        "baselineAgeMs": 1351,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 1351,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5796,
          "p95": 7586,
          "samples": 27
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "24csUX0CGBNnntTQiOQPhx05MEjvSMbBiNm0BF8D4s8",
        "catalogAgeMs": 1351,
        "events": 58,
        "markets": 315,
        "quotes": 630
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 303,
        "quoteChanges300s": 884,
        "lastSemanticChangeAgeMs": 1351,
        "sampleChange": {
          "selectionKey": "BTI:879710768558526464:0OU879710769690980388:3.25:0OU879710769690980388OMM",
          "before": "0.89",
          "after": "0.94",
          "atMs": 1787664250509
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664263017,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 146728
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 457,
        "lastSequence": 1730,
        "byTransport": {
          "HTTP_RESPONSE": 1694,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
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
        "decoded": 292,
        "ignored": 93,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 263
        },
        "lastDecodedAgeMs": 475,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:1729",
        "baselineAgeMs": 475,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 475,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5796,
          "p95": 7586,
          "samples": 28
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "vX1wGD817UG9UFNaZDnZ662LERle5oIcJWHt6jnMB1A",
        "catalogAgeMs": 475,
        "events": 58,
        "markets": 315,
        "quotes": 630
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 297,
        "quoteChanges300s": 920,
        "lastSemanticChangeAgeMs": 475,
        "sampleChange": {
          "selectionKey": "BTI:880073186652467200:0OU880073187449401382:5.5:0OU880073187449401382OMM",
          "before": "0.79",
          "after": "0.81",
          "atMs": 1787664262542
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664268021,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 151732
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 87,
        "lastSequence": 1813,
        "byTransport": {
          "HTTP_RESPONSE": 1777,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
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
        "decoded": 303,
        "ignored": 96,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 273
        },
        "lastDecodedAgeMs": 1297,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:1798",
        "baselineAgeMs": 1297,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 1297,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5796,
          "p95": 7586,
          "samples": 29
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "z9J9QbM2B8myy4Q-RGyaFQpvhcyNXg45Z5U9PouC9hI",
        "catalogAgeMs": 1297,
        "events": 58,
        "markets": 315,
        "quotes": 630
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 339,
        "quoteChanges300s": 962,
        "lastSemanticChangeAgeMs": 1297,
        "sampleChange": {
          "selectionKey": "BTI:880073186652467200:0OU880073187449401382:5.5:0OU880073187449401382OMM",
          "before": "0.79",
          "after": "0.81",
          "atMs": 1787664262542
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664273030,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 156741
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 172,
        "lastSequence": 1878,
        "byTransport": {
          "HTTP_RESPONSE": 1840,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
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
        "decoded": 314,
        "ignored": 101,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 283
        },
        "lastDecodedAgeMs": 172,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:1871",
        "baselineAgeMs": 524,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 524,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7586,
          "samples": 30
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "GFz1kNqoKwY1_IrXj5RM5BYz1EbZ9h0Dgvp2ABFCTrQ",
        "catalogAgeMs": 524,
        "events": 58,
        "markets": 313,
        "quotes": 626
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 312,
        "quoteChanges300s": 996,
        "lastSemanticChangeAgeMs": 524,
        "sampleChange": {
          "selectionKey": "BTI:879649368104521728:0OU879649368922411056:1.75:0OU879649368922411056OMM",
          "before": "0.75",
          "after": "0.72",
          "atMs": 1787664272506
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664278045,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 161756
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1083,
        "lastSequence": 1939,
        "byTransport": {
          "HTTP_RESPONSE": 1901,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
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
        "decoded": 323,
        "ignored": 103,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 292
        },
        "lastDecodedAgeMs": 1083,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:1871",
        "baselineAgeMs": 5539,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 5539,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7586,
          "samples": 30
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "GFz1kNqoKwY1_IrXj5RM5BYz1EbZ9h0Dgvp2ABFCTrQ",
        "catalogAgeMs": 5539,
        "events": 58,
        "markets": 313,
        "quotes": 626
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 312,
        "quoteChanges300s": 996,
        "lastSemanticChangeAgeMs": 5539,
        "sampleChange": {
          "selectionKey": "BTI:879649368104521728:0OU879649368922411056:1.75:0OU879649368922411056OMM",
          "before": "0.75",
          "after": "0.72",
          "atMs": 1787664272506
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664283062,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 166773
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 122,
        "lastSequence": 1980,
        "byTransport": {
          "HTTP_RESPONSE": 1940,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
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
        "decoded": 329,
        "ignored": 107,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 296
        },
        "lastDecodedAgeMs": 122,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:1980",
        "baselineAgeMs": 122,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 122,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7586,
          "samples": 32
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "bNGiJx8zGY5q8HlEHWUZqhXjAX6GZbs6q2A3qZkLPd4",
        "catalogAgeMs": 122,
        "events": 57,
        "markets": 312,
        "quotes": 624
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 302,
        "quoteChanges300s": 1028,
        "lastSemanticChangeAgeMs": 122,
        "sampleChange": {
          "selectionKey": "BTI:879750671753293824:0OU879750673049448486:2.25:0OU879750673049448486OMM",
          "before": "0.93",
          "after": "0.95",
          "atMs": 1787664282940
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664288077,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 171788
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 739,
        "lastSequence": 2047,
        "byTransport": {
          "HTTP_RESPONSE": 2007,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
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
        "decoded": 340,
        "ignored": 108,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 307
        },
        "lastDecodedAgeMs": 739,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:1980",
        "baselineAgeMs": 5137,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 5137,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7586,
          "samples": 32
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "bNGiJx8zGY5q8HlEHWUZqhXjAX6GZbs6q2A3qZkLPd4",
        "catalogAgeMs": 5137,
        "events": 57,
        "markets": 312,
        "quotes": 624
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 302,
        "quoteChanges300s": 1028,
        "lastSemanticChangeAgeMs": 5137,
        "sampleChange": {
          "selectionKey": "BTI:879750671753293824:0OU879750673049448486:2.25:0OU879750673049448486OMM",
          "before": "0.93",
          "after": "0.95",
          "atMs": 1787664282940
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664293081,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 176792
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 339,
        "lastSequence": 2116,
        "byTransport": {
          "HTTP_RESPONSE": 2074,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
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
        "decoded": 352,
        "ignored": 111,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 318
        },
        "lastDecodedAgeMs": 339,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:2053",
        "baselineAgeMs": 4563,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 4563,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7586,
          "samples": 33
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "CE3v6jcCo4p0BlExobeCbGK2BDP2y2y6R3oLCqFg9JI",
        "catalogAgeMs": 4563,
        "events": 57,
        "markets": 311,
        "quotes": 622
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 258,
        "quoteChanges300s": 1054,
        "lastSemanticChangeAgeMs": 4563,
        "sampleChange": {
          "selectionKey": "BTI:879750671753293824:0OU879750673049448486:2.25:0OU879750673049448486OMM",
          "before": "0.93",
          "after": "0.95",
          "atMs": 1787664282940
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664298096,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 181807
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 3,
        "lastSequence": 2173,
        "byTransport": {
          "HTTP_RESPONSE": 2130,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
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
        "decoded": 361,
        "ignored": 115,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 326
        },
        "lastDecodedAgeMs": 3,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:2122",
        "baselineAgeMs": 3300,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 3300,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7586,
          "samples": 34
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "aYxe3a_PvXEB7Xao9Cu5X48NardY21XHsDG70IlpkAE",
        "catalogAgeMs": 3300,
        "events": 57,
        "markets": 311,
        "quotes": 622
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 282,
        "quoteChanges300s": 1078,
        "lastSemanticChangeAgeMs": 3300,
        "sampleChange": {
          "selectionKey": "BTI:880037049460346880:0OU880037050152415250:6.25:0OU880037050152415250OMM",
          "before": "0.81",
          "after": "0.86",
          "atMs": 1787664294796
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664303109,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 186820
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 261,
        "lastSequence": 2262,
        "byTransport": {
          "HTTP_RESPONSE": 2218,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
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
        "decoded": 373,
        "ignored": 120,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 337
        },
        "lastDecodedAgeMs": 261,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:2181",
        "baselineAgeMs": 4643,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 4643,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7586,
          "samples": 35
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "NY-Idlqm8_2fXne7L1YRDKt5riOejy1ufL4cjEtvcCo",
        "catalogAgeMs": 4643,
        "events": 57,
        "markets": 311,
        "quotes": 622
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 244,
        "quoteChanges300s": 1084,
        "lastSemanticChangeAgeMs": 4643,
        "sampleChange": {
          "selectionKey": "BTI:880037049460346880:0OU880037050152415250:6.25:0OU880037050152415250OMM",
          "before": "0.81",
          "after": "0.86",
          "atMs": 1787664294796
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664308117,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 191828
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 50,
        "lastSequence": 2319,
        "byTransport": {
          "HTTP_RESPONSE": 2274,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
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
        "decoded": 380,
        "ignored": 126,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 343
        },
        "lastDecodedAgeMs": 50,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:2269",
        "baselineAgeMs": 3457,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 3457,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7586,
          "samples": 36
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "t3_Sq7aOBsPzqKlZcLuVPdpzPZeLNxQBSII_BwW58Sc",
        "catalogAgeMs": 3457,
        "events": 57,
        "markets": 311,
        "quotes": 622
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 294,
        "quoteChanges300s": 1134,
        "lastSemanticChangeAgeMs": 3457,
        "sampleChange": {
          "selectionKey": "BTI:879649368104521728:0OU879649368922411056:1.5:0OU879649368922411056OM25",
          "before": "0.50",
          "after": "0.52",
          "atMs": 1787664304660
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664313126,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 196837
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 742,
        "lastSequence": 2356,
        "byTransport": {
          "HTTP_RESPONSE": 2309,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 48
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
        "decoded": 390,
        "ignored": 128,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 352
        },
        "lastDecodedAgeMs": 742,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:2331",
        "baselineAgeMs": 2623,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 2623,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5796,
          "p95": 7586,
          "samples": 37
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "p7udzlxyn3_fpVXriO3CQbIWkQRtkLPIRORUhRbh6F8",
        "catalogAgeMs": 2623,
        "events": 57,
        "markets": 311,
        "quotes": 622
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 278,
        "quoteChanges300s": 1162,
        "lastSemanticChangeAgeMs": 2623,
        "sampleChange": {
          "selectionKey": "BTI:879710768558526464:0HC879710769690980387:-0.25:0HC879710769690980387HMM",
          "before": "-0.94",
          "after": "-0.92",
          "atMs": 1787664310503
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664318135,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 201846
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 166,
        "lastSequence": 2444,
        "byTransport": {
          "HTTP_RESPONSE": 2397,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 48
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
        "decoded": 404,
        "ignored": 131,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 365
        },
        "lastDecodedAgeMs": 166,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:2383",
        "baselineAgeMs": 3587,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 3587,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7586,
          "samples": 38
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "t3-DFGSxrPL4_UOEq0NVkp84B7AqqSHXIvtBkQCX2w4",
        "catalogAgeMs": 3587,
        "events": 57,
        "markets": 311,
        "quotes": 622
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 314,
        "quoteChanges300s": 1198,
        "lastSemanticChangeAgeMs": 3587,
        "sampleChange": {
          "selectionKey": "BTI:879710768558526464:0HC879710769690980387:-0.25:0HC879710769690980387HMM",
          "before": "-0.94",
          "after": "-0.92",
          "atMs": 1787664310503
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664323139,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 206850
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 147,
        "lastSequence": 2501,
        "byTransport": {
          "HTTP_RESPONSE": 2452,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 50
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
        "decoded": 414,
        "ignored": 134,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 374
        },
        "lastDecodedAgeMs": 147,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:2456",
        "baselineAgeMs": 2656,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 2656,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5796,
          "p95": 7586,
          "samples": 39
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "p6YKE4BOHYMMTCfPs-xE4Bzn07SJo2ahWHxvOWetODY",
        "catalogAgeMs": 2656,
        "events": 57,
        "markets": 311,
        "quotes": 622
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 270,
        "quoteChanges300s": 1232,
        "lastSemanticChangeAgeMs": 2656,
        "sampleChange": {
          "selectionKey": "BTI:879710768558526464:0HC879710769690980387:-0.25:0HC879710769690980387HMM",
          "before": "-0.92",
          "after": "-0.94",
          "atMs": 1787664320483
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664328149,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 211860
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 457,
        "lastSequence": 2578,
        "byTransport": {
          "HTTP_RESPONSE": 2528,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 51
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
        "decoded": 428,
        "ignored": 140,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 387
        },
        "lastDecodedAgeMs": 536,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:2526",
        "baselineAgeMs": 2740,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 2740,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7336,
          "samples": 40
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "ZQmzoQl30BJfljyojc57tIHDgHez1QbAEGYD3Bdctxk",
        "catalogAgeMs": 2740,
        "events": 57,
        "markets": 311,
        "quotes": 622
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 282,
        "quoteChanges300s": 1244,
        "lastSemanticChangeAgeMs": 2740,
        "sampleChange": {
          "selectionKey": "BTI:879710768558526464:0HC879710769690980387:-0.25:0HC879710769690980387HMM",
          "before": "-0.92",
          "after": "-0.94",
          "atMs": 1787664320483
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664333155,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 216866
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 148,
        "lastSequence": 2642,
        "byTransport": {
          "HTTP_RESPONSE": 2591,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 52
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
        "decoded": 434,
        "ignored": 142,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 392
        },
        "lastDecodedAgeMs": 148,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:2586",
        "baselineAgeMs": 2618,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 2618,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7336,
          "samples": 41
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "5ibdJygYqA6Q-_jelv1F31O8XbFIIAliYLucjMLLAXI",
        "catalogAgeMs": 2618,
        "events": 57,
        "markets": 311,
        "quotes": 622
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 244,
        "quoteChanges300s": 1268,
        "lastSemanticChangeAgeMs": 2618,
        "sampleChange": {
          "selectionKey": "BTI:880073186652467200:0OU880073187449401382:5.5:0OU880073187449401382OMM",
          "before": "0.86",
          "after": "0.93",
          "atMs": 1787664330537
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664338167,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 221878
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 28,
        "lastSequence": 2693,
        "byTransport": {
          "HTTP_RESPONSE": 2641,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 53
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
        "decoded": 443,
        "ignored": 149,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 400
        },
        "lastDecodedAgeMs": 336,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:2675",
        "baselineAgeMs": 1661,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 1661,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7336,
          "samples": 42
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "iabfFnx8rUxF0yKRRm92jqtFhb0XMVQ456fA9WC5OHg",
        "catalogAgeMs": 1661,
        "events": 57,
        "markets": 311,
        "quotes": 622
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 269,
        "quoteChanges300s": 1293,
        "lastSemanticChangeAgeMs": 1661,
        "sampleChange": {
          "selectionKey": "BTI:880073186652467200:0OU880073187449401382:5.5:0OU880073187449401382OMM",
          "before": "0.86",
          "after": "0.93",
          "atMs": 1787664330537
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664343183,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 226894
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 3186,
        "lastSequence": 2730,
        "byTransport": {
          "HTTP_RESPONSE": 2677,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 54
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
        "decoded": 449,
        "ignored": 149,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 406
        },
        "lastDecodedAgeMs": 3186,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:2675",
        "baselineAgeMs": 6677,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 6677,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7336,
          "samples": 42
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "iabfFnx8rUxF0yKRRm92jqtFhb0XMVQ456fA9WC5OHg",
        "catalogAgeMs": 6677,
        "events": 57,
        "markets": 311,
        "quotes": 622
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 239,
        "quoteChanges300s": 1293,
        "lastSemanticChangeAgeMs": 6677,
        "sampleChange": {
          "selectionKey": "BTI:880073186652467200:0OU880073187449401382:5.5:0OU880073187449401382OMM",
          "before": "0.86",
          "after": "0.93",
          "atMs": 1787664330537
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664348199,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 231910
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 641,
        "lastSequence": 2788,
        "byTransport": {
          "HTTP_RESPONSE": 2734,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 55
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
        "decoded": 463,
        "ignored": 154,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 418
        },
        "lastDecodedAgeMs": 641,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:2785",
        "baselineAgeMs": 1551,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 1551,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7336,
          "samples": 44
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "D0XvHGchQMBUyMVrrvvTM_TU_oxDvkfoGCAa8nM6EMg",
        "catalogAgeMs": 1551,
        "events": 57,
        "markets": 311,
        "quotes": 622
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 299,
        "quoteChanges300s": 1353,
        "lastSemanticChangeAgeMs": 1551,
        "sampleChange": {
          "selectionKey": "BTI:879710768558526464:0OU879710769690980388:3.25:0OU879710769690980388OMM",
          "before": "0.99",
          "after": "0.96",
          "atMs": 1787664343382
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664353215,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 236926
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 167,
        "lastSequence": 2895,
        "byTransport": {
          "HTTP_RESPONSE": 2839,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 57
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
        "decoded": 477,
        "ignored": 156,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 431
        },
        "lastDecodedAgeMs": 167,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:2856",
        "baselineAgeMs": 2277,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 2277,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7336,
          "samples": 45
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "G9yV_ORai6bmoa29YeHENqHpNbxk66xE5qY7BON1BKI",
        "catalogAgeMs": 2277,
        "events": 57,
        "markets": 311,
        "quotes": 622
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 289,
        "quoteChanges300s": 1373,
        "lastSemanticChangeAgeMs": 2277,
        "sampleChange": {
          "selectionKey": "BTI:880037049460346880:0OU880037050152415250:7.75:0OU880037050152415250OMM",
          "before": "0.75",
          "after": "0.81",
          "atMs": 1787664350938
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664358233,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 241944
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 3480,
        "lastSequence": 2918,
        "byTransport": {
          "HTTP_RESPONSE": 2862,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 57
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
        "decoded": 482,
        "ignored": 157,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 436
        },
        "lastDecodedAgeMs": 3480,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:2856",
        "baselineAgeMs": 7295,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 7295,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7336,
          "samples": 45
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "G9yV_ORai6bmoa29YeHENqHpNbxk66xE5qY7BON1BKI",
        "catalogAgeMs": 7295,
        "events": 57,
        "markets": 311,
        "quotes": 622
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 289,
        "quoteChanges300s": 1373,
        "lastSemanticChangeAgeMs": 7295,
        "sampleChange": {
          "selectionKey": "BTI:880037049460346880:0OU880037050152415250:7.75:0OU880037050152415250OMM",
          "before": "0.75",
          "after": "0.81",
          "atMs": 1787664350938
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664363252,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 246963
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 378,
        "lastSequence": 2930,
        "byTransport": {
          "HTTP_RESPONSE": 2872,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 59
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
        "decoded": 485,
        "ignored": 160,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 438
        },
        "lastDecodedAgeMs": 378,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:2926",
        "baselineAgeMs": 683,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 683,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7586,
          "samples": 46
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "DLbLijyn1Zf1zD4wRHZqTD_fhSho4kFBVGSgpys0exQ",
        "catalogAgeMs": 683,
        "events": 57,
        "markets": 309,
        "quotes": 618
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 269,
        "quoteChanges300s": 1403,
        "lastSemanticChangeAgeMs": 683,
        "sampleChange": {
          "selectionKey": "BTI:879750671753293824:0OU879750673049448481:0.5:0OU879750673049448481OMM",
          "before": "0.74",
          "after": "0.77",
          "atMs": 1787664362569
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664368264,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 251975
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 2625,
        "lastSequence": 2980,
        "byTransport": {
          "HTTP_RESPONSE": 2922,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 59
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
        "decoded": 494,
        "ignored": 160,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 447
        },
        "lastDecodedAgeMs": 2625,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:2926",
        "baselineAgeMs": 5695,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 5695,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7586,
          "samples": 46
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "DLbLijyn1Zf1zD4wRHZqTD_fhSho4kFBVGSgpys0exQ",
        "catalogAgeMs": 5695,
        "events": 57,
        "markets": 309,
        "quotes": 618
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 269,
        "quoteChanges300s": 1403,
        "lastSemanticChangeAgeMs": 5695,
        "sampleChange": {
          "selectionKey": "BTI:879750671753293824:0OU879750673049448481:0.5:0OU879750673049448481OMM",
          "before": "0.74",
          "after": "0.77",
          "atMs": 1787664362569
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664373270,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 256981
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 838,
        "lastSequence": 3056,
        "byTransport": {
          "HTTP_RESPONSE": 2996,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 61
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
        "decoded": 500,
        "ignored": 162,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 452
        },
        "lastDecodedAgeMs": 1371,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:2987",
        "baselineAgeMs": 4494,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 4494,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5796,
          "p95": 7586,
          "samples": 47
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "c660RCJk5w05Oh4XuE8TGHcatZV8uwDoKxXtNbvIy-g",
        "catalogAgeMs": 4494,
        "events": 57,
        "markets": 310,
        "quotes": 620
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 217,
        "quoteChanges300s": 1415,
        "lastSemanticChangeAgeMs": 4494,
        "sampleChange": {
          "selectionKey": "BTI:879750671753293824:0OU879750673049448481:0.5:0OU879750673049448481OMM",
          "before": "0.74",
          "after": "0.77",
          "atMs": 1787664362569
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664378277,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 261988
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 76,
        "lastSequence": 3127,
        "byTransport": {
          "HTTP_RESPONSE": 3066,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 62
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
        "decoded": 512,
        "ignored": 169,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 463
        },
        "lastDecodedAgeMs": 76,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:3078",
        "baselineAgeMs": 3280,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 3280,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5796,
          "p95": 7586,
          "samples": 48
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "lcyPYgSXdsNm_ZZi1ZB-Q0AWa7NOIwYyv69qAHehMdg",
        "catalogAgeMs": 3280,
        "events": 57,
        "markets": 310,
        "quotes": 620
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 247,
        "quoteChanges300s": 1445,
        "lastSemanticChangeAgeMs": 3280,
        "sampleChange": {
          "selectionKey": "BTI:879750671753293824:0OU879750673049448481:0.5:0OU879750673049448481OMM",
          "before": "0.77",
          "after": "0.74",
          "atMs": 1787664374997
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664383283,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 266994
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 99,
        "lastSequence": 3178,
        "byTransport": {
          "HTTP_RESPONSE": 3115,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 64
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
        "decoded": 525,
        "ignored": 171,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 475
        },
        "lastDecodedAgeMs": 99,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:3138",
        "baselineAgeMs": 2772,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 2772,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5796,
          "p95": 7586,
          "samples": 49
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "9RHD6aZRV2pVB9Szi314ZXoIt9IgPZOwFArrsrKeN_I",
        "catalogAgeMs": 2772,
        "events": 57,
        "markets": 310,
        "quotes": 620
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 239,
        "quoteChanges300s": 1483,
        "lastSemanticChangeAgeMs": 2772,
        "sampleChange": {
          "selectionKey": "BTI:879649299175329792:0OU879649300215509048:3.75:0OU879649300215509048OM25",
          "before": "0.65",
          "after": "0.68",
          "atMs": 1787664380511
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664388293,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 272004
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 195,
        "lastSequence": 3252,
        "byTransport": {
          "HTTP_RESPONSE": 3189,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 64
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
        "decoded": 537,
        "ignored": 176,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 486
        },
        "lastDecodedAgeMs": 195,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:3188",
        "baselineAgeMs": 3760,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 3760,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7586,
          "samples": 50
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "8bplEVOQZ1HwzzINtwTgK2S13ZTkNh5iCQokaKMixJA",
        "catalogAgeMs": 3760,
        "events": 57,
        "markets": 310,
        "quotes": 620
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 261,
        "quoteChanges300s": 1505,
        "lastSemanticChangeAgeMs": 3760,
        "sampleChange": {
          "selectionKey": "BTI:879649299175329792:0OU879649300215509048:3.75:0OU879649300215509048OM25",
          "before": "0.65",
          "after": "0.68",
          "atMs": 1787664380511
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664393310,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 277021
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 751,
        "lastSequence": 3325,
        "byTransport": {
          "HTTP_RESPONSE": 3260,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 66
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
        "decoded": 551,
        "ignored": 178,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 499
        },
        "lastDecodedAgeMs": 751,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:3260",
        "baselineAgeMs": 3743,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 3743,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7586,
          "samples": 51
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "ASFwm2Jo6qvgVy19YswVCvvwv5ZEJRQlfzCASr3LlKY",
        "catalogAgeMs": 3743,
        "events": 57,
        "markets": 310,
        "quotes": 620
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 222,
        "quoteChanges300s": 1515,
        "lastSemanticChangeAgeMs": 3743,
        "sampleChange": {
          "selectionKey": "BTI:879649299175329792:0OU879649300215509048:3.75:0OU879649300215509048OM25",
          "before": "0.65",
          "after": "0.68",
          "atMs": 1787664380511
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664398321,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 282032
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 467,
        "lastSequence": 3383,
        "byTransport": {
          "HTTP_RESPONSE": 3318,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 66
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
        "decoded": 561,
        "ignored": 181,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 508
        },
        "lastDecodedAgeMs": 622,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:3332",
        "baselineAgeMs": 3752,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 3752,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5578,
          "p95": 7586,
          "samples": 52
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "xEPcYp2R1NsnZSFbQWBYYfIRqBjdvI_3dPlebWYeFjo",
        "catalogAgeMs": 3752,
        "events": 57,
        "markets": 310,
        "quotes": 620
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 248,
        "quoteChanges300s": 1541,
        "lastSemanticChangeAgeMs": 3752,
        "sampleChange": {
          "selectionKey": "BTI:879649266409426944:0OU879649267340644408:5.25:0OU879649267340644408OP25",
          "before": "-0.89",
          "after": "-0.86",
          "atMs": 1787664394569
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664403329,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 287040
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 78,
        "lastSequence": 3470,
        "byTransport": {
          "HTTP_RESPONSE": 3403,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 68
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
        "decoded": 571,
        "ignored": 184,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 517
        },
        "lastDecodedAgeMs": 78,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:3433",
        "baselineAgeMs": 2241,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 2241,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7586,
          "samples": 53
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "EKn-1UEaEK346iA039nE3aSsk8Kil-HEcHIqgrNZjp8",
        "catalogAgeMs": 2241,
        "events": 56,
        "markets": 309,
        "quotes": 618
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 210,
        "quoteChanges300s": 1563,
        "lastSemanticChangeAgeMs": 2241,
        "sampleChange": {
          "selectionKey": "BTI:879750671753293824:0OU879750673049448481:0.5:0OU879750673049448481OMM",
          "before": "0.74",
          "after": "0.77",
          "atMs": 1787664401088
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664408342,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 292053
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 43,
        "lastSequence": 3495,
        "byTransport": {
          "HTTP_RESPONSE": 3427,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 69
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
        "decoded": 576,
        "ignored": 189,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 521
        },
        "lastDecodedAgeMs": 43,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:3481",
        "baselineAgeMs": 875,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 875,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7586,
          "samples": 54
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "GXpMkL4FUzPVdF6xq5z16EDn_9jejDDXdoe4D9L_V5k",
        "catalogAgeMs": 875,
        "events": 56,
        "markets": 309,
        "quotes": 618
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 234,
        "quoteChanges300s": 1587,
        "lastSemanticChangeAgeMs": 875,
        "sampleChange": {
          "selectionKey": "BTI:879750671753293824:0OU879750673049448481:0.5:0OU879750673049448481OMM",
          "before": "0.74",
          "after": "0.77",
          "atMs": 1787664401088
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664413357,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 297068
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 6,
        "lastSequence": 3577,
        "byTransport": {
          "HTTP_RESPONSE": 3454,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 68
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
        "decoded": 582,
        "ignored": 190,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 528
        },
        "lastDecodedAgeMs": 118,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:3538",
        "baselineAgeMs": 2489,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 2489,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5782,
          "p95": 7586,
          "samples": 53
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "WGY4IAu1PvHGh6cZ832h4cDrrUryy4l7fOAO6idWrbI",
        "catalogAgeMs": 2489,
        "events": 56,
        "markets": 309,
        "quotes": 618
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 234,
        "quoteChanges300s": 1373,
        "lastSemanticChangeAgeMs": 2489,
        "sampleChange": {
          "selectionKey": "BTI:879649368104521728:0OU879649368922411056:1.5:0OU879649368922411056OM25",
          "before": "0.58",
          "after": "0.55",
          "atMs": 1787664410868
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664418370,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 302081
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 79,
        "lastSequence": 3620,
        "byTransport": {
          "HTTP_RESPONSE": 3496,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 69
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
        "decoded": 588,
        "ignored": 192,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 533
        },
        "lastDecodedAgeMs": 79,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:3586",
        "baselineAgeMs": 1770,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 1770,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5732,
          "p95": 7586,
          "samples": 54
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "CvogZIyIZG8cRoQuqe_nr35fujuRfwKDZJQi8aLSb10",
        "catalogAgeMs": 1770,
        "events": 56,
        "markets": 308,
        "quotes": 616
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 268,
        "quoteChanges300s": 1407,
        "lastSemanticChangeAgeMs": 1770,
        "sampleChange": {
          "selectionKey": "BTI:879649368104521728:0OU879649368922411056:1.5:0OU879649368922411056OM25",
          "before": "0.58",
          "after": "0.55",
          "atMs": 1787664410868
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664423385,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 307096
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 381,
        "lastSequence": 3675,
        "byTransport": {
          "HTTP_RESPONSE": 3407,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 68
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
        "decoded": 575,
        "ignored": 190,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 521
        },
        "lastDecodedAgeMs": 2286,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:3586",
        "baselineAgeMs": 6785,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 6785,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5732,
          "p95": 7586,
          "samples": 53
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "CvogZIyIZG8cRoQuqe_nr35fujuRfwKDZJQi8aLSb10",
        "catalogAgeMs": 6785,
        "events": 56,
        "markets": 308,
        "quotes": 616
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 226,
        "quoteChanges300s": 1371,
        "lastSemanticChangeAgeMs": 6785,
        "sampleChange": {
          "selectionKey": "BTI:879649368104521728:0OU879649368922411056:1.5:0OU879649368922411056OM25",
          "before": "0.58",
          "after": "0.55",
          "atMs": 1787664410868
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664428395,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 312106
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 858,
        "lastSequence": 3764,
        "byTransport": {
          "HTTP_RESPONSE": 3495,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 69
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
        "decoded": 584,
        "ignored": 198,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 528
        },
        "lastDecodedAgeMs": 858,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:3742",
        "baselineAgeMs": 1917,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 1917,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5732,
          "p95": 7586,
          "samples": 55
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "WY31aKHArWoNZeb6avyycBN06efLSwH3Hhb1jZvIPRY",
        "catalogAgeMs": 1917,
        "events": 56,
        "markets": 308,
        "quotes": 616
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 270,
        "quoteChanges300s": 1415,
        "lastSemanticChangeAgeMs": 1917,
        "sampleChange": {
          "selectionKey": "BTI:879649266409426944:0OU879649267340644408:6.25:0OU879649267340644408OP25",
          "before": "-0.86",
          "after": "-0.83",
          "atMs": 1787664423279
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664433408,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 317119
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 59,
        "lastSequence": 3868,
        "byTransport": {
          "HTTP_RESPONSE": 3500,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 68
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
        "decoded": 577,
        "ignored": 193,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 523
        },
        "lastDecodedAgeMs": 59,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:3829",
        "baselineAgeMs": 2570,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 2570,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5578,
          "p95": 7586,
          "samples": 53
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "bplC46_HrHBx5sCAeo-oYr1CwrTnIhK0M62YkPUiOik",
        "catalogAgeMs": 2570,
        "events": 56,
        "markets": 308,
        "quotes": 616
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 246,
        "quoteChanges300s": 1361,
        "lastSemanticChangeAgeMs": 2570,
        "sampleChange": {
          "selectionKey": "BTI:880078503570329600:0OU880078504329580575:2.75:0OU880078504329580575OMM",
          "before": "0.72",
          "after": "0.80",
          "atMs": 1787664430838
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664438424,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 322135
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 667,
        "lastSequence": 3928,
        "byTransport": {
          "HTTP_RESPONSE": 3560,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 68
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
        "decoded": 587,
        "ignored": 200,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 532
        },
        "lastDecodedAgeMs": 667,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:3877",
        "baselineAgeMs": 3900,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 3900,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5566,
          "p95": 7586,
          "samples": 54
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "Jjj9WJF-K__rRNCMV1D-PdfANnFXLGPeeHv9QuFK8YM",
        "catalogAgeMs": 3900,
        "events": 55,
        "markets": 308,
        "quotes": 616
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 274,
        "quoteChanges300s": 1389,
        "lastSemanticChangeAgeMs": 3900,
        "sampleChange": {
          "selectionKey": "BTI:880078503570329600:0OU880078504329580575:2.75:0OU880078504329580575OMM",
          "before": "0.72",
          "after": "0.80",
          "atMs": 1787664430838
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664443431,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 327142
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 5,
        "lastSequence": 3980,
        "byTransport": {
          "HTTP_RESPONSE": 3488,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 68
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
        "decoded": 582,
        "ignored": 197,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 527
        },
        "lastDecodedAgeMs": 5,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:3936",
        "baselineAgeMs": 2558,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 2558,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5566,
          "p95": 7586,
          "samples": 54
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "CDiAEiYRtyAPMsrtLQ1OJDfk4BxZ_V7yX_AhIAjKSj0",
        "catalogAgeMs": 2558,
        "events": 55,
        "markets": 308,
        "quotes": 616
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 242,
        "quoteChanges300s": 1407,
        "lastSemanticChangeAgeMs": 2558,
        "sampleChange": {
          "selectionKey": "BTI:879649266409426944:0OU879649267340644408:6.25:0OU879649267340644408OP25",
          "before": "-0.83",
          "after": "-0.78",
          "atMs": 1787664440873
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664448436,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 332147
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 299,
        "lastSequence": 4064,
        "byTransport": {
          "HTTP_RESPONSE": 3572,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 68
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
        "decoded": 594,
        "ignored": 200,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 538
        },
        "lastDecodedAgeMs": 484,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:4007",
        "baselineAgeMs": 3654,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 3654,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5566,
          "p95": 7586,
          "samples": 55
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "dU6rIRH8RuAHkpmIZuMdZD965Vc2UqjWb17gHaxk5Pc",
        "catalogAgeMs": 3654,
        "events": 55,
        "markets": 308,
        "quotes": 616
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 252,
        "quoteChanges300s": 1417,
        "lastSemanticChangeAgeMs": 3654,
        "sampleChange": {
          "selectionKey": "BTI:879649266409426944:0OU879649267340644408:6.25:0OU879649267340644408OP25",
          "before": "-0.83",
          "after": "-0.78",
          "atMs": 1787664440873
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664453447,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 337158
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 412,
        "lastSequence": 4127,
        "byTransport": {
          "HTTP_RESPONSE": 3486,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 67
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
        "decoded": 581,
        "ignored": 196,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 526
        },
        "lastDecodedAgeMs": 412,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:4083",
        "baselineAgeMs": 2954,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 2954,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5514,
          "p95": 7586,
          "samples": 54
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "527hgYKAlXXuuBpULbMNxOZRPqF-cN4AbG06zJL9H68",
        "catalogAgeMs": 2954,
        "events": 54,
        "markets": 307,
        "quotes": 614
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 246,
        "quoteChanges300s": 1383,
        "lastSemanticChangeAgeMs": 2954,
        "sampleChange": {
          "selectionKey": "BTI:880073186652467200:0OU880073187449401382:5.5:0OU880073187449401382OMM",
          "before": "-0.94",
          "after": "-0.91",
          "atMs": 1787664450493
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664458464,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 342175
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 412,
        "lastSequence": 4194,
        "byTransport": {
          "HTTP_RESPONSE": 3552,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 68
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
        "decoded": 590,
        "ignored": 200,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 534
        },
        "lastDecodedAgeMs": 412,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:4141",
        "baselineAgeMs": 2869,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 2869,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5514,
          "p95": 7586,
          "samples": 55
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "cigYyh4oCQ8GN9QeLhjud1Aj94VBvVQBIqIauH8q2xU",
        "catalogAgeMs": 2869,
        "events": 54,
        "markets": 307,
        "quotes": 614
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 260,
        "quoteChanges300s": 1397,
        "lastSemanticChangeAgeMs": 2869,
        "sampleChange": {
          "selectionKey": "BTI:880073186652467200:0OU880073187449401382:5.5:0OU880073187449401382OMM",
          "before": "-0.94",
          "after": "-0.91",
          "atMs": 1787664450493
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664463481,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 347192
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 53,
        "lastSequence": 4272,
        "byTransport": {
          "HTTP_RESPONSE": 3560,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 67
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
        "decoded": 589,
        "ignored": 202,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 534
        },
        "lastDecodedAgeMs": 53,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:4231",
        "baselineAgeMs": 2764,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 2764,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5128,
          "p95": 7586,
          "samples": 54
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "mKi8Wu7Jjsj2yVc7ZmQNX_xs-G4z4IW2i6frF7GGZG8",
        "catalogAgeMs": 2764,
        "events": 54,
        "markets": 306,
        "quotes": 612
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 232,
        "quoteChanges300s": 1356,
        "lastSemanticChangeAgeMs": 2764,
        "sampleChange": {
          "selectionKey": "BTI:880073186652467200:0OU880073187449401382:5.5:0OU880073187449401382OMM",
          "before": "-0.91",
          "after": "-0.88",
          "atMs": 1787664460717
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664468492,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 352203
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 500,
        "lastSequence": 4331,
        "byTransport": {
          "HTTP_RESPONSE": 3619,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 67
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
        "decoded": 600,
        "ignored": 206,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 544
        },
        "lastDecodedAgeMs": 500,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:4278",
        "baselineAgeMs": 4043,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 4043,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5128,
          "p95": 7586,
          "samples": 55
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "B0p8ifezal0zefd3Joam5XnNBMf2qoXAIZoq-EeAkAs",
        "catalogAgeMs": 4043,
        "events": 54,
        "markets": 306,
        "quotes": 612
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 252,
        "quoteChanges300s": 1376,
        "lastSemanticChangeAgeMs": 4043,
        "sampleChange": {
          "selectionKey": "BTI:880073186652467200:0OU880073187449401382:5.5:0OU880073187449401382OMM",
          "before": "-0.91",
          "after": "-0.88",
          "atMs": 1787664460717
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664473499,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 357210
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 55,
        "lastSequence": 4365,
        "byTransport": {
          "HTTP_RESPONSE": 3534,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 67
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
        "decoded": 584,
        "ignored": 201,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 528
        },
        "lastDecodedAgeMs": 55,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:4338",
        "baselineAgeMs": 1408,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 1408,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5128,
          "p95": 7642,
          "samples": 55
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "omNVvXwRdPucjK8N1Qv6h9q8JJPqwHAUsPKHgVSb_2k",
        "catalogAgeMs": 1408,
        "events": 54,
        "markets": 307,
        "quotes": 614
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 222,
        "quoteChanges300s": 1370,
        "lastSemanticChangeAgeMs": 1408,
        "sampleChange": {
          "selectionKey": "BTI:879649368104521728:0HC879649368922411055:-0.25:0HC879649368922411055HMM",
          "before": "-0.86",
          "after": "-0.89",
          "atMs": 1787664472091
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664478517,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 362228
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 307,
        "lastSequence": 4449,
        "byTransport": {
          "HTTP_RESPONSE": 3617,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 68
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
        "decoded": 598,
        "ignored": 204,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 541
        },
        "lastDecodedAgeMs": 307,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:4418",
        "baselineAgeMs": 1989,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 1989,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5122,
          "p95": 7642,
          "samples": 56
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "YToFi7QpxteuSqwCbcjDcoPpUcNpqltmkJgr2tRot-8",
        "catalogAgeMs": 1989,
        "events": 52,
        "markets": 304,
        "quotes": 608
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 236,
        "quoteChanges300s": 1384,
        "lastSemanticChangeAgeMs": 1989,
        "sampleChange": {
          "selectionKey": "BTI:879649368104521728:0HC879649368922411055:-0.25:0HC879649368922411055HMM",
          "before": "-0.86",
          "after": "-0.89",
          "atMs": 1787664472091
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664483532,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 367243
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 45,
        "lastSequence": 4532,
        "byTransport": {
          "HTTP_RESPONSE": 3556,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 66
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
        "decoded": 596,
        "ignored": 204,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 541
        },
        "lastDecodedAgeMs": 45,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:4483",
        "baselineAgeMs": 2940,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 2940,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5128,
          "p95": 7642,
          "samples": 54
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "FLmjFtspQrdsYajzyrddQdRdSiHBwwq8j0q2jelPtog",
        "catalogAgeMs": 2940,
        "events": 52,
        "markets": 303,
        "quotes": 606
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 196,
        "quoteChanges300s": 1340,
        "lastSemanticChangeAgeMs": 2940,
        "sampleChange": {
          "selectionKey": "BTI:879750671753293824:0OU879750673049448481:0.5:0OU879750673049448481OMM",
          "before": "0.81",
          "after": "0.86",
          "atMs": 1787664480592
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664488538,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 372249
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 315,
        "lastSequence": 4562,
        "byTransport": {
          "HTTP_RESPONSE": 3585,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 67
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
        "decoded": 598,
        "ignored": 207,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 542
        },
        "lastDecodedAgeMs": 1733,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:4540",
        "baselineAgeMs": 1733,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 1733,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5514,
          "p95": 7642,
          "samples": 55
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "LGLnql9wTf-fq3AD3GcTvYebYlZejOcnJV63VWhPj98",
        "catalogAgeMs": 1733,
        "events": 52,
        "markets": 303,
        "quotes": 606
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 214,
        "quoteChanges300s": 1358,
        "lastSemanticChangeAgeMs": 1733,
        "sampleChange": {
          "selectionKey": "BTI:879750671753293824:0OU879750673049448481:0.5:0OU879750673049448481OMM",
          "before": "0.81",
          "after": "0.86",
          "atMs": 1787664480592
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664493559,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 377270
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 45,
        "lastSequence": 4646,
        "byTransport": {
          "HTTP_RESPONSE": 3547,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 67
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
        "decoded": 587,
        "ignored": 205,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 532
        },
        "lastDecodedAgeMs": 45,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:4631",
        "baselineAgeMs": 899,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 899,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5514,
          "p95": 7642,
          "samples": 54
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "FFwh9wzcC8C4eN-I-bJJ5pDG-XkAyrhqONCmS5xX3xo",
        "catalogAgeMs": 899,
        "events": 52,
        "markets": 303,
        "quotes": 606
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 192,
        "quoteChanges300s": 1330,
        "lastSemanticChangeAgeMs": 899,
        "sampleChange": {
          "selectionKey": "BTI:879649368104521728:0OU879649368922411056:1.5:0OU879649368922411056OM25",
          "before": "0.61",
          "after": "0.64",
          "atMs": 1787664492660
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664498569,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 382280
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 571,
        "lastSequence": 4701,
        "byTransport": {
          "HTTP_RESPONSE": 3602,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 67
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
        "decoded": 599,
        "ignored": 210,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 543
        },
        "lastDecodedAgeMs": 571,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:4681",
        "baselineAgeMs": 1887,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 1887,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5514,
          "p95": 7642,
          "samples": 55
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "_FVe2FnfvoYg6FP6uAjP0bJ1EhTLEyBUovlB5jpltYM",
        "catalogAgeMs": 1887,
        "events": 52,
        "markets": 303,
        "quotes": 606
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 208,
        "quoteChanges300s": 1346,
        "lastSemanticChangeAgeMs": 1887,
        "sampleChange": {
          "selectionKey": "BTI:879649368104521728:0OU879649368922411056:1.5:0OU879649368922411056OM25",
          "before": "0.61",
          "after": "0.64",
          "atMs": 1787664492660
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664503584,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 387295
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 3491,
        "lastSequence": 4735,
        "byTransport": {
          "HTTP_RESPONSE": 3527,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 66
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
        "decoded": 585,
        "ignored": 207,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 530
        },
        "lastDecodedAgeMs": 3604,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:4681",
        "baselineAgeMs": 6902,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 6902,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5128,
          "p95": 7336,
          "samples": 54
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "_FVe2FnfvoYg6FP6uAjP0bJ1EhTLEyBUovlB5jpltYM",
        "catalogAgeMs": 6902,
        "events": 52,
        "markets": 303,
        "quotes": 606
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 160,
        "quoteChanges300s": 1304,
        "lastSemanticChangeAgeMs": 6902,
        "sampleChange": {
          "selectionKey": "BTI:879649368104521728:0OU879649368922411056:1.5:0OU879649368922411056OM25",
          "before": "0.61",
          "after": "0.64",
          "atMs": 1787664492660
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664508594,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 392305
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 360,
        "lastSequence": 4806,
        "byTransport": {
          "HTTP_RESPONSE": 3597,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 67
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
        "decoded": 592,
        "ignored": 212,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 535
        },
        "lastDecodedAgeMs": 360,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:4788",
        "baselineAgeMs": 1724,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 1724,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5128,
          "p95": 7336,
          "samples": 56
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "zFIMUXEh2u3a2P3-5guYEzUySOMbvgmLrbW_9PKNH0c",
        "catalogAgeMs": 1724,
        "events": 52,
        "markets": 303,
        "quotes": 606
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 180,
        "quoteChanges300s": 1324,
        "lastSemanticChangeAgeMs": 4803,
        "sampleChange": {
          "selectionKey": "BTI:879649266409426944:0HC879649267340644407:0.25:0HC879649267340644407HP25",
          "before": "0.56",
          "after": "0.59",
          "atMs": 1787664503791
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664513599,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 397310
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 315,
        "lastSequence": 4864,
        "byTransport": {
          "HTTP_RESPONSE": 3567,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 67
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
        "decoded": 586,
        "ignored": 211,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 530
        },
        "lastDecodedAgeMs": 315,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:4852",
        "baselineAgeMs": 1018,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 1018,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5578,
          "p95": 7336,
          "samples": 55
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "b8ocO0HxXm8i7GGQAvpZa2js31v6kAh1GT-bXLWCfyo",
        "catalogAgeMs": 1018,
        "events": 52,
        "markets": 303,
        "quotes": 606
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 162,
        "quoteChanges300s": 1279,
        "lastSemanticChangeAgeMs": 1018,
        "sampleChange": {
          "selectionKey": "BTI:879649368104521728:0HC879649368922411055:-0.25:0HC879649368922411055HMM",
          "before": "-0.89",
          "after": "-0.86",
          "atMs": 1787664512581
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664518663,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 402374
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 2786,
        "lastSequence": 4903,
        "byTransport": {
          "HTTP_RESPONSE": 3606,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 67
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
        "decoded": 592,
        "ignored": 215,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 536
        },
        "lastDecodedAgeMs": 3260,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:4852",
        "baselineAgeMs": 6082,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 6082,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5578,
          "p95": 7336,
          "samples": 55
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "b8ocO0HxXm8i7GGQAvpZa2js31v6kAh1GT-bXLWCfyo",
        "catalogAgeMs": 6082,
        "events": 52,
        "markets": 303,
        "quotes": 606
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 162,
        "quoteChanges300s": 1279,
        "lastSemanticChangeAgeMs": 6082,
        "sampleChange": {
          "selectionKey": "BTI:879649368104521728:0HC879649368922411055:-0.25:0HC879649368922411055HMM",
          "before": "-0.89",
          "after": "-0.86",
          "atMs": 1787664512581
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664523683,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 407394
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 229,
        "lastSequence": 4982,
        "byTransport": {
          "HTTP_RESPONSE": 3566,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 66
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
        "decoded": 577,
        "ignored": 211,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 522
        },
        "lastDecodedAgeMs": 229,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:4911",
        "baselineAgeMs": 3659,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 3659,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5578,
          "p95": 7443,
          "samples": 54
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "8E4zZjfu2lqqci6Kt_JpdzPC7a-yvIDLlwzGkoq5cVg",
        "catalogAgeMs": 3659,
        "events": 52,
        "markets": 303,
        "quotes": 606
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 144,
        "quoteChanges300s": 1257,
        "lastSemanticChangeAgeMs": 3659,
        "sampleChange": {
          "selectionKey": "BTI:879750671753293824:0OU879750673049448481:0.5:0OU879750673049448481OMM",
          "before": "0.86",
          "after": "0.91",
          "atMs": 1787664520024
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664528695,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 412406
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 766,
        "lastSequence": 5045,
        "byTransport": {
          "HTTP_RESPONSE": 3629,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 66
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
        "decoded": 593,
        "ignored": 216,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 537
        },
        "lastDecodedAgeMs": 766,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:5003",
        "baselineAgeMs": 3812,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 3812,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5578,
          "p95": 7443,
          "samples": 55
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "yJPFDsQhCtDzl7SXbe93p1YT9zzJ3mCU094s7CrBbyg",
        "catalogAgeMs": 3812,
        "events": 52,
        "markets": 304,
        "quotes": 608
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 166,
        "quoteChanges300s": 1279,
        "lastSemanticChangeAgeMs": 3812,
        "sampleChange": {
          "selectionKey": "BTI:879750671753293824:0OU879750673049448481:0.5:0OU879750673049448481OMM",
          "before": "0.86",
          "after": "0.91",
          "atMs": 1787664520024
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664533698,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 417409
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1376,
        "lastSequence": 5074,
        "byTransport": {
          "HTTP_RESPONSE": 3528,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 66
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
        "decoded": 574,
        "ignored": 213,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 519
        },
        "lastDecodedAgeMs": 1376,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:5053",
        "baselineAgeMs": 2926,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 2926,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5578,
          "p95": 7443,
          "samples": 54
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "dA0YBEsdXAgq_Dh4Uaspr2IhXibtiHtp9nZ9ysnlcao",
        "catalogAgeMs": 2926,
        "events": 52,
        "markets": 303,
        "quotes": 606
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 148,
        "quoteChanges300s": 1229,
        "lastSemanticChangeAgeMs": 2926,
        "sampleChange": {
          "selectionKey": "BTI:880073186652467200:0OU880073187449401382:5.5:0OU880073187449401382OMM",
          "before": "-0.82",
          "after": "-0.80",
          "atMs": 1787664530772
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664538715,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 422426
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 302,
        "lastSequence": 5169,
        "byTransport": {
          "HTTP_RESPONSE": 3623,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 66
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
        "decoded": 586,
        "ignored": 217,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 530
        },
        "lastDecodedAgeMs": 302,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:5111",
        "baselineAgeMs": 3151,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 3151,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5578,
          "p95": 7443,
          "samples": 55
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "tCIEjGbszkfGd5Nl6xnNpFmF7GimsLnKQGSjY5XqjEM",
        "catalogAgeMs": 3151,
        "events": 52,
        "markets": 303,
        "quotes": 606
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 154,
        "quoteChanges300s": 1235,
        "lastSemanticChangeAgeMs": 3151,
        "sampleChange": {
          "selectionKey": "BTI:880073186652467200:0OU880073187449401382:5.5:0OU880073187449401382OMM",
          "before": "-0.82",
          "after": "-0.80",
          "atMs": 1787664530772
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664543720,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 427431
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 3997,
        "lastSequence": 5184,
        "byTransport": {
          "HTTP_RESPONSE": 3497,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 65
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
        "decoded": 569,
        "ignored": 210,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 515
        },
        "lastDecodedAgeMs": 4335,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:5111",
        "baselineAgeMs": 8156,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 8156,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5578,
          "p95": 7443,
          "samples": 53
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "tCIEjGbszkfGd5Nl6xnNpFmF7GimsLnKQGSjY5XqjEM",
        "catalogAgeMs": 8156,
        "events": 52,
        "markets": 303,
        "quotes": 606
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 132,
        "quoteChanges300s": 1191,
        "lastSemanticChangeAgeMs": 8156,
        "sampleChange": {
          "selectionKey": "BTI:880073186652467200:0OU880073187449401382:5.5:0OU880073187449401382OMM",
          "before": "-0.82",
          "after": "-0.80",
          "atMs": 1787664530772
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664548734,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 432445
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 266,
        "lastSequence": 5217,
        "byTransport": {
          "HTTP_RESPONSE": 3529,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 66
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
        "decoded": 573,
        "ignored": 213,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 518
        },
        "lastDecodedAgeMs": 266,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:5191",
        "baselineAgeMs": 2103,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 2103,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5578,
          "p95": 7642,
          "samples": 54
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "0KHCyITJ73fd58qDJfYhjpSkzgDtZqgqcp-h1ZrAofM",
        "catalogAgeMs": 2103,
        "events": 52,
        "markets": 304,
        "quotes": 608
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 142,
        "quoteChanges300s": 1201,
        "lastSemanticChangeAgeMs": 2103,
        "sampleChange": {
          "selectionKey": "BTI:879649368104521728:0OU879649368922411064:3.75:0OU879649368922411064OMM",
          "before": "0.81",
          "after": "0.83",
          "atMs": 1787664546631
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:BTI:FOOTBALL",
  "lobby": "BTI",
  "nowMs": 1787664553749,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:BTI:2105815599",
        "tabId": 2105815599,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5",
        "attachedForMs": 437460
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 492,
        "lastSequence": 5274,
        "byTransport": {
          "HTTP_RESPONSE": 3522,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 66
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
        "decoded": 566,
        "ignored": 216,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 512
        },
        "lastDecodedAgeMs": 492,
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
        "activeGeneration": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:5:5256",
        "baselineAgeMs": 1531,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 1531,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 5578,
          "p95": 7642,
          "samples": 53
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 2,
        "nextAttemptInMs": 0,
        "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
      }
    },
    {
      "hop": "HOP7_CATALOG",
      "ok": true,
      "detail": {
        "sessionState": "ACTIVE",
        "reason": null,
        "snapshotState": "FRESH",
        "revision": "q0_OgtbT435qPX7okAHBsOoFUpjtcqKIzCu5vPm6cM8",
        "catalogAgeMs": 1531,
        "events": 52,
        "markets": 304,
        "quotes": 608
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 134,
        "quoteChanges300s": 1177,
        "lastSemanticChangeAgeMs": 1531,
        "sampleChange": {
          "selectionKey": "BTI:879750671753293824:0OU879750673049448481:0.5:0OU879750673049448481OMM",
          "before": "0.91",
          "after": "0.93",
          "atMs": 1787664552218
        }
      }
    }
  ]
}

### Branch A — retry

- 60 snapshot trong 300 giây; `firstFailingHop=null` ở cả 60 snapshot.
- HOP8 `quoteChanges60s`: min `132`, max `339`, snapshot cuối `134`.
- HOP8 `quoteChanges300s`: min `884`, max `1587`, snapshot cuối `1177`.
- Authority: HOP1 `ACTIVE`; HOP5 `ACTIVE`.
- `baselineAgeMs`: min `122`, max `8156`, snapshot cuối `1531`.
- Mẫu đổi giá thật: selection `BTI:879750671753293824:0OU879750673049448481:0.5:0OU879750673049448481OMM`, `0.91` → `0.93`, `atMs=1787664552218`.
- `/trpc/getLoginStatus` và `/api/betslip/bets/updates` không được tính là bằng chứng catalog sống.

### Replay outputs

```json
{"provider":"BTI","capture":"capture-1787551154125.jsonl","envelopes":24,"baselines":0,"deltas":0,"rejected":{"total":24,"reasons":{"NETWORK_BODY_INCOMPLETE":9,"ADAPTER_DECODE_EMPTY:bti-http-catalog-v1":14,"TAB_STATE_TRANSPORT_ONLY":1}},"semanticChanges":0}
{"provider":"BTI","capture":"capture-1787551154128.jsonl","envelopes":30,"baselines":0,"deltas":0,"rejected":{"total":30,"reasons":{"NETWORK_BODY_INCOMPLETE":30}},"semanticChanges":0}
```

### SHARED_REQUEST

- Hop: `HOP4_ADAPTER` trên đường replay.
- File shared cần xử lý: `apps/api/src/chrome-bridge/chrome-catalog-data-plane.ts`.
- Lý do: live trace có HOP8 đổi giá thật nhưng cả hai capture BTI đều không lập được baseline; data-plane từ chối toàn bộ envelope với `NETWORK_BODY_INCOMPLETE` và/hoặc `ADAPTER_DECODE_EMPTY:bti-http-catalog-v1`. Replay có `semanticChanges=0`, nên không thể đạt gate `--assert-semantic-changes 1` trong whitelist BTI.
- Không sửa code và không ghi `LOCAL_GREEN`.

---

## LOCAL_GREEN BTI — NO_CODE_CHANGE

Các kết luận `BLOCKED`/`SHARED_REQUEST` cũ do replay đã bị hủy theo luật mới của BASE: replay harness không phải cổng nghiệm thu. GATE 0 xác nhận có source `chrome:BTI:2105815599`.

Ba phép đo live bắt đầu cách nhau lần lượt `77078 ms` và `77802 ms`:

| Lần | `firstFailingHop` | `HOP8.quoteChanges60s` | `HOP8.quoteChanges300s` | `HOP7.sessionState` | `sampleChange` |
|---:|---|---:|---:|---|---|
| 1 | `null` | 272 | 1771 | `ACTIVE` | `BTI:879649299175329792:0OU879649300215509048:6.5:0OU879649300215509048OMM`, `-0.67` → `-0.64`, `atMs=1787665312660` |
| 2 | `null` | 284 | 1761 | `ACTIVE` | `BTI:879710768558526464:0OU879710769690980388:3.25:0OU879710769690980388OMM`, `0.92` → `0.87`, `atMs=1787665394866` |
| 3 | `null` | 144 | 1607 | `ACTIVE` | `BTI:879750671753293824:0OU879750673049448481:0.5:0OU879750673049448481OMM`, `-0.40` → `-0.39`, `atMs=1787665463057` |

`/trpc/getLoginStatus` và `/api/betslip/bets/updates` không được dùng làm bằng chứng. Bằng chứng nghiệm thu là ba cửa sổ live đều có HOP8 thay đổi giá thật và `sampleChange`. Không có code change.
