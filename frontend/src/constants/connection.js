export const PAUSE_COPY = {
  whatsapp_disconnect: {
    title: "WhatsApp dropped",
    detail:
      "The WhatsApp link dropped (Wi-Fi, network, or QR offline). Cancel or delete this campaign, or wait — Chatrix continues it when the number reconnects.",
  },
  banned: {
    title: "This WhatsApp number was blocked",
    detail:
      "Sending paused. You can cancel or delete this campaign, or link a new charity number with the QR code — unfinished recipients continue from where this campaign stopped.",
  },
  restricted: {
    title: "This WhatsApp account is restricted",
    detail:
      "Sending paused. Cancel this campaign to keep the remaining people, or delete it. Resume later once the account can send again.",
  },
  removed: {
    title: "This device was removed from WhatsApp",
    detail:
      "Sending paused because the QR session is offline. Cancel or delete this campaign, or scan a new QR code. Already-sent messages are kept.",
  },
  logged_out: {
    title: "WhatsApp signed out",
    detail:
      "Sending paused because the QR session is offline. Cancel or delete this campaign, or link WhatsApp again. Already-sent messages will not be sent twice.",
  },
  session_replaced: {
    title: "WhatsApp linked on another computer",
    detail: "The QR session is offline. Cancel or delete this campaign, or scan the QR again on this computer to continue.",
  },
  user_stop: {
    title: "Sending stopped",
    detail: "Resume anytime to continue from the next unsent recipient.",
  },
  server_restart: {
    title: "Chatrix restarted",
    detail: "Press Resume to continue from the remaining recipients.",
  },
};

export function pauseCopy(reason) {
  return PAUSE_COPY[reason] || PAUSE_COPY.whatsapp_disconnect;
}

export function needsNewWhatsAppLink(reason) {
  return ["banned", "removed", "logged_out", "session_replaced"].includes(reason);
}

function qrSessionOffline(waState) {
  return waState === "qr" || waState === "logged-out" || waState === "error";
}

// A live campaign that is paused or stopped can be cancelled or deleted when
// the account is banned, restricted, or the QR session is offline.
export function canCancelOrDeleteCampaign({ sendJob, campaign, waState, waMessage = "" }) {
  const id = campaign?.id;
  const live = Boolean(sendJob?.running && id && sendJob.campaignId === id);
  if (!live) return { cancel: false, delete: true };

  const reason = String(sendJob.pauseReason || campaign?.pauseReason || "");
  const message = String(waMessage || "").toLowerCase();
  const qrOffline = qrSessionOffline(waState);
  const bannedOrRestricted =
    reason === "banned" ||
    reason === "restricted" ||
    /ban|restrict|locked|blocked/.test(message);
  const held =
    Boolean(sendJob.paused) ||
    campaign?.status === "stopped" ||
    campaign?.status === "interrupted" ||
    qrOffline;
  if (!held) return { cancel: false, delete: false };
  if (bannedOrRestricted || qrOffline) return { cancel: true, delete: true };
  if (["removed", "logged_out", "session_replaced"].includes(reason)) {
    return { cancel: true, delete: true };
  }
  return { cancel: false, delete: false };
}
