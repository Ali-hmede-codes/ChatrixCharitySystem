import React from "react";
import { useApp } from "../../context/AppContext.jsx";
import { pauseCopy, needsNewWhatsAppLink } from "../../constants/connection.js";
import { IconWifiOff, IconRefresh, IconSend, IconWhatsApp, IconAlertCircle } from "../common/Icons.jsx";

export function ConnectionBanner() {
  const {
    isOnline,
    socketConnected,
    waState,
    waMessage,
    sendJob,
    resumableCampaigns,
    resumeCampaign,
    setCurrentStep,
    offlineReady,
    pendingCount,
    syncing,
    lastSyncAt,
  } = useApp();

  const resumable = Array.isArray(resumableCampaigns) ? resumableCampaigns : [];
  const top = resumable[0] || null;
  const pauseReason = sendJob.pauseReason || top?.pauseReason || "";
  const copy = pauseCopy(pauseReason);
  const remaining = sendJob.remaining || top?.remainingCount || 0;

  if (!isOnline) {
    return (
      <div className="connection-banner is-danger" role="status">
        <IconWifiOff className="w-4 h-4" />
        <div className="connection-banner-copy">
          <strong>This screen lost Wi-Fi</strong>
          <span>
            If Chatrix is still running on this computer, sending continues in the background. Live status
            will catch up when the browser reconnects. The Aid Pickup desk keeps working from its cached
            list and uploads your collections when reconnected.
          </span>
        </div>
      </div>
    );
  }

  if (!socketConnected) {
    const pickupLine = offlineReady
      ? syncing
        ? `Aid Pickup desk is still working offline — syncing ${pendingCount} saved change${pendingCount === 1 ? "" : "s"} now.`
        : pendingCount > 0
          ? `Aid Pickup desk is still working offline — ${pendingCount} change${pendingCount === 1 ? "" : "s"} saved on this device will upload when reconnected.`
          : lastSyncAt
            ? "Aid Pickup desk is still working offline — all changes are saved on this device."
            : "Aid Pickup desk is still working offline — collections are saved on this device and upload when reconnected."
      : "Aid Pickup desk needs one online visit to load its list, then it works offline.";
    return (
      <div className="connection-banner is-danger" role="status">
        <IconAlertCircle className="w-4 h-4" />
        <div className="connection-banner-copy">
          <strong>Lost connection to Chatrix</strong>
          <span>
            The server on this computer is unreachable. Campaign progress is saved. Keep this window open —
            it will reconnect automatically. {pickupLine}
          </span>
        </div>
      </div>
    );
  }

  if (sendJob.running && sendJob.paused) {
    const relink = needsNewWhatsAppLink(sendJob.pauseReason);
    return (
      <div className={`connection-banner ${relink ? "is-danger" : "is-warning"}`} role="status">
        <IconWhatsApp className="w-4 h-4" />
        <div className="connection-banner-copy">
          <strong>
            {copy.title}
            {remaining ? ` · ${remaining} remaining` : ""}
          </strong>
          <span>{sendJob.stepText || copy.detail}</span>
        </div>
        {relink && (
          <button type="button" className="btn-secondary btn-xs" onClick={() => setCurrentStep("auth")}>
            Link number
          </button>
        )}
      </div>
    );
  }

  if (waState === "reconnecting") {
    return (
      <div className="connection-banner is-warning" role="status">
        <IconRefresh className="w-4 h-4 connection-spin" />
        <div className="connection-banner-copy">
          <strong>Reconnecting WhatsApp</strong>
          <span>{waMessage || "Keeping the charity number linked…"}</span>
        </div>
      </div>
    );
  }

  if (
    top &&
    remaining > 0 &&
    (waState === "error" || waState === "logged-out" || waState === "qr") &&
    !sendJob.running
  ) {
    return (
      <div className="connection-banner is-danger" role="status">
        <IconWhatsApp className="w-4 h-4" />
        <div className="connection-banner-copy">
          <strong>
            Unfinished campaign: {top.name} · {top.remainingCount} remaining
          </strong>
          <span>{pauseCopy(top.pauseReason).detail}</span>
        </div>
        <button type="button" className="btn-primary btn-xs" onClick={() => setCurrentStep("auth")}>
          Link & continue
        </button>
      </div>
    );
  }

  if (top && remaining > 0 && waState === "open" && !sendJob.running) {
    return (
      <div className="connection-banner is-info" role="status">
        <IconSend className="w-4 h-4" />
        <div className="connection-banner-copy">
          <strong>
            Continue “{top.name}” · {top.remainingCount} not sent yet
          </strong>
          <span>Already-sent people are skipped. This continues from the last unsent number.</span>
        </div>
        <button type="button" className="btn-primary btn-xs" onClick={() => resumeCampaign(top.id)}>
          Resume campaign
        </button>
      </div>
    );
  }

  return null;
}
