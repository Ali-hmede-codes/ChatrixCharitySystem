export const PAUSE_COPY = {
  whatsapp_disconnect: {
    title: "WhatsApp dropped",
    detail:
      "The WhatsApp link dropped (Wi-Fi or network). Chatrix continues this campaign automatically when the number reconnects.",
  },
  banned: {
    title: "This WhatsApp number was blocked",
    detail:
      "Sending paused. Link a new charity number with the QR code — unfinished recipients continue from where this campaign stopped.",
  },
  removed: {
    title: "This device was removed from WhatsApp",
    detail:
      "Sending paused. Scan a new QR code. Already-sent messages are kept; only remaining people will be sent.",
  },
  logged_out: {
    title: "WhatsApp signed out",
    detail:
      "Sending paused. Link WhatsApp again to continue remaining recipients. Messages already sent will not be sent twice.",
  },
  session_replaced: {
    title: "WhatsApp linked on another computer",
    detail: "Scan the QR again on this computer to continue the unfinished campaign.",
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
