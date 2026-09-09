# IM timeout diagnosis — 2026-09-09

Status: deployed correction; fresh IM collection is **not yet accepted**.

The attached IM document was reporting only `rate-limited`, with zero HTTP
catalog envelopes. The guarded collector was collapsing lock contention, cooldown
and non-status failures into one label. Added bounded diagnostics for lock held,
cooldown, request/signature/network failures and HTTP 401/403/429. Tokens and
arbitrary error text are not emitted.

A read of the existing page found native login ready, no held collector lock,
zero active collector controllers, five prior failures, and `hardBlocked=false`.
The last failure was REQUEST_TIMEOUT with no HTTP/native status. Resource timing
showed one GetSE HTTP 200 response of 640,902 transferred bytes taking 7,971 ms;
three other samples had status zero and durations around 8.0–8.6 seconds. HTTP 200
does not independently prove a valid catalog or disprove provider account limits.

The old collector aborted at eight seconds including signing and body reading.
The production roster-only request now has fifteen seconds, within the observer's
twenty-second command timeout. The older detail lane remains at eight seconds;
production still does not run GetEBI sweeps. Origin locking, initial grace, the
twenty-second minimum round interval, thirty-second failure pause, fifteen-minute
pause after three failed rounds, Retry-After and the hard-stop rules remain intact.
No persistent gate was cleared or shortened.

Validation: 42 collector/readiness tests, 25 IM observer tests, 18 API telemetry
tests passed. The slow-success test first failed under the old eight-second
timeout and then passed; the fifteen-second abort/backoff regression also passed.
Extension typecheck/build and API build passed.

Final deployed extension 0.2.103, artifact
`sha256:705c92862b08573f322590915ab406a853fd1855b85db4140dde4162afc0439b`.
Stack `sha256:6f391a21c306d36704b73372cc5377c4e024cc6e5638f5e5455f90c3dd25004b`,
instance `3526f706-bf09-4c32-8b66-285651e9a1d5`. Deployment lease released.

During a subsequent page-state check, address-bar automation navigated IM to a
search page unintentionally. This was disclosed, the browser Back action restored
`imsports.directsb.net`, and the source was observed attached again. That method
was discontinued. It was not a provider hard-reload recovery loop. The first
read's diagnostic title was temporary and the restored page uses its own title.

The finite observation still showed an old stale IM catalog with no decoded
current prices. Repeated diagnostic timeout counts include the same saved failure
during cooldown and must not be interpreted as that many physical requests.
No account-block diagnosis, fresh-feed success, complete market coverage or
positive opportunity is claimed. Artifacts: `.run/im-fix-2026-09-09/`.
