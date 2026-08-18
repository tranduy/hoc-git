interface RefreshableCatalogSource {
  readonly id: string;
  readonly provider: string;
  readonly sessionState: string;
}

export async function verifyRefreshedCatalogSources(options: {
  readonly listSources: () => Promise<readonly RefreshableCatalogSource[]>;
  readonly readCatalog: (accountId: string) => Promise<unknown>;
}): Promise<void> {
  const sources = await options.listSources();
  const inactive = sources.filter((source) => source.sessionState !== "ACTIVE");
  if (inactive.length > 0) {
    throw new Error(`SESSION_REFRESH_INCOMPLETE:${inactive
      .map((source) => `${source.provider}:${source.sessionState}`).join(",")}`);
  }

  const reads = await Promise.allSettled(sources.map(async (source) => {
    await options.readCatalog(source.id);
    return source.provider;
  }));
  const unavailable = reads.flatMap((result, index) => result.status === "rejected" ? [sources[index]!.provider] : []);
  if (unavailable.length > 0) throw new Error(`SESSION_READER_UNAVAILABLE:${unavailable.join(",")}`);
}
