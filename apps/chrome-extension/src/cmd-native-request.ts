const HOST = "cgnew.fts368.com";
export const CMD_MORE_PATH = "/Member/BetsView/BetLight/DataOdds.asmx/GetAllOdds";
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;

export interface CmdNativeRequestMetadata {
  readonly cmdFullScope?: true;
  readonly providerGroupId?: string;
}

/** Read only public scope/owner fields; account and session parameters stay in Chrome. */
export function cmdNativeRequestMetadata(request: {
  readonly url?: unknown; readonly method?: unknown; readonly postData?: unknown;
}): CmdNativeRequestMetadata {
  if (request.method !== "POST" || typeof request.url !== "string" ||
    typeof request.postData !== "string" || request.postData.length > 4_096) return {};
  try {
    const url = new URL(request.url);
    if (url.protocol !== "https:" || url.hostname !== HOST || url.username || url.password) return {};
    if (url.pathname === CMD_MORE_PATH) {
      const body: unknown = JSON.parse(request.postData);
      if (typeof body !== "object" || body === null || Array.isArray(body)) return {};
      const value = body as Record<string, unknown>;
      return (value.isPar === 0 || value.isPar === false) && typeof value.m_groupId === "string" && UUID.test(value.m_groupId)
        ? { providerGroupId: value.m_groupId.toLowerCase() } : {};
    }
    if (url.pathname !== "/Member/BetsView/BetLight/DataOdds.ashx") return {};
    const params = new URLSearchParams(url.search);
    new URLSearchParams(request.postData).forEach((value, key) => params.append(key, value));
    const exact = (key: string, expected: string): boolean => {
      const values = params.getAll(key);
      return values.length === 1 && values[0] === expected;
    };
    if (!(exact("fc", "1") || exact("fc", "6"))) return {};
    const fields = { TimeFilter: "0", m_gameType: "S_", SingleDouble: "double",
      m_sp: "0", m_LeagueList: "", fav: "", keywords: "", exlist: "0" };
    return Object.entries(fields).every(([key, value]) => exact(key, value)) ? { cmdFullScope: true } : {};
  } catch { return {}; }
}
