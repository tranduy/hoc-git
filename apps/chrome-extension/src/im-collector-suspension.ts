// Serialized into the MAIN world on extension upgrade. Keep this function
// self-contained: the old page worker survives a service-worker replacement.
export function stopSuspendedImCollector(): boolean {
  if (location.hostname !== "imsports.directsb.net") return false;
  const page = window as typeof window & { __fieldlineImNativeCatalogV1?: {
    state: { retired: boolean; controllers: Set<AbortController>; waiters: Set<() => void> } | null;
  } };
  const manager = page.__fieldlineImNativeCatalogV1;
  const state = manager?.state;
  if (manager && state) {
    state.retired = true;
    for (const controller of state.controllers) controller.abort();
    for (const release of state.waiters) release();
    state.waiters.clear();
    manager.state = null;
  }
  return true;
}
