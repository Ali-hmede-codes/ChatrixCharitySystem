const FAMILY_COUNT_SUFFIX = /\s*\+\s*\d+\s*$/;

export function stripFamilyCountSuffix(value) {
  return String(value || "").replace(FAMILY_COUNT_SUFFIX, "").replace(/\s+/g, " ").trim();
}

function splitNameField(value) {
  const raw = stripFamilyCountSuffix(value);
  if (!raw) return [];
  if (/\s*\+\s*/.test(raw)) {
    return raw
      .split(/\s*\+\s*/)
      .map((name) => name.trim())
      .filter((name) => name && !/^\d+$/.test(name));
  }
  return /^\d+$/.test(raw) ? [] : [raw];
}

export function uniquePersonNames(list) {
  const names = [];
  for (const value of list || []) {
    const name = String(value || "").replace(/\s+/g, " ").trim();
    if (!name || /^\d+$/.test(name)) continue;
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
    split.push(...splitNameField(value));
  }
  return uniquePersonNames(split);
}

export function contactSaveName(item) {
  const names = namesFromRecipient(item);
  if (names.length >= 2) return `${names[0]} +${names.length}`;
  if (names.length === 1) return names[0];
  return stripFamilyCountSuffix(item?.name);
}

export function shouldSendPerPerson(names, body, extras = {}) {
  const nameList = Array.isArray(names) ? names.filter(Boolean) : [];
  if (nameList.length <= 1) return false;
  return Boolean(extras.useNameTemplate) || /\[PersonName\]/i.test(String(body || ""));
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
  const text = stripFamilyCountSuffix(fullName);
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
