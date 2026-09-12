export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label || "timeout")), ms);
    }),
  ]);
}

export async function waitGap(ms, isCancelled) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (isCancelled?.()) return;
    await delay(Math.min(250, end - Date.now()));
  }
}

export function jitter(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}
