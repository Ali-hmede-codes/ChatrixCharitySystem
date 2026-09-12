export function campaignDayKey(ts) {
  const d = new Date(Number(ts) || Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function formatAidId(dayKey, seq) {
  const short = String(dayKey || "").slice(-6);
  const n = Math.max(1, Number(seq) || 1);
  return `${short}-${String(n).padStart(4, "0")}`;
}

export function parseAidSeq(aidId, dayKey) {
  const short = String(dayKey || "").slice(-6);
  if (!short) return 0;
  const match = String(aidId || "").trim().match(new RegExp(`^${short}-(\\d{4})$`));
  return match ? Number(match[1]) : 0;
}

export function maxAidSeqForDay(campaigns, dayKey) {
  let max = 0;
  for (const campaign of campaigns || []) {
    if (campaignDayKey(campaign.createdAt) !== dayKey) continue;
    for (const recipient of campaign.recipients || []) {
      const seq = parseAidSeq(recipient.takenAidId, dayKey);
      if (seq > max) max = seq;
      for (const pickup of recipient.pickups || []) {
        const pickupSeq = parseAidSeq(pickup.takenAidId, dayKey);
        if (pickupSeq > max) max = pickupSeq;
      }
    }
  }
  return max;
}
