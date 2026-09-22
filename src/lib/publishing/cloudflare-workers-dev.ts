// Local Vite development does not provide the Cloudflare Workers `env` module.
// Keep the runtime adapter importable so score/news pages can render locally;
// production Cloudflare builds continue to use the real module via the
// standalone Vite configuration.
export const env = Object.fromEntries(Object.entries(process.env)) as Record<string, string | undefined>;
