import React from "react";
import { useApp } from "../../context/AppContext.jsx";

export function BootScreen() {
  const { brand } = useApp();

  return (
    <div className="boot-screen-view">
      <div className="boot-dialog">
        <div className="boot-logo-wrap">
          {brand.hasLogo ? (
            <img src={brand.url} alt="" className="boot-logo-img" />
          ) : (
            <div className="boot-logo-letter">C</div>
          )}
        </div>
        <h2 className="boot-title">Chatrix Charity System</h2>
        <p className="boot-desc">Checking WhatsApp session and initializing…</p>
        <div className="boot-spinner" />
      </div>
    </div>
  );
}
