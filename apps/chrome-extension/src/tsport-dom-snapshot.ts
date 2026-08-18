// Read-only extraction of the public T-Sports football catalog currently
// rendered by the provider page. The expression intentionally returns only
// event/market/price fields; it never reads credentials, storage or forms.
export const TSPORT_PUBLIC_CATALOG_EXPRESSION = `(() => {
  const clean = (value, max = 160) => {
    const normalized = String(value ?? "").replace(/\\s+/gu, " ").trim();
    return normalized.length <= max ? normalized : "";
  };
  const text = (root, selector, max = 160) => clean(root.querySelector(selector)?.textContent, max);
  const line = (value) => {
    const match = clean(value, 32).match(/[+-]?(?:0|[1-9]\\d*)(?:\\.(?:25|5|75))?(?:\\s*[\\/-]\\s*(?:0|[1-9]\\d*)(?:\\.(?:25|5|75))?)?/u);
    return match?.[0]?.replace(/\\s+/gu, "") ?? null;
  };
  const records = [];
  for (const node of document.querySelectorAll(".match")) {
    const favoriteId = clean(node.querySelector(".match-favorite")?.id, 128);
    const favoriteEventId = favoriteId.match(/eventId-[^-]+-\\d+-([0-9]+)$/u)?.[1] ?? "";
    const dataEventId = clean(node.getAttribute("data-event-id") || node.getAttribute("data-eventid"), 128);
    const nodeEventId = clean(node.id, 128).match(/([0-9]{4,})$/u)?.[1] ?? "";
    const eventId = favoriteEventId || dataEventId || nodeEventId;
    const leagueName = text(node, ".league-name");
    const teamNames = [...node.querySelectorAll(".match__team-name")]
      .slice(0, 2).map((element) => clean(element.textContent)).filter(Boolean);
    const rawStatus = text(node, ".match__status, .match__time, .match-time", 80);
    const scores = [...node.querySelectorAll(".match__team-score")]
      .slice(0, 2).map((element) => clean(element.textContent, 8));
    const scoreText = scores.length === 2 && scores.every((score) => /^\\d+$/u.test(score))
      ? scores.join(" - ") : null;
    const timeText = /(?:live|trực\\s*tiếp|hiệp|\\d+h)/iu.test(rawStatus) || scoreText !== null
      ? (rawStatus || "LIVE") : rawStatus;
    if (!eventId || !leagueName || teamNames.length !== 2 || !timeText) continue;
    const markets = [...node.querySelectorAll(".match-odd-pair-list")].flatMap((group, groupIndex) => {
      const label = text(group, ".match__odd-pair-list__type", 80);
      const normalizedLabel = label.normalize("NFD").replace(/[\\u0300-\\u036f]/gu, "").toLowerCase();
      const marketType = /(?:handicap|chap|cuoc chap|asian handicap|\\bah\\b)/u.test(normalizedLabel)
        ? "FT_AH" : /(?:total|over\\s*\\/?\\s*under|t\\s*\\/\\s*x|tai\\s*\\/?\\s*xiu)/u.test(normalizedLabel)
          ? "FT_TOTAL" : null;
      if (marketType === null) return [];
      const odds = [...group.querySelectorAll(".match__odd-pair")];
      if (odds.length !== 2) return [];
      const rawTypes = odds.map((odd) => text(odd, ".match__odd-type", 32));
      const lines = rawTypes.map(line);
      if (lines.some((value) => value === null)) return [];
      const selections = odds.map((odd, index) => ({
        selectionId: clean(odd.id.replace(/^odd-item-/u, ""), 128) ||
          eventId + ":" + marketType + ":" + groupIndex + ":" + index,
        selection: marketType === "FT_AH" ? (index === 0 ? "HOME" : "AWAY")
          : (index === 0 ? "OVER" : "UNDER"),
        priceText: text(odd, ".match__odd-value", 32),
        locked: odd.matches("[disabled], .disabled, .locked") ||
          odd.querySelector("[disabled], .disabled, .locked") !== null,
        ...(marketType === "FT_AH" ? { lineText: lines[index] } : {})
      }));
      if (selections.some((selection) => !selection.priceText)) return [];
      const lineText = lines[0];
      return [{ marketId: eventId + ":" + marketType + ":" + lineText + ":" + groupIndex,
        marketType, lineText, selections }];
    });
    records.push({ eventId, leagueName, timeText, scoreText, teamNames, markets });
  }
  return JSON.stringify(records);
})()`;
