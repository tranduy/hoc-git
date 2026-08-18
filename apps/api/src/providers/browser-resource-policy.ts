import type { BrowserContext, Route } from "playwright";

const blockedResourceTypes = new Set(["font", "image", "media"]);

export function shouldBlockCatalogResource(resourceType: string): boolean {
  return blockedResourceTypes.has(resourceType);
}

export async function installCatalogResourcePolicy(context: BrowserContext): Promise<void> {
  await context.route("**/*", async (route: Route) => {
    if (shouldBlockCatalogResource(route.request().resourceType())) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}
