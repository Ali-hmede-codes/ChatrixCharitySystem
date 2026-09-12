/**
 * Arabic-aware & Phone-aware search normalization.
 * Normalizes variations of Alef (أ, إ, آ -> ا), Teh Marbuta (ة -> ه),
 * Alef Maksura (ى -> ي), and strips tashkeel/diacritics.
 */
export function normalizeSearch(str) {
  if (!str) return "";
  return String(str)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "") // remove Arabic tashkeel diacritics
    .replace(/[إأآا]/g, "ا") // normalize Alef forms
    .replace(/ة/g, "ه") // normalize Teh Marbuta to Heh
    .replace(/ى/g, "ي") // normalize Alef Maksura to Yeh
    .replace(/[\s\-_/\\,.]+/g, " ")
    .trim();
}

export function matchesText(source, query) {
  if (!query) return true;
  const q = normalizeSearch(query);
  if (!q) return true;
  const s = normalizeSearch(source);
  return s.includes(q);
}

export function matchesCampaign(campaign, query) {
  if (!query) return true;
  const q = normalizeSearch(query);
  if (!q) return true;

  // Check name
  if (matchesText(campaign.name, q)) return true;

  // Check message
  if (matchesText(campaign.message, q)) return true;

  // Check status (completed, running, stopped)
  if (matchesText(campaign.status, q)) return true;

  // Check channel mode (sms, whatsapp)
  if (campaign.enableSms && (q.includes("sms") || q.includes("رسائل") || q.includes("fallback"))) {
    return true;
  }
  if (!campaign.enableSms && (q.includes("wa") || q.includes("whatsapp") || q.includes("واتساب"))) {
    return true;
  }

  // Check formatted date
  if (campaign.createdAt) {
    const dateStr = new Date(campaign.createdAt).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    if (matchesText(dateStr, q)) return true;
  }

  if (matchesText(campaign.aidCode, q)) return true;

  return false;
}

export function matchesRecipient(recipient, query) {
  if (!query) return true;
  const q = normalizeSearch(query);
  if (!q) return true;

  // Check beneficiary name
  if (matchesText(recipient.name, q)) return true;

  // Check phone number (allow searching by pure digits or formatted string)
  const digitsQuery = query.replace(/\D/g, "");
  if (digitsQuery.length >= 3) {
    const targetDigits = String(recipient.phone || "").replace(/\D/g, "");
    if (targetDigits.includes(digitsQuery)) return true;
  }
  if (matchesText(recipient.phone, q)) return true;

  // Check channel ("sms", "whatsapp")
  if (matchesText(recipient.channel, q)) return true;

  // Check state ("delivered", "waiting", "sms-sent", "failed", "skipped")
  if (matchesText(recipient.state, q)) return true;

  // Check aid / pickup code / printed ticket id
  if (matchesText(recipient.code, q)) return true;
  if (matchesText(recipient.takenAidId, q)) return true;
  if (recipient.takenAt && (q.includes("taken") || q.includes("collect") || q.includes("استلام") || q.includes("تم"))) {
    return true;
  }

  // Check details
  if (matchesText(recipient.detail, q)) return true;

  return false;
}
