import { cp, readdir, rm, realpath } from "node:fs/promises";
import path from "node:path";
// Next copies loaded .env files into standalone output. Never ship those copies.
const workspace = await realpath(process.cwd());
const root = path.join(workspace, ".next", "standalone");
async function scrub(directory) {
  const resolved = await realpath(directory);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error("Unexpected standalone path.");
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (/^\.env($|\.)/.test(entry.name) && entry.isFile()) await rm(target);
    else if (entry.isDirectory() && entry.name !== "node_modules") await scrub(target);
  }
}
await scrub(root);
await cp(path.join(workspace, ".next", "static"), path.join(root, ".next", "static"), { recursive: true });
console.log("Standalone output prepared; environment files excluded.");
