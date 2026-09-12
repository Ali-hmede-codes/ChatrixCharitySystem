export function normalizeSearch(str) {
  if (!str) return "";
  return String(str)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\s\-_/\\,.]+/g, " ")
    .trim();
}

export function matchesText(source, query) {
  if (!query) return true;
  const q = normalizeSearch(query);
  if (!q) return true;
  return normalizeSearch(source).includes(q);
}
