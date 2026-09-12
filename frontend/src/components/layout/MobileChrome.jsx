import React, { useEffect } from "react";
import { useApp } from "../../context/AppContext.jsx";
import {
  IconMenu,
  IconSend,
  IconSettings,
  IconShield,
  IconTicket,
  IconHistory,
} from "../common/Icons.jsx";

export function MobileTopBar() {
  const { brand, navOpen, setNavOpen, waState, disconnecting } = useApp();
  const linked = waState === "open" && !disconnecting;

  return (
    <header className="mobile-topbar">
      <button
        type="button"
        className="mobile-menu-btn"
        aria-label="Open menu"
        aria-expanded={navOpen}
        onClick={() => setNavOpen(true)}
      >
        <IconMenu className="w-6 h-6" />
      </button>
      <div className="mobile-topbar-brand">
        {brand.hasLogo ? (
          <img src={brand.url} alt="" className="mobile-topbar-logo" />
        ) : (
          <span className="mobile-topbar-mark">C</span>
        )}
        <strong>Chatrix</strong>
      </div>
      <span className={`mobile-wa-pill ${linked ? "is-on" : "is-off"}`}>
        {linked ? "WA on" : "WA off"}
      </span>
    </header>
  );
}

export function NavOverlay() {
  const { navOpen, setNavOpen } = useApp();

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") setNavOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setNavOpen]);

  return (
    <button
      type="button"
      className={`nav-overlay ${navOpen ? "is-visible" : ""}`}
      aria-label="Close menu"
      tabIndex={navOpen ? 0 : -1}
      onClick={() => setNavOpen(false)}
    />
  );
}

export function MobileBottomNav() {
  const { currentStep, setCurrentStep, sendJob, people, waState } = useApp();
  const sendActive = ["excel", "list", "send", "sending"].includes(currentStep);

  function goSendings() {
    if (sendJob.running) setCurrentStep("send");
    else if (people.length > 0) setCurrentStep("list");
    else setCurrentStep("excel");
  }

  const items = [
    {
      id: "sendings",
      label: "Send",
      icon: <IconSend className="w-5 h-5" />,
      active: sendActive,
      onClick: goSendings,
    },
    {
      id: "campaigns",
      label: "Campaigns",
      icon: <IconHistory className="w-5 h-5" />,
      active: currentStep === "campaigns",
      onClick: () => setCurrentStep("campaigns"),
    },
    {
      id: "pickup",
      label: "Pickup",
      icon: <IconTicket className="w-5 h-5" />,
      active: currentStep === "pickup",
      onClick: () => setCurrentStep("pickup"),
    },
    {
      id: "auth",
      label: "Auth",
      icon: <IconShield className="w-5 h-5" />,
      active: currentStep === "auth",
      live: waState === "open",
      onClick: () => setCurrentStep("auth"),
    },
    {
      id: "settings",
      label: "Settings",
      icon: <IconSettings className="w-5 h-5" />,
      active: currentStep === "settings",
      onClick: () => setCurrentStep("settings"),
    },
  ];

  return (
    <nav className="mobile-bottom-nav" aria-label="Primary">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`mobile-nav-item ${item.active ? "active" : ""}`}
          onClick={item.onClick}
        >
          <span className="mobile-nav-icon">
            {item.icon}
            {item.live ? <span className="mobile-nav-live" /> : null}
          </span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
