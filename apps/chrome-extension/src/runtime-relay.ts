export type RuntimeSender = (message: unknown) => Promise<unknown> | unknown;

export function createRuntimeRelay(sendMessage: RuntimeSender): (message: unknown) => void {
  let available = true;
  return (message) => {
    if (!available) return;
    try {
      void Promise.resolve(sendMessage(message)).catch(() => { available = false; });
    } catch {
      // Chrome invalidates an old content-script context synchronously when an
      // unpacked extension is reloaded. Stop the orphaned listener quietly;
      // the newly loaded content script owns subsequent captures.
      available = false;
    }
  };
}
