# SBOBET / KSPORT realtime report

## INVESTIGATED — 2026-08-25

- CDP `127.0.0.1:9333` không sẵn; không ghi capture mới, không launch Chrome.
- Capture thật có sẵn: `capture-1787551154125.jsonl` đến `capture-1787551154128.jsonl`, tổng cộng 446 envelope `KSPORT / WS_FRAME`.
- Transport: STOMP trên SockJS trong OOPIF con.
- Có hai socket sportsbook `/sport/` đồng thời trên hai host `*.sb21.net`: socket chính 420 frame / 4.9 MB và socket song song 290 frame / 218 KB trong phép đo 150 giây.
- Destination đã xác nhận: `/topic/sports/1_11/today/ma/event/vi` (`subSportHotMatch`) và `/topic/sports/1_1/live/ma/event/vi` (`subSportBookLive`).
- `novoga.sb21.net` và `novoba.sb21.net` là nhiễu Volta không có path `/sport/`; predicate hiện tại loại đúng và không được nới.
- Frame là full snapshot lặp: năm frame liên tiếp có cùng nội dung snapshot, chỉ khác `message-id`; dedupe phải dựa trên nội dung.
- Tab được mapping vào lobby là `zenandfe.com`. Title thật không có trong capture hiện có và không thể đọc khi CDP không sẵn; không suy đoán title.

## DIAG ROUND 1 — full output

`node scripts/diag-pipeline.mjs SBOBET 180`

```json
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663450880,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 3978578
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 461051,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28660781,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663455894,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 3983592
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 466065,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28665795,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663460903,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 3988601
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 471074,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28670804,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663465919,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 3993617
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 476090,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28675820,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663470928,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 3998626
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 481099,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28680829,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663475937,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4003635
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 486108,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28685838,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663480953,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4008651
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 491124,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28690854,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663485962,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4013660
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 496133,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28695863,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663490966,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4018664
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 501137,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28700867,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663495970,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4023668
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 506141,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28705871,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663500977,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4028675
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 511148,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28710878,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663505989,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4033687
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 516160,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28715890,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663511005,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4038703
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 521176,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28720906,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663516013,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4043711
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 526184,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28725914,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663521020,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4048718
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 531191,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28730921,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663526028,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4053726
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 536199,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28735929,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663531030,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4058728
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 541201,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28740931,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663536040,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4063738
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 546211,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28745941,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663541055,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4068753
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 551226,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28750956,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663546060,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4073758
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 556231,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28755961,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663551065,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4078763
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 561236,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28760966,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663556068,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4083766
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 566239,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28765969,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663561077,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4088775
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 571248,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28770978,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663566091,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4093789
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 576262,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28775992,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663571106,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4098804
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 581277,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28781007,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663576116,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4103814
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 586287,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28786017,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663581123,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4108821
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 591294,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28791024,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663586129,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4113827
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 596300,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28796030,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663591145,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4118843
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 601316,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28801046,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663596155,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4123853
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 606326,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28806056,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663601162,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4128860
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 611333,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28811063,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663606165,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4133863
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 616336,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28816066,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663611169,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4138867
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 621340,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28821070,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663616181,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4143879
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 626352,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28826082,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663621187,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4148885
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 631358,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28831088,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787663626198,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:45",
        "attachedForMs": 4153896
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 636369,
        "lastSequence": 922,
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 28836099,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
```

## Shared fixes and live result — 2026-08-25 21:23–22:04 +07:00

### Changes applied

- Telemetry: `apps/api/src/server.ts` now supplies `pipelineDiagnostics` from
  `ChromeBridgeRegistry.listSources()`, so the live `CANDIDATE` KSPORT source is
  visible at HOP1 with its real `authorityDisposition`.
- Observer: every attached child OOPIF receives bounded `Network.enable`,
  `Runtime.enable`, recursive `Target.setAutoAttach` with `flatten: true` and
  `waitForDebuggerOnStart: true`, followed by `Runtime.runIfWaitingForDebugger`.
- Observer: after 5 seconds without a KSPORT catalog frame, the existing
  page-owned `/sport/` WebSocket is closed through `Runtime.evaluate` /
  `Runtime.queryObjects` so the application can reconnect. The predicate
  `isKsportCatalogSocket` was not widened; Volta hosts remain excluded.
- Observer round 3: startup explicitly discovers an already-running provider
  iframe with `Target.getTargets`, attaches it with `flatten: true`, enables the
  same child observation path, and applies the same no-frame watchdog even when
  Chrome emits no `Target.attachedToTarget` event.
- No SBOBET adapter/dedupe change was made: all live rounds remained at zero
  WS frames, before per-partition baseline or content dedupe could execute.

### RED / focused verification

- API RED: candidate HOP1 test initially failed because
  `pipelineDiagnosticSources` did not exist; after the fix,
  `apps/api/src/server.test.ts` passed `17/17`.
- Observer RED 1: child OOPIF had no recursive `Target.setAutoAttach` and no
  zero-frame reconnect; after the fix, the focused observer file passed.
- Observer RED 2: startup did not call `Target.attachToTarget` when auto-attach
  emitted no child event; after the fix, the focused observer file passed
  `210/210`.
- `@tool-chenh/api` typecheck: pass.
- `@tool-chenh/chrome-extension` typecheck: pass.
- Workspace build: pass.
- Extension bundle was reloaded from its existing Chrome extension-management
  tab. No sportsbook tab was reloaded, navigated, or closed.

### Three live rounds

| Round | Deployed observer path | HOP1 | HOP2 attachedForMs (last sample) | HOP3 byTransport (last sample) | HOP5 | HOP8 |
|---|---|---|---:|---|---|---|
| 1 | Recursive child auto-attach + zero-frame reconnect, before extension reload | `ok`, `CANDIDATE` | 239824 | HTTP 0, WS 0, DOM 0, TAB_STATE 104 | `NONE` | 60s 0, 300s 0 |
| 2 | Same fix after extension reload | `ok`, `CANDIDATE` | 242103 | HTTP 0, WS 0, DOM 0, TAB_STATE 105 | `NONE` | 60s 0, 300s 0 |
| 3 | Explicit startup discovery/attach + recursive observation + watchdog | `ok`, `CANDIDATE` | 200643 | HTTP 0, WS 0, DOM 0, TAB_STATE 88 | `NONE` | 60s 0, 300s 0 |

Final round details:

- `firstFailingHop: HOP4_ADAPTER` is the telemetry calculation after HOP1 became
  visible, but the transport evidence remains the actual boundary:
  `HOP3.WS_FRAME = 0` and adapter `decoded = 0`.
- HOP3 rejects remained `SEQUENCE_GAP: 0`, `RETIRED_EPOCH: 0`, `TOO_OLD: 0`.
- HOP6 remained `HARD_RECOVERY`, `lastFailureCode: AUTH_EGRESS_UNAVAILABLE`,
  `baselineAgeMs: null`.
- HOP8 remained `quoteChanges60s: 0`, `quoteChanges300s: 0`,
  `sampleChange: null`.
- H2 (one missing live/today partition) is not supported by these samples:
  neither partition produced any bridge WS frame.
- Immediately before the final round, sources contained all six lobbies in
  `LIVE`; CMD, IM, SABA, and BTI were `ACTIVE`, while KSPORT and TSPORT were
  `CANDIDATE`.

No `PROVISIONAL_ACCEPTANCE SBOBET` or `READY_FOR_24H_SOAK SBOBET` was recorded
because live HOP8 never showed a real price change after the maximum three
rounds.

USER_CHECK_PENDING — manual comparison of three selections was not performed.

## RUN 2026-08-25 — A

- Samples: `36`.
- `firstFailingHop`: `HOP1_TAB`.
- HOP1: `sourceId=null`, `tabId=null`.
- HOP3 snapshot cuối: `HTTP_RESPONSE=0`, `WS_FRAME=0`, `DOM_SNAPSHOT=0`, `TAB_STATE=137`; `WS_FRAME` có `min=0`, `max=0` trong 36 mẫu.
- HOP5 authority: `NONE`.
- HOP6 `baselineAgeMs=null`, `lastFailureCode=AUTH_EGRESS_UNAVAILABLE`.
- HOP8 `quoteChanges60s=0`, `quoteChanges300s=0`.

## BLOCKED_ENV

- Trúng nhánh D: HOP1 có `sourceId=null` và `tabId=null`; HOP6 có `AUTH_EGRESS_UNAVAILABLE`.
- GATE 0 từng thấy source KSPORT `LIVE/CANDIDATE`, nhưng endpoint diag không thấy source/tab authority và không nhận `WS_FRAME` trong toàn bộ cửa sổ 180 giây.
- Dừng ngay theo nhánh D. Không chạy RED, không sửa code, không chạy test/typecheck/replay và không ghi `LOCAL_GREEN`.

## OOPIF investigation — diag 120s

- Command: `node scripts/diag-pipeline.mjs SBOBET 120`; exit `0`; 24 samples.
- HOP2: `ok=false`; `sourceEpoch=77f00c4a-a65b-4108-927c-a86bf9a8dacd:4`; `attachedForMs=1340927`.
- HOP3: `ok=true`; `lastEnvelopeAgeMs=1207`; `lastSequence=614`; `HTTP_RESPONSE=0`, `WS_FRAME=0`, `DOM_SNAPSHOT=0`, `TAB_STATE=135`; rejected `SEQUENCE_GAP=0`, `RETIRED_EPOCH=0`, `TOO_OLD=0`.
- `WS_FRAME` giữ `min=0`, `max=0` trong toàn bộ 24 samples.
- HOP5: `ok=false`; `authorityDisposition=NONE`.

## SHARED_REQUEST — HOP3 OOPIF attachment

### Bằng chứng live

- Trạng thái đã đo lúc 20:35: HOP3 `WS_FRAME=0`, `DOM_SNAPSHOT=0`, `TAB_STATE=134`; HOP5 authority `NONE`.
- Lần đo mới 120 giây: HOP3 `WS_FRAME=0` trong 24/24 samples (`min=0`, `max=0`), snapshot cuối `TAB_STATE=135`; HOP5 authority `NONE`.
- Source KSPORT đã gắn `LIVE/CANDIDATE`; HOP1 null là bẫy telemetry. Chặng hỏng thật là HOP3.

### File shared cần sửa

- `apps/chrome-extension/src/network-observer.ts:1107`: `Target.setAutoAttach` với `flatten:true` chỉ được cài trên root session.
- `apps/chrome-extension/src/network-observer.ts:2410`: handler `Target.attachedToTarget` bật `Network.enable` và `Runtime.enable` trên iframe child, nhưng không cài tiếp `Target.setAutoAttach` cho child target lồng nhau và không ghi `targetId → sessionId` vào `#ksportAttachedTargetSessions`.
- `apps/chrome-extension/src/network-observer.ts:2165`: fallback KSPORT chủ động `Target.attachToTarget` vào provider iframe nhưng sau đó chỉ gọi `Runtime.enable` tại dòng 2170; không gọi `Network.enable`. Vì vậy fallback có thể gắn đúng OOPIF mà vẫn không nhận `Network.webSocketCreated`/`Network.webSocketFrameReceived`.
- Yêu cầu shared: bảo đảm mọi KSPORT OOPIF session được theo dõi (kể cả target có sẵn/lồng nhau), lưu session binding, và bật bounded `Network.enable` trước khi chờ WebSocket events.

### Vì sao `TAB_STATE` vẫn tăng

- `apps/chrome-extension/src/background.ts:94` nối poller work-health vào observer.
- `apps/chrome-extension/src/cmd-snapshot-poller.ts:343` phát work-health độc lập mỗi tối đa một lần/5 giây.
- `apps/chrome-extension/src/network-observer.ts:2402` chuyển work-health thành `TAB_STATE`; đường này không cần child CDP/WebSocket nên vẫn chảy khi OOPIF observation hỏng.

### Predicate Volta

- `apps/chrome-extension/src/network-observer.ts:34` vẫn lọc đúng `wss:` + `*.sb21.net` + path `/sport/`.
- Predicate chỉ được gọi sau `Network.webSocketCreated` tại dòng 2588; HOP3 không có WS event nào nên predicate chưa phải điểm loại bỏ. Không được nới predicate.

Nguyên nhân và file sửa đều ngoài whitelist SBOBET. Không viết RED giả trong adapter, không sửa file shared, không chạy test/typecheck/live remeasure sau fix; dừng chờ Opus.

## Shared-fix run — before changes, diag 120s

- Command `node scripts/diag-pipeline.mjs SBOBET 120`: exit `0`, 24 samples.
- HOP2: `ok=false`, `sourceEpoch=77f00c4a-a65b-4108-927c-a86bf9a8dacd:4`, `attachedForMs=3542926`.
- HOP3: `ok=true`, `lastEnvelopeAgeMs=2932`, `lastSequence=1588`, `HTTP_RESPONSE=0`, `WS_FRAME=0`, `DOM_SNAPSHOT=0`, `TAB_STATE=120`; rejected `SEQUENCE_GAP=0`, `RETIRED_EPOCH=0`, `TOO_OLD=0`.
- HOP5: `ok=false`, `authorityDisposition=NONE`.

## A — DIAG ROUND 1

- Samples: 36.
- `firstFailingHop`: `HOP1_TAB`.
- HOP1: `ok=false`, `sourceId=null`, `tabId=null`.
- HOP3: `ok=false`; `WS_FRAME=0` trong cả 36/36 mẫu (`min=0`, `max=0`); snapshot cuối `TAB_STATE=0`.
- HOP4: `ok=false`, `decoded=0`, `ignored=0`.
- HOP5 authority: `NONE`.
- HOP6 baseline age: `null`; feed `HARD_RECOVERY / RECOVERY_HARD`; recovery stage `HARD`, attempt `2`, consecutive failures `2`, last failure `AUTH_EGRESS_UNAVAILABLE`.
- HOP8: `quoteChanges60s=0`, `quoteChanges300s=0`, `lastSemanticChangeAgeMs=null`.

## BLOCKED

- Nhánh B được kích hoạt vì HOP8 không có semantic change và hop detail không có một `WS_FRAME` nào.
- Giả thuyết evidence-supported duy nhất được chọn từ `PROVIDER-SBOBET.md`: **H4 — child session OOPIF không được gắn**. H1/H2/H3 đều cần frame `/sport/` tới adapter, nhưng HOP3 đo được `WS_FRAME=0` trong toàn bộ 36 mẫu.
- RED và fix cho H4 phải chạm đường auto-attach/OOPIF của extension (`network-observer`/background), nằm ngoài whitelist SBOBET và còn bị lệnh hiện tại cấm sửa. Không có file nào trong whitelist adapter/STOMP/direct-catalog có thể làm HOP3 nhận frame khi extension không phát envelope.
- Theo luật “mâu thuẫn với plan → ghi BLOCKED rồi dừng”, không viết RED sai chặng, không sửa code, không chạy test/typecheck/replay và không ghi `LOCAL_GREEN`.

## RUN 2026-08-25 — GATE 0

- `PASS`: có source `chrome:KSPORT:2105815583`, lobby `KSPORT`, tab `2105815583`, state `LIVE`, authority disposition `CANDIDATE`, sequence `80`.

## RUN 2026-08-25 — INVESTIGATED

- CDP `127.0.0.1:9333` không sẵn; bỏ capture mới, không launch Chrome.
- Dùng lại capture thật có sẵn và ground truth đã ghi ở mục INVESTIGATED: hai socket `/sport/`, hai destination live/today, Volta bị loại, frame là full snapshot lặp.

## RUN 2026-08-25 — DIAG FULL OUTPUT

`node scripts/diag-pipeline.mjs SBOBET 180`

```json
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664334077,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 218356
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 362,
        "lastSequence": 102,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 103
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29543978,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664339096,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 223375
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 2388,
        "lastSequence": 104,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 105
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29548997,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664344116,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 228395
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 198,
        "lastSequence": 107,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 108
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29554017,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664349131,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 233410
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1412,
        "lastSequence": 108,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 109
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29559032,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664354147,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 238426
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 405,
        "lastSequence": 112,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 113
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29564048,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664359162,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 243441
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1129,
        "lastSequence": 113,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 114
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29569063,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664364181,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 248460
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 4462,
        "lastSequence": 115,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 116
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29574082,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664369187,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 253466
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 3467,
        "lastSequence": 118,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 119
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29579088,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664374193,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 258472
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 429,
        "lastSequence": 121,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 122
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29584094,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664379211,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 263490
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 5447,
        "lastSequence": 121,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 122
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29589112,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664384216,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 268495
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 2501,
        "lastSequence": 125,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 126
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29594117,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664389227,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 273506
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1495,
        "lastSequence": 127,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 128
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29599128,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664394246,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 278525
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 489,
        "lastSequence": 131,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 132
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29604147,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664399262,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 283541
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 5505,
        "lastSequence": 131,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 132
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29609163,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664404272,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 288551
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 556,
        "lastSequence": 134,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 135
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29614173,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664409285,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 293564
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 2233,
        "lastSequence": 136,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 137
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29619186,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664414288,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 298567
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 354,
        "lastSequence": 139,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 136
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29624189,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664419303,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 303582
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1588,
        "lastSequence": 140,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 137
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29629204,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664424317,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 308596
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 604,
        "lastSequence": 144,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 137
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29634218,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664429324,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 313603
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 5611,
        "lastSequence": 144,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 137
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29639225,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664434330,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 318609
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 2602,
        "lastSequence": 147,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 135
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29644231,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664439336,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 323615
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1601,
        "lastSequence": 150,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 138
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29649237,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664444337,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 328616
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 483,
        "lastSequence": 152,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 135
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29654238,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664449353,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 333632
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 3626,
        "lastSequence": 153,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 136
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29659254,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664454369,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 338648
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 2642,
        "lastSequence": 157,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 135
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29664270,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664459378,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 343657
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 832,
        "lastSequence": 158,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 136
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29669279,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664464386,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 348665
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 2660,
        "lastSequence": 160,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 134
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29674287,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664469393,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 353672
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1678,
        "lastSequence": 163,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 137
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29679294,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664474399,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 358678
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1005,
        "lastSequence": 165,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 135
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29684300,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664479402,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 363681
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 3688,
        "lastSequence": 166,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 136
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29689303,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664484405,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 368684
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 2979,
        "lastSequence": 170,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 135
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29694306,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664489417,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 373696
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1338,
        "lastSequence": 172,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 137
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29699318,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664494424,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 378703
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 2701,
        "lastSequence": 174,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 135
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29704325,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664499438,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 383717
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1725,
        "lastSequence": 177,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 138
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29709339,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664504453,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 388732
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 727,
        "lastSequence": 180,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 135
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29714354,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:SBOBET:FOOTBALL",
  "lobby": "SBOBET",
  "nowMs": 1787664509466,
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
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:4",
        "attachedForMs": 393745
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 228,
        "lastSequence": 182,
        "byTransport": {
          "HTTP_RESPONSE": 0,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 137
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
        "lastDecodedAgeMs": null,
        "forcedUnlocks": 0
      }
    },
    {
      "hop": "HOP5_AUTHORITY",
      "ok": false,
      "detail": {
        "authorityDisposition": "NONE"
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
        "revision": "9FZFOrUYKMCfQCbJRQV25R7f5qyV0RhI6dlpq61n4rY",
        "catalogAgeMs": 29719367,
        "events": 48,
        "markets": 277,
        "quotes": 554
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": null
      }
    }
  ]
}
```

## 2026-08-25 23:15 +07 — deploy loop: root pre-existing socket watchdog

### INVESTIGATED

- Live CDP probe on `chrome:KSPORT:2105815583` returned `Not allowed` for the observer's
  `Target.getTargets` discovery command.
- Root `Target.setAutoAttach(flatten=true, waitForDebuggerOnStart=true)` emitted two child
  workers and no iframe child. Both worker sessions exposed `WebSocket` but contained `0`
  KSPORT `/sport/` sockets.
- A credential-free heap query in the root target found `2` sockets matching the unchanged
  `isKsportCatalogSocket` predicate. This proved the live sockets pre-dated `Network.enable`
  and were root-owned for this page instance.
- Existing code scheduled `#scheduleKsportPreexistingSocketReconnect` only after child target
  discovery/attachment. When discovery returned `Not allowed`, the root sockets never received
  the five-second reconnect watchdog.

### RED / minimal fix

- RED: `reconnects a pre-existing KSPORT root socket when child target discovery is unavailable`
  failed because no root `Runtime.callFunctionOn` occurred after 5,001 ms.
- Minimal fix: after KSPORT startup discovery, schedule the existing pre-existing-socket
  reconnect watchdog unconditionally. No predicate change; Volta remains excluded.
- Focused test: `211 passed` in `src/network-observer.test.ts`.
- Typecheck: `@tool-chenh/chrome-extension` passed.
- Workspace build passed.

### DEPLOY + mandatory six-provider regression

- Deployment completed through exact-v2 handoff; the required retry of
  `restart-live-stack.mjs` returned exit `0`; SBOBET deployment lease was released.
- The extension was reloaded through the `dev-reload-button`; no provider tab was reloaded,
  navigated, or closed.

| Provider | quoteChanges60s | HOP3 WS_FRAME | Result |
|---|---:|---:|---|
| CMD | 376 | n/a | preserved |
| IM | 160 | n/a | preserved |
| SABA | 498 | n/a | no regression |
| SBOBET / KSPORT | 0 | 0 | still failing |
| APSPORT / TSPORT | 175 | 2513 | CDP path preserved |
| BTI | 455 | n/a | preserved |

SBOBET post-deploy detail:

- HOP1: `sourceId=chrome:KSPORT:2105815583`, `authorityDisposition=CANDIDATE`.
- HOP2: `sourceEpoch=a57e370c-a2cd-4f62-a33b-4507d1c08a6a:5`,
  `attachedForMs=11638`.
- HOP3: `HTTP_RESPONSE=0`, `WS_FRAME=0`, `DOM_SNAPSHOT=0`, `TAB_STATE=51`.
- HOP5: `authorityDisposition=NONE`.
- HOP8: `quoteChanges60s=0`, `quoteChanges300s=0`.

No regression required a revert. This loop is not accepted because KSPORT still has no live
HOP8 semantic price change.

## 2026-08-26 00:05 +07 — correction and scoped KSPORT time-tab deploy

- The root pre-existing-socket watchdog above was disproved live: it closed the two root
  `/sport/` sockets but the page did not reconnect them. That experimental change and its RED
  were reverted; the shared CDP path that raised TSPORT WS traffic was retained.
- The KSPORT time-tab selector was scoped to the Football `.sport-type-group-item`, then to
  `.sport-menu-tab .period-item`; active state is `active-period` on the period item.

Mandatory six-provider regression after deploy:

| Provider | quoteChanges60s | HOP3 WS_FRAME | Result |
|---|---:|---:|---|
| CMD | 308 | n/a | preserved |
| IM | 88 | n/a | preserved |
| SABA | 0 | 51 | source remained live |
| SBOBET / KSPORT | 215 | 59 | real HOP8 change observed |
| APSPORT / TSPORT | 67 | 922 | CDP path preserved |
| BTI | 344 | n/a | preserved |

HOP8 sample: selection `SBOBET:5619747:18378260931025:56197470030002005h`,
raw odds `0.81 -> 0.8`.

The pre-fix 10-minute acceptance did not pass: minutes 1, 2 and 6 failed at HOP6; minutes
7–9 failed at HOP1 after the source aged out, and the final read was interrupted by the stack
handoff. The first six windows were:

| Minute | firstFailingHop | quoteChanges60s | HOP3 WS_FRAME | Feed state | Evidence p95 ms |
|---:|---|---:|---:|---|---:|
| 1 | HOP6_FEED | 220 | 97 | SOFT_RECOVERY | 42059 |
| 2 | HOP6_FEED | 355 | 124 | SOFT_RECOVERY | 43320 |
| 3 | null | 428 | 148 | LIVE | 43320 |
| 4 | null | 345 | 130 | LIVE | 43320 |
| 5 | null | 378 | 128 | LIVE | 43320 |
| 6 | HOP6_FEED | 146 | 121 | SOFT_RECOVERY | 39373 |

Root cause for HOP6: repeated full snapshots with unchanged content were discarded completely.
RED proved they must refresh transport liveness without emitting a catalog value/revision, while
a later changed snapshot must still emit a delta. Minimal adapter fix passes 56/56 focused tests.

## 2026-08-26 00:43 +07 — post-restart H2 investigation

After deploying the adapter liveness fix and reloading the extension, the mandatory regression
guardrails were preserved, but KSPORT again had no captured WebSocket frames:

| Provider | quoteChanges60s | HOP3 WS_FRAME | Result |
|---|---:|---:|---|
| CMD | 430 | 0 | preserved |
| IM | 242 | 0 | preserved |
| SABA | 206 | 202 | source live; HOP7 transient |
| SBOBET / KSPORT | 0 | 0 | failing |
| APSPORT / TSPORT | 0 | 1158 | required CDP guardrail preserved |
| BTI | 531 | 0 | preserved |

Full 120-second SBOBET diagnostic remained stable at the failing boundary. Final HOP2/3/5
detail:

```json
{
  "HOP2_ATTACH": {
    "sourceEpoch": "a8159b7a-1ebb-4390-8b2b-caf0346e3465:6",
    "attachedForMs": 174072
  },
  "HOP3_ENVELOPE": {
    "lastEnvelopeAgeMs": 3318,
    "lastSequence": 83,
    "byTransport": {
      "HTTP_RESPONSE": 0,
      "WS_FRAME": 0,
      "DOM_SNAPSHOT": 0,
      "TAB_STATE": 135
    },
    "rejected": {
      "SEQUENCE_GAP": 0,
      "RETIRED_EPOCH": 0,
      "TOO_OLD": 0
    }
  },
  "HOP5_AUTHORITY": {
    "authorityDisposition": "NONE"
  }
}
```

H2 RED: KSPORT root startup used `Target.setAutoAttach` with
`waitForDebuggerOnStart=false` and no OOPIF target filter. The new test failed on that exact
call. Minimal fix changes only KSPORT root auto-attach to pause and attach iframe targets before
their socket can escape observation; other providers retain the existing call. Observer tests
pass 212/212, adapter tests pass 56/56, both affected typechecks pass, and workspace build passes.
This H2 build is awaiting the shared deployment lease; it has not yet been accepted live.

### H2 live result and mandatory rollback

The H2 auto-attach/filter build was deployed and extension-reloaded. Its first 45-second
regression table was:

| Provider | quoteChanges60s | HOP3 WS_FRAME | Result |
|---|---:|---:|---|
| CMD | 154 | 0 | preserved |
| IM | 94 | 0 | preserved |
| SABA | 174 | 22 | preserved |
| SBOBET / KSPORT | 0 | 0 | still failing |
| APSPORT / TSPORT | 0 | 0 | regression |
| BTI | 75 | 0 | preserved |

Because TSPORT lost its required WS traffic, the KSPORT-only root auto-attach/filter change and
its RED were reverted immediately. The shared stack lease was occupied, so the extension rollback
was applied first from the rebuilt dist without touching provider tabs. The rollback verification
restored every required guardrail:

| Provider | quoteChanges60s | HOP3 WS_FRAME | Result |
|---|---:|---:|---|
| CMD | 252 | 0 | restored/preserved |
| IM | 116 | 0 | restored/preserved |
| SABA | 194 | 152 | preserved |
| SBOBET / KSPORT | 0 | 0 | still failing |
| APSPORT / TSPORT | 32 | 2185 | restored |
| BTI | 398 | 0 | restored/preserved |

H2 is disproved and is not part of the retained source. The adapter snapshot-liveness fix remains.

## 2026-08-26 01:13 +07 — live DOM ownership and period-selector RED

- Redacted live target probe: `Target.setAutoAttach` exposed exactly two `worker` targets and no
  `iframe`; `Page.getFrameTree` exposed only the root frame. The root document was complete with
  25,984 elements and no child frames. This live page instance therefore did not support the H2
  OOPIF assumption.
- The root DOM contained 21 `.sport-type-group-item` nodes and 24 period controls.
- Candidate `index=0` was the promo Football group with `boost=true`; candidate `index=1` was the
  real active Football group with `boost=false`.
- Neither group contained a period item. For the real Football group, the minimal shared ancestor
  was `.header-tab-content` at ancestor level 2, containing exactly one menu and three period
  items. The broader `.sport-menu-container` held eight menus and 24 period items.

RED: the focused selector test failed because the expression queried
`group.querySelectorAll('.sport-menu-tab .period-item')`, which cannot match the measured live DOM.
Minimal fix:

- exclude `.sport-odds-boosts` / `class*=odds-boost` when selecting the Football group;
- scope to `group.closest('.header-tab-content')`;
- query the three period items only within that scope.

No WebSocket predicate or Volta allowance changed. Focused test passes; full observer tests pass
211/211; adapter tests pass 56/56; API and extension typechecks pass; workspace build passes.
The build is awaiting the shared SABA acceptance lease and has not yet been deployed live.
