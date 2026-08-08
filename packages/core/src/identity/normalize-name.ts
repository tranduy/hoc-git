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

export interface VersionedAliasRegistry {
  readonly version: string;
  readonly aliases: AliasRegistry;
}

export interface VersionedAliasResolution extends AliasResolution {
  readonly category: Category;
  readonly registryVersion: string;
}

export class AliasRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AliasRegistryError";
  }
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
function resolveExactAlias(value: string, aliasMaps: readonly (Readonly<Record<string, string>>)[]): AliasResolution {
  const normalized = normalizeName(value);
  const canonicalMatches = new Set<string>();

  for (const aliases of aliasMaps) {
    for (const [alias, canonical] of Object.entries(aliases)) {
      if (normalizeName(alias) === normalized) {
        const normalizedCanonical = normalizeName(canonical);

        if (!normalizedCanonical) {
          throw new AliasRegistryError(`explicit alias target is empty: ${normalized}`);
        }

        canonicalMatches.add(normalizedCanonical);
      }
    }
  }

  if (canonicalMatches.size > 1) {
    throw new AliasRegistryError(`ambiguous explicit alias: ${normalized}`);
  }

  const canonical = canonicalMatches.values().next().value;

  if (canonical !== undefined) {
    return { normalized, canonical, source: "EXPLICIT_ALIAS" };
  }

  return { normalized, canonical: normalized, source: "NORMALIZED_NAME" };
}

/**
 * Resolves only aliases explicitly recorded in the registry. Values with no
 * exact normalized alias remain their own normalized candidate identity.
 * This legacy helper is intentionally category-unspecified and fails closed
 * when a spelling resolves differently across categories.
 */
export function resolveAlias(value: string, aliases: AliasRegistry): AliasResolution {
  return resolveExactAlias(value, [aliases.FOOTBALL, aliases.LOL]);
}

/**
 * Resolves an alias within one category and records the registry version that
 * supplied the result, making downstream identity derivations reproducible.
 */
export function resolveAliasForCategory(
  value: string,
  category: Category,
  registry: VersionedAliasRegistry
): VersionedAliasResolution {
  if (registry.version.trim() === "") {
    throw new AliasRegistryError("versioned alias registry must have a nonempty version");
  }

  return {
    ...resolveExactAlias(value, [registry.aliases[category]]),
    category,
    registryVersion: registry.version
  };
}
