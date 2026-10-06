import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("dist");
const needle = "standings-debug";
let hits = [];

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    console.error(`Missing build output at ${dir}. Run npm run build first.`);
    process.exit(1);
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (/\.(mjs|js|html|json)$/.test(entry.name)) {
      const text = await readFile(full, "utf8");
      if (text.includes(needle)) hits.push(full);
    }
  }
}

await walk(root);
if (hits.length) {
  console.error(`Debug route still in build output:\n${hits.join("\n")}`);
  process.exit(1);
}
console.log("Built output has no standings-debug route.");
