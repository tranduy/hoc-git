# IM realtime report

## INVESTIGATED

- Evidence 2026-08-25: IM dùng HTTP; provider không phát request sau 15 giây đầu; landing không phát `GetSE`.
- Capture có sẵn: 5 file JSONL, tổng 44.738.260 byte.
- CDP `127.0.0.1:9333`: không sẵn; không ghi capture mới.

## `node scripts/diag-pipeline.mjs IM 180`

{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663371493,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3893643
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 381521,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 393352,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 393352,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 393352,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 393352,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 393352,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663376511,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3898661
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 386539,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 398370,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 398370,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 398370,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 398370,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 398370,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663381516,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3903666
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 391544,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 403375,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 403375,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 403375,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 403375,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 403375,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663386530,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3908680
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 396558,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 408389,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 408389,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 408389,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 408389,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 408389,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663391543,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3913693
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 401571,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 413402,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 413402,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 413402,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 413402,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 413402,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663396553,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3918703
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 406581,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 418412,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 418412,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 418412,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 418412,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 418412,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663401565,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3923715
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 411593,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 423424,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 423424,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 423424,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 423424,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 423424,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663406571,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3928721
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 416599,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 428430,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 428430,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 428430,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 428430,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 428430,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663411575,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3933725
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 421603,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 433434,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 433434,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 433434,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 433434,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 433434,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663416584,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3938734
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 426612,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 438443,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 438443,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 438443,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 438443,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 438443,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663421592,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3943742
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 431620,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 443451,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 443451,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 443451,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 443451,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 443451,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663426600,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3948750
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 436628,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 448459,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 448459,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 448459,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 448459,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 448459,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663431604,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3953754
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 441632,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 453463,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 453463,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 453463,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 453463,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 453463,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663436609,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3958759
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 446637,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 458468,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 458468,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 458468,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 458468,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 458468,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663441623,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3963773
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 451651,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 463482,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 463482,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 463482,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 463482,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 463482,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663446638,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3968788
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 456666,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 468497,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 468497,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 468497,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 468497,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 468497,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663451648,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3973798
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 461676,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 473507,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 473507,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 473507,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 473507,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 473507,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663456657,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3978807
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 466685,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 478516,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 478516,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 478516,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 478516,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 478516,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663461662,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3983812
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 471690,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 483521,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 483521,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 483521,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 483521,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 483521,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663466676,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3988826
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 476704,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 488535,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 488535,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 488535,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 488535,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 488535,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663471681,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3993831
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 481709,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 493540,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 493540,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 493540,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 493540,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 493540,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663476684,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 3998834
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 486712,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 498543,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 498543,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 498543,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 498543,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 498543,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663481689,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 4003839
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 491717,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 503548,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 503548,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 503548,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 503548,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 503548,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663486694,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 4008844
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 496722,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 508553,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 508553,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 508553,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 508553,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 508553,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663491707,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 4013857
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 501735,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 513566,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 513566,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 513566,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 513566,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 513566,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663496717,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 4018867
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 506745,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 518576,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 518576,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 518576,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 518576,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 518576,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663501725,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 4023875
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 511753,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 523584,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 523584,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 523584,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 523584,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 523584,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663506732,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 4028882
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 516760,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 528591,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 528591,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 528591,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 528591,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 528591,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663511735,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 4033885
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 521763,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 533594,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 533594,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 533594,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 533594,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 533594,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663516747,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 4038897
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 526775,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 538606,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 538606,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 538606,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 538606,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 538606,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663521755,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 4043905
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 531783,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 543614,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 543614,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 543614,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 543614,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 543614,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663526769,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 4048919
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 536797,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 548628,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 548628,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 548628,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 548628,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 548628,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663531786,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 4053936
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 541814,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 553645,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 553645,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 553645,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 553645,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 553645,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663536793,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 4058943
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 546821,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 558652,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 558652,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 558652,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 558652,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 558652,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663541803,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 4063953
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 551831,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 563662,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 563662,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 563662,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 563662,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 563662,
        "sampleChange": null
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787663546810,
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
        "sourceEpoch": "9bb36713-c6f1-4712-8c82-b05ed55f0e0e:48",
        "attachedForMs": 4068960
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": false,
      "detail": {
        "lastEnvelopeAgeMs": 556838,
        "lastSequence": 17253,
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
        "lastDecodedAgeMs": 568669,
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
        "activeGeneration": "im:2105815596:216",
        "baselineAgeMs": 568669,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 568669,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": null,
          "p95": null,
          "samples": 0
        },
        "recoveryStage": "HARD",
        "recoveryAttempt": 2,
        "consecutiveFailures": 4,
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
        "revision": "4WE7rS_MhcP3qFCMY3MUm5Wy7GyRwPz1iguxdk_iW2M",
        "catalogAgeMs": 568669,
        "events": 121,
        "markets": 1087,
        "quotes": 2174
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": false,
      "detail": {
        "quoteChanges60s": 0,
        "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": 568669,
        "sampleChange": null
      }
    }
  ]
}

## A — Kết quả đo

- Số mẫu: 36.
- `firstFailingHop`: `HOP1_TAB` trong 36/36 mẫu.
- HOP1: `sourceId=null`, `tabId=null`, `authorityDisposition=null`.
- HOP8: `quoteChanges60s=0`, `quoteChanges300s=0`, không có `sampleChange`.
- Authority tại HOP5: `ACTIVE` trong 36/36 mẫu.
- `baselineAgeMs`: 393.352–568.669 ms; `maxBaselineAgeMs=90.000` ms.
- `evidenceAgeMs`: 393.352–568.669 ms; `expectedEvidenceCadenceMs=45.000` ms.
- Recovery: `HARD`, attempt 2; `consecutiveFailures=4`; `lastFailureCode=AUTH_EGRESS_UNAVAILABLE`.
- `forcedUnlocks=0` trong 36/36 mẫu.
- Treadmill: HOP3 ghi `HTTP_RESPONSE=0`, `TAB_STATE=0`; HOP4 ghi `decoded=0`; cadence có 0 mẫu. Baseline không được làm mới trong toàn bộ vòng đo.

## BLOCKED

Chặng hỏng đầu tiên đo được là HOP1: tab/source IM không còn được đăng ký (`sourceId` và `tabId` đều `null`). Whitelist của `PROVIDER-IM.md` chỉ cho sửa adapter IM, catalog source IM, bootstrap refresh IM và report; không file nào trong whitelist sở hữu việc đăng ký/attach tab ở HOP1. Tạo RED/fix tại HOP4/HOP6 hoặc treadmill trong các file whitelist sẽ không tái hiện và không sửa đúng chặng hỏng đầu tiên, trái yêu cầu RED đúng chặng và cấm sửa ngoài whitelist. Không có code nào được sửa.

---

## Vòng mới — GATE 0

- Source IM tồn tại: `chrome:IM:2105815596`.
- State: `LIVE`; authority: `ACTIVE`.

## Vòng mới — INVESTIGATED

- Evidence 2026-08-25: IM dùng HTTP; provider im lặng sau 15 giây; landing không phát `GetSE`.
- Capture có sẵn: 5 file JSONL, tổng 44.738.260 byte.
- CDP `127.0.0.1:9333`: không sẵn; không ghi capture mới.

## Vòng mới — `node scripts/diag-pipeline.mjs IM 180` — FULL OUTPUT
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664235057,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 123323
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1991,
        "lastSequence": 524,
        "byTransport": {
          "HTTP_RESPONSE": 484,
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
        "decoded": 9,
        "ignored": 39,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 5512,
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
        "activeGeneration": "im:2105815596:8",
        "baselineAgeMs": 5512,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 5512,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15254,
          "p95": 20638,
          "samples": 8
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "ShjkCPrvqBIp-CImjRX35nZlyq5Py5ZeRIJyqDfHqp8",
        "catalogAgeMs": 5512,
        "events": 110,
        "markets": 994,
        "quotes": 1988
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 194,
        "quoteChanges300s": 1150,
        "lastSemanticChangeAgeMs": 5512,
        "sampleChange": {
          "selectionKey": "IM:112587731:2500034213:32457775439",
          "before": "0.93",
          "after": "0.95",
          "atMs": 1787664229545
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664240066,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 128332
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 347,
        "lastSequence": 525,
        "byTransport": {
          "HTTP_RESPONSE": 484,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
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
        "decoded": 9,
        "ignored": 39,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 10521,
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
        "activeGeneration": "im:2105815596:8",
        "baselineAgeMs": 10521,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 10521,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15254,
          "p95": 20638,
          "samples": 8
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "ShjkCPrvqBIp-CImjRX35nZlyq5Py5ZeRIJyqDfHqp8",
        "catalogAgeMs": 10521,
        "events": 110,
        "markets": 994,
        "quotes": 1988
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 124,
        "quoteChanges300s": 1150,
        "lastSemanticChangeAgeMs": 10521,
        "sampleChange": {
          "selectionKey": "IM:112587731:2500034213:32457775439",
          "before": "0.93",
          "after": "0.95",
          "atMs": 1787664229545
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664245068,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 133334
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 333,
        "lastSequence": 529,
        "byTransport": {
          "HTTP_RESPONSE": 487,
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
        "decoded": 9,
        "ignored": 42,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 15523,
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
        "activeGeneration": "im:2105815596:8",
        "baselineAgeMs": 15523,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 15523,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15254,
          "p95": 20638,
          "samples": 8
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "ShjkCPrvqBIp-CImjRX35nZlyq5Py5ZeRIJyqDfHqp8",
        "catalogAgeMs": 15523,
        "events": 110,
        "markets": 994,
        "quotes": 1988
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 124,
        "quoteChanges300s": 1150,
        "lastSemanticChangeAgeMs": 15523,
        "sampleChange": {
          "selectionKey": "IM:112587731:2500034213:32457775439",
          "before": "0.93",
          "after": "0.95",
          "atMs": 1787664229545
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664250081,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 138347
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 361,
        "lastSequence": 593,
        "byTransport": {
          "HTTP_RESPONSE": 548,
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
        "decoded": 10,
        "ignored": 44,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 4938,
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
        "activeGeneration": "im:2105815596:9",
        "baselineAgeMs": 4938,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 4938,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15598,
          "p95": 20638,
          "samples": 9
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "yDFIq-wsbCh7MpbvfXw7qbbPQ-6jCsVe55LEyoYw0BY",
        "catalogAgeMs": 4938,
        "events": 110,
        "markets": 994,
        "quotes": 1988
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 140,
        "quoteChanges300s": 1176,
        "lastSemanticChangeAgeMs": 4938,
        "sampleChange": {
          "selectionKey": "IM:112822884:2506041087:32412394245",
          "before": "0.9",
          "after": "0.89",
          "atMs": 1787664245143
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664255094,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 143360
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1537,
        "lastSequence": 594,
        "byTransport": {
          "HTTP_RESPONSE": 549,
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
        "decoded": 10,
        "ignored": 45,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 9951,
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
        "activeGeneration": "im:2105815596:9",
        "baselineAgeMs": 9951,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 9951,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15598,
          "p95": 20638,
          "samples": 9
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "yDFIq-wsbCh7MpbvfXw7qbbPQ-6jCsVe55LEyoYw0BY",
        "catalogAgeMs": 9951,
        "events": 110,
        "markets": 994,
        "quotes": 1988
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 140,
        "quoteChanges300s": 1176,
        "lastSemanticChangeAgeMs": 9951,
        "sampleChange": {
          "selectionKey": "IM:112822884:2506041087:32412394245",
          "before": "0.9",
          "after": "0.89",
          "atMs": 1787664245143
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664260106,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 148372
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 382,
        "lastSequence": 597,
        "byTransport": {
          "HTTP_RESPONSE": 550,
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
        "decoded": 10,
        "ignored": 46,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 14963,
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
        "activeGeneration": "im:2105815596:9",
        "baselineAgeMs": 14963,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 14963,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15598,
          "p95": 20638,
          "samples": 9
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "yDFIq-wsbCh7MpbvfXw7qbbPQ-6jCsVe55LEyoYw0BY",
        "catalogAgeMs": 14963,
        "events": 110,
        "markets": 994,
        "quotes": 1988
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 140,
        "quoteChanges300s": 1176,
        "lastSemanticChangeAgeMs": 14963,
        "sampleChange": {
          "selectionKey": "IM:112822884:2506041087:32412394245",
          "before": "0.9",
          "after": "0.89",
          "atMs": 1787664245143
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664265118,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 153384
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1357,
        "lastSequence": 661,
        "byTransport": {
          "HTTP_RESPONSE": 612,
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
        "decoded": 11,
        "ignored": 49,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 3513,
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
        "activeGeneration": "im:2105815596:10",
        "baselineAgeMs": 3513,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 3513,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15598,
          "p95": 20638,
          "samples": 10
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "cNKabEQVBPUH2lhdnmTQH9Q2BXsIEM29JfUFc_fZGlU",
        "catalogAgeMs": 3513,
        "events": 110,
        "markets": 993,
        "quotes": 1986
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 206,
        "quoteChanges300s": 1242,
        "lastSemanticChangeAgeMs": 3513,
        "sampleChange": {
          "selectionKey": "IM:112956755:2509491086:32462131151",
          "before": "0.72",
          "after": "0.74",
          "atMs": 1787664261605
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664270134,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 158400
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 420,
        "lastSequence": 663,
        "byTransport": {
          "HTTP_RESPONSE": 613,
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
        "decoded": 11,
        "ignored": 50,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 8529,
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
        "activeGeneration": "im:2105815596:10",
        "baselineAgeMs": 8529,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 8529,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15598,
          "p95": 20638,
          "samples": 10
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "cNKabEQVBPUH2lhdnmTQH9Q2BXsIEM29JfUFc_fZGlU",
        "catalogAgeMs": 8529,
        "events": 110,
        "markets": 993,
        "quotes": 1986
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 102,
        "quoteChanges300s": 1242,
        "lastSemanticChangeAgeMs": 8529,
        "sampleChange": {
          "selectionKey": "IM:112956755:2509491086:32462131151",
          "before": "0.72",
          "after": "0.74",
          "atMs": 1787664261605
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664275148,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 163414
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1152,
        "lastSequence": 666,
        "byTransport": {
          "HTTP_RESPONSE": 615,
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
        "decoded": 11,
        "ignored": 52,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 13543,
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
        "activeGeneration": "im:2105815596:10",
        "baselineAgeMs": 13543,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 13543,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15598,
          "p95": 20638,
          "samples": 10
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "cNKabEQVBPUH2lhdnmTQH9Q2BXsIEM29JfUFc_fZGlU",
        "catalogAgeMs": 13543,
        "events": 110,
        "markets": 993,
        "quotes": 1986
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 102,
        "quoteChanges300s": 1242,
        "lastSemanticChangeAgeMs": 13543,
        "sampleChange": {
          "selectionKey": "IM:112956755:2509491086:32462131151",
          "before": "0.72",
          "after": "0.74",
          "atMs": 1787664261605
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664280167,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 168433
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 429,
        "lastSequence": 730,
        "byTransport": {
          "HTTP_RESPONSE": 676,
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
        "decoded": 12,
        "ignored": 54,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 2507,
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
        "activeGeneration": "im:2105815596:11",
        "baselineAgeMs": 2507,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 2507,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 16055,
          "p95": 20638,
          "samples": 11
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "wFYCA7dRgOOtuNZXcknpE5K-5kXn-0-BaD4ilBplWKE",
        "catalogAgeMs": 2507,
        "events": 110,
        "markets": 993,
        "quotes": 1986
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 106,
        "quoteChanges300s": 1256,
        "lastSemanticChangeAgeMs": 2507,
        "sampleChange": {
          "selectionKey": "IM:112956939:2509497360:32457611807",
          "before": "-0.9433962264150942",
          "after": "-0.9259259259259258",
          "atMs": 1787664277660
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664285172,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 173438
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 823,
        "lastSequence": 731,
        "byTransport": {
          "HTTP_RESPONSE": 677,
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
        "decoded": 12,
        "ignored": 55,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 7512,
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
        "activeGeneration": "im:2105815596:11",
        "baselineAgeMs": 7512,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 7512,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 16055,
          "p95": 20638,
          "samples": 11
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "wFYCA7dRgOOtuNZXcknpE5K-5kXn-0-BaD4ilBplWKE",
        "catalogAgeMs": 7512,
        "events": 110,
        "markets": 993,
        "quotes": 1986
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 106,
        "quoteChanges300s": 1256,
        "lastSemanticChangeAgeMs": 7512,
        "sampleChange": {
          "selectionKey": "IM:112956939:2509497360:32457611807",
          "before": "-0.9433962264150942",
          "after": "-0.9259259259259258",
          "atMs": 1787664277660
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664290176,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 178442
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 287,
        "lastSequence": 735,
        "byTransport": {
          "HTTP_RESPONSE": 679,
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
        "decoded": 12,
        "ignored": 57,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 12516,
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
        "activeGeneration": "im:2105815596:11",
        "baselineAgeMs": 12516,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 12516,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 16055,
          "p95": 20638,
          "samples": 11
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "wFYCA7dRgOOtuNZXcknpE5K-5kXn-0-BaD4ilBplWKE",
        "catalogAgeMs": 12516,
        "events": 110,
        "markets": 993,
        "quotes": 1986
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 106,
        "quoteChanges300s": 1256,
        "lastSemanticChangeAgeMs": 12516,
        "sampleChange": {
          "selectionKey": "IM:112956939:2509497360:32457611807",
          "before": "-0.9433962264150942",
          "after": "-0.9259259259259258",
          "atMs": 1787664277660
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664295193,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 183459
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 536,
        "lastSequence": 799,
        "byTransport": {
          "HTTP_RESPONSE": 741,
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
        "decoded": 13,
        "ignored": 60,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 1801,
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
        "activeGeneration": "im:2105815596:12",
        "baselineAgeMs": 1801,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 1801,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15732,
          "p95": 20638,
          "samples": 12
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "Iy2RZ2qlTPX2oPFixO0EKU8VXdgTo77U9QC7dvTV4Uk",
        "catalogAgeMs": 1801,
        "events": 110,
        "markets": 993,
        "quotes": 1986
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 176,
        "quoteChanges300s": 1326,
        "lastSemanticChangeAgeMs": 1801,
        "sampleChange": {
          "selectionKey": "IM:112957012:2509499644:32457624411",
          "before": "0.83",
          "after": "0.86",
          "atMs": 1787664293392
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664300196,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 188462
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 480,
        "lastSequence": 800,
        "byTransport": {
          "HTTP_RESPONSE": 741,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
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
        "decoded": 13,
        "ignored": 60,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 6804,
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
        "activeGeneration": "im:2105815596:12",
        "baselineAgeMs": 6804,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 6804,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15732,
          "p95": 20638,
          "samples": 12
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "Iy2RZ2qlTPX2oPFixO0EKU8VXdgTo77U9QC7dvTV4Uk",
        "catalogAgeMs": 6804,
        "events": 110,
        "markets": 993,
        "quotes": 1986
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 150,
        "quoteChanges300s": 1326,
        "lastSemanticChangeAgeMs": 6804,
        "sampleChange": {
          "selectionKey": "IM:112957012:2509499644:32457624411",
          "before": "0.83",
          "after": "0.86",
          "atMs": 1787664293392
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664305213,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 193479
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 231,
        "lastSequence": 801,
        "byTransport": {
          "HTTP_RESPONSE": 742,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
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
        "decoded": 13,
        "ignored": 61,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 11821,
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
        "activeGeneration": "im:2105815596:12",
        "baselineAgeMs": 11821,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 11821,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15732,
          "p95": 20638,
          "samples": 12
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "Iy2RZ2qlTPX2oPFixO0EKU8VXdgTo77U9QC7dvTV4Uk",
        "catalogAgeMs": 11821,
        "events": 110,
        "markets": 993,
        "quotes": 1986
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 150,
        "quoteChanges300s": 1326,
        "lastSemanticChangeAgeMs": 11821,
        "sampleChange": {
          "selectionKey": "IM:112957012:2509499644:32457624411",
          "before": "0.83",
          "after": "0.86",
          "atMs": 1787664293392
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664310218,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 198484
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 136,
        "lastSequence": 868,
        "byTransport": {
          "HTTP_RESPONSE": 805,
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
        "decoded": 14,
        "ignored": 65,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 703,
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
        "activeGeneration": "im:2105815596:13",
        "baselineAgeMs": 703,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 703,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 16055,
          "p95": 20638,
          "samples": 13
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "LLDU9jlHEsjLWWuo3697oVWq5qdeRdPD7QvNVoibcmI",
        "catalogAgeMs": 703,
        "events": 110,
        "markets": 992,
        "quotes": 1984
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 208,
        "quoteChanges300s": 1384,
        "lastSemanticChangeAgeMs": 703,
        "sampleChange": {
          "selectionKey": "IM:112822884:2506041069:32457418315",
          "before": "-0.8849557522123894",
          "after": "-0.8928571428571428",
          "atMs": 1787664309515
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664315225,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 203491
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 135,
        "lastSequence": 869,
        "byTransport": {
          "HTTP_RESPONSE": 806,
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
        "decoded": 14,
        "ignored": 66,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 5710,
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
        "activeGeneration": "im:2105815596:13",
        "baselineAgeMs": 5710,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 5710,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 16055,
          "p95": 20638,
          "samples": 13
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "LLDU9jlHEsjLWWuo3697oVWq5qdeRdPD7QvNVoibcmI",
        "catalogAgeMs": 5710,
        "events": 110,
        "markets": 992,
        "quotes": 1984
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 208,
        "quoteChanges300s": 1384,
        "lastSemanticChangeAgeMs": 5710,
        "sampleChange": {
          "selectionKey": "IM:112822884:2506041069:32457418315",
          "before": "-0.8849557522123894",
          "after": "-0.8928571428571428",
          "atMs": 1787664309515
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664320241,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 208507
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 521,
        "lastSequence": 870,
        "byTransport": {
          "HTTP_RESPONSE": 806,
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
        "decoded": 14,
        "ignored": 66,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 10726,
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
        "activeGeneration": "im:2105815596:13",
        "baselineAgeMs": 10726,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 10726,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 16055,
          "p95": 20638,
          "samples": 13
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "LLDU9jlHEsjLWWuo3697oVWq5qdeRdPD7QvNVoibcmI",
        "catalogAgeMs": 10726,
        "events": 110,
        "markets": 992,
        "quotes": 1984
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 142,
        "quoteChanges300s": 1384,
        "lastSemanticChangeAgeMs": 10726,
        "sampleChange": {
          "selectionKey": "IM:112822884:2506041069:32457418315",
          "before": "-0.8849557522123894",
          "after": "-0.8928571428571428",
          "atMs": 1787664309515
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664325247,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 213513
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 201,
        "lastSequence": 873,
        "byTransport": {
          "HTTP_RESPONSE": 808,
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
        "decoded": 14,
        "ignored": 68,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 15732,
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
        "activeGeneration": "im:2105815596:13",
        "baselineAgeMs": 15732,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 15732,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 16055,
          "p95": 20638,
          "samples": 13
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "LLDU9jlHEsjLWWuo3697oVWq5qdeRdPD7QvNVoibcmI",
        "catalogAgeMs": 15732,
        "events": 110,
        "markets": 992,
        "quotes": 1984
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 142,
        "quoteChanges300s": 1384,
        "lastSemanticChangeAgeMs": 15732,
        "sampleChange": {
          "selectionKey": "IM:112822884:2506041069:32457418315",
          "before": "-0.8849557522123894",
          "after": "-0.8928571428571428",
          "atMs": 1787664309515
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664330258,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 218524
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 531,
        "lastSequence": 938,
        "byTransport": {
          "HTTP_RESPONSE": 870,
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
        "decoded": 15,
        "ignored": 71,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 4760,
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
        "activeGeneration": "im:2105815596:14",
        "baselineAgeMs": 4760,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 4760,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15983,
          "p95": 20638,
          "samples": 14
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "QCbBbtzDyXBKgmn7sxbOEl56RZo6CU1nubeLwBUQOcE",
        "catalogAgeMs": 4760,
        "events": 110,
        "markets": 992,
        "quotes": 1984
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 140,
        "quoteChanges300s": 1396,
        "lastSemanticChangeAgeMs": 4760,
        "sampleChange": {
          "selectionKey": "IM:112958063:2509523227:32460945362",
          "before": "0.64",
          "after": "0.68",
          "atMs": 1787664325498
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664335270,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 223536
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 5543,
        "lastSequence": 938,
        "byTransport": {
          "HTTP_RESPONSE": 870,
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
        "decoded": 15,
        "ignored": 71,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 9772,
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
        "activeGeneration": "im:2105815596:14",
        "baselineAgeMs": 9772,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 9772,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15983,
          "p95": 20638,
          "samples": 14
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "QCbBbtzDyXBKgmn7sxbOEl56RZo6CU1nubeLwBUQOcE",
        "catalogAgeMs": 9772,
        "events": 110,
        "markets": 992,
        "quotes": 1984
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 140,
        "quoteChanges300s": 1396,
        "lastSemanticChangeAgeMs": 9772,
        "sampleChange": {
          "selectionKey": "IM:112958063:2509523227:32460945362",
          "before": "0.64",
          "after": "0.68",
          "atMs": 1787664325498
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664340281,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 228547
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 377,
        "lastSequence": 942,
        "byTransport": {
          "HTTP_RESPONSE": 872,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
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
        "decoded": 15,
        "ignored": 73,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 14783,
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
        "activeGeneration": "im:2105815596:14",
        "baselineAgeMs": 14783,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 14783,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15983,
          "p95": 20638,
          "samples": 14
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "QCbBbtzDyXBKgmn7sxbOEl56RZo6CU1nubeLwBUQOcE",
        "catalogAgeMs": 14783,
        "events": 110,
        "markets": 992,
        "quotes": 1984
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 140,
        "quoteChanges300s": 1396,
        "lastSemanticChangeAgeMs": 14783,
        "sampleChange": {
          "selectionKey": "IM:112958063:2509523227:32460945362",
          "before": "0.64",
          "after": "0.68",
          "atMs": 1787664325498
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664345293,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 233559
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 2767,
        "lastSequence": 1005,
        "byTransport": {
          "HTTP_RESPONSE": 933,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
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
        "decoded": 16,
        "ignored": 75,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 3253,
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
        "activeGeneration": "im:2105815596:15",
        "baselineAgeMs": 3253,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 3253,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 16055,
          "p95": 20638,
          "samples": 15
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "Kb4GxgaEfhoW6rRYK94333HVASEMXxU1wOhYVUsMcAo",
        "catalogAgeMs": 3253,
        "events": 110,
        "markets": 992,
        "quotes": 1984
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 174,
        "quoteChanges300s": 1430,
        "lastSemanticChangeAgeMs": 3253,
        "sampleChange": {
          "selectionKey": "IM:112956743:2509490765:32457578386",
          "before": "0.89",
          "after": "0.87",
          "atMs": 1787664342040
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664350298,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 238564
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 509,
        "lastSequence": 1008,
        "byTransport": {
          "HTTP_RESPONSE": 935,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
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
        "decoded": 17,
        "ignored": 76,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 2862,
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
        "activeGeneration": "im:2105815596:15",
        "baselineAgeMs": 8258,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 2862,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15983,
          "p95": 20638,
          "samples": 16
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "VOuO7xahsTKEG09erIXV6VxlePWvHWXue-66HboAr_Q",
        "catalogAgeMs": 2862,
        "events": 110,
        "markets": 992,
        "quotes": 1984
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 110,
        "quoteChanges300s": 1436,
        "lastSemanticChangeAgeMs": 2862,
        "sampleChange": {
          "selectionKey": "IM:112956743:2509490765:32457578386",
          "before": "0.89",
          "after": "0.87",
          "atMs": 1787664342040
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664355305,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 243571
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1381,
        "lastSequence": 1010,
        "byTransport": {
          "HTTP_RESPONSE": 936,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 75
        },
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
        "ignored": 77,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 7869,
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
        "activeGeneration": "im:2105815596:15",
        "baselineAgeMs": 13265,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 7869,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15983,
          "p95": 20638,
          "samples": 16
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "VOuO7xahsTKEG09erIXV6VxlePWvHWXue-66HboAr_Q",
        "catalogAgeMs": 7869,
        "events": 110,
        "markets": 992,
        "quotes": 1984
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 110,
        "quoteChanges300s": 1436,
        "lastSemanticChangeAgeMs": 7869,
        "sampleChange": {
          "selectionKey": "IM:112956743:2509490765:32457578386",
          "before": "0.89",
          "after": "0.87",
          "atMs": 1787664342040
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664360310,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 248576
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 591,
        "lastSequence": 1075,
        "byTransport": {
          "HTTP_RESPONSE": 998,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 78
        },
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
        "ignored": 80,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 2669,
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
        "activeGeneration": "im:2105815596:16",
        "baselineAgeMs": 2669,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 2669,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15983,
          "p95": 20638,
          "samples": 17
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "SpX1PsD5sJT2d9cb8gILIOw0Gkalp9MYPhkvmIE82iQ",
        "catalogAgeMs": 2669,
        "events": 110,
        "markets": 992,
        "quotes": 1984
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 84,
        "quoteChanges300s": 1468,
        "lastSemanticChangeAgeMs": 2669,
        "sampleChange": {
          "selectionKey": "IM:112956805:2509493247:32457587771",
          "before": "0.55",
          "after": "0.56",
          "atMs": 1787664357641
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664365326,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 253592
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 5607,
        "lastSequence": 1075,
        "byTransport": {
          "HTTP_RESPONSE": 998,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 78
        },
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
        "ignored": 80,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 7685,
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
        "activeGeneration": "im:2105815596:16",
        "baselineAgeMs": 7685,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 7685,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15983,
          "p95": 20638,
          "samples": 17
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "SpX1PsD5sJT2d9cb8gILIOw0Gkalp9MYPhkvmIE82iQ",
        "catalogAgeMs": 7685,
        "events": 110,
        "markets": 992,
        "quotes": 1984
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 84,
        "quoteChanges300s": 1468,
        "lastSemanticChangeAgeMs": 7685,
        "sampleChange": {
          "selectionKey": "IM:112956805:2509493247:32457587771",
          "before": "0.55",
          "after": "0.56",
          "atMs": 1787664357641
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664370342,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 258608
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 435,
        "lastSequence": 1080,
        "byTransport": {
          "HTTP_RESPONSE": 1001,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 80
        },
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
        "ignored": 83,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 12701,
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
        "activeGeneration": "im:2105815596:16",
        "baselineAgeMs": 12701,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 12701,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15983,
          "p95": 20638,
          "samples": 17
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "SpX1PsD5sJT2d9cb8gILIOw0Gkalp9MYPhkvmIE82iQ",
        "catalogAgeMs": 12701,
        "events": 110,
        "markets": 992,
        "quotes": 1984
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 84,
        "quoteChanges300s": 1468,
        "lastSemanticChangeAgeMs": 12701,
        "sampleChange": {
          "selectionKey": "IM:112956805:2509493247:32457587771",
          "before": "0.55",
          "after": "0.56",
          "atMs": 1787664357641
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664375357,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 263623
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 1148,
        "lastSequence": 1143,
        "byTransport": {
          "HTTP_RESPONSE": 1062,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 82
        },
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
        "ignored": 85,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 1726,
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
        "activeGeneration": "im:2105815596:17",
        "baselineAgeMs": 1726,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 1726,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15983,
          "p95": 20638,
          "samples": 18
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "YFoOJRQZSDpy59sL4EFgMBiEejYc46yXNP6h3RhFmoE",
        "catalogAgeMs": 1726,
        "events": 110,
        "markets": 992,
        "quotes": 1984
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 184,
        "quoteChanges300s": 1568,
        "lastSemanticChangeAgeMs": 1726,
        "sampleChange": {
          "selectionKey": "IM:112956743:2509490740:32462131515",
          "before": "0.9",
          "after": "0.92",
          "atMs": 1787664373631
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664380360,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 268626
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 642,
        "lastSequence": 1145,
        "byTransport": {
          "HTTP_RESPONSE": 1063,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 83
        },
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
        "ignored": 86,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 6729,
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
        "activeGeneration": "im:2105815596:17",
        "baselineAgeMs": 6729,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 6729,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15983,
          "p95": 20638,
          "samples": 18
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "YFoOJRQZSDpy59sL4EFgMBiEejYc46yXNP6h3RhFmoE",
        "catalogAgeMs": 6729,
        "events": 110,
        "markets": 992,
        "quotes": 1984
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 172,
        "quoteChanges300s": 1568,
        "lastSemanticChangeAgeMs": 6729,
        "sampleChange": {
          "selectionKey": "IM:112956743:2509490740:32462131515",
          "before": "0.9",
          "after": "0.92",
          "atMs": 1787664373631
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664385368,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 273634
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 5650,
        "lastSequence": 1145,
        "byTransport": {
          "HTTP_RESPONSE": 1063,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 83
        },
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
        "ignored": 86,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 11737,
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
        "activeGeneration": "im:2105815596:17",
        "baselineAgeMs": 11737,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 11737,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15983,
          "p95": 20638,
          "samples": 18
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "YFoOJRQZSDpy59sL4EFgMBiEejYc46yXNP6h3RhFmoE",
        "catalogAgeMs": 11737,
        "events": 110,
        "markets": 992,
        "quotes": 1984
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 172,
        "quoteChanges300s": 1568,
        "lastSemanticChangeAgeMs": 11737,
        "sampleChange": {
          "selectionKey": "IM:112956743:2509490740:32462131515",
          "before": "0.9",
          "after": "0.92",
          "atMs": 1787664373631
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664390380,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 278646
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 980,
        "lastSequence": 1197,
        "byTransport": {
          "HTTP_RESPONSE": 1114,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 84
        },
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
        "ignored": 90,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 1039,
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
        "activeGeneration": "im:2105815596:18",
        "baselineAgeMs": 1039,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 1039,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15983,
          "p95": 20638,
          "samples": 19
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "DGpkDlw7FrdNK97KAzyL-NynTS0atCyvt-rsbaFlT2s",
        "catalogAgeMs": 1039,
        "events": 110,
        "markets": 990,
        "quotes": 1980
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 198,
        "quoteChanges300s": 1594,
        "lastSemanticChangeAgeMs": 1039,
        "sampleChange": {
          "selectionKey": "IM:112956859:2509494799:32457599302",
          "before": "0.88",
          "after": "-0.970873786407767",
          "atMs": 1787664389341
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664395385,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 283651
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 4899,
        "lastSequence": 1213,
        "byTransport": {
          "HTTP_RESPONSE": 1127,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 87
        },
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
        "ignored": 91,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 6044,
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
        "activeGeneration": "im:2105815596:18",
        "baselineAgeMs": 6044,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 6044,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15983,
          "p95": 20638,
          "samples": 19
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "DGpkDlw7FrdNK97KAzyL-NynTS0atCyvt-rsbaFlT2s",
        "catalogAgeMs": 6044,
        "events": 110,
        "markets": 990,
        "quotes": 1980
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 198,
        "quoteChanges300s": 1594,
        "lastSemanticChangeAgeMs": 6044,
        "sampleChange": {
          "selectionKey": "IM:112956859:2509494799:32457599302",
          "before": "0.88",
          "after": "-0.970873786407767",
          "atMs": 1787664389341
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664400392,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 288658
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 642,
        "lastSequence": 1215,
        "byTransport": {
          "HTTP_RESPONSE": 1128,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 88
        },
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
        "ignored": 92,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 11051,
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
        "activeGeneration": "im:2105815596:18",
        "baselineAgeMs": 11051,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 11051,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15983,
          "p95": 20638,
          "samples": 19
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "DGpkDlw7FrdNK97KAzyL-NynTS0atCyvt-rsbaFlT2s",
        "catalogAgeMs": 11051,
        "events": 110,
        "markets": 990,
        "quotes": 1980
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 158,
        "quoteChanges300s": 1594,
        "lastSemanticChangeAgeMs": 11051,
        "sampleChange": {
          "selectionKey": "IM:112956859:2509494799:32457599302",
          "before": "0.88",
          "after": "-0.970873786407767",
          "atMs": 1787664389341
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664405403,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 293669
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 297,
        "lastSequence": 1218,
        "byTransport": {
          "HTTP_RESPONSE": 1130,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 89
        },
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
        "ignored": 94,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 16062,
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
        "activeGeneration": "im:2105815596:18",
        "baselineAgeMs": 16062,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 16062,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15983,
          "p95": 20638,
          "samples": 19
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "DGpkDlw7FrdNK97KAzyL-NynTS0atCyvt-rsbaFlT2s",
        "catalogAgeMs": 16062,
        "events": 110,
        "markets": 990,
        "quotes": 1980
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 158,
        "quoteChanges300s": 1594,
        "lastSemanticChangeAgeMs": 16062,
        "sampleChange": {
          "selectionKey": "IM:112956859:2509494799:32457599302",
          "before": "0.88",
          "after": "-0.970873786407767",
          "atMs": 1787664389341
        }
      }
    }
  ]
}
{
  "accountId": "catalog-source:IM:FOOTBALL",
  "lobby": "IM",
  "nowMs": 1787664410407,
  "firstFailingHop": null,
  "hops": [
    {
      "hop": "HOP1_TAB",
      "ok": true,
      "detail": {
        "sourceId": "chrome:IM:2105815596",
        "tabId": 2105815596,
        "authorityDisposition": "ACTIVE"
      }
    },
    {
      "hop": "HOP2_ATTACH",
      "ok": true,
      "detail": {
        "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:1",
        "attachedForMs": 298673
      }
    },
    {
      "hop": "HOP3_ENVELOPE",
      "ok": true,
      "detail": {
        "lastEnvelopeAgeMs": 686,
        "lastSequence": 1283,
        "byTransport": {
          "HTTP_RESPONSE": 1160,
          "WS_FRAME": 0,
          "DOM_SNAPSHOT": 0,
          "TAB_STATE": 88
        },
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
        "ignored": 96,
        "rejectReasons": {
          "PROVIDER_STREAM_GAP": 0,
          "SCHEMA_CHANGED": 0,
          "PRE_BASELINE": 0
        },
        "lastDecodedAgeMs": 4874,
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
        "activeGeneration": "im:2105815596:19",
        "baselineAgeMs": 4874,
        "maxBaselineAgeMs": 90000,
        "evidenceAgeMs": 4874,
        "expectedEvidenceCadenceMs": 45000,
        "observedEvidenceCadenceMs": {
          "p50": 15983,
          "p95": 18223,
          "samples": 19
        },
        "recoveryStage": "NONE",
        "recoveryAttempt": 0,
        "consecutiveFailures": 5,
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
        "revision": "H3Wmmub_qH9H431NWII3_aVrDWneADOXW9XCPMzIgGI",
        "catalogAgeMs": 4874,
        "events": 110,
        "markets": 993,
        "quotes": 1986
      }
    },
    {
      "hop": "HOP8_SEMANTIC",
      "ok": true,
      "detail": {
        "quoteChanges60s": 144,
        "quoteChanges300s": 860,
        "lastSemanticChangeAgeMs": 4874,
        "sampleChange": {
          "selectionKey": "IM:112956755:2509491116:32457579945",
          "before": "0.85",
          "after": "0.83",
          "atMs": 1787664405533
        }
      }
    }
  ]
}

## Vòng mới — A

- Số mẫu: 36.
- `firstFailingHop=null` trong 36/36 mẫu.
- HOP8 `quoteChanges60s`: 84–208; `quoteChanges300s`: 860–1.594.
- HOP5 authority: `ACTIVE` trong 36/36 mẫu.
- `baselineAgeMs`: 703–16.062 ms; `evidenceAgeMs`: 703–16.062 ms.
- Treadmill: `HTTP_RESPONSE` tăng 484–1.160; `TAB_STATE` tăng 41–89; cadence p50 15.254–16.055 ms, p95 18.223–20.638 ms.
- Recovery: `NONE/0`; `forcedUnlocks=0` trong 36/36 mẫu.
- Mẫu đổi giá thật: selection `IM:112956755:2509491116:32457579945`, `before=0.85`, `after=0.83`, `atMs=1787664405533`.

## Vòng mới — Replay capture thật

```json
{"provider":"IM","capture":"capture-1787556598048.jsonl","envelopes":0,"baselines":0,"deltas":0,"rejected":{"total":0,"reasons":{}},"semanticChanges":0}
{"provider":"IM","capture":"capture-1787551154128.jsonl","envelopes":30,"baselines":0,"deltas":0,"rejected":{"total":30,"reasons":{"NETWORK_BODY_INCOMPLETE":30}},"semanticChanges":0}
{"provider":"IM","capture":"capture-1787551154127.jsonl","envelopes":34,"baselines":0,"deltas":0,"rejected":{"total":34,"reasons":{"NETWORK_BODY_INCOMPLETE":34}},"semanticChanges":0}
{"provider":"IM","capture":"capture-1787551154126.jsonl","envelopes":44,"baselines":0,"deltas":0,"rejected":{"total":44,"reasons":{"NETWORK_BODY_INCOMPLETE":37,"TAB_STATE_TRANSPORT_ONLY":3,"ADAPTER_FINGERPRINT_UNMATCHED":2,"ADAPTER_DECODE_EMPTY:im-http-catalog-v1":2}},"semanticChanges":0}
{"provider":"IM","capture":"capture-1787551154125.jsonl","envelopes":48,"baselines":0,"deltas":0,"rejected":{"total":48,"reasons":{"NETWORK_BODY_INCOMPLETE":48}},"semanticChanges":0}
```

## SHARED_REQUEST

- Hop/gate: HOP8 semantic replay validation; runtime HOP1–HOP8 đang xanh nhưng replay không chứng minh được semantic change.
- File ngoài whitelist cần shared owner xử lý/kiểm tra: `scripts/record-capture.mjs` và, nếu capture mới vẫn bị từ chối, `apps/api/src/chrome-bridge/replay-harness.ts`.
- Lý do: CDP 9333 không sẵn để worker IM ghi capture mới; cả 5 capture hiện có đều cho `semanticChanges=0`, bốn capture có envelope IM không lập được baseline và phần lớn bị `NETWORK_BODY_INCOMPLETE`.
- Không ghi `LOCAL_GREEN IM — NO_CODE_CHANGE` vì replay chưa đạt `--assert-semantic-changes 1`. Không sửa code IM.

---

## LOCAL_GREEN IM — NO_CODE_CHANGE

SHARED_REQUEST cũ về replay/CDP 9333 bị hủy theo luật nghiệm thu mới. Replay không được dùng làm cổng.

- GATE 0: có source `chrome:IM:2105815596`.
- Lần 1 (`nowMs=1787665403077`): `firstFailingHop=null`; HOP8 `quoteChanges60s=166`, `quoteChanges300s=729`; HOP7 `sessionState=ACTIVE`; sample selection `IM:112822874:2506040749:32411873407`, `before=0.86`, `after=0.87`, `atMs=1787665397739`.
- Lần 2 (`nowMs=1787665477670`, cách lần 1 74.593 ms): `firstFailingHop=null`; HOP8 `quoteChanges60s=108`, `quoteChanges300s=763`; HOP7 `sessionState=ACTIVE`; sample selection `IM:112956743:2509490735:32462131511`, `before=0.98`, `after=-0.970873786407767`, `atMs=1787665461632`.
- Lần 3 (`nowMs=1787665552045`, cách lần 2 74.375 ms): `firstFailingHop=null`; HOP8 `quoteChanges60s=98`, `quoteChanges300s=753`; HOP7 `sessionState=ACTIVE`; sample selection `IM:112956755:2509491091:32462131161`, `before=0.65`, `after=0.67`, `atMs=1787665542164`.
- Cả 3 lần đo live đều có `HOP8.quoteChanges60s > 0` và có `sampleChange` giá trước/sau.
- Không sửa code.

---

## PROVISIONAL_ACCEPTANCE IM

- Build identity của vòng đạt: `sha256:cf90d0f489457a30fc3be3a95299dcb6faa2d7cf0ea91f95dc256a56d687bfa5`; không đổi trước/sau vòng 600 giây.
- Lệnh: `node scripts/diag-pipeline.mjs IM 600`; 120 mẫu trong 596.253 ms.
- Chặng hỏng thật: `null` trong 120/120 mẫu.
- HOP7 `sessionState=ACTIVE` trong 120/120 mẫu.
- Mười cửa sổ `HOP8.quoteChanges60s`: `234, 146, 156, 692, 170, 70, 58, 100, 148, 138`.
- Cửa sổ dương: 10/10, đạt yêu cầu >= 8/10.
- Chu kỳ bơm extension: 15 giây. SLA đề xuất: p95 <= 30 giây.
- Cadence đo được trong vòng đạt: p50 15.614–16.522 ms; p95 17.805–26.685 ms; p95 cuối vòng 18.274 ms.

Ba lần đổi giá thật và độ trễ quan sát từ `sampleChange.atMs` đến mẫu diagnostics đầu tiên thấy thay đổi:

1. Selection `IM:112822874:2506040769:32445228323`: `-0.8403361344537815` → `-0.8333333333333334`; độ trễ 4.312 ms.
2. Selection `IM:112974844:2509938088:32459770891`: `-0.9174311926605504` → `-0.9259259259259258`; độ trễ 4.388 ms.
3. Selection `IM:112974844:2509938088:32459770891`: `-0.9259259259259258` → `-0.9345794392523364`; độ trễ 3.175 ms.

Bảng sáu sàn tại `/api/diag/pipeline` sau vòng đạt:

| Lobby | firstFailingHop | Feed | Catalog | Quotes | Δ60s |
|---|---|---|---|---:|---:|
| CMD | null | LIVE | ACTIVE | 1016 | 268 |
| IM | null | LIVE | ACTIVE | 3252 | 172 |
| SABA | HOP6_FEED | HARD_RECOVERY | ACTION_REQUIRED | 2208 | 0 |
| SBOBET | HOP4_ADAPTER | HARD_RECOVERY | ACTION_REQUIRED | 554 | 0 |
| APSPORT | HOP4_ADAPTER | HARD_RECOVERY | ACTION_REQUIRED | 108 | 0 |
| BTI | null | LIVE | ACTIVE | 702 | 348 |

- `USER_CHECK_PENDING`: đối chiếu tay ba kèo (1 AH, 1 O/U, 1 live); worker không tự mở tab sàn.
- Service worker recovery: chưa quan sát thấy `sourceEpoch` đổi trong vòng 600 giây; tiếp tục quan sát trong soak 30 phút, không reload extension.
- Không sửa code, không deploy.

---

## Acceptance retry after IM adapter fix — FAILED

- Running/local build identity: `sha256:74f1f91aa6c2b6a85286722ad3de36a67343ff467fbe07fe709da34d83244946`.
- RED: `emits transport continuity for a valid incomplete newer GetSE generation after a baseline` failed because the first valid partition of a newer generation returned `[]` after an established baseline.
- Minimal IM fix: a valid incomplete newer GetSE generation now emits transport-only continuity; the catalog baseline remains atomic and is still committed only after both IM partitions of the same generation arrive.
- Focused test: `apps/api/src/chrome-bridge/im-http-adapter.test.ts` passed 48/48.
- Typecheck: `npm.cmd run typecheck --workspace @tool-chenh/api` passed.
- Build: `npm.cmd run build` passed.
- Deploy: exact-v2 handoff/restart completed to the same local artifact identity above; immediately after deploy `/api/chrome-bridge/sources` contained six lobbies including `chrome:IM:2105815596`.

### Live 600-second acceptance result

- Command: `node scripts/diag-pipeline.mjs IM 600`; 120 samples over about 600 seconds.
- The run began green. First sample at `nowMs=1787676508018`: `firstFailingHop=null`, IM source `chrome:IM:2105815596`, HOP6 `LIVE`, HOP7 `ACTIVE`, HOP8 `quoteChanges60s=149`, with real sample `IM:112781262:2504982617:32405533489`, `1` -> `0.99`.
- A later real price sample was `IM:112781262:2504982599:32405544667`, `0.71` -> `0.72`, at `atMs=1787676908597`.
- The run then lost every new IM envelope. Final sample at `nowMs=1787677104172`: `firstFailingHop=HOP1_TAB`, source id still present in the sample but stale, HOP3 `lastEnvelopeAgeMs=192752`, `lastSequence=3737`, HOP4 `lastDecodedAgeMs=195575`, `forcedUnlocks=0`, HOP6 `HARD_RECOVERY`, HOP7 `ACTION_REQUIRED/STALE`, and HOP8 `quoteChanges60s=0`, `quoteChanges300s=283`.
- The last accepted IM envelope was at `1787676911430`. Catalog data was retained as STALE (`167` events, `1514` markets, `3028` quotes); no empty catalog was published.
- Therefore the required invariant `firstFailingHop=null` for the full ten minutes and the live HOP8 window requirement were not met. No new `PROVISIONAL_ACCEPTANCE IM` is recorded for this build.

### Cross-provider bridge evidence

After the failed run, the live stack identity remained unchanged and the coordinator recorded no intervening deployment. Nevertheless `/api/chrome-bridge/sources` became empty for every lobby. Four read-only samples remained empty for the full 90-second observation:

| atMs | all sources | IM sources |
|---:|---:|---:|
| 1787677305482 | 0 | 0 |
| 1787677335580 | 0 | 0 |
| 1787677365598 | 0 | 0 |
| 1787677395625 | 0 | 0 |

This is not an IM adapter/catalog-source failure: CMD, IM, SABA, SBOBET, APSPORT and BTI all lost bridge registration together. Chrome processes and the API/web stack were still running, but the extension bridge did not wake and reattach. The first failing boundary is the shared service-worker wakeup/reattach path.

## SHARED_REQUEST

- Hop/boundary: shared HOP1 source registration after the extension service worker stops.
- Shared owner files requiring investigation/fix: `apps/chrome-extension/src/bridge-wakeup.ts` and its wiring in `apps/chrome-extension/src/background.ts`.
- Reason: the 30-second alarm did not restore any of the six sources after more than 90 seconds. None of the IM whitelist files owns alarm registration, bridge reconnection, tab reconciliation, or reattachment. An IM-only RED/fix would not reproduce or repair the measured first failure and would violate the whitelist.
- Required IM proof still pending after the shared fix: kill the extension service worker once, observe a new IM `sourceEpoch`, automatic baseline re-establishment without tab reload, then rerun the 600-second acceptance and 1800-second soak.
- `USER_CHECK_PENDING`: manual comparison of three tickets; no provider tab was opened or navigated by this worker.
