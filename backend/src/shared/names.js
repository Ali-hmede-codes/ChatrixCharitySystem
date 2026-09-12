export function uniquePersonNames(list) {
  const names = [];
  for (const value of list || []) {
    const name = String(value || "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    if (names.some((item) => item.toLowerCase() === name.toLowerCase())) continue;
    names.push(name);
  }
  return names;
}

export function namesFromRecipient(item) {
  const rawList =
    Array.isArray(item?.names) && item.names.length
      ? item.names
      : [String(item?.name || "")];
  const split = [];
  for (const value of rawList) {
    const raw = String(value || "").replace(/\s+/g, " ").trim();
    if (!raw) continue;
    if (/\s*\+\s*/.test(raw)) {
      split.push(...raw.split(/\s*\+\s*/).map((name) => name.trim()).filter(Boolean));
    } else {
      split.push(raw);
    }
  }
  return uniquePersonNames(split);
}

export function personSlots(item) {
  const names = namesFromRecipient(item);
  return names.length ? names : [String(item?.name || "").trim() || "Beneficiary"];
}

export function namesEqual(a, b) {
  return (
    String(a || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase() ===
    String(b || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  );
}

export function firstNameFrom(fullName) {
  const text = String(fullName || "").trim();
  if (!text) return "Contact";
  return text.split(/\s+/).filter(Boolean)[0].slice(0, 40);
}

export function applyPersonNameTemplate(template, name) {
  return String(template || "").replace(/\[PersonName\]/gi, name);
}

export function sanitizeAidCode(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function messageHasCodePlaceholder(text) {
  return /\[(?:Aid)?Code\]|\[كود\]/i.test(String(text || ""));
}

export function messageHasNamePlaceholder(text) {
  return /\[PersonName\]/i.test(String(text || ""));
}

export function applyCodePlaceholder(text, code) {
  const value = sanitizeAidCode(code);
  if (!value) return String(text || "");
  return String(text || "").replace(/\[(?:Aid)?Code\]|\[كود\]/gi, value);
}
