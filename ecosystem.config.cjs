const path = require("path");

const root = __dirname;

module.exports = {
  apps: [
    {
      name: "chatrix",
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
        HOST: process.env.HOST || "127.0.0.1",
        PORT: process.env.PORT || "4173",
        LOCK_PORT: process.env.LOCK_PORT || "4179",
      },
    },
  ],
};
