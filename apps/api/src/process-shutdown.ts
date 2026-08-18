export interface ShutdownLifecycle {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  on(event: "message", listener: (message: unknown) => void): unknown;
}

export function bindGracefulShutdown(options: {
  readonly lifecycle: ShutdownLifecycle;
  readonly stop: () => Promise<void>;
  readonly exit: (code: number) => void;
}): void {
  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    void options.stop().then(() => options.exit(0), () => options.exit(1));
  };
  options.lifecycle.once("SIGINT", shutdown);
  options.lifecycle.once("SIGTERM", shutdown);
  options.lifecycle.on("message", (message) => {
    if (typeof message === "object" && message !== null &&
      (message as { readonly type?: unknown }).type === "tool-chenh:shutdown") shutdown();
  });
}
