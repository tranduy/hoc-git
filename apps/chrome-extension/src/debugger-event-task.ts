const EXPECTED_EVENT_REJECTION_CODES = new Set([
  "PROVIDER_WORK_QUEUE_FULL",
  "PROVIDER_WORK_CLEARED"
]);

export function runDebuggerEventTask(
  task: Promise<void>,
  reportUnexpected: (error: unknown) => void = () => undefined
): void {
  void task.catch((error: unknown) => {
    if (isExpectedEventRejection(error)) return;
    reportUnexpected(error);
  });
}

function isExpectedEventRejection(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    typeof error.code === "string" && EXPECTED_EVENT_REJECTION_CODES.has(error.code);
}
