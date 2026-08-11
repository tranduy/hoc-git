export interface ImSelectionRecord {
  readonly code: number;
  readonly name: string;
  readonly odds: number;
  readonly handicap: number;
  readonly locked: boolean;
}

export interface ImMarketRecord {
  readonly sportId: number;
  readonly sportName: string;
  readonly leagueId: number;
  readonly leagueName: string;
  readonly parentMatchNo: number;
  readonly parentHomeId: number;
  readonly parentHomeName: string;
  readonly parentAwayId: number;
  readonly parentAwayName: string;
  readonly parentDate: string;
  readonly matchNo: number;
  readonly gameTypeCode: string;
  readonly gameTypeName: string;
  readonly marketGroup: string;
  readonly gameOrder: number;
  readonly status: number;
  readonly isLive: boolean;
  readonly matchDate: string;
  readonly selections: readonly ImSelectionRecord[];
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function extractImCatalogRecords(body: unknown): readonly ImMarketRecord[] {
  const root = object(body);
  if (root === null || number(root.StatusCode) !== 0) return [];
  const output: ImMarketRecord[] = [];
  for (const sportValue of array(root.Sport)) {
    const sport = object(sportValue);
    const sportId = number(sport?.SportId);
    if (sport === null || sportId === null) continue;
    for (const leagueValue of array(sport.LG)) {
      const league = object(leagueValue);
      const leagueId = number(league?.LGId);
      if (league === null || leagueId === null) continue;
      for (const parentValue of array(league.ParentMatch)) {
        const parent = object(parentValue);
        const parentMatchNo = number(parent?.PMatchNo);
        const parentHomeId = number(parent?.PHTId);
        const parentAwayId = number(parent?.PATId);
        if (parent === null || parentMatchNo === null || parentHomeId === null || parentAwayId === null) continue;
        for (const matchValue of array(parent.Match)) {
          const match = object(matchValue);
          const matchNo = number(match?.MatchNo);
          const gameOrder = number(match?.GameOrder);
          const status = number(match?.Status);
          if (match === null || matchNo === null || gameOrder === null || status === null ||
            typeof match.IsLive !== "boolean") continue;
          for (const oddsValue of array(match.Odds)) {
            const odds = object(oddsValue);
            if (odds === null) continue;
            const selections = array(odds.SEL).flatMap((selectionValue): ImSelectionRecord[] => {
              const selection = object(selectionValue);
              const code = number(selection?.SCode);
              const price = number(selection?.Odds);
              const handicap = number(selection?.HDP);
              if (selection === null || code === null || price === null || handicap === null ||
                typeof selection.IsLock !== "boolean") return [];
              return [{ code, name: text(selection.SName), odds: price, handicap, locked: selection.IsLock }];
            });
            if (selections.length === 0) continue;
            output.push({
              sportId, sportName: text(sport.SportName), leagueId, leagueName: text(league.LGName),
              parentMatchNo, parentHomeId, parentHomeName: text(parent.PHTName),
              parentAwayId, parentAwayName: text(parent.PATName), parentDate: text(parent.PMCDate),
              matchNo, gameTypeCode: text(match.GTCode), gameTypeName: text(match.GTName),
              marketGroup: text(match.GTMarketGroup), gameOrder, status, isLive: match.IsLive,
              matchDate: text(match.MCDate), selections
            });
          }
        }
      }
    }
  }
  return output;
}
