import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Read local server configuration at runtime, never bake it into client assets.
require("@next/env").loadEnvConfig(process.cwd(), false);
const child = spawn(process.execPath, [".next/standalone/server.js"], {
  stdio: "inherit", env: { ...process.env, HOSTNAME: process.env.HOSTNAME || "127.0.0.1", PORT: process.env.PORT || "3000" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
