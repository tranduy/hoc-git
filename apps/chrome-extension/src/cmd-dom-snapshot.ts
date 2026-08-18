// This expression returns only public catalog fields. It never returns HTML,
// storage, cookies, URLs, request headers, or form values.
export const CMD_PUBLIC_CATALOG_EXPRESSION = `(() => {
  const clean = (value, max = 160) => {
    const normalized = String(value ?? "").replace(/\\s+/gu, " ").trim();
    return normalized.length <= max ? normalized : "";
  };
  const directText = (element) => clean([...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "").join(" "), 80);
  const result = [];
  for (const match of document.querySelectorAll(".c-odds-table--sport1 .c-match[data-matchid]")) {
    const matchId = clean(match.getAttribute("data-matchid"), 128);
    const league = match.closest(".c-league");
    if (!matchId || !league) continue;
    const groups = [...match.querySelectorAll(".c-match__odds-group")].flatMap((container) => {
      const rows = [...container.querySelectorAll("[data-bt]")]
        .filter((row) => row.querySelector(".c-odds[data-moid]") !== null);
      return (rows.length > 0 ? rows : [container]).map((group) => {
        const semantic = [
          ...(group.matches("[data-bt], [data-in-play]") ? [group] : []),
          ...group.querySelectorAll("[data-bt], [data-in-play]")
        ];
        const betTypeIds = [...new Set([
          ...(group.matches("[data-bt]") ? [group] : []),
          ...group.querySelectorAll("[data-bt]")
        ].map((element) => clean(element.getAttribute("data-bt"), 80)).filter(Boolean))];
        const directLabels = semantic.filter((element) => !element.classList.contains("c-odds")).map(directText);
        const leafLabels = [...group.querySelectorAll("*")]
          .filter((element) => element.children.length === 0 && !element.classList.contains("c-odds") &&
            !element.matches("i, svg, path"))
          .map((element) => clean(element.textContent, 80));
        const labels = [...new Set([...directLabels, ...leafLabels].filter(Boolean))];
        const odds = [...group.querySelectorAll(".c-odds[data-moid]")].map((element) => {
          const button = element.closest(".c-odds-button");
          const base = {
            marketOddsId: clean(element.getAttribute("data-moid"), 128),
            priceText: clean(element.textContent, 32),
            status: button ? clean(button.getAttribute("data-odds-status"), 32) || null : null,
            greyedOut: button ? clean(button.getAttribute("data-grey-out"), 16) || null : null
          };
          if (!betTypeIds.includes("1")) return base;
          const clone = button?.cloneNode(true);
          clone?.querySelectorAll(".c-odds").forEach((price) => price.remove());
          const evidence = clone ? clean(clone.textContent, 32) : "";
          return { ...base, lineText: evidence.match(/[+-]?\\d+(?:\\.\\d+)?(?:\\s*[\\/-]\\s*\\d+(?:\\.\\d+)?)?/u)?.[0] ?? null };
        }).filter((odd) => odd.marketOddsId && odd.priceText);
        return { betTypeIds, labels, odds };
      }).filter((group) => group.odds.length > 0 && group.betTypeIds.length === 1);
    });
    result.push({
      sportId: "1",
      leagueId: clean(league.getAttribute("data-leagueid"), 128),
      leagueName: clean(league.querySelector(".c-league__name")?.textContent, 160),
      matchId,
      timeText: clean(match.querySelector(".c-match-time")?.textContent, 80),
      teamNames: [...new Set([...match.querySelectorAll(".c-team-name")]
        .map((element) => clean(element.textContent, 160)).filter(Boolean))].slice(0, 4),
      groups
    });
  }
  if (result.length === 0 && document.querySelector(".match .team") !== null) {
    const records = new Map();
    let leagueId = "";
    let leagueName = "";
    let baseMatchId = "";
    for (const node of document.querySelectorAll(".league, .match")) {
      if (node.classList.contains("league")) {
        leagueId = clean(node.id.replace(/^lg\\d*_/u, ""), 128);
        leagueName = clean(node.textContent, 160);
        baseMatchId = "";
        continue;
      }
      const rowId = clean(node.id.replace(/^R_/u, ""), 128);
      if (!rowId || !leagueId || !leagueName) continue;
      if (node.classList.contains("default-match") || !baseMatchId) baseMatchId = rowId;
      const team = node.querySelector(".team");
      if (!team) continue;
      const eventName = team.querySelector(".tableDiv-match-info__event") ?? team;
      const renderedLines = String(eventName.innerText ?? "").split(/\\s*\\n\\s*/u).map((value) => clean(value, 160));
      const childLabels = [...eventName.children].map((element) => clean(element.innerText || element.textContent, 160));
      const leafLabels = [...eventName.querySelectorAll("*")]
        .map((element) => clean(element.innerText || element.textContent, 160));
      const isTeamLabel = (value) => value && !/(?:hòa|hÃ²a|draw)/iu.test(value) &&
        !/^\\d+(?::\\d+)?$/u.test(value) && !/^[+\\d-]*(?:\\s|\\d|[.:\\/'-])*$/u.test(value);
      const lineTeams = [...new Set(renderedLines.filter(isTeamLabel))];
      const fallbackTeams = [...new Set([...childLabels, ...leafLabels].filter(isTeamLabel))]
        .sort((left, right) => left.length - right.length);
      const teamNames = (lineTeams.length >= 2 ? lineTeams : fallbackTeams).slice(0, 2);
      if (teamNames.length !== 2) continue;
      const rawTime = clean(node.querySelector(".tableDiv-match-time")?.textContent, 80);
      const liveClock = /(\\d)H\\s*(\\d+)/iu.exec(rawTime);
      const timeText = liveClock ? liveClock[1] + "H" + liveClock[2] + "'" : rawTime;
      const groups = [];
      const marketContainers = [
        { element: node.querySelector(".Dbox_b2"), betType: "1" },
        { element: [...node.querySelectorAll(".Dbox_b3")]
          .find((element) => element.querySelectorAll(".odds").length === 2), betType: "3" }
      ];
      for (const market of marketContainers) {
        if (!market.element) continue;
        const priceElements = [...market.element.querySelectorAll(".odds")].slice(0, 2);
        if (priceElements.length !== 2) continue;
        const clone = market.element.cloneNode(true);
        clone.querySelectorAll(".odds").forEach((price) => price.remove());
        const evidence = clean(clone.textContent, 80).replace(/\\b(?:o|u|ou)\\b/giu, " ");
        const lineValue = evidence.match(/[+-]?\\d+(?:\\.\\d+)?(?:\\s*\\/\\s*\\d+(?:\\.\\d+)?)?/u)?.[0] ?? "";
        if (!lineValue) continue;
        const marketOddsId = "legacy:" + rowId + ":" + market.betType + ":" + lineValue.replace(/\\s+/gu, "");
        groups.push({
          betTypeIds: [market.betType], labels: [lineValue],
          odds: priceElements.map((element, index) => ({
            marketOddsId, priceText: clean(element.textContent, 32), status: null,
            greyedOut: element.classList.contains("no-hover") || element.getAttribute("aria-disabled") === "true" ? "true" : null,
            ...(market.betType === "1" && index === 0 ? { lineText: lineValue } : {})
          }))
        });
      }
      const current = records.get(baseMatchId);
      if (current) current.groups.push(...groups);
      else records.set(baseMatchId, { sportId: "1", leagueId, leagueName, matchId: baseMatchId,
        timeText, teamNames, groups: [...groups] });
    }
    result.push(...records.values());
  }
  if (result.length === 0) {
    const describe = (element) => {
      const allowedAttributes = new Set(["id", "data-id", "data-mid", "data-matchid", "data-match-id",
        "data-eventid", "data-event-id", "data-oddsid", "data-odds-id", "data-moid", "data-bt",
        "data-line", "data-hdp", "data-leagueid"]);
      const attributes = {};
      for (const attribute of element.attributes) {
        if (allowedAttributes.has(attribute.name) && attribute.value.length <= 128) {
          attributes[attribute.name] = attribute.value;
        }
      }
      return {
        tag: element.tagName.toLowerCase(),
        classNames: [...element.classList].filter((name) => /^[a-z0-9_-]{1,64}$/iu.test(name)).slice(0, 12),
        attributes,
        text: clean(element.textContent, 160)
      };
    };
    const classCounts = new Map();
    for (const element of document.querySelectorAll("[class]")) {
      for (const name of element.classList) {
        if (!/^[a-z0-9_-]{1,64}$/iu.test(name)) continue;
        classCounts.set(name, (classCounts.get(name) ?? 0) + 1);
      }
    }
    const classNames = [...classCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 80)
      .map(([name, count]) => name + ":" + count);
    result.push({ __fieldlineDiagnostic: {
      matchCount: document.querySelectorAll(".c-match").length,
      dataMatchIdCount: document.querySelectorAll("[data-matchid]").length,
      oddsIdCount: document.querySelectorAll("[data-moid]").length,
      tableCount: document.querySelectorAll("table").length,
      classNames,
      leagueSamples: [...document.querySelectorAll(".league")].slice(0, 3).map(describe),
      matchSamples: [...document.querySelectorAll(".match")].slice(0, 3).map((match) => ({
        node: describe(match),
        descendants: [...match.querySelectorAll(".team, .odds, [class*='Dbox_'], [class*='tableDiv-match']")]
          .slice(0, 60).map(describe)
      }))
    } });
  }
  return JSON.stringify(result);
})()`;
