const FINISHED_STATES = new Set([
  "waiting",
  "delivered",
  "sms-sent",
  "sms-failed",
  "sms-queued",
  "skipped",
  "undelivered",
]);

export const PAUSE_COPY = {
  whatsapp_disconnect: {
    title: "WhatsApp dropped",
    detail: "The WhatsApp link dropped (Wi-Fi, network, or QR offline). Cancel or delete this campaign, or wait — Chatrix continues it when the number reconnects.",
  },
  banned: {
    title: "This WhatsApp number was blocked",
    detail: "Sending paused. You can cancel or delete this campaign, or link a new charity number with the QR code — unfinished recipients will continue from where this campaign stopped.",
  },
  restricted: {
    title: "This WhatsApp account is restricted",
    detail: "Sending paused. Cancel this campaign to keep the remaining people, or delete it. Resume later once the account can send again.",
  },
  removed: {
    title: "This device was removed from WhatsApp",
    detail: "Sending paused because the QR session is offline. Cancel or delete this campaign, or scan a new QR code. Already-sent messages are kept.",
  },
  logged_out: {
    title: "WhatsApp signed out",
    detail: "Sending paused because the QR session is offline. Cancel or delete this campaign, or link WhatsApp again. Already-sent messages will not be sent twice.",
  },
  session_replaced: {
    title: "WhatsApp linked on another computer",
    detail: "The QR session is offline. Cancel or delete this campaign, or scan the QR again on this computer to continue.",
  },
  user_stop: {
    title: "Sending stopped",
    detail: "You stopped this campaign. Resume anytime to continue from the next unsent recipient.",
  },
  server_restart: {
    title: "Chatrix restarted",
    detail: "The computer or app restarted while a campaign was running. Press Resume to continue from the remaining recipients.",
  },
  merged: {
    title: "Merged campaign",
    detail: "This campaign was combined from several send batches. Resume anytime to send anyone still waiting.",
  },
};

export function isRecipientPending(recipient) {
  return !FINISHED_STATES.has(String(recipient?.state || "queued"));
}

export function classifyWhatsAppClose({ reason, code, fatal } = {}) {
  const why = String(reason || "");
  if (why === "failure_locked") return "restricted";
  if (code === 402 || code === 406 || why === "failure_banned") {
    return "banned";
  }
  if (why === "stream_error_device_removed") return "removed";
  if (why === "stream_error_replaced") return "session_replaced";
  if (
    fatal ||
    code === 401 ||
    code === 403 ||
    why === "stream_error_force_logout" ||
    why === "failure_not_authorized" ||
    why === "primary_identity_key_change"
  ) {
    return "logged_out";
  }
  return "whatsapp_disconnect";
}

export function isConnectionError(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return (
    /disconnect|disconnected|not connected|connection|closed|timed out|timeout|logged.?out|banned|unauthor|socket|stream|econnreset|network|enotfound|offline/i.test(
      text
    ) || error?.name === "AbortError"
  );
}

// zapo drops a recipient device from the fanout when no Signal session exists
// for it, surfacing as "direct fanout dropping primary recipient device
// without signal session". The send then rejects, and without recovery the
// message falls back to SMS even though the recipient is on WhatsApp. This
// also catches the related prekey-bundle fetch failures that prevent a
// session from bootstrapping. Matched narrowly so rate-limit / connection
// errors keep their own handling paths.
export function isSignalSessionError(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return /signal session|fanout dropping|prekey|could not establish.*session|no.*signal.*session/i.test(
    text
  );
}

export function shouldAutoResume(reason) {
  return reason !== "user_stop" && reason !== "server_restart" && reason !== "restricted";
}

export function pauseCopy(reason) {
  return PAUSE_COPY[reason] || PAUSE_COPY.whatsapp_disconnect;
}
