/** Rejects when `work` does not settle in time, so a spinner can show an error. */
export function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  // A late failure after the deadline must not become an unhandled rejection.
  work.then(
    () => undefined,
    () => undefined,
  );
  return Promise.race([work, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
