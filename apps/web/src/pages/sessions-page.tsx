import { useEffect, useRef, useState, type FormEvent } from "react";
import { ProviderIdSchema, type AccountStatus, type ProviderId, type RedactedSessionStatus, type SessionStatusList } from "@tool-chenh/contracts";
import {
  SessionApi,
  type FabetDiscoveryResult,
  type ManualSessionInput
} from "../api/sessions.js";
import { AccountApi, type AccountApiLike } from "../api/accounts.js";
import { AccountCard } from "../components/account-card.js";

export interface SessionApiLike {
  list(): Promise<SessionStatusList>;
  discoverFabet(entryUrl: string): Promise<FabetDiscoveryResult>;
  trustFabet(hostname: string): Promise<{ readonly hostname: string; readonly trusted: true }>;
  configureFabet(input: { readonly entryUrl: string; readonly trustedHostname: string; readonly username: string; readonly password: string }): Promise<RedactedSessionStatus>;
  configureManual(input: ManualSessionInput): Promise<RedactedSessionStatus>;
  validate(id: string): Promise<RedactedSessionStatus>;
  renew(id: string): Promise<RedactedSessionStatus>;
  resetFabet(): Promise<void>;
}

const defaultApi = new SessionApi();
const defaultAccountApi = new AccountApi();

function healthExplanation(session: RedactedSessionStatus): string {
  if (session.reason === "SCHEMA_CHANGED") return "Provider protocol is not validated yet.";
  if (session.reason === "EXPIRED") return "Session expired. Enter a new token or login again.";
  if (session.reason === "UNAUTHORIZED") return "The provider rejected this session.";
  if (session.reason === "UNREACHABLE") return "The provider is currently unreachable.";
  if (session.reason === "DOMAIN_APPROVAL_REQUIRED") return "Approve the exact redirected hostname before login.";
  if (session.reason === "VAULT_UNAVAILABLE") return "Windows could not unlock the local credential vault.";
  if (session.reason === "RESET_FAILED") return "Some local session data could not be removed.";
  return session.state === "ACTIVE" ? "Validated and available to read-only adapters." : "No additional diagnostic.";
}

function displayState(state: RedactedSessionStatus["state"]): string {
  return state.replaceAll("_", " ");
}

function displayTime(value: number | null): string {
  return value === null ? "—" : new Date(value).toLocaleString();
}

export function SessionsPage({
  api = defaultApi,
  accountApi = defaultAccountApi
}: {
  readonly api?: SessionApiLike;
  readonly accountApi?: AccountApiLike;
}) {
  const [sessions, setSessions] = useState<readonly RedactedSessionStatus[]>([]);
  const [accounts, setAccounts] = useState<readonly AccountStatus[]>([]);
  const [accountAlias, setAccountAlias] = useState("");
  const [accountSessionId, setAccountSessionId] = useState("");
  const [entryUrl, setEntryUrl] = useState("https://fabet.com/");
  const [discovery, setDiscovery] = useState<FabetDiscoveryResult | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [provider, setProvider] = useState("SABA");
  const [kind, setKind] = useState<ManualSessionInput["kind"]>("TOKEN");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const refresh = async (): Promise<void> => {
    const result = await api.list();
    setSessions(result.sessions);
  };

  const refreshAccounts = async (): Promise<void> => {
    setAccounts(await accountApi.list());
  };

  useEffect(() => {
    void refresh().catch(() => setMessage("Session status is unavailable."));
  }, [api]);

  useEffect(() => {
    void refreshAccounts().catch(() => setAccountMessage("Account profile status is unavailable."));
  }, [accountApi]);

  useEffect(() => {
    if (resetOpen) cancelRef.current?.focus();
  }, [resetOpen]);

  const eligibleAccountSessions = sessions.filter((session) =>
    session.state === "ACTIVE" && session.provider !== "FABET" && ProviderIdSchema.safeParse(session.provider).success);

  useEffect(() => {
    if (!eligibleAccountSessions.some((session) => session.id === accountSessionId)) {
      setAccountSessionId(eligibleAccountSessions[0]?.id ?? "");
    }
  }, [sessions, accountSessionId]);

  const run = async (operation: () => Promise<void>, fallback: string): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      await operation();
    } catch {
      setMessage(fallback);
    } finally {
      setBusy(false);
    }
  };

  const discover = (): void => {
    void run(async () => {
      setDiscovery(await api.discoverFabet(entryUrl));
    }, "Fabet is unreachable. You can still enter a provider session directly.");
  };

  const trust = (): void => {
    if (discovery === null) return;
    void run(async () => {
      await api.trustFabet(discovery.finalHostname);
      setDiscovery({ ...discovery, trusted: true });
    }, "The redirected hostname could not be trusted.");
  };

  const submitFabet = (event: FormEvent): void => {
    event.preventDefault();
    if (discovery === null || !discovery.trusted) {
      setMessage("Discover and trust the current hostname before sending credentials.");
      return;
    }
    void run(async () => {
      try {
        await api.configureFabet({
          entryUrl: discovery.finalUrl,
          trustedHostname: discovery.finalHostname,
          username,
          password
        });
      } finally {
        setUsername("");
        setPassword("");
      }
      await refresh();
    }, "Fabet login failed. Credentials were not displayed or logged.");
  };

  const submitManual = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      try {
        await api.configureManual({ provider, kind, secret });
      } finally {
        setSecret("");
      }
      await refresh();
    }, "Provider session could not be validated.");
  };

  const sessionAction = (id: string, action: "validate" | "renew"): void => {
    void run(async () => {
      await api[action](id);
      await refresh();
    }, `Session ${action} failed.`);
  };

  const refreshAccount = (id: string): void => {
    setBusy(true);
    setAccountMessage(null);
    void accountApi.refresh(id).then(refreshAccounts).catch(() => {
      setAccountMessage("Provider profile refresh failed. No balance was assumed.");
    }).finally(() => setBusy(false));
  };

  const registerAccount = (event: FormEvent): void => {
    event.preventDefault();
    const session = eligibleAccountSessions.find((candidate) => candidate.id === accountSessionId);
    const parsedProvider = ProviderIdSchema.safeParse(session?.provider);
    if (session === undefined || !parsedProvider.success || accountAlias.trim().length === 0) return;
    setBusy(true);
    setAccountMessage(null);
    void accountApi.register({
      sessionId: session.id,
      alias: accountAlias.trim(),
      provider: parsedProvider.data as ProviderId
    }).then(async () => {
      setAccountAlias("");
      await refreshAccounts();
    }).catch(() => setAccountMessage("Provider account registration failed."))
      .finally(() => setBusy(false));
  };

  const reset = (): void => {
    void run(async () => {
      await api.resetFabet();
      setResetOpen(false);
      setDiscovery(null);
      await refresh();
    }, "Fabet reset failed.");
  };

  return (
    <>
      <header className="page-header">
        <p className="eyebrow">Local credential vault</p>
        <h1>Sessions</h1>
        <p>Configure login or provider launch material once. Secrets remain encrypted on this Windows user account.</p>
      </header>

      {message !== null && <p className="session-message" role="status">{message}</p>}

      <div className="session-config-grid">
        <section className="session-panel" aria-labelledby="fabet-session-heading">
          <h2 id="fabet-session-heading">Fabet login</h2>
          <label>Reachable Fabet URL<input value={entryUrl} onChange={(event) => { setEntryUrl(event.target.value); setDiscovery(null); }} /></label>
          <button disabled={busy} onClick={discover} type="button">Discover current domain</button>
          {discovery !== null && (
            <div className="domain-approval">
              <span>Redirected hostname</span><strong>{discovery.finalHostname}</strong>
              {discovery.trusted
                ? <span className="session-good">Trusted on this machine</span>
                : <button disabled={busy} onClick={trust} type="button">Trust {discovery.finalHostname}</button>}
            </div>
          )}
          <form onSubmit={submitFabet}>
            <label>Username<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
            <label>Password<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <button disabled={busy || username.length === 0 || password.length === 0} type="submit">Save and login</button>
          </form>
        </section>

        <section className="session-panel" aria-labelledby="manual-session-heading">
          <h2 id="manual-session-heading">Direct provider session</h2>
          <p>Use this when Fabet is blocked or when another portal supplied the provider session.</p>
          <form onSubmit={submitManual}>
            <label>Provider<input value={provider} onChange={(event) => setProvider(event.target.value.toUpperCase())} /></label>
            <label>Session type<select value={kind} onChange={(event) => setKind(event.target.value as ManualSessionInput["kind"])}>
              <option value="TOKEN">Token</option>
              <option value="LAUNCH_URL">Launch URL</option>
              <option value="COOKIE_BUNDLE">Cookie bundle</option>
            </select></label>
            <label>Provider token or launch URL<input autoComplete="off" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} /></label>
            <button disabled={busy || provider.length === 0 || secret.length === 0} type="submit">Save and validate</button>
          </form>
        </section>
      </div>

      <section className="session-panel session-status-panel" aria-labelledby="session-status-heading">
        <div className="session-heading-row">
          <h2 id="session-status-heading">Stored session status</h2>
          <button className="danger-button" disabled={busy} onClick={() => setResetOpen(true)} type="button">Reset Fabet session</button>
        </div>
        {sessions.length === 0 ? <p className="empty-state">No session is configured.</p> : (
          <div className="table-wrap"><table><thead><tr>
            <th>Provider</th><th>Category</th><th>Source</th><th>State</th><th>Trusted host</th><th>Last checked</th><th>Forced renewal</th><th>Diagnostic</th><th>Actions</th>
          </tr></thead><tbody>{sessions.map((session) => (
            <tr key={session.id}>
              <td>{session.provider}</td>
              <td>{session.category ?? "—"}</td>
              <td>{session.source === "FABET_LOGIN" ? "Fabet login" : "Direct"}</td>
              <td><strong className={`session-state session-state--${session.state.toLowerCase()}`}>{displayState(session.state)}</strong></td>
              <td>{session.trustedHostname ?? "—"}</td>
              <td>{displayTime(session.lastValidatedAtMs)}</td>
              <td>{displayTime(session.renewAfterMs)}</td>
              <td>{healthExplanation(session)}</td>
              <td className="session-actions">
                <button disabled={busy} onClick={() => sessionAction(session.id, "validate")} type="button">Validate</button>
                <button disabled={busy} onClick={() => sessionAction(session.id, "renew")} type="button">Renew</button>
              </td>
            </tr>
          ))}</tbody></table></div>
        )}
      </section>

      <section className="session-panel account-status-panel" aria-labelledby="account-status-heading">
        <div className="session-heading-row">
          <div><h2 id="account-status-heading">Provider accounts</h2><p>Balances are read from the provider and never inferred from local state.</p></div>
          <button disabled={busy} onClick={() => {
            setBusy(true);
            setAccountMessage(null);
            void refreshAccounts().catch(() => setAccountMessage("Account profile status is unavailable.")).finally(() => setBusy(false));
          }} type="button">Reload accounts</button>
        </div>
        {accountMessage !== null && <p className="session-message" role="status">{accountMessage}</p>}
        <form className="account-register-form" onSubmit={registerAccount}>
          <label>Account session<select aria-label="Account session" value={accountSessionId} onChange={(event) => setAccountSessionId(event.target.value)}>
            {eligibleAccountSessions.length === 0 && <option value="">No active verified provider session</option>}
            {eligibleAccountSessions.map((session) => <option key={session.id} value={session.id}>
              {session.provider} · {session.source === "FABET_LOGIN" ? "Fabet login" : "Direct"} · {session.state}
            </option>)}
          </select></label>
          <label>Account alias<input aria-label="Account alias" maxLength={80} value={accountAlias} onChange={(event) => setAccountAlias(event.target.value)} /></label>
          <button disabled={busy || accountSessionId.length === 0 || accountAlias.trim().length === 0} type="submit">Register provider account</button>
        </form>
        {accounts.length === 0
          ? <p className="empty-state">No provider account is registered yet.</p>
          : <div className="account-grid">{accounts.map((account) => (
            <AccountCard account={account} busy={busy} key={account.id} onRefresh={refreshAccount} />
          ))}</div>}
      </section>

      {resetOpen && (
        <div className="modal-backdrop">
          <section aria-labelledby="reset-title" aria-modal="true" className="confirm-dialog" role="dialog">
            <h2 id="reset-title">Reset Fabet session?</h2>
            <p>This deletes the local Fabet credential, token, trusted domains, and browser session. Direct provider sessions remain untouched.</p>
            <div className="dialog-actions">
              <button ref={cancelRef} onClick={() => setResetOpen(false)} type="button">Cancel</button>
              <button className="danger-button" disabled={busy} onClick={reset} type="button">Reset everything</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
