interface Candidate {
  readonly lobby: string;
  readonly tabId: number;
  readonly hostname: string;
}

interface StatusResponse {
  readonly ok: boolean;
  readonly configured: boolean;
  readonly candidates: Candidate[];
  readonly attached: Array<{ lobby: string; tabId: number; state: string }>;
}

const keyInput = document.querySelector<HTMLInputElement>("#installation-key")!;
const saveButton = document.querySelector<HTMLButtonElement>("#save-key")!;
const stateNode = document.querySelector<HTMLElement>("#bridge-state")!;
const tabsNode = document.querySelector<HTMLElement>("#tabs")!;
const attachAllButton = document.querySelector<HTMLButtonElement>("#attach-all")!;

async function refresh(): Promise<void> {
  const status = await chrome.runtime.sendMessage({ kind: "STATUS" }) as StatusResponse;
  stateNode.textContent = status.configured ? "Loopback bridge configured" : "Enter the local key, then Save";
  tabsNode.replaceChildren();
  if (!status.candidates.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No recognized sportsbook tabs are open.";
    tabsNode.append(empty);
    return;
  }
  for (const candidate of status.candidates) {
    const attached = status.attached.find((entry) => entry.tabId === candidate.tabId);
    const row = document.createElement("div");
    row.className = "tab";
    const label = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = candidate.lobby;
    const host = document.createElement("small");
    host.textContent = candidate.hostname;
    label.append(title, host);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = attached?.state ?? "Attach";
    button.disabled = Boolean(attached);
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Attaching…";
      await chrome.runtime.sendMessage({ kind: "ATTACH_TAB", tabId: candidate.tabId });
      await refresh();
    });
    row.append(label, button);
    tabsNode.append(row);
  }
}

saveButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ kind: "SAVE_KEY", installationKey: keyInput.value });
  keyInput.value = "";
  await refresh();
});

attachAllButton.addEventListener("click", async () => {
  attachAllButton.disabled = true;
  attachAllButton.textContent = "Attaching…";
  await chrome.runtime.sendMessage({ kind: "ATTACH_ALL" });
  attachAllButton.disabled = false;
  attachAllButton.textContent = "Attach all";
  await refresh();
});

void refresh();
