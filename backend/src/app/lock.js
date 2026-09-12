import { createServer as createLockServer } from "node:net";

export function acquireLock({ host, port, onTaken, onFree }) {
  const lock = createLockServer();
  lock.on("error", () => {
    onTaken();
  });
  lock.listen({ port, host, exclusive: true }, () => {
    onFree();
  });
  return lock;
}
