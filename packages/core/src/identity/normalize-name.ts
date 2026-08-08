import type { Category } from "@tool-chenh/contracts";

export type AliasRegistry = Readonly<
  Record<Category, Readonly<Record<string, string>>>
>;

export type AliasResolutionSource = "EXPLICIT_ALIAS" | "NORMALIZED_NAME";

export interface AliasResolution {
  readonly normalized: string;
  readonly canonical: string;
  readonly source: AliasResolutionSource;
}

/**
 * Produces a stable text representation suitable for deterministic identity
 * comparisons. It deliberately does not attempt approximate matching.
 */
export function normalizeName(value: string): string {
  return value
    .replace(/&/g, " and ")
    .replace(/\p{S}/gu, "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}\s_]/gu, "")
    .replace(/[\s_]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Resolves only aliases explicitly recorded in the registry. Values with no
 * exact normalized alias remain their own normalized candidate identity.
 */
export function resolveAlias(value: string, aliases: AliasRegistry): AliasResolution {
  const normalized = normalizeName(value);
  const canonicalMatches = new Set<string>();

  for (const category of ["FOOTBALL", "LOL"] as const) {
    for (const [alias, canonical] of Object.entries(aliases[category])) {
      if (normalizeName(alias) === normalized) {
        canonicalMatches.add(normalizeName(canonical));
      }
    }
  }

  if (canonicalMatches.size > 1) {
    throw new Error(`ambiguous explicit alias: ${normalized}`);
  }

  const canonical = canonicalMatches.values().next().value;

  if (canonical !== undefined) {
    return { normalized, canonical, source: "EXPLICIT_ALIAS" };
  }

  return { normalized, canonical: normalized, source: "NORMALIZED_NAME" };
}
