const fs = require("fs");
const path = require("path");

const root = __dirname;

function readDeployEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

function slug(value) {
  const text = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return text || "chatrix";
}

const saved = readDeployEnv(path.join(root, ".deploy.env"));
const appName = saved.APP_NAME || slug(path.basename(root));
const host = saved.HOST || process.env.HOST || "127.0.0.1";
let port = String(saved.APP_PORT || process.env.PORT || "4173");
let lockPort = String(saved.LOCK_PORT || process.env.LOCK_PORT || "4179");
if (lockPort === port) {
  const next = Number(port) + 6;
  lockPort = String(Number.isFinite(next) ? next : 4179);
}
const nodeBin = saved.NODE_BIN || process.env.NODE_BIN || "";
const nodeDir = nodeBin ? path.dirname(nodeBin) : "";

const app = {
  name: appName,
  cwd: path.join(root, "backend"),
  script: "src/index.js",
  instances: 1,
  exec_mode: "fork",
  autorestart: true,
  watch: false,
  max_restarts: 8,
  min_uptime: 5000,
  restart_delay: 3000,
  stop_exit_codes: [78],
  kill_timeout: 8000,
  max_memory_restart: "512M",
  env: {
    NODE_ENV: "production",
    HOST: host,
    PORT: port,
    LOCK_PORT: lockPort,
    APP_NAME: appName,
    PATH: nodeDir ? `${nodeDir}:/usr/local/bin:/usr/bin:/bin` : process.env.PATH,
  },
};

if (nodeBin) app.interpreter = nodeBin;

module.exports = { apps: [app] };
