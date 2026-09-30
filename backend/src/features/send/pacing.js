export function looksRateLimited(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return /rate|429|too many|throttl|spam|restricted|not-authorized|forbidden|locked/.test(text);
}

export function looksAccountBanned(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return /banned|\bblocked\b/.test(text);
}

export function looksAccountRestricted(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return /restrict|not-authorized|forbidden|locked/.test(text);
}

export async function respectServerLimits(client) {
  try {
    const cap = await client.message.getNewChatMessageCapping();
    const remaining =
      cap?.totalQuota != null && cap?.usedQuota != null ? cap.totalQuota - cap.usedQuota : null;
    const blocked = remaining === 0 || /exhaust|capped|block/i.test(String(cap?.cappingStatus || ""));
    if (blocked) {
      const until = Number(cap?.cycleEndAt);
      const waitMs =
        Number.isFinite(until) && until > Date.now()
          ? Math.min(until - Date.now(), 45 * 60 * 1000)
          : 30 * 60 * 1000;
      return {
        waitMs,
        reason: "WhatsApp new-chat limit reached. Waiting before more sends.",
      };
    }
  } catch {
    // Optional API — ignore if this build does not expose it.
  }

  try {
    const lock = await client.message.getReachoutTimelock();
    if (lock?.isActive) {
      return {
        accountRestricted: true,
        reason: "WhatsApp restricted this account (cold-outreach pause is active).",
      };
    }
  } catch {
    // Optional API.
  }

  return null;
}
