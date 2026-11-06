export async function register(): Promise<void> {
  const { installExposeErrors } = await import("./lib/errors");
  installExposeErrors();
}
