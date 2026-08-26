# SABA realtime report

## INVESTIGATED

- Status: `INVESTIGATED`
- Ground truth: Socket.IO; schema `f` động; partition odds `b14`; baseline `reset` … `done`.
- Cadence đo ngày 2026-08-25: 118 frame/150 giây; sau burst đầu ổn định 4–7 frame/15 giây.
- Evidence khử nhạy cảm: `.run/realtime/saba/investigated.json`.
- Capture có sẵn: 46 `WS_FRAME`, sequence 423–518; 44 delta, 0 reset, 0 done.
- Kịch bản gắn muộn: capture bắt đầu khi socket đã chạy; không có lifecycle `OPEN` hoặc baseline trong cửa sổ capture.

## Diagnostic round 1 — full output

Command: `node scripts/diag-pipeline.mjs SABA 180`

```json
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663398735,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3602741
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 406705,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 407331,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3635804,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3813005,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663403757,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3607763
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 411727,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 412353,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3640826,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3818027,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663408764,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3612770
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 416734,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 417360,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3645833,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3823034,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663413771,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3617777
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 421741,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 422367,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3650840,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3828041,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663418783,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3622789
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 426753,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 427379,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3655852,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3833053,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663423798,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3627804
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 431768,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 432394,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3660867,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3838068,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663428811,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3632817
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 436781,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 437407,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3665880,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3843081,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663433816,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3637822
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 441786,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 442412,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3670885,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3848086,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663438825,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3642831
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 446795,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 447421,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3675894,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3853095,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663443831,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3647837
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 451801,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 452427,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3680900,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3858101,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663448844,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3652850
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 456814,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 457440,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3685913,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3863114,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663453859,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3657865
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 461829,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 462455,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3690928,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3868129,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663458875,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3662881
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 466845,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 467471,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3695944,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3873145,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663463878,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3667884
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 471848,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 472474,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3700947,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3878148,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663468891,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3672897
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 476861,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 477487,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3705960,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3883161,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663473895,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3677901
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 481865,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 482491,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3710964,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3888165,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663478910,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3682916
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 486880,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 487506,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3715979,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3893180,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663483915,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3687921
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 491885,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 492511,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3720984,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3898185,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663488931,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3692937
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 496901,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 497527,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3726000,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3903201,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663493940,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3697946
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 501910,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 502536,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3731009,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3908210,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663498953,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3702959
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 506923,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 507549,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3736022,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3913223,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663503960,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3707966
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 511930,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 512556,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3741029,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3918230,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663508976,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3712982
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 516946,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 517572,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3746045,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3923246,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663513979,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3717985
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 521949,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 522575,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3751048,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3928249,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663518994,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3723000
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 526964,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 527590,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3756063,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3933264,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663524000,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3728006
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 531970,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 532596,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3761069,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3938270,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663529012,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3733018
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 536982,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 537608,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3766081,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3943282,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663534020,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3738026
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 541990,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 542616,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3771089,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3948290,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663539033,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3743039
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 547003,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 547629,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3776102,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3953303,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663544034,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3748040
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 552004,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 552630,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3781103,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3958304,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663549042,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3753048
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 557012,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 557638,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3786111,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3963312,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663554054,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3758060
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 562024,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 562650,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3791123,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3968324,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663559068,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3763074
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 567038,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 567664,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3796137,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3973338,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663564083,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3768089
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 572053,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 572679,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3801152,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3978353,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663569088,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3773094
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 577058,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 577684,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3806157,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3983358,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663574095,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 3778101
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 582065,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 582691,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 3811164,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 3988365,
        "sampleChange": null
      }
    }
  ]
}
```

## Decision A — round 1

- `firstFailingHop`: `HOP1_TAB`
- `HOP8.quoteChanges60s`: `0`
- `HOP8.quoteChanges300s`: `0`
- Authority: `ACTIVE`
- Baseline age: `null`
- Recovery: `HARD`, attempt `2`, state/reason `HARD_RECOVERY/RECOVERY_HARD`

## Branch B — hypothesis H1, RED, minimal fix

- Hypothesis: H1 — late attachment receives no lifecycle `OPEN`; stable full-page DOM quorum was emitted only as a delta and could not establish a baseline.
- RED command: `node scripts/replay-capture.mjs --capture <existing SABA capture> --provider SABA --assert-semantic-changes 5`
- RED result: `envelopes=97`, `baselines=0`, `deltas=0`, `semanticChanges=0`, exit `1`.
- Minimal fix: mark a stable two-generation DOM quorum as an authoritative baseline only while no socket baseline is ready. DOM after socket bootstrap remains delta evidence.
- Focused tests: `2` files passed, `40/40` tests passed.
- API workspace typecheck: passed.
- Replay after fix: `envelopes=97`, `baselines=0`, `deltas=0`, `semanticChanges=0`, exit `1`.
- Decision: `LOCAL_GREEN` forbidden; branch D round 2 required.

## Diagnostic round 2 — full output

Command: `node scripts/diag-pipeline.mjs SABA 180`

```json
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663813818,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4017824
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 821788,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 822414,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4050887,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4228088,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663818836,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4022842
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 826806,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 827432,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4055905,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4233106,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663823842,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4027848
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 831812,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 832438,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4060911,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4238112,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663828859,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4032865
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 836829,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 837455,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4065928,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4243129,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663833871,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4037877
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 841841,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 842467,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4070940,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4248141,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663838882,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4042888
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 846852,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 847478,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4075951,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4253152,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663843889,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4047895
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 851859,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 852485,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4080958,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4258159,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663848892,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4052898
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 856862,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 857488,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4085961,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4263162,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663853903,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4057909
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 861873,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 862499,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4090972,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4268173,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663858906,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4062912
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 866876,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 867502,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4095975,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4273176,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663863922,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4067928
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 871892,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 872518,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4100991,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4278192,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663868936,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4072942
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 876906,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 877532,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4106005,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4283206,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663873944,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4077950
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 881914,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 882540,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4111013,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4288214,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663878959,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4082965
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 886929,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 887555,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4116028,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4293229,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663883964,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4087970
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 891934,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 892560,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4121033,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4298234,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663888980,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4092986
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 896950,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 897576,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4126049,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4303250,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663893995,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4098001
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 901965,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 902591,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4131064,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4308265,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663899011,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4103017
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 906981,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 907607,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4136080,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4313281,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663904017,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4108023
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 911987,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 912613,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4141086,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4318287,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663909032,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4113038
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 917002,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 917628,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4146101,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4323302,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663914044,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4118050
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 922014,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 922640,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4151113,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4328314,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663919054,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4123060
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 927024,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 927650,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4156123,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4333324,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663924059,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4128065
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 932029,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 932655,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4161128,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4338329,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663929076,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4133082
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 937046,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 937672,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4166145,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4343346,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663934092,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4138098
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 942062,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 942688,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4171161,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4348362,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663939106,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4143112
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 947076,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 947702,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4176175,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4353376,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663944114,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4148120
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 952084,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 952710,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4181183,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4358384,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663949123,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4153129
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 957093,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 957719,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4186192,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4363393,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663954135,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4158141
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 962105,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 962731,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4191204,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4368405,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663959148,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4163154
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 967118,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 967744,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4196217,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4373418,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663964152,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4168158
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 972122,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 972748,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4201221,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4378422,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663969164,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4173170
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 977134,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 977760,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4206233,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4383434,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663974181,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4178187
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 982151,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 982777,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4211250,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4388451,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663979195,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4183201
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 987165,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 987791,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4216264,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4393465,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663984204,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4188210
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 992174,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 992800,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4221273,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4398474,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787663989213,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:92",
        "attachedForMs": 4193219
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 997183,
        "lastSequence": 5409,
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
        "lastDecodedAgeMs": 997809,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4226282,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4403483,
        "sampleChange": null
      }
    }
  ]
}
```

## Decision A — round 2

- `firstFailingHop`: `HOP1_TAB`
- `HOP8.quoteChanges60s`: `0`
- `HOP8.quoteChanges300s`: `0`
- Authority: `ACTIVE`
- Baseline age: `null`
- Recovery: `HARD`, attempt `2`, state/reason `HARD_RECOVERY/RECOVERY_HARD`

## BLOCKED

- Status: `BLOCKED`
- Reason: after two 180-second diagnostic rounds, HOP8 remained at zero and no current baseline/evidence was established.
- Round 2 also had no envelopes in the five-minute telemetry window, so the whitelist-only adapter fix could not be exercised by the running stack.
- Replay after the single H1 fix still returned `semanticChanges=0`; therefore `LOCAL_GREEN SABA` is forbidden.

---

## Current run — GATE 0

```json
{"sources":[{"lobby":"CMD","sourceId":"chrome:CMD:2105815648","tabId":2105815648,"state":"LIVE","lastSequence":61,"lastAcceptedAtMs":1787664217984,"reason":null,"authorityDisposition":"ACTIVE"},{"lobby":"IM","sourceId":"chrome:IM:2105815596","tabId":2105815596,"state":"LIVE","lastSequence":453,"lastAcceptedAtMs":1787664213945,"reason":null,"authorityDisposition":"ACTIVE"},{"lobby":"SABA","sourceId":"chrome:SABA:2105815586","tabId":2105815586,"state":"LIVE","lastSequence":164,"lastAcceptedAtMs":1787664219036,"reason":null,"authorityDisposition":"CANDIDATE"},{"lobby":"KSPORT","sourceId":"chrome:KSPORT:2105815583","tabId":2105815583,"state":"LIVE","lastSequence":48,"lastAcceptedAtMs":1787664217720,"reason":null,"authorityDisposition":"CANDIDATE"},{"lobby":"TSPORT","sourceId":"chrome:TSPORT:2105815593","tabId":2105815593,"state":"LIVE","lastSequence":28,"lastAcceptedAtMs":1787664217936,"reason":null,"authorityDisposition":"CANDIDATE"},{"lobby":"BTI","sourceId":"chrome:BTI:2105815599","tabId":2105815599,"state":"LIVE","lastSequence":1226,"lastAcceptedAtMs":1787664219035,"reason":null,"authorityDisposition":"ACTIVE"}]}
```

- GATE 0: passed; SABA source exists.

## Current run — INVESTIGATED

- Status: `INVESTIGATED`
- Ground truth: Socket.IO; schema `f` động; odds partition `b14`; baseline `reset` … `done`.
- Existing sanitized evidence: `.run/realtime/saba/investigated.json`.
- CDP 9333 status: `000`; no new capture was recorded.

## Current run — diagnostic full output

Command: `node scripts/diag-pipeline.mjs SABA 180`

```json
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664255432,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 139711
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1714,
        "lastSequence": 218,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 147,
          "DOM_SNAPSHOT": 30,
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
        "decoded": 12,
        "ignored": 172,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 4,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 25413,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4492501,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4669702,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664260453,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 144732
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 728,
        "lastSequence": 241,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 163,
          "DOM_SNAPSHOT": 34,
          "TAB_STATE": 36
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
        "ignored": 192,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 5,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 934,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4497522,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4674723,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664265466,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 149745
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 2584,
        "lastSequence": 249,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 166,
          "DOM_SNAPSHOT": 38,
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
        "decoded": 15,
        "ignored": 198,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 5,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 3310,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4502535,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4679736,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664270480,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 154759
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 765,
        "lastSequence": 251,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 166,
          "DOM_SNAPSHOT": 38,
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
        "decoded": 15,
        "ignored": 198,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 5,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 8324,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4507549,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4684750,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664275493,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 159772
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1767,
        "lastSequence": 262,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 176,
          "DOM_SNAPSHOT": 38,
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
        "decoded": 15,
        "ignored": 208,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 5,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 13337,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4512562,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4689763,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664280510,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 164789
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 232,
        "lastSequence": 271,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 183,
          "DOM_SNAPSHOT": 38,
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
        "decoded": 15,
        "ignored": 215,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 5,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 18354,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4517579,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4694780,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664285521,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 169800
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 5243,
        "lastSequence": 271,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 183,
          "DOM_SNAPSHOT": 38,
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
        "decoded": 15,
        "ignored": 215,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 5,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 23365,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4522590,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4699791,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664290537,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 174816
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 71,
        "lastSequence": 296,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 198,
          "DOM_SNAPSHOT": 44,
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
        "decoded": 18,
        "ignored": 235,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 6,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 71,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4527606,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4704807,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664295555,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 179834
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 2747,
        "lastSequence": 306,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 204,
          "DOM_SNAPSHOT": 47,
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
        "decoded": 19,
        "ignored": 243,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 6,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 3743,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4532624,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4709825,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664300560,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 184839
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 136,
        "lastSequence": 310,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 206,
          "DOM_SNAPSHOT": 47,
          "TAB_STATE": 47
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
        "ignored": 245,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 6,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 8748,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4537629,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4714830,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664305573,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 189852
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1856,
        "lastSequence": 317,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 212,
          "DOM_SNAPSHOT": 47,
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
        "decoded": 19,
        "ignored": 251,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 6,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 13761,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4542642,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4719843,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664310577,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 194856
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 861,
        "lastSequence": 325,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 219,
          "DOM_SNAPSHOT": 47,
          "TAB_STATE": 49
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
        "ignored": 258,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 6,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 18765,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4547646,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4724847,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664315584,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 199863
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 3867,
        "lastSequence": 326,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 219,
          "DOM_SNAPSHOT": 47,
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
        "decoded": 19,
        "ignored": 258,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 6,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 23772,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4552653,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4729854,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664320599,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 204878
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 413,
        "lastSequence": 349,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 235,
          "DOM_SNAPSHOT": 50,
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
        "decoded": 21,
        "ignored": 277,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 7,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 801,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4557668,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4734869,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664325607,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 209886
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1239,
        "lastSequence": 357,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 239,
          "DOM_SNAPSHOT": 53,
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
        "decoded": 22,
        "ignored": 283,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 7,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 1498,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4562676,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4739877,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664330613,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 214892
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 886,
        "lastSequence": 359,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 239,
          "DOM_SNAPSHOT": 53,
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
        "decoded": 22,
        "ignored": 283,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 7,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 6504,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4567682,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4744883,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664335625,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 219904
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 3548,
        "lastSequence": 366,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 246,
          "DOM_SNAPSHOT": 53,
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
        "decoded": 22,
        "ignored": 290,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 7,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 11516,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4572694,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4749895,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664340637,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 224916
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 214,
        "lastSequence": 375,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 253,
          "DOM_SNAPSHOT": 53,
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
        "decoded": 22,
        "ignored": 297,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 7,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 16528,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4577706,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4754907,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664345651,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 229930
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 3777,
        "lastSequence": 376,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 253,
          "DOM_SNAPSHOT": 53,
          "TAB_STATE": 58
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
        "ignored": 297,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 7,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 21542,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4582720,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4759921,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664350653,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 234932
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 864,
        "lastSequence": 395,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 266,
          "DOM_SNAPSHOT": 56,
          "TAB_STATE": 60
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
        "ignored": 313,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 7,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 1616,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4587722,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4764923,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664355664,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 239943
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 266,
        "lastSequence": 417,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 280,
          "DOM_SNAPSHOT": 62,
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
        "decoded": 26,
        "ignored": 331,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 8,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 1648,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4592733,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4769934,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664360670,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 244949
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 951,
        "lastSequence": 420,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 281,
          "DOM_SNAPSHOT": 62,
          "TAB_STATE": 63
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
        "decoded": 26,
        "ignored": 332,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 8,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 6654,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4597739,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4774940,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664365682,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 249961
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1015,
        "lastSequence": 429,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 290,
          "DOM_SNAPSHOT": 62,
          "TAB_STATE": 63
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
        "decoded": 26,
        "ignored": 341,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 8,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 11666,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4602751,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4779952,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664370686,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 254965
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 959,
        "lastSequence": 431,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 290,
          "DOM_SNAPSHOT": 62,
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
        "decoded": 26,
        "ignored": 341,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 8,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 16670,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4607755,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4784956,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664375700,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 259979
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1999,
        "lastSequence": 442,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 300,
          "DOM_SNAPSHOT": 62,
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
        "decoded": 26,
        "ignored": 351,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 8,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 21684,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4612769,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4789970,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664380714,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 264993
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 995,
        "lastSequence": 444,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 300,
          "DOM_SNAPSHOT": 62,
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
        "decoded": 26,
        "ignored": 351,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 8,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 26698,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4617783,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4794984,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664385726,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 270005
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 36,
        "lastSequence": 475,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 322,
          "DOM_SNAPSHOT": 68,
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
        "decoded": 29,
        "ignored": 378,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 9,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 1084,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4622795,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4799996,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664390741,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 275020
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 131,
        "lastSequence": 488,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 328,
          "DOM_SNAPSHOT": 74,
          "TAB_STATE": 70
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
        "ignored": 388,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 9,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 2539,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4627810,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4805011,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664395743,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 280022
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1987,
        "lastSequence": 489,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 328,
          "DOM_SNAPSHOT": 74,
          "TAB_STATE": 71
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
        "ignored": 388,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 9,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 7541,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4632812,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4810013,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664400759,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 285038
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1009,
        "lastSequence": 497,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 334,
          "DOM_SNAPSHOT": 74,
          "TAB_STATE": 73
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
        "ignored": 394,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 9,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 12557,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4637828,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4815029,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664405764,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 290043
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 48,
        "lastSequence": 498,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 334,
          "DOM_SNAPSHOT": 74,
          "TAB_STATE": 74
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
        "ignored": 394,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 9,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 17562,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4642833,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4820034,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664410768,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 295047
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1046,
        "lastSequence": 509,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 344,
          "DOM_SNAPSHOT": 74,
          "TAB_STATE": 73
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
        "ignored": 404,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 9,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 22566,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4647837,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4825038,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664415779,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 300058
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 590,
        "lastSequence": 525,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 355,
          "DOM_SNAPSHOT": 77,
          "TAB_STATE": 74
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
        "decoded": 32,
        "ignored": 418,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 9,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 590,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4652848,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4830049,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664420787,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 305066
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 813,
        "lastSequence": 543,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 367,
          "DOM_SNAPSHOT": 80,
          "TAB_STATE": 73
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
        "decoded": 34,
        "ignored": 432,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 10,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 813,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4657856,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4835057,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664425800,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 310079
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 142,
        "lastSequence": 552,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 372,
          "DOM_SNAPSHOT": 83,
          "TAB_STATE": 74
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
        "decoded": 35,
        "ignored": 439,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 10,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 1862,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4662869,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4840070,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SABA:FOOTBALL",
  "lobby": "SABA",
  "nowMs": 1787664430812,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:3",
        "attachedForMs": 315091
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1086,
        "lastSequence": 560,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 367,
          "DOM_SNAPSHOT": 78,
          "TAB_STATE": 73
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
        "decoded": 34,
        "ignored": 429,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 9,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 4832,
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
        "activeGeneration": null,
        "baselineAgeMs": null,
        "maxBaselineAgeMs": 60000,
        "evidenceAgeMs": null,
        "expectedEvidenceCadenceMs": 10000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 6,
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
        "revision": "0EX0VT3Nnv3epBhO89tvSsrqsY6B3HQKx-oxkfsrYQ8",
        "catalogAgeMs": 4667881,
        "events": 296,
        "markets": 1005,
        "quotes": 2010
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 4845082,
        "sampleChange": null
      }
    }
  ]
}
```

## Current run — Decision A

- `firstFailingHop`: `HOP1_TAB`
- `HOP8.quoteChanges60s`: `0`
- `HOP8.quoteChanges300s`: `0`
- Authority: `ACTIVE`
- `baselineAgeMs`: `null`

## BLOCKED_ENV

- Status: `BLOCKED_ENV`
- GATE 0 initially contained source `chrome:SABA:2105815586`, but the 180-second diagnostic reported `HOP1_TAB.detail.sourceId=null` and `tabId=null`.
- HOP6 reported `lastFailureCode=AUTH_EGRESS_UNAVAILABLE`.
- These are mandatory branch D environment-failure signals. No RED or code change was made in this run.

---

## H1/H3 authority run — diagnostic before fix

Command: `node scripts/diag-pipeline.mjs SABA 120`

```json
{
  "nowMs": 1787665391746,
  "HOP3_ENVELOPE": {
    "ok": true,
    "detail": {
      "lastEnvelopeAgeMs": 2029,
      "lastSequence": 2404,
      "byTransport": { "HTTP_RESPONSE": 0, "WS_FRAME": 381, "DOM_SNAPSHOT": 87, "TAB_STATE": 73 },
      "rejected": { "SEQUENCE_GAP": 0, "RETIRED_EPOCH": 0, "TOO_OLD": 0 }
    }
  },
  "HOP4_ADAPTER": {
    "ok": true,
    "detail": {
      "decoded": 32,
      "ignored": 456,
      "rejectReasons": { "PROVIDER_STREAM_GAP": 0, "SCHEMA_CHANGED": 10, "PRE_BASELINE": 0 },
      "lastDecodedAgeMs": 5850,
      "forcedUnlocks": 0
    }
  },
  "HOP5_AUTHORITY": { "ok": true, "detail": { "authorityDisposition": "ACTIVE" } },
  "HOP6_FEED": {
    "ok": false,
    "detail": {
      "state": "HARD_RECOVERY",
      "reason": "RECOVERY_HARD",
      "activeGeneration": null,
      "baselineAgeMs": null,
      "maxBaselineAgeMs": 60000,
      "evidenceAgeMs": null,
      "expectedEvidenceCadenceMs": 10000,
      "observedEvidenceCadenceMs": { "p50": null, "p95": null, "samples": 0 },
      "recoveryStage": "HARD",
      "recoveryAttempt": 2,
      "consecutiveFailures": 6,
      "nextAttemptInMs": 0,
      "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
    }
  }
}
```

- HOP8: `quoteChanges60s=0`, `quoteChanges300s=0`, `sampleChange=null`.
- Chặng hỏng thật đầu tiên: `HOP5_AUTHORITY` — source truth là `CANDIDATE`; không có baseline để thăng `ACTIVE`. HOP1 null bị bỏ qua theo bẫy telemetry; HOP5 detail `ACTIVE` không khớp source truth trong trạng thái này.

## H1 RED and minimal fix

- Hypothesis: H1 — a late attachment does not observe `webSocketCreated`, so the adapter receives `reset/data/done` without a preceding `OPEN` and never marks the complete snapshot authoritative.
- RED: `authorizes a complete late-attached baseline without a preceding OPEN` failed because the returned catalog had no `authoritativeBaseline`, `evidenceMode`, or `provenance`.
- Minimal fix: when the current non-retired stream completes a decoded full snapshot, establish its authoritative generation without requiring an earlier `OPEN`. Delta-only and retired streams remain non-authoritative.
- Focused tests: `2` files passed, `41/41` tests passed.
- API workspace typecheck: passed.

## Live diagnostic after fix

Command: `node scripts/diag-pipeline.mjs SABA 120`

```json
{
  "nowMs": 1787665687674,
  "HOP3_ENVELOPE": {
    "ok": true,
    "detail": {
      "lastEnvelopeAgeMs": 5281,
      "lastSequence": 2971,
      "byTransport": { "HTTP_RESPONSE": 0, "WS_FRAME": 396, "DOM_SNAPSHOT": 81, "TAB_STATE": 72 },
      "rejected": { "SEQUENCE_GAP": 0, "RETIRED_EPOCH": 0, "TOO_OLD": 0 }
    }
  },
  "HOP4_ADAPTER": {
    "ok": true,
    "detail": {
      "decoded": 34,
      "ignored": 461,
      "rejectReasons": { "PROVIDER_STREAM_GAP": 0, "SCHEMA_CHANGED": 9, "PRE_BASELINE": 0 },
      "lastDecodedAgeMs": 5281,
      "forcedUnlocks": 0
    }
  },
  "HOP5_AUTHORITY": { "ok": true, "detail": { "authorityDisposition": "ACTIVE" } },
  "HOP6_FEED": {
    "ok": false,
    "detail": {
      "state": "HARD_RECOVERY",
      "reason": "RECOVERY_HARD",
      "activeGeneration": null,
      "baselineAgeMs": null,
      "maxBaselineAgeMs": 60000,
      "evidenceAgeMs": null,
      "expectedEvidenceCadenceMs": 10000,
      "observedEvidenceCadenceMs": { "p50": null, "p95": null, "samples": 0 },
      "recoveryStage": "HARD",
      "recoveryAttempt": 2,
      "consecutiveFailures": 6,
      "nextAttemptInMs": 0,
      "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
    }
  },
  "HOP8_SEMANTIC": {
    "ok": false,
    "detail": {
      "quoteChanges60s": 0,
      "quoteChanges300s": 0,
      "lastSemanticChangeAgeMs": 6101944,
      "sampleChange": null
    }
  }
}
```

## LOCAL_GREEN_PENDING_DEPLOY

- Status: `LOCAL_GREEN_PENDING_DEPLOY`
- Reason: the H1 RED is GREEN and focused tests/typecheck pass, but live `quoteChanges60s` remains `0` because build/restart are forbidden and the running stack does not contain this code fix.

---

## Deploy run — diagnostic before deploy

Command: `node scripts/diag-pipeline.mjs SABA 120`

```json
{
  "nowMs": 1787667550572,
  "HOP3_ENVELOPE": {
    "ok": true,
    "detail": {
      "lastEnvelopeAgeMs": 160,
      "lastSequence": 6773,
      "byTransport": { "HTTP_RESPONSE": 0, "WS_FRAME": 387, "DOM_SNAPSHOT": 91, "TAB_STATE": 75 },
      "rejected": { "SEQUENCE_GAP": 0, "RETIRED_EPOCH": 0, "TOO_OLD": 0 }
    }
  },
  "HOP4_ADAPTER": {
    "ok": true,
    "detail": {
      "decoded": 33,
      "ignored": 465,
      "rejectReasons": { "PROVIDER_STREAM_GAP": 0, "SCHEMA_CHANGED": 10, "PRE_BASELINE": 0 },
      "lastDecodedAgeMs": 2483,
      "forcedUnlocks": 1
    }
  },
  "HOP5_AUTHORITY": { "ok": true, "detail": { "authorityDisposition": "ACTIVE" } },
  "HOP6_FEED": {
    "ok": false,
    "detail": {
      "state": "HARD_RECOVERY",
      "reason": "RECOVERY_HARD",
      "activeGeneration": null,
      "baselineAgeMs": null,
      "maxBaselineAgeMs": 60000,
      "evidenceAgeMs": null,
      "expectedEvidenceCadenceMs": 10000,
      "observedEvidenceCadenceMs": { "p50": null, "p95": null, "samples": 0 },
      "recoveryStage": "HARD",
      "recoveryAttempt": 2,
      "consecutiveFailures": 6,
      "nextAttemptInMs": 0,
      "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
    }
  }
}
```

- HOP8 before deploy: `quoteChanges60s=0`, `quoteChanges300s=0`, `sampleChange=null`.
- Chặng hỏng thật: `HOP5_AUTHORITY` — frames and adapter decoding are live, but the source remains `CANDIDATE` and HOP6 has no active generation or baseline.

## H1 guard and RED

- `saba-ws-adapter.ts:173-192`: only observed `OPEN` set `authorizing=true`.
- `saba-ws-adapter.ts:214-219`: a frame-first late attachment seeded its stream with `authorizing=false`.
- Old baseline gate was at `saba-ws-adapter.ts:297-308`; the minimal adoption fix is now at lines `297-304` and only activates after `applied.fullSnapshot`.
- RED test: `authorizes a complete late-attached baseline without a preceding OPEN`.
- RED result before the fix: failed because valid `reset → data → done` returned a catalog without `authoritativeBaseline`, `evidenceMode`, or `provenance`.
- H2 was not triggered by this RED; no H2 change was made.

## H1 deploy and live round 1

- `npm.cmd run build`: PASS.
- `restart-live-stack.mjs` exhausted 10 lease retries, then the authorized SABA lease path reached `STACK_INSTANCE_DISCOVERY_UNAVAILABLE`.
- `exact-v2-stack-handoff.mjs` completed under the SABA deployment lease; all 6 lobby sources returned.
- Post-deploy `diag-pipeline.mjs SABA 120` ended early at 55.7 seconds with `fetch failed`. Before that transport failure, HOP3 continued receiving frames, HOP4 decoded frames, HOP5 reported `ACTIVE`, HOP6 remained `SOFT_RECOVERY` with `activeGeneration=null` and `baselineAgeMs=null`, and HOP8 remained `quoteChanges60s=0`, `quoteChanges300s=0`.

## H3 RED and minimal fix

- Remaining first failing stage: HOP6 authority evidence. After a revision/schema/A003 failure, the adapter cleared `activeStreamId` and `activeStreamOrdinal`; the frame guard then rejected a complete replacement baseline arriving on the same already-running socket, so authority had no recovery path without another `OPEN`.
- RED: `re-baselines the current running stream after a revision gap without another OPEN` failed because the valid same-stream `reset -> data -> done` sequence returned `[]` instead of an authoritative baseline.
- Minimal fix at `saba-ws-adapter.ts:220-236`: when authority is cleared, provisionally re-adopt the current-or-newer stream only if its incoming frame starts a baseline with `reset` or `empty`. Delta-only frames remain rejected. The existing full-snapshot gate at `saba-ws-adapter.ts:314-320` is still the only point that commits authority.
- H2 was not proven by the RED and was not changed.
- Focused SABA tests: PASS, 41/41.
- `@tool-chenh/api` typecheck: PASS.
- `@tool-chenh/adapters` typecheck: PASS.

## Deploy round 3 and final live measurements

- Build: PASS.
- Deployment identity: `sha256:cf90d0f489457a30fc3be3a95299dcb6faa2d7cf0ea91f95dc256a56d687bfa5`; lease released; 6/6 lobby sources present.
- First two attempts to start the 120-second diagnostic failed at 20.6 seconds and 5.8 seconds with `fetch failed`; neither incomplete attempt was treated as a measurement round.

### Completed 120-second diagnostic

- 24 snapshots over 115315 ms.
- HOP3 final: `WS_FRAME=239`, `DOM_SNAPSHOT=22`, `TAB_STATE=23`, `lastEnvelopeAgeMs=1418`, rejected `SEQUENCE_GAP=2`, `RETIRED_EPOCH=0`, `TOO_OLD=0`.
- HOP4 final: `decoded=20`, `ignored=248`, rejects `PROVIDER_STREAM_GAP=0`, `SCHEMA_CHANGED=3`, `PRE_BASELINE=0`, `lastDecodedAgeMs=57771`, `forcedUnlocks=10`.
- HOP5 final: `authorityDisposition=ACTIVE`.
- HOP6 final: `HARD_RECOVERY/RECOVERY_HARD`, `activeGeneration=null`, `baselineAgeMs=null`, cadence `p50=1214`, `p95=63719`, `samples=13`, `lastFailureCode=AUTH_EGRESS_UNAVAILABLE`.
- HOP8: 19/24 snapshots had `quoteChanges60s>0`; maximum `quoteChanges60s=21`, maximum `quoteChanges300s=21`.
- Real price changes observed in this window:
  - `SABA:132692863:1049841609:1049841609:home`: `0.72 -> 0.75`.
  - `SABA:132919052:1051987670:1051987670:home`: `-1 -> 1`.

### Completed 600-second diagnostic

- Command completed normally: 120 snapshots over 596319 ms.
- Real first failing stage was `HOP6_FEED` in 120/120 snapshots; `HOP6_FEED.ok` was 0/120.
- Positive 60-second windows: 0/10. Every window had maximum `quoteChanges60s=0`.
- Maximum `quoteChanges300s=21`, inherited from the earlier change; the final snapshot had `quoteChanges60s=0`, `quoteChanges300s=0`, and `lastSemanticChangeAgeMs=682812`.
- Final HOP3: `WS_FRAME=396`, `DOM_SNAPSHOT=72`, `TAB_STATE=74`, `lastEnvelopeAgeMs=3312`, and all transport rejects were 0.
- Final HOP4: `decoded=21`, `ignored=459`, all adapter reject counters were 0, `lastDecodedAgeMs=35116`, `forcedUnlocks=14`.
- Final HOP5: `authorityDisposition=ACTIVE`.
- Final HOP6: `HARD_RECOVERY/RECOVERY_HARD`, `activeGeneration=null`, `baselineAgeMs=null`, `evidenceAgeMs=null`, `lastFailureCode=AUTH_EGRESS_UNAVAILABLE`.
- Observed cadence p95 ranged from 2349 ms to 63719 ms; only 4/41 populated snapshots were at or below the proposed SABA SLA of 10000 ms. The proposed SLA is therefore not met.
- Third distinct real change observed across the live measurements: `SABA:132919052:1051987589:1051987589:home`, `-0.9 -> -0.88`.

### Six-lobby post-deploy table

| Lobby | State | Authority | Regressed from pre-round-3 state |
|---|---|---|---|
| CMD | LIVE | ACTIVE | No |
| IM | LIVE | ACTIVE | No |
| SABA | LIVE | CANDIDATE | No; still the remaining failure |
| KSPORT | LIVE | CANDIDATE | No |
| TSPORT | LIVE | CANDIDATE | No |
| BTI | LIVE | ACTIVE | No |

## Maximum rounds reached

- Three implementation/deploy rounds were completed. No fourth hypothesis or fix was attempted.
- Remaining true failing stage: `HOP6_FEED`. Frames continue through HOP3 and HOP4, and the partition-scope fix removed schema rejects in the final 600-second window, but no active generation/baseline survives at HOP6.
- `PROVISIONAL_ACCEPTANCE SABA` is not recorded because the 10-minute criteria failed.
- `READY_FOR_24H_SOAK SABA` is not recorded; the 30-minute stability phase was not started.
- `USER_CHECK_PENDING` — manual comparison of three bets remains pending.

## H3 deploy round 2 and failed 600-second acceptance

- Deployment identity: `sha256:98fb49450ad8574b44d41f9a0babe5d73a181652734f5351395d86f53ab2d43c`; lease released; 6 lobby sources present.
- Live 120-second diagnostic produced real HOP8 evidence: `quoteChanges60s=2`, `quoteChanges300s=2`, selection `SABA:132919052:1051987589:1051987589:home`, before `-0.9`, after `-0.88`.
- Authority did not remain stable: later samples returned to `HOP6_FEED`, `activeGeneration=null`, `baselineAgeMs=null`, and `quoteChanges60s=0`.
- The required 600-second diagnostic aborted after 325784 ms because the diagnostic fetch failed. It captured 66 snapshots; 0/66 had `firstFailingHop=null`, 0/6 observed 60-second bins had `quoteChanges60s>0`, maximum `quoteChanges300s=2`, and observed cadence p95 ranged from 1808 ms to 22496 ms. This is not acceptance evidence.

## H3 partition-scope RED and final minimal fix

- Existing late-attach capture evidence contains 43 structurally valid SABA frames from `b11`, `b0`, and `b13` that arrive without a field table or baseline. Each currently reaches `SABA_PUSH_SCHEMA_CHANGED:INVALID`; these partitions never owned an authoritative catalog.
- RED: after an authoritative `b14` baseline, an undecodable delta from never-ready `b21` returned a global `SCHEMA_CHANGED` invalidation instead of `[]` and prevented the next valid `b14` delta.
- Minimal fix at `saba-ws-adapter.ts:239-243,354-356`: schema/revision faults may retire authority only when the faulting partition previously completed a baseline. Whole-frame parse faults and malformed baseline frames remain fail-closed.
- H2 remains dynamic-table based and was not changed.
- Focused SABA tests: PASS, 42/42.
- `@tool-chenh/api` typecheck: PASS.
- `@tool-chenh/adapters` typecheck: PASS.

## FINAL DISPOSITION AFTER ROUND 3

- Code/test state: focused SABA tests `42/42` PASS; API and adapters typecheck PASS; build PASS; deployment identity `sha256:cf90d0f489457a30fc3be3a95299dcb6faa2d7cf0ea91f95dc256a56d687bfa5` released successfully.
- Live 120-second evidence: maximum `quoteChanges60s=21`; real changes included `0.72 -> 0.75` and `-1 -> 1`.
- Live 600-second evidence: `HOP6_FEED` failed 120/120 snapshots, positive windows `0/10`, final `quoteChanges60s=0`, `activeGeneration=null`, `baselineAgeMs=null`.
- Six lobbies remained present with no state regression attributable to the deploy.
- Maximum three rounds reached. Remaining true failing stage: `HOP6_FEED`.
- Acceptance and soak labels are intentionally absent because their gates were not met.
- `USER_CHECK_PENDING`.

## Unbounded loop — policy round A

- Adapter emits a WS generation at `saba-ws-adapter.ts:314-347`. The data plane counts the adapter decode first at `chrome-catalog-data-plane.ts:208-213`, then validates generation at lines `275-304`, and only commits catalog evidence to the feed registry at lines `310-313`. Therefore `decoded>0` can coexist with `activeGeneration=null` whenever the decoded update has not reached or survived the registry baseline commit.
- The registry stores the generation through `ProviderFeedController.#acceptCatalog` at `provider-feed-controller.ts:192-205`. It clears the authoritative catalog, baseline timestamp, and generation in `#invalidate` at lines `222-239`, after the data plane accepts an adapter invalidation at `chrome-catalog-data-plane.ts:227-240`.
- `forcedUnlocks` is emitted by the extension poller at `cmd-snapshot-poller.ts:295-310`: a maintenance/catalog/capture work-item guard exceeds its timeout, so the poller deletes the owner and active work token. It is a consequence of recovery churn, not the cause of lost feed generation.
- The ACTIVE/CANDIDATE oscillation is also a consequence: after the feed stalls, recovery introduces a newer connection/source epoch which must prove a baseline before promotion.
- Chosen single cause: SABA policy uses `expectedEvidenceCadenceMs=10000`, `softRecoveryAfterMs=20000`, `hardRecoveryAfterMs=45000`, and `maxBaselineAgeMs=60000`, while measured SABA evidence p95 reaches 69600 ms and the provider normally sends one bootstrap baseline followed by deltas. The policy initiates recovery and expires the generation despite continuing provider frames.
- Round result before deploy: RED failed on the first valid delta at 69600 ms (`accepted=false`). Minimal SABA-only lease fix sets evidence cadence to 75000 ms, soft/hard recovery to 90000/180000 ms, and the bounded bootstrap baseline lease to 3600000 ms in both feed policy and adapter retention. Focused tests PASS 68/68; API and adapters typecheck PASS.
- Deploy identity: `sha256:e62f2e4a72724476da53d6666c99177a73f13a834ec3ff8043aede744bc01606`; 6/6 sources present. Cross-provider regression immediately after deploy: CMD `LIVE`, generation present, `quoteChanges60s=228`; IM `LIVE`, generation present, `quoteChanges60s=46`; BTI `LIVE`, generation present, `quoteChanges60s=152`. No required control provider regressed.

## Unbounded loop — DOM bootstrap round B

- Policy round A did not establish a baseline: the 120-second diagnostic captured 24 snapshots over 115248 ms, with `HOP4=1`, `HOP5=23`, generation present `0/24`, positive `quoteChanges60s` snapshots `0/24`, and maximum `quoteChanges60s=0`. Final HOP3 was `WS_FRAME=191`, `DOM_SNAPSHOT=24`, `TAB_STATE=42`, `lastEnvelopeAgeMs=5816`; final HOP4 was `decoded=6`, `ignored=211`, schema/gap/pre-baseline rejects all `0`, `lastDecodedAgeMs=6602`, `forcedUnlocks=3`; HOP5 had no authority; HOP6 was `SOFT_RECOVERY`, `activeGeneration=null`, `baselineAgeMs=null`.
- Exact decoded-to-generation path: SABA WS baseline generation is emitted at `saba-ws-adapter.ts:319-321`; the data plane counts decoded evidence at `chrome-catalog-data-plane.ts:208-213`, validates/builds candidate proof at lines `275-303`, commits a candidate generation through `#promoteCandidate` and `feeds.accept(catalogEvidence)` at lines `407-467`, or commits active evidence at lines `311-313`. The feed controller records `activeGeneration` at `provider-feed-controller.ts:192-205`.
- Exact authority clearing path: accepted adapter invalidations flow through `chrome-catalog-data-plane.ts:227-240`; `ProviderFeedController.#invalidate` at `provider-feed-controller.ts:222-243` clears `activeGeneration` at line 238. The observed ACTIVE↔CANDIDATE transition follows that missing/cleared baseline during recovery.
- Exact forced unlock path remains `cmd-snapshot-poller.ts:295-310`: the work-item timeout removes the owner and active work token. It is a recovery consequence, not the selected cause.
- Chosen single cause for round B: a late-attached SABA source can have no usable socket reset/done bootstrap while complete DOM generations continue. The adapter requires two stable complete DOM generations, but the data plane previously rejected candidate `DOM_FALLBACK` evidence before candidate promotion, so no catalog baseline reached HOP6. `forcedUnlocks` and ACTIVE↔CANDIDATE are consequences.
- RED: `promotes a late-attached SABA candidate from two stable complete DOM generations` feeds two valid 20-event atomic DOM generations without OPEN/WS baseline. Before the fix, the second generation was rejected instead of producing `LIVE` with `activeGeneration=worker-a:0:dom:2`.
- Minimal SABA-only fix: preserve the adapter's two-generation/20-event quorum, permit its complete baseline through the candidate guards, accept `DOM_FALLBACK` as SABA feed authority, and supply the coordinator compatibility proof only for that SABA DOM baseline. Other providers retain their existing candidate DOM rejection.
- Focused verification: four files, `91/91` PASS. `@tool-chenh/api` typecheck PASS. `@tool-chenh/adapters` typecheck PASS.

### Round B live result

- Deployment identity `sha256:c8a326ecac113e8079c5b20c830a7390b9150de7d0f8b97d54d471b5e58cf0cf`; 6/6 sources reconnected.
- Required control regression immediately after deploy: CMD `LIVE`, generation present, `quoteChanges60s=154`; IM `LIVE`, generation present, `quoteChanges60s=110`; BTI `LIVE`, generation present, `quoteChanges60s=340`. SABA was `LIVE`, generation `...:dom:8`, `quoteChanges60s=104`.
- The first complete lease-protected 600-second run had 120 samples over 596226 ms, 10/10 positive 60-second windows, final `firstFailingHop=null`, HOP3 `WS_FRAME=363`, `DOM_SNAPSHOT=96`, HOP4 `decoded=31`, `ignored=445`, `forcedUnlocks=0`, HOP6 `LIVE` with generation `...:dom:333`, cadence p95 `30442 ms`, HOP8 `quoteChanges60s=348`, `quoteChanges300s=1829`. Only 118/120 samples had a generation because the first two samples caught bootstrap, so provisional acceptance was not recorded.
- A second stable-start 600-second run had 120 samples over 596163 ms. Window maxima were `460, 490, 522, 522, 436, 530, 0, 528, 528, 614`: 9/10 positive, but only 103/120 samples retained a generation. Final state recovered to `LIVE`, generation `...:dom:390`, cadence p95 `40398 ms`, `quoteChanges60s=358`, `quoteChanges300s=1404`.

## Unbounded loop — shadowed socket invalidation round C

- New evidence after the round-B generation gap: HOP3 recorded `SEQUENCE_GAP=1`; HOP4 recorded `SCHEMA_CHANGED=1`, `forcedUnlocks=3`; HOP6 later recovered to `LIVE` on DOM generation. This matches the 17 generation-null samples and the single zero-change minute.
- Chosen single cause: after a complete DOM fallback owns SABA authority, a malformed WS frame that has never established a WS baseline still emits `SCHEMA_CHANGED`; the data plane accepts it as a global invalidation and `ProviderFeedController.#invalidate` clears the unrelated active DOM generation. The forced unlock and authority recovery are consequences.
- RED: `keeps an active SABA DOM generation when a non-authoritative socket frame is malformed`. Two stable complete DOM generations establish `worker-a:0:dom:2`; OPEN plus a malformed non-authoritative socket frame then returned `true` and cleared the feed instead of being rejected while retaining the DOM generation.
- Minimal fix: when and only when the current SABA catalog basis is `DOM_FALLBACK`, a WS-frame `SCHEMA_CHANGED`/`PROVIDER_STREAM_GAP` invalidation is shadowed at the data-plane boundary. The adapter has already retired its malformed socket state, while the independent DOM baseline remains LIVE. WS-owned baselines and every other provider retain fail-closed invalidation.
- Focused verification: four files, `92/92` PASS. `@tool-chenh/api` typecheck PASS. `@tool-chenh/adapters` typecheck PASS.
- Deploy identity: `sha256:74f1f91aa6c2b6a85286722ad3de36a67343ff467fbe07fe709da34d83244946`; 6/6 sources present.
- Required post-deploy controls: CMD `LIVE`, generation present, `quoteChanges60s=110`; IM `LIVE`, generation present, `quoteChanges60s=93`; BTI `LIVE`, generation present, `quoteChanges60s=130`. SABA completed DOM bootstrap shortly afterward with generation `...:dom:128` and `quoteChanges60s=215`.

### Round D live result

- The current shared deployed identity after coordinated provider deploys was `sha256:6b11dfddeb8f7cd62cc1166282ef51256d720d0e23be31acdcfae29f570105a7`; it includes the shared workspace SABA artifacts.
- Acceptance-protected 120 seconds: 24/24 samples retained a generation and 24/24 had positive HOP8 changes (`34..642`). The final sample was `firstFailingHop=null`, HOP6 `LIVE`, generation `...:dom:257`, cadence p95 `20062 ms`, `quoteChanges60s=522`. The window included `SEQUENCE_GAP=1` and `SCHEMA_CHANGED=1` without losing the DOM generation.
- Acceptance-protected 600 seconds: 120 samples over 596197 ms; 10/10 positive windows with maxima `617, 629, 671, 521, 503, 592, 612, 517, 482, 514`. Generation was present in 117/120 samples, so continuous-generation acceptance was not recorded. Final: `firstFailingHop=null`, HOP3 `WS_FRAME=427`, `DOM_SNAPSHOT=93`, HOP4 `decoded=43`, `ignored=501`, `forcedUnlocks=0`, HOP6 `LIVE`, generation `...:dom:1575`, cadence p95 `21832 ms`, HOP8 `quoteChanges60s=318`, `quoteChanges300s=2193`.
- Three real changes from that 600-second window: `SABA:132848111:132848111__1055124529:132848111__1055124529:over`, `-0.85 -> -0.83`, latency `18246 ms`; `SABA:132848111:132848111__1051201465:132848111__1051201465:home`, `0.91 -> 0.93`, latency `4763 ms`; `SABA:132435383:132435383__1055242100:132435383__1055242100:home`, `-0.82 -> -0.83`, latency `3048 ms`.
- Immediate follow-up null-trace for 120 seconds had 24/24 non-null generations and no null sample to classify. A full 600-second reproduction with null-detail capture is required before another code hypothesis.
- The full null-detail 600-second reproduction retained generation in 120/120 samples, but the SABA bridge source disappeared during the window. Window maxima were `92, 0, 0, 0, 0, 0, 0, 0, 0, 0`; final telemetry was `HOP1_TAB`, HOP3 counters reset to zero, HOP6 retained the old generation in `HARD_RECOVERY`, and HOP8 was zero. This run is invalid for provisional acceptance and does not justify another HOP6 code change.
- After the source returned on a newer epoch, HOP3 immediately resumed (`WS_FRAME=74`, `DOM_SNAPSHOT=1`, last envelope age `3398 ms`) and HOP8 briefly showed `quoteChanges60s=296`, but the new epoch had not yet completed two DOM generations, so HOP6 remained without a new baseline. No tab or extension action was taken.
- The next source completed bootstrap during an acceptance-protected 120 seconds: generation 24/24, final `firstFailingHop=null`, HOP3 `WS_FRAME=192`, `DOM_SNAPSHOT=21`, HOP4 `decoded=12`, `ignored=208`, HOP6 `LIVE`, generation `...:dom:250`, HOP8 `quoteChanges60s=417`.
- The following 600 seconds had 10/10 positive windows with maxima `317, 250, 450, 461, 415, 529, 352, 352, 406, 180`, but only 118/120 generation samples. The source epoch changed from `...:168` before the run to `...:7` at the end while the acceptance lease prevented stack deployment. Final HOP6 recovered `LIVE`, final HOP8 `quoteChanges60s=180`.

## Unbounded loop — non-authoritative socket close round E

- Chosen single cause: an extension worker/source-epoch replacement closes the observed socket. Even when the active catalog basis is DOM and that socket never owned a catalog baseline, its `WS_STATE CLOSED` update becomes global `PROVIDER_STREAM_CLOSED`, clearing the independent DOM generation until the new epoch completes the two-generation DOM quorum.
- RED: `keeps an active SABA DOM generation when its non-authoritative socket closes`. After a two-generation DOM baseline and socket OPEN, CLOSED returned `true` and cleared `worker-a:0:dom:2`.
- Minimal fix: extend the existing SABA DOM invalidation shadow to `WS_STATE/PROVIDER_STREAM_CLOSED`. The adapter still retires the closed socket; WS-owned catalog baselines and every non-SABA provider retain fail-closed close behavior.
- Focused verification: four files, `93/93` PASS. `@tool-chenh/api` typecheck PASS. `@tool-chenh/adapters` typecheck PASS.
- Deploy identity: `sha256:ab26b3b3f844d69b28dc4ecd9c938695d561990a504e10575fc5e1f35f605266`; exactly 6 lobby sources present.
- Required controls after deploy: CMD `LIVE`, generation present, `quoteChanges60s=154`; IM `LIVE`, generation present, `quoteChanges60s=94`; BTI `LIVE`, generation present, `quoteChanges60s=141`. SABA was `LIVE`, generation `...:dom:59`, `quoteChanges60s=174`.

## PROVISIONAL_ACCEPTANCE SABA

- Round-E 120-second gate: 24/24 generation samples, final source epoch changed during the window without a generation gap; final HOP6 `LIVE`, `quoteChanges60s=194`.
- Acceptance-protected 600 seconds completed with 120 samples over 596237 ms and generation present in 120/120 samples.
- Ten 60-second window maxima: `150, 287, 335, 274, 326, 170, 292, 318, 348, 288`; positive windows `10/10`.
- Final HOP3: `WS_FRAME=372`, `DOM_SNAPSHOT=47`, `SEQUENCE_GAP=0`.
- Final HOP4: `decoded=21`, `ignored=411`, `SCHEMA_CHANGED=0`, `forcedUnlocks=0`.
- Final HOP6: `LIVE`, generation `a0291f41-bb51-4159-b588-57eb6500b40a:4:dom:29`, baseline age `51853 ms`, cadence p95 `36320 ms`.
- Final HOP8: `quoteChanges60s=128`, `quoteChanges300s=898`.
- Real change 1: `SABA:132435339:132435339__1055209899:132435339__1055209899:over`, `-0.36 -> -0.32`, observed latency `19767 ms`.
- Real change 2: same selection, `-0.32 -> -0.29`, observed latency `1278 ms`.
- Real change 3: same selection, `-0.25 -> -0.27`, observed latency `1404 ms`.
- `USER_CHECK_PENDING` — manual comparison of three bets remains the user's task.

## Soak stopped at user request

- The required `node scripts/diag-pipeline.mjs SABA 1800` soak was started under an acceptance lease and the lease was renewed successfully during the run.
- The user stopped further testing before the 1800-second command completed, so no completed 30-minute aggregate exists and `READY_FOR_24H_SOAK SABA` is intentionally not recorded.
- Cleanup after interruption: 2 diagnostic-related processes stopped, 1 SABA acceptance lease released, 0 SABA acceptance leases remain.
- Current valid disposition remains `PROVISIONAL_ACCEPTANCE SABA` based on the completed 600-second result above.
- `USER_CHECK_PENDING`.
- Deploy identity: `sha256:8b1e7f4178f008ca1ca0dc71d304f54f26bda19dae1fac7e03279e84363c0d39`; 6/6 lobby sources present.
- Required post-deploy regression: CMD `LIVE`, generation present, `quoteChanges60s=621`; IM `LIVE`, generation present, `quoteChanges60s=219`; BTI `LIVE`, generation present, `quoteChanges60s=503`. SABA started `LIVE`, generation `...:dom:818`, `quoteChanges60s=378`. No required control provider regressed.

### Round C live result

- First 120-second run: 24 samples, 23/24 with generation, 24/24 with positive `quoteChanges60s`, range `225..577`; final `firstFailingHop=null`, `sequenceGaps=0`, `schemaChanged=0`, HOP6 `LIVE`, cadence p95 `33720 ms`, `quoteChanges60s=419`.
- Null-trace 120-second run: exactly one generation-null sample, at sample index 21. It was `HOP6_FEED`, authority remained `ACTIVE`, feed was `SOFT_RECOVERY/RECOVERY_SOFT`, `SEQUENCE_GAP=0`, `SCHEMA_CHANGED=0`, `forcedUnlocks=8`, and HOP8 still had `quoteChanges60s=357`. The final sample recovered generation `...:dom:1494` and `quoteChanges60s=522`.

## Unbounded loop — DOM heartbeat liveness round D

- Chosen single cause: the active DOM generation can remain well inside its 3600000 ms baseline lease while no DOM snapshot is decoded for more than the 90000 ms soft-recovery threshold. Exact Engine.IO heartbeat frames are decoded as transport liveness only when a WS baseline exists, so a valid DOM-owned feed receives no authoritative liveness and recovery replaces/clears its generation. `forcedUnlocks` is again a consequence of that recovery.
- RED: the existing stable two-generation DOM bootstrap test now opens the observed socket and sends exact heartbeat `2`; before the fix the adapter returned `[]` instead of a `transportAlive=true` update.
- Minimal fix: heartbeat liveness may use the timestamp of the current ready DOM partition as its bounded baseline when no WS baseline timestamp exists. It still requires the exact current OPEN stream, exact Engine.IO heartbeat, current source/epoch, and a DOM baseline younger than 3600000 ms. It does not authorize a WS catalog delta or create a WS generation.
- Focused verification: four files, `92/92` PASS. `@tool-chenh/api` typecheck PASS. `@tool-chenh/adapters` typecheck PASS.
