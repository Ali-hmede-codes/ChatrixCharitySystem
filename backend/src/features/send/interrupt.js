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
    detail: "The WhatsApp link dropped (Wi-Fi or network). Chatrix will continue this campaign automatically when the number reconnects.",
  },
  banned: {
    title: "This WhatsApp number was blocked",
    detail: "Sending paused. Link a new charity number with the QR code — unfinished recipients will continue from where this campaign stopped.",
  },
  removed: {
    title: "This device was removed from WhatsApp",
    detail: "Sending paused. Scan a new QR code. The campaign will continue with everyone who has not received the message yet.",
  },
  logged_out: {
    title: "WhatsApp signed out",
    detail: "Sending paused. Link WhatsApp again to continue the remaining recipients. Already-sent messages will not be sent twice.",
  },
  session_replaced: {
    title: "WhatsApp linked on another computer",
    detail: "This session was replaced. Scan the QR again on this computer to continue the unfinished campaign.",
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
  if (code === 402 || code === 406 || why === "failure_banned" || why === "failure_locked") {
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

export function shouldAutoResume(reason) {
  return reason !== "user_stop" && reason !== "server_restart";
}

export function pauseCopy(reason) {
  return PAUSE_COPY[reason] || PAUSE_COPY.whatsapp_disconnect;
}
