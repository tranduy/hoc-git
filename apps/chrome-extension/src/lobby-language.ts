import type { ChromeLobbyId } from "@tool-chenh/contracts";

export type LobbyLanguage = "en" | "vi";

/**
 * Rewrite the one thing on a lobby URL that names its language, leaving every
 * other part of it alone - above all the session token, which is spent the
 * moment it is re-requested and takes the book with it.
 *
 * Each book names the language differently, and one of them puts it in the
 * path rather than the query:
 *
 *   SABA     /(S(<session>))/NewIndex?lang=vn
 *   T-SPORT  ?token=<token>&lng=vi
 *   K-SPORT  ?token=<token>&lng=vi
 *   IM       ?languageCode=vi&token=<token>
 *   BTI      /vi/asian-view/today/<Football>
 *
 * Returns null when the URL already reads that language, so a caller cannot
 * navigate a page for no reason.
 */
export function lobbyLanguageUrl(lobby: ChromeLobbyId, currentUrl: string,
  language: LobbyLanguage): string | null {
  let url: URL;
  try { url = new URL(currentUrl); } catch { return null; }
  if (url.protocol !== "https:") return null;

  if (lobby === "BTI") {
    const segments = url.pathname.split("/").filter(Boolean);
    const head = segments[0] ?? "";
    if (!/^[a-z]{2}$/u.test(head)) return null;
    if (head === language) return null;
    // The day segment is named in the page language too, and only these two
    // spellings are proven from the real lobby.
    const rest = segments.slice(1)
      .map((segment) => segment === "B%C3%B3ng-%C4%91%C3%A1" || segment === "Bóng-đá"
        ? (language === "vi" ? "Bóng-đá" : "Football")
        : segment === "Football" ? (language === "vi" ? "Bóng-đá" : "Football") : segment);
    url.pathname = `/${[language, ...rest].join("/")}`;
    return url.href;
  }

  const parameter = lobby === "SABA" ? "lang" : lobby === "IM" ? "languageCode" : "lng";
  const wanted = lobby === "SABA" ? (language === "vi" ? "vn" : "en") : language;
  const held = url.searchParams.get(parameter);
  if (held === null || held === wanted) return null;
  url.searchParams.set(parameter, wanted);
  return url.href;
}
