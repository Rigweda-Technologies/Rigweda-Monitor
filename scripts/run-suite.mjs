import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [suite, mode] = process.argv.slice(2);

const commands = {
  // Local mode starts the local API plus its UI/agent.  Server mode starts
  // only the UI/agent, which uses the deployed URLs from .env.server.
  desktop: mode === "local"
    ? [
        { label: "desktop backend", cwd: "desktop/backend", args: ["run", mode] },
        { label: "desktop agent", cwd: "desktop/frontend", args: ["-m", "app.main"], python: true },
      ]
    : [{ label: "desktop agent", cwd: "desktop/frontend", args: ["-m", "app.main"], python: true }],
  hrms: mode === "local"
    ? [
        { label: "hrms backend", cwd: "hrms/back-end", args: ["run", mode] },
        { label: "hrms frontend", cwd: "hrms/front-end", args: ["run", mode] },
      ]
    : [{ label: "hrms frontend", cwd: "hrms/front-end", args: ["run", mode] }],
};

if (!commands[suite] || !["local", "server"].includes(mode)) {
  console.error("Usage: node scripts/run-suite.mjs <desktop|hrms> <local|server>");
  process.exit(1);
}

const activeUrls = {
  desktop: mode === "local"
    ? [
        "Desktop monitor API: http://localhost:3001/api",
        "HRMS login API:      http://localhost:8000/api/users/login",
      ]
    : [
        "Desktop monitor API: https://rigweda-monitor-backend.vercel.app/api",
        "HRMS login API:      https://rigweda-hrms-backend.vercel.app/api/users/login",
      ],
  hrms: mode === "local"
    ? [
        "HRMS web app:        http://localhost:3000",
        "HRMS API:            http://localhost:8000/api",
        "Desktop monitor API: http://localhost:3001/api",
      ]
    : [
        "HRMS API:            https://rigweda-hrms-backend.vercel.app/api",
        "Desktop monitor API: https://rigweda-monitor-backend.vercel.app/api",
      ],
};

console.log(`\nStarting ${suite} in ${mode.toUpperCase()} mode`);
for (const url of activeUrls[suite]) console.log(url);
console.log("");

const children = commands[suite].map(({ label, cwd, args, python }) => {
  const command = python ? (process.env.PYTHON || "python") : "npm";
  const childArgs = python ? args : args;
  const child = spawn(command, childArgs, {
    cwd: path.join(workspaceRoot, cwd),
    env: { ...process.env, APP_ENV: mode },
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    if (code && code !== 0) console.error(`${label} stopped with exit code ${code}.`);
  });
  return child;
});

const stopChildren = () => {
  for (const child of children) child.kill();
};
process.on("SIGINT", stopChildren);
process.on("SIGTERM", stopChildren);
