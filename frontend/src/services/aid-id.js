// Aid ID helpers for the frontend offline path.
//
// The backend (backend/src/shared/aid-id.js) owns the canonical Aid ID
// format: `${YYMMDD}-${seq padded to 4}`. When the desk collects OFFLINE we
// must print a receipt with an Aid ID immediately, and that same ID must
// become the permanent record after sync — so the paper and the database
// never disagree.
//
// Strategy: allocate offline IDs from a HIGH offset (9000+) so they can
// never collide with the server's normal sequential allocations (which
// start at 1 and increment by 1). The server adopts the offline ID as-is
// on sync (see backend applyOfflineOp). For a single pickup desk this is
// collision-free; the high offset is the safety margin.

export const OFFLINE_AID_OFFSET = 9000;

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function campaignDayKey(ts) {
  const d = new Date(Number(ts) || Date.now());
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
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

// Highest sequence already used for a day across the cached snapshot, so a
// newly-allocated offline ID never reuses one already printed.
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

// Allocate a fresh offline Aid ID for the given day. Always lands in the
// high-offset range (>= 9000) and above any ID already present in the cache.
export function allocateOfflineAidId(campaigns, dayKey) {
  const used = maxAidSeqForDay(campaigns, dayKey);
  const seq = Math.max(OFFLINE_AID_OFFSET, used + 1);
  return { aidId: formatAidId(dayKey, seq), seq };
}
