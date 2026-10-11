import { access, cp, mkdir, writeFile } from 'node:fs/promises';

const CLOUDFLARE_ENTRY = 'dist/server/index.mjs';
const CLIENT_DIR = 'dist/client';

// Fail the build if the Cloudflare Worker entry (or asset dir) that wrangler.toml
// points at is missing. Without this, a rename in the nitro/Vite toolchain would
// only surface at deploy time as an opaque "module not found".
for (const path of [CLOUDFLARE_ENTRY, CLIENT_DIR]) {
  try {
    await access(path);
  } catch {
    throw new Error(`Expected build output missing: ${path} (referenced by wrangler.toml).`);
  }
}

// OpenAI hosting target: keep the thin re-export wrapper plus hosting metadata so
// both deployment targets work from this single build.
await writeFile('dist/server/index.js', "export { default } from './index.mjs';\n");
await mkdir('dist/.openai', { recursive: true });
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await cp('drizzle', 'dist/.openai/drizzle', { recursive: true });
