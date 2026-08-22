import type { AccountStatus } from "@tool-chenh/contracts";

function displayTime(value: number | null): string {
  return value === null ? "—" : new Date(value).toLocaleString();
}

export function AccountCard({
  account,
  busy,
  onRefresh
}: {
  readonly account: AccountStatus;
  readonly busy: boolean;
  readonly onRefresh: (id: string) => void;
}) {
  const balance = account.balance === null || account.currency === null
    ? "Unavailable"
    : `${account.balance} ${account.currency}`;
  return (
    <article className="account-card">
      <header>
        <div><span className="eyebrow">{account.provider}</span><h3>{account.alias}</h3></div>
        <strong className={`profile-state profile-state--${account.profileState.toLowerCase()}`}>{account.profileState}</strong>
      </header>
      <dl>
        <div><dt>Provider profile</dt><dd>{account.redactedLabel ?? "Not available"}</dd></div>
        <div><dt>Balance</dt><dd className="account-balance">{balance}</dd></div>
        <div><dt>Provider timestamp</dt><dd>{displayTime(account.balanceAsOfMs)}</dd></div>
        <div><dt>Session</dt><dd>{account.sessionState.replaceAll("_", " ")}</dd></div>
        <div><dt>Read capabilities</dt><dd>{account.capabilities.length === 0 ? "None verified" : account.capabilities.join(", ")}</dd></div>
      </dl>
      <button disabled={busy} onClick={() => onRefresh(account.id)} type="button">Refresh {account.alias}</button>
    </article>
  );
}
