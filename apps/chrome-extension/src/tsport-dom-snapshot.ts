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
  // Cache ancestor/style checks across every match. This catches CSS-hidden
  // provider panels without forcing geometry/layout reads for every row.
  const hiddenByTree = new WeakMap();
  const isHiddenByTree = (element) => {
    if (!element || typeof element !== "object") return true;
    const cached = hiddenByTree.get(element);
    if (cached !== undefined) return cached;
    const hiddenByAttribute = element.hidden === true ||
      element.getAttribute?.("hidden") !== null ||
      element.getAttribute?.("aria-hidden") === "true";
    let hiddenByStyle = false;
    if (typeof getComputedStyle === "function") {
      try {
        const style = getComputedStyle(element);
        hiddenByStyle = style.display === "none" ||
          style.visibility === "hidden" || style.visibility === "collapse" ||
          style.contentVisibility === "hidden";
      } catch {
        hiddenByStyle = true;
      }
    }
    const hidden = hiddenByAttribute || hiddenByStyle ||
      (element.parentElement != null && isHiddenByTree(element.parentElement));
    hiddenByTree.set(element, hidden);
    return hidden;
  };
  const footballRoots = [...document.querySelectorAll(
    '[data-sport-id="1"], ' +
    '[data-sportid="1"], ' +
    '[data-football-event-list="true"][data-loaded="true"], ' +
    '[data-role="football-event-list"][data-loaded="true"], ' +
    '.football-match-list[data-loaded="true"], ' +
    '.match-list[data-sport-id="1"][data-loaded="true"], ' +
    '.match-list[data-sportid="1"][data-loaded="true"]'
  )].filter((root) => !isHiddenByTree(root));
  if (footballRoots.length !== 1) return JSON.stringify([]);
  const footballRoot = footballRoots[0];
  if (isHiddenByTree(footballRoot) || footballRoot.getAttribute('data-loaded') === 'false' ||
    footballRoot.getAttribute('aria-busy') === 'true' ||
    footballRoot.querySelector('[aria-busy="true"], [data-loading="true"]') !== null) {
    return JSON.stringify([]);
  }
  // Measured 2026-08-27: the element carrying data-sport-id="1" held one row
  // while the page showed eighteen, and .match-list and .football-match-list did
  // not exist at all. The gate above passed on that single element and the sweep
  // returned one fixture out of the 554 the lobby's own menu counted, with no
  // way to tell that from an empty page. The rows themselves are the evidence:
  // when the root holds fewer of them than the document does, the root is not
  // the list and the rows are read where they actually are. Their own checks -
  // an event id, a league, two distinct teams, a usable market - still decide
  // what is accepted, so widening where they are looked for cannot admit a row
  // that would have been refused.
  const rootCandidates = [...footballRoot.querySelectorAll(".match")];
  const documentCandidates = [...document.querySelectorAll(".match")]
    .filter((node) => !footballRoots.includes(node));
  const candidates = rootCandidates.length >= documentCandidates.length
    ? rootCandidates : documentCandidates;
  const records = [];
  // A row that is not a fixture at all - a header, a promotion, anything with
  // no teams behind it - is not a failed read, and neither is one the page is
  // not showing. Counting them made the sweep incomplete for as long as the
  // page carried one: measured 2026-08-27, 26 rows of which 23 carried every
  // field, so the sweep never completed, no frame ever answered, no snapshot
  // was ever sent and the feed sat in hard recovery with no generation - and
  // with no generation there was nothing to capture against. Only a row that
  // looks like a fixture and still cannot be read means the list was caught
  // half-rendered, which is what this count is for.
  let invalidCandidates = 0;
  let fixtureCandidates = 0;
  for (const node of candidates) {
    if (isHiddenByTree(node)) {
      // A stale row the page is hiding means it is still changing, which is a
      // genuine reason to withhold completion.
      invalidCandidates += 1;
      continue;
    }
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
    // Two teams is what makes a row a fixture. A row carrying them but missing
    // an id, a league or a time is a fixture still rendering and must withhold
    // completion; a row with no teams at all was never one.
    const looksLikeFixture = teamNames.length === 2;
    if (looksLikeFixture) fixtureCandidates += 1;
    if (!eventId || !leagueName || teamNames.length !== 2 || !timeText) {
      if (looksLikeFixture) invalidCandidates += 1;
      continue;
    }
    const markets = [...node.querySelectorAll(".match-odd-pair-list")].flatMap((group, groupIndex) => {
      const label = text(group, ".match__odd-pair-list__type", 80);
      const normalizedLabel = label.normalize("NFD").replace(/[\\u0300-\\u036f]/gu, "").toLowerCase();
      const isHandicap = /(?:handicap|chap|cuoc chap|asian handicap|\\bah\\b)/u.test(normalizedLabel) ||
        normalizedLabel.includes("cháº¥p");
      const isTotal = /(?:total|over\\s*\\/?\\s*under|t\\s*\\/\\s*x|tai\\s*\\/?\\s*xiu)/u.test(normalizedLabel);
      const firstHalf = /(?:hiep\\s*1|first\\s*half|\\b1h\\b)/u.test(normalizedLabel);
      const secondHalf = /(?:hiep\\s*2|second\\s*half|\\b2h\\b)/u.test(normalizedLabel);
      const corner = /(?:phat\\s*goc|corner)/u.test(normalizedLabel);
      const card = /(?:the\\s*phat|booking|card)/u.test(normalizedLabel);
      if (isHandicap === isTotal || (firstHalf && secondHalf) || (corner && card) ||
        ((corner || card) && secondHalf)) return [];
      const kind = isHandicap ? "AH" : "TOTAL";
      const marketType = corner ? "CORNER_" + (firstHalf ? "FH" : "FT") + "_" + kind
        : card ? "CARD_" + (firstHalf ? "FH" : "FT") + "_" + kind
          : (firstHalf ? "FH" : secondHalf ? "SH" : "FT") + "_" + kind;
      if (marketType === null) return [];
      const odds = [...group.querySelectorAll(".match__odd-pair")];
      if (odds.length !== 2) return [];
      const rawTypes = odds.map((odd) => text(odd, ".match__odd-type", 32));
      const lines = rawTypes.map(line);
      if (lines.some((value) => value === null)) return [];
      if (!isHandicap && new Set(lines).size !== 1) return [];
      const selections = odds.map((odd, index) => ({
        selectionId: clean(odd.id.replace(/^odd-item-/u, ""), 128),
        selection: isHandicap ? (index === 0 ? "HOME" : "AWAY")
          : (index === 0 ? "OVER" : "UNDER"),
        priceText: text(odd, ".match__odd-value", 32),
        locked: odd.matches("[disabled], .disabled, .locked") ||
          odd.querySelector("[disabled], .disabled, .locked") !== null,
        ...(isHandicap ? { lineText: lines[index] } : {})
      }));
      if (selections.some((selection) => !selection.selectionId || !selection.priceText)) return [];
      const lineText = lines[0];
      return [{ marketId: eventId + ":" + marketType + ":" + lineText + ":" + groupIndex,
        marketType, lineText, selections }];
    });
    records.push({ eventId, leagueName, timeText, scoreText, teamNames, markets });
  }
  // A shell, login frame, busy list, or partially rendered list is not a
  // complete football catalog. Empty authority requires an event-list-specific
  // sentinel on the exact ready root; generic descendant empty states (for
  // example an empty bet slip) cannot complete the sweep.
  const exactEmpty = candidates.length === 0 && (
    footballRoot.matches('[data-empty="true"], [data-state="empty"]') ||
    footballRoot.querySelector(
      '[data-football-events-empty="true"], [data-event-list-empty="true"], ' +
      '.football-match-list__empty, .match-list__empty'
    ) !== null
  );
  const complete = fixtureCandidates > 0
    ? invalidCandidates === 0 && records.length === fixtureCandidates
    : exactEmpty;
  if (complete) {
    // The observer adds the current frame/loader binding before forwarding it,
    // so a different document cannot reuse these expected event ids.
    records.push({ __fieldlineSweep: {
      sweepId: "tsport-sweep-" + Date.now(),
      complete: true
    } });
  }
  return JSON.stringify(records);
})()`;
