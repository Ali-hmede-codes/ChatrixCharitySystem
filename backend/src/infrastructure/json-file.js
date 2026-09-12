import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export function createJsonStore(filePath, fallback) {
  return {
    read() {
      try {
        return JSON.parse(readFileSync(filePath, "utf8"));
      } catch {
        return typeof fallback === "function" ? fallback() : structuredClone(fallback);
      }
    },
    async write(data) {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
    },
  };
}
