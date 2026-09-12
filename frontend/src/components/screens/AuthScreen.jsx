import React, { useEffect, useState } from "react";
import { useApp } from "../../context/AppContext.jsx";
import { IconShield, IconSparkles, IconCheck, IconRefresh } from "../common/Icons.jsx";

export function AuthScreen() {
  const {
    qrCode,
    waState,
    waMessage,
    waPhone,
    resetSession,
    disconnecting,
    socketConnected,
    isOnline,
    resumableCampaigns,
  } = useApp();
  const [qrWaited, setQrWaited] = useState(false);
  const isLinked = waState === "open" && !disconnecting;
  const showQrBox = !isLinked && waState !== "reconnecting";

  useEffect(() => {
    if (qrCode || isLinked || waState === "reconnecting") {
      setQrWaited(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setQrWaited(true), 10000);
    return () => window.clearTimeout(timer);
  }, [qrCode, waState, isLinked]);

  const qrStuck = showQrBox && !qrCode && (qrWaited || waState === "logged-out" || waState === "error");

  return (
    <div className="page-view auth-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{isLinked ? "Charity WhatsApp is linked" : "Link Charity WhatsApp"}</h1>
          <p className="page-subtitle">
            {isLinked
              ? `Connected as ${waPhone || "the charity number"}. No QR scan is needed until you clear this session.`
              : "Scan the QR code once with your charity phone to link WhatsApp Web session"}
          </p>
        </div>

        <span
          className={`chip-badge ${
            isLinked
              ? "chip-success"
              : !isOnline || !socketConnected || waState === "error" || waState === "logged-out"
              ? "chip-danger"
              : "chip-warning"
          }`}
        >
          <span className="dot-indicator" />
          <span>
            {isLinked
              ? `Linked${waPhone ? ` · ${waPhone}` : ""}`
              : !isOnline
              ? "Wi-Fi is offline."
              : !socketConnected
              ? "Chatrix server is not running. Start it with npm start."
              : waMessage || "Connecting…"}
          </span>
        </span>
      </div>

      <div className="page-content-scroll">
        <div className={`auth-clean-grid ${isLinked || !showQrBox ? "is-linked" : ""}`}>
          {showQrBox && (
            <div className="qr-box-clean">
              <div className="qr-frame-clean">
                {qrCode ? (
                  <div className="qr-img-wrapper">
                    <img src={qrCode} alt="WhatsApp Pairing QR Code" className="qr-img" />
                  </div>
                ) : (
                  <div className="qr-waiting-box">
                    <div className="spinner-clean" />
                    <p>
                      {disconnecting
                        ? "Clearing saved session…"
                        : !socketConnected
                        ? "Waiting for Chatrix server…"
                        : qrStuck
                        ? "QR did not load. Clear the session below."
                        : "Generating pairing QR code…"}
                    </p>
                  </div>
                )}
              </div>
              <div className="qr-footer-hint">
                <IconSparkles className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                <span>QR refreshes automatically if not scanned</span>
              </div>
            </div>
          )}

          <div className="auth-guide-column">
            {isLinked ? (
              <div className="auth-linked-card">
                <div className="auth-linked-icon">
                  <IconCheck className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="auth-guide-title">Already authenticated</h3>
                  <p className="auth-linked-copy">
                    This computer is linked to <strong>{waPhone || "the charity WhatsApp number"}</strong>. You can
                    send campaigns from the Send tab. The QR code stays hidden until you clear the session to
                    connect a different number.
                  </p>
                </div>
              </div>
            ) : waState === "reconnecting" ? (
              <div className="auth-linked-card is-reconnect">
                <div className="auth-linked-icon is-reconnect">
                  <IconRefresh className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="auth-guide-title">Reconnecting saved session</h3>
                  <p className="auth-linked-copy">
                    A number is already authenticated on this computer. Chatrix is restoring the link — no QR scan
                    is needed unless reconnect fails.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <h3 className="auth-guide-title">How to connect in 3 steps:</h3>

                <div className="auth-steps-list">
                  <div className="auth-step-row">
                    <span className="auth-step-badge">1</span>
                    <div className="auth-step-text">
                      <strong>Open WhatsApp on Charity Phone</strong>
                      <p>Open WhatsApp on Android or iPhone, tap Settings or 3-dots Menu</p>
                    </div>
                  </div>

                  <div className="auth-step-row">
                    <span className="auth-step-badge">2</span>
                    <div className="auth-step-text">
                      <strong>Select Linked Devices</strong>
                      <p>
                        Tap on <strong>Linked devices</strong> → <strong>Link a device</strong>
                      </p>
                    </div>
                  </div>

                  <div className="auth-step-row">
                    <span className="auth-step-badge">3</span>
                    <div className="auth-step-text">
                      <strong>Scan the QR Code</strong>
                      <p>Point your phone's camera at the QR code on this screen</p>
                    </div>
                  </div>
                </div>
              </>
            )}

            {Array.isArray(resumableCampaigns) && resumableCampaigns.length > 0 && (
              <div className="info-callout mt-4">
                <div className="info-callout-header">
                  <IconShield className="w-4 h-4 text-amber-700" />
                  <span>
                    <strong>Unfinished campaign:</strong> {resumableCampaigns[0].name} still has{" "}
                    {resumableCampaigns[0].remainingCount} people unsent.{" "}
                    {isLinked
                      ? "Open Send to continue from the last unsent number — already-sent people are not sent twice."
                      : "After you scan, Chatrix continues from the last unsent number — already-sent people are not sent twice."}
                  </span>
                </div>
              </div>
            )}

            {!isOnline && (
              <div className="info-callout mt-4">
                <div className="info-callout-header">
                  <IconRefresh className="w-4 h-4 text-rose-600" />
                  <span>
                    {isLinked
                      ? "This screen is offline. The linked number stays saved on this computer."
                      : "This screen is offline. Reconnect Wi-Fi to load a new QR code."}
                  </span>
                </div>
              </div>
            )}

            <div className={`auth-reset-card ${qrStuck ? "is-urgent" : ""}`}>
              <div>
                <strong>
                  {isLinked ? "Need to link a different number?" : "QR not loading or showing Disconnected?"}
                </strong>
                <p>
                  {isLinked
                    ? "Clear session & auth only if you must replace this WhatsApp number. Unfinished campaigns stay saved."
                    : "A stale WhatsApp login on this computer can block a new QR. Clear session & auth, then scan again."}
                </p>
              </div>
              <button
                type="button"
                className="btn-danger"
                onClick={resetSession}
                disabled={disconnecting}
              >
                <IconRefresh className="w-4 h-4 mr-1.5" />
                <span>{disconnecting ? "Clearing…" : "Clear session & auth"}</span>
              </button>
            </div>

            <div className="info-callout mt-4">
              <div className="info-callout-header">
                <IconShield className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  <strong>Zero Relogin Needed:</strong> After a successful scan, credentials stay on this computer.
                  Use the button above only if the link breaks.
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
