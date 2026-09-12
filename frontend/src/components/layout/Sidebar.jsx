import React from "react";
import { useApp } from "../../context/AppContext.jsx";
import {
  IconSend,
  IconPhone,
  IconSettings,
  IconMessage,
  IconLogOut,
  IconWifiOff,
  IconRefresh,
  IconX,
  IconTicket,
} from "../common/Icons.jsx";

export function Sidebar() {
  const {
    brand,
    currentStep,
    setCurrentStep,
    people,
    savedContacts,
    waState,
    waPhone,
    disconnecting,
    logout,
    resetSession,
    smsSettings,
    setSettingsActiveTab,
    isOnline,
    socketConnected,
    sendJob,
    setNavOpen,
    campaigns = [],
  } = useApp();

  const todayWaiting = campaigns.reduce((sum, c) => {
    if (!c?.createdAt) return sum;
    const a = new Date(c.createdAt);
    const b = new Date();
    const sameDay = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (!sameDay) return sum;
    const total = Number(c.stats?.people) || Number(c.totalPeople) || Number(c.totalRecipients) || 0;
    const taken = Number(c.stats?.taken) || 0;
    return sum + Math.max(0, total - taken);
  }, 0);
  const isLinked = waState === "open" && !disconnecting;
  const isSendingsActive = ["excel", "list", "send", "sending"].includes(currentStep);

  const managementItems = [
    {
      id: "contacts",
      label: "Contacts Directory",
      icon: <IconPhone className="w-4 h-4" />,
      badge: savedContacts.length > 0 ? String(savedContacts.length) : null,
      disabled: false,
    },
    {
      id: "settings",
      label: "Settings & SMS",
      icon: <IconSettings className="w-4 h-4" />,
      badge: smsSettings.ready ? "SMS ON" : "SMS OFF",
      badgeColor: smsSettings.ready ? "badge-success" : "badge-warn",
      disabled: false,
    },
  ];

  function handleSelectSendings() {
    if (!isSendingsActive) {
      if (sendJob.running) {
        setCurrentStep("send");
      } else if (people.length > 0) {
        setCurrentStep("list");
      } else {
        setCurrentStep("excel");
      }
    }
  }

  return (
    <aside className="app-sidebar" aria-label="Main Navigation">
      {/* Brand Header */}
      <div className="sidebar-brand-header">
        <div className="sidebar-brand-logo">
          {brand.hasLogo ? (
            <img src={brand.url} alt="Logo" className="sidebar-logo-img" />
          ) : (
            <div className="sidebar-logo-fallback">
              <span>C</span>
            </div>
          )}
        </div>
        <div className="sidebar-brand-text">
          <div className="sidebar-brand-title">
            <strong>Chatrix</strong>
            <span className="sidebar-brand-tag">Verified</span>
          </div>
          <span className="sidebar-brand-sub">Charity Outreach</span>
        </div>
        <button
          type="button"
          className="sidebar-close-btn"
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
        >
          <IconX className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation Groups */}
      <div className="sidebar-nav-scroll">
        {/* Sendings Group */}
        <div className="sidebar-section">
          <span className="sidebar-section-title">Sendings</span>
          <nav className="sidebar-nav-list">
            <button
              type="button"
              className={`sidebar-nav-item ${isSendingsActive ? "active" : ""}`}
              onClick={handleSelectSendings}
            >
              <span className="sidebar-nav-icon">
                <IconSend className="w-4 h-4" />
              </span>
              <span className="sidebar-nav-label">Sending Messages</span>
              {sendJob.running ? (
                <span className="sidebar-nav-badge badge-live">
                  {sendJob.paused ? "Paused" : "Live"}
                </span>
              ) : people.length > 0 ? (
                <span className="sidebar-nav-badge">{people.length}</span>
              ) : null}
            </button>
            <button
              type="button"
              className={`sidebar-nav-item ${currentStep === "pickup" ? "active" : ""}`}
              onClick={() => setCurrentStep("pickup")}
            >
              <span className="sidebar-nav-icon">
                <IconTicket className="w-4 h-4" />
              </span>
              <span className="sidebar-nav-label">Aid Pickup</span>
              {todayWaiting > 0 ? (
                <span className="sidebar-nav-badge">{todayWaiting}</span>
              ) : null}
            </button>
          </nav>
        </div>

        {/* Management Group */}
        <div className="sidebar-section">
          <span className="sidebar-section-title">System</span>
          <nav className="sidebar-nav-list">
            {managementItems.map((item) => {
              const active = currentStep === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`sidebar-nav-item ${active ? "active" : ""}`}
                  onClick={() => setCurrentStep(item.id)}
                >
                  <span className="sidebar-nav-icon">{item.icon}</span>
                  <span className="sidebar-nav-label">{item.label}</span>
                  {item.badge && (
                    <span className={`sidebar-nav-badge ${item.badgeColor || ""}`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Sidebar Footer with Live Connection Status */}
      <div className="sidebar-footer">
        {(!isOnline || !socketConnected) && (
          <div className="sidebar-offline-banner">
            <IconWifiOff className="w-3.5 h-3.5" />
            <span>{!isOnline ? "Wi-Fi Offline" : "Server disconnected"}</span>
          </div>
        )}

        <div className="sidebar-connection-card">
          <button
            type="button"
            className="sidebar-connection-status sidebar-connection-btn"
            onClick={() => setCurrentStep("auth")}
            title="Open WhatsApp linking"
          >
            <span className={`sidebar-status-dot ${isLinked ? "status-online" : "status-offline"}`} />
            <div className="sidebar-status-info">
              <span className="sidebar-status-label">
                {isLinked
                  ? "WhatsApp Active"
                  : disconnecting
                  ? "Updating session…"
                  : waState === "reconnecting"
                  ? "Reconnecting…"
                  : "Not Connected"}
              </span>
              <span className="sidebar-status-detail">
                {isLinked
                  ? waPhone || "Linked"
                  : sendJob.paused
                  ? "Link again to continue campaign"
                  : "Scan QR or clear session"}
              </span>
            </div>
          </button>

          <div className="sidebar-quick-actions">
            <button
              type="button"
              className={`sidebar-mini-pill ${smsSettings.ready ? "pill-sms-active" : "pill-sms-off"}`}
              onClick={() => {
                setSettingsActiveTab("sms");
                setCurrentStep("settings");
              }}
              title={smsSettings.ready ? "SMS fallback is configured" : "SMS is not configured — campaigns cannot send SMS"}
            >
              <IconMessage className="w-3 h-3" />
              <span>{smsSettings.ready ? "SMS configured" : "SMS not configured"}</span>
            </button>

            {isLinked ? (
              <button
                type="button"
                className="sidebar-disconnect-btn"
                onClick={logout}
                disabled={disconnecting}
                title="Disconnect charity WhatsApp"
              >
                <IconLogOut className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                className="sidebar-disconnect-btn"
                onClick={resetSession}
                disabled={disconnecting}
                title="Clear WhatsApp session and auth"
              >
                <IconRefresh className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
