import { join } from "node:path";

export function resolveStackEntries(repositoryRoot) {
  const webRoot = join(repositoryRoot, "apps", "web");
  return {
    apiEntry: join(repositoryRoot, "apps", "api", "dist", "server.js"),
    viteEntry: join(webRoot, "node_modules", "vite", "bin", "vite.js"),
    webRoot
  };
}
