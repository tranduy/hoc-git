import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AccountStatus, RedactedSessionStatus, SessionStatusList } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { SessionsPage, type SessionApiLike } from "./sessions-page.js";
import type { AccountApiLike } from "../api/accounts.js";

const active: RedactedSessionStatus = {
  id: "manual-1",
  provider: "SABA",
  category: null,
  source: "MANUAL_PROVIDER_SESSION",
  state: "ACTIVE",
  trustedHostname: null,
  acquiredAtMs: 100,
  lastValidatedAtMs: 100,
  renewAfterMs: 86_400_100,
  secretConfigured: true,
  reason: null
};

class FakeSessionApi implements SessionApiLike {
  sessions: RedactedSessionStatus[] = [active];
  resetCount = 0;

  async list(): Promise<SessionStatusList> { return { sessions: [...this.sessions] }; }
  async discoverFabet() { return { requestedUrl: "https://fabet.com/", finalUrl: "https://fabet.party/", finalHostname: "fabet.party", trusted: false }; }
  async trustFabet(hostname: string) { return { hostname, trusted: true as const }; }
  async configureFabet(): Promise<RedactedSessionStatus> { return active; }
  async configureManual(input: { provider: string; kind: "TOKEN" | "COOKIE_BUNDLE" | "LAUNCH_URL"; secret: string }): Promise<RedactedSessionStatus> {
    if (input.secret !== "ui-secret-canary") throw new Error("bad secret");
    const configured = { ...active, id: "manual-2", provider: input.provider, state: "ACTION_REQUIRED" as const, reason: "SCHEMA_CHANGED" as const };
    this.sessions = [...this.sessions, configured];
    return configured;
  }
  async validate(): Promise<RedactedSessionStatus> { return active; }
  async renew(): Promise<RedactedSessionStatus> { return active; }
  async resetFabet(): Promise<void> { this.resetCount += 1; this.sessions = this.sessions.filter((session) => session.source !== "FABET_LOGIN"); }
}

class FakeAccountApi implements AccountApiLike {
  accounts: AccountStatus[] = [{
    id: "account-1",
    alias: "CMD account 1",
    provider: "CMD",
    sessionState: "ACTIVE",
    profileState: "FRESH",
    redactedLabel: "••••1445",
    currency: "UUS",
    balance: "0",
    balanceAsOfMs: 1_800_000_000_000,
    capabilities: ["PROFILE", "CATALOG"],
    reason: null
  }];

  async list(): Promise<readonly AccountStatus[]> { return [...this.accounts]; }
  async register(input: { sessionId: string; alias: string; provider: AccountStatus["provider"] }): Promise<AccountStatus> {
    const created: AccountStatus = {
      id: `account-${this.accounts.length + 1}`, alias: input.alias, provider: input.provider,
      sessionState: "ACTIVE", profileState: "UNAVAILABLE", redactedLabel: null, currency: null,
      balance: null, balanceAsOfMs: null, capabilities: input.provider === "CMD" ? ["PROFILE", "CATALOG"] : [], reason: "SCHEMA_CHANGED"
    };
    this.accounts = [...this.accounts, created];
    return created;
  }
  async refresh(id: string): Promise<AccountStatus> {
    const account = this.accounts.find((candidate) => candidate.id === id);
    if (account === undefined) throw new Error("ACCOUNT_NOT_FOUND");
    return account;
  }
}

afterEach(() => cleanup());

describe("SessionsPage", () => {
  it("registers a second verified session as a distinct provider account", async () => {
    const sessionApi = new FakeSessionApi();
    sessionApi.sessions = [
      { ...active, id: "cmd-session-1", provider: "CMD" },
      { ...active, id: "cmd-session-2", provider: "CMD" }
    ];
    const accountApi = new FakeAccountApi();
    accountApi.accounts = [];
    render(<SessionsPage api={sessionApi} accountApi={accountApi} />);

    expect(await screen.findAllByRole("option", { name: "CMD · Direct · ACTIVE" })).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Account session"), { target: { value: "cmd-session-2" } });
    fireEvent.change(screen.getByLabelText("Account alias"), { target: { value: "CMD second" } });
    fireEvent.click(screen.getByRole("button", { name: "Register provider account" }));

    expect(await screen.findByText("CMD second")).toBeTruthy();
    expect(accountApi.accounts).toHaveLength(1);
    expect(accountApi.accounts[0]).toMatchObject({ alias: "CMD second", provider: "CMD" });
  });

  it("shows redacted provider profiles and refreshes balances without exposing session material", async () => {
    const accountApi = new FakeAccountApi();
    render(<SessionsPage api={new FakeSessionApi()} accountApi={accountApi} />);

    expect(await screen.findByRole("heading", { name: "Provider accounts" })).toBeTruthy();
    expect(screen.getByText("CMD account 1")).toBeTruthy();
    expect(screen.getByText("••••1445")).toBeTruthy();
    expect(screen.getByText("0 UUS")).toBeTruthy();
    expect(screen.getByText("FRESH")).toBeTruthy();
    expect(document.body.textContent).not.toContain("launchUrl");

    accountApi.accounts = [{ ...accountApi.accounts[0]!, balance: "25000", profileState: "STALE" }];
    fireEvent.click(screen.getByRole("button", { name: "Refresh CMD account 1" }));
    expect(await screen.findByText("25000 UUS")).toBeTruthy();
    expect(screen.getByText("STALE")).toBeTruthy();
  });

  it("clears manual secret input and renders fail-closed validation state", async () => {
    render(<SessionsPage api={new FakeSessionApi()} />);
    await screen.findByText("SABA");
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "BTI" } });
    fireEvent.change(screen.getByLabelText("Provider token or launch URL"), { target: { value: "ui-secret-canary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and validate" }));

    await screen.findByText("ACTION REQUIRED");
    expect((screen.getByLabelText("Provider token or launch URL") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("ui-secret-canary")).toBeNull();
    expect(screen.getByText("Provider protocol is not validated yet.")).toBeTruthy();
  });

  it("shows the exact discovered hostname before trust", async () => {
    render(<SessionsPage api={new FakeSessionApi()} />);
    fireEvent.click(screen.getByRole("button", { name: "Discover current domain" }));

    expect(await screen.findByText("fabet.party")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Trust fabet.party" })).toBeTruthy();
  });

  it("keeps state after cancel and resets only after destructive confirmation", async () => {
    const api = new FakeSessionApi();
    api.sessions = [{ ...active, id: "fabet", provider: "FABET", source: "FABET_LOGIN", trustedHostname: "fabet.party" }];
    render(<SessionsPage api={api} />);
    await screen.findByText("FABET");

    fireEvent.click(screen.getByRole("button", { name: "Reset Fabet session" }));
    expect(screen.getByRole("dialog").textContent).toContain("credential, token, trusted domains, and browser session");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("FABET")).toBeTruthy();
    expect(api.resetCount).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Reset Fabet session" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset everything" }));
    await waitFor(() => expect(screen.queryByText("FABET")).toBeNull());
    expect(api.resetCount).toBe(1);
  });

  it("leaves manual entry available when Fabet discovery fails", async () => {
    const api = new FakeSessionApi();
    api.discoverFabet = async () => { throw new Error("unreachable-secret-canary"); };
    render(<SessionsPage api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "Discover current domain" }));
    expect(await screen.findByText("Fabet is unreachable. You can still enter a provider session directly.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save and validate" })).toBeTruthy();
    expect(screen.queryByText("unreachable-secret-canary")).toBeNull();
  });

  it("clears Fabet credentials even when login fails", async () => {
    const api = new FakeSessionApi();
    api.discoverFabet = async () => ({
      requestedUrl: "https://fabet.party/",
      finalUrl: "https://fabet.party/",
      finalHostname: "fabet.party",
      trusted: true
    });
    api.configureFabet = async () => { throw new Error("login-secret-canary"); };
    render(<SessionsPage api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "Discover current domain" }));
    await screen.findByText("Trusted on this machine");
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "failed-user-canary" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "failed-password-canary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and login" }));

    await screen.findByText("Fabet login failed. Credentials were not displayed or logged.");
    expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect(document.body.textContent).not.toMatch(/failed-user-canary|failed-password-canary|login-secret-canary/u);
  });
});
