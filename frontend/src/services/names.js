import { DEFAULT_NAME_TEMPLATE } from "../constants/config.js";

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

export function resolveAidCode(item, campaignCode) {
  return sanitizeAidCode(item?.code) || sanitizeAidCode(campaignCode);
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

const FAMILY_COUNT_SUFFIX = /\s*\+\s*\d+\s*$/;

function stripFamilyCountSuffix(value) {
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

export function personNames(item) {
  const rawList =
    Array.isArray(item?.names) && item.names.length
      ? item.names
      : [String(item?.name || "")];
  const split = [];
  for (const value of rawList) {
    split.push(...splitNameField(value));
  }
  const unique = [];
  for (const name of split) {
    if (!unique.some((existing) => namesEqual(existing, name))) unique.push(name);
  }
  return collapsePersonNames(unique);
}

// Mirror of the backend collapse: drop a name that is a word-prefix of a
// longer one (e.g. "Ahmad" when "Ahmad Ali" exists) so the same person is not
// messaged twice under two spellings. Households like "Ahmad" + "Sara" stay.
export function collapsePersonNames(list) {
  const names = [];
  for (const value of list || []) {
    const name = String(value || "").replace(/\s+/g, " ").trim();
    if (!name || /^\d+$/.test(name)) continue;
    if (names.some((item) => namesEqual(item, name))) continue;
    names.push(name);
  }
  return names.filter((name) => {
    return !names.some((other) => {
      if (other === name) return false;
      return (
        other.toLowerCase().startsWith(name.toLowerCase() + " ") ||
        namesEqual(other, name)
      );
    });
  });
}

export function contactSaveName(item) {
  const names = personNames(item);
  if (names.length >= 2) return `${names[0]} +${names.length}`;
  if (names.length === 1) return names[0];
  return stripFamilyCountSuffix(item?.name);
}

export function addPersonName(person, newName, code) {
  const clean = String(newName || "").replace(/\s+/g, " ").trim();
  if (!clean) return;

  if (!Array.isArray(person.names)) {
    person.names = personNames(person);
  }

  const incoming = splitNameField(clean);

  // Record a per-person pickup code so that when several people share one
  // phone number in the same Excel, each of them gets their OWN code in a
  // separate message instead of all receiving the first person's code.
  // Keyed by the lowercased raw name; the collapsed name used at send time
  // is always one of these raw names, so the lookup never misses.
  const cleanCode = sanitizeAidCode(code);
  if (cleanCode) {
    if (!person.nameCodes || typeof person.nameCodes !== "object") person.nameCodes = {};
    for (const name of incoming) {
      person.nameCodes[String(name).toLowerCase()] = cleanCode;
    }
  }

  for (const name of incoming) {
    if (!person.names.some((existing) => namesEqual(existing, name))) {
      person.names.push(name);
    }
  }

  person.name = person.names.join(" + ");
  person.label = person.name;
}

// Look up the pickup code that belongs to a specific person on a recipient.
// Falls back to the recipient-level code (the first row's code) when there is
// no per-person entry — e.g. a single-person recipient or an old campaign.
export function nameCodeFor(item, name) {
  const key = String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (key && item?.nameCodes && typeof item.nameCodes === "object") {
    const perName = sanitizeAidCode(item.nameCodes[key]);
    if (perName) return perName;
  }
  return sanitizeAidCode(item?.code);
}

export function applyPersonNameTemplate(template, name) {
  return String(template || "").replace(/\[PersonName\]/gi, name);
}

function buildOnePreviewMessage(names, bodyText, messageConfig, extras = {}) {
  const body = String(bodyText || "").trim();
  const nameList = Array.isArray(names) ? names.filter(Boolean) : [];
  // Mirror the backend: when this message is for a single person and the
  // recipient carries per-person codes (nameCodes), use THAT person's own
  // code only — a missing code is left as the literal [Code] so the user
  // sees the problem, instead of showing another person's code. With no
  // per-person map (old campaign / single shared code), fall back to the
  // recipient-level code. For one combined message to a whole family, use
  // the recipient-level code.
  const item = extras.item;
  let code;
  if (nameList.length === 1 && item?.nameCodes && typeof item.nameCodes === "object") {
    code = sanitizeAidCode(item.nameCodes[String(nameList[0]).toLowerCase()]);
  } else {
    code = resolveAidCode(item, extras.code);
  }
  let result = body;

  if (messageConfig?.useNameTemplate) {
    const template =
      String(messageConfig?.template || DEFAULT_NAME_TEMPLATE).trim() ||
      DEFAULT_NAME_TEMPLATE;
    if (nameList.length) {
      const greetings = nameList
        .map((name) => applyPersonNameTemplate(template, name).trim())
        .filter(Boolean);

      if (!body) result = greetings.join("\n");
      else if (/\[PersonName\]/i.test(body)) {
        result = nameList
          .map((name) => applyPersonNameTemplate(body, name).trim())
          .filter(Boolean)
          .join("\n\n");
      } else {
        result = greetings.join("\n") + "\n\n" + body;
      }
    }
  } else if (nameList.length && /\[PersonName\]/i.test(body)) {
    result = nameList
      .map((name) => applyPersonNameTemplate(body, name).trim())
      .filter(Boolean)
      .join("\n\n");
  }

  return applyCodePlaceholder(result, code);
}

export function buildPreviewMessages(item, bodyText, messageConfig, extras = {}) {
  const names = personNames(item);
  const personalized =
    Boolean(messageConfig?.useNameTemplate) || /\[PersonName\]/i.test(String(bodyText || ""));
  const payload = { ...extras, item };
  if (personalized && names.length > 1) {
    return names
      .map((name) => buildOnePreviewMessage([name], bodyText, messageConfig, payload))
      .filter(Boolean);
  }
  const one = buildOnePreviewMessage(names, bodyText, messageConfig, payload);
  return one ? [one] : [];
}

export function buildPreviewMessage(item, bodyText, messageConfig, extras = {}) {
  return buildPreviewMessages(item, bodyText, messageConfig, extras).join("\n\n") || "";
}

export function personInitials(name, phone) {
  const text = String(name || "").trim();
  if (text) {
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return text.slice(0, 2).toUpperCase();
  }
  return String(phone || "?").replace(/\D/g, "").slice(-2) || "?";
}
