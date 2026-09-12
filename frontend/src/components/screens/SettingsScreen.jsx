import React, { useEffect, useState } from "react";
import { useApp } from "../../context/AppContext.jsx";
import { buildReceiptHtml, clampPaperWidth, printReceipt, sampleReceipt } from "../../services/receipt.js";
import {
  IconCheck,
  IconUpload,
  IconMessage,
  IconShield,
  IconPrinter,
} from "../common/Icons.jsx";

export function SettingsScreen() {
  const {
    settingsActiveTab,
    setSettingsActiveTab,
    setCurrentStep,
    smsSettings,
    saveSms,
    brand,
    uploadLogo,
    clearLogo,
    waState,
    waPhone,
    showToast,
    printerSettings,
    savePrinter,
  } = useApp();

  // SMS local form state
  const [smsEnabled, setSmsEnabled] = useState(smsSettings.enabled);
  const [smsApiKey, setSmsApiKey] = useState("");
  const [smsFrom, setSmsFrom] = useState(smsSettings.from || "");
  const [paperWidthMm, setPaperWidthMm] = useState(printerSettings.paperWidthMm || 80);
  const [headerText, setHeaderText] = useState(printerSettings.headerText || "");

  useEffect(() => {
    setPaperWidthMm(printerSettings.paperWidthMm || 80);
    setHeaderText(printerSettings.headerText || "");
  }, [printerSettings.paperWidthMm, printerSettings.headerText]);

  function handleSaveSms() {
    saveSms({
      enabled: smsEnabled,
      apiKey: smsApiKey.trim(),
      from: smsFrom.trim(),
    });
    setSmsApiKey("");
  }

  function handleLogoFile(file) {
    if (!file) return;
    const mime = file.type || "";
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(mime) && !file.name.endsWith(".svg")) {
      showToast("Please pick a PNG, JPG, WEBP, GIF, or SVG image.", "error");
      return;
    }

    if (mime === "image/svg+xml" || file.name.endsWith(".svg")) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = String(reader.result || "");
          uploadLogo({
            mime: "image/svg+xml",
            data: btoa(unescape(encodeURIComponent(text))),
          });
        } catch (e) {
          showToast("Could not read SVG file.", "error");
        }
      };
      reader.readAsText(file);
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 256;
      const scale = Math.min(1, max / Math.max(img.width, img.height, 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL("image/png");
      uploadLogo({ mime: "image/png", data: dataUrl.split(",")[1] || "" });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      showToast("Could not load image.", "error");
    };
    img.src = url;
  }

  function handleSavePrinter() {
    savePrinter({
      paperWidthMm: clampPaperWidth(paperWidthMm),
      headerText: headerText.trim(),
    });
  }

  function handleTestPrint() {
    printReceipt(
      sampleReceipt({
        logoUrl: brand.url || "",
        headerText: headerText.trim(),
        paperWidthMm: clampPaperWidth(paperWidthMm),
      }),
      { paperWidthMm: clampPaperWidth(paperWidthMm), headerText: headerText.trim() }
    );
  }

  const previewHtml = buildReceiptHtml(
    sampleReceipt({
      logoUrl: brand.url || "",
      headerText: headerText.trim(),
      paperWidthMm: clampPaperWidth(paperWidthMm),
    }),
    { paperWidthMm: clampPaperWidth(paperWidthMm), headerText: headerText.trim() }
  );

  const tabs = [
    { id: "setup", label: "Setup Checklist", icon: <IconCheck className="w-4 h-4" /> },
    {
      id: "sms",
      label: "SMS Fallback",
      badge: smsSettings.ready ? "Active" : null,
      icon: <IconMessage className="w-4 h-4" />,
    },
    {
      id: "logo",
      label: "Brand Logo",
      badge: brand.hasLogo ? "Custom" : null,
      icon: <IconUpload className="w-4 h-4" />,
    },
    {
      id: "printer",
      label: "Receipt Printer",
      badge: `${printerSettings.paperWidthMm || 80}mm`,
      icon: <IconPrinter className="w-4 h-4" />,
    },
  ];
  const activeSettingsTab = tabs.some((tab) => tab.id === settingsActiveTab)
    ? settingsActiveTab
    : "setup";

  return (
    <div className="page-view settings-page">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings & Preferences</h1>
          <p className="page-subtitle">
            Configure SMS fallback, charity branding, and the bills printer used at the pickup desk.
          </p>
        </div>
      </div>

      {/* Sleek Underline Tabs */}
      <div className="modern-tabs-bar" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`modern-tab-btn ${activeSettingsTab === tab.id ? "active" : ""}`}
            onClick={() => setSettingsActiveTab(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span>{tab.label}</span>
            {tab.badge && <span className="tab-pill-badge">{tab.badge}</span>}
          </button>
        ))}
      </div>

      <div className="page-content-scroll">
        {/* Tab 1: Setup Checklist */}
        {activeSettingsTab === "setup" && (
          <div className="settings-section max-w-3xl">
            <p className="section-lead-text">
              Configure these preferences for your organization. Message names and pickup codes are not set here — select those Excel columns on Choose List, then control them on Compose Outreach.
            </p>

            <div className="checklist-list">
              {/* Item 1 */}
              <div className="checklist-row">
                <div className={`checklist-step-num ${waState === "open" ? "is-done" : ""}`}>
                  {waState === "open" ? <IconCheck className="w-4 h-4" /> : "1"}
                </div>
                <div className="checklist-details">
                  <h3 className="checklist-title">Link Charity WhatsApp Phone</h3>
                  <p className="checklist-desc">
                    {waState === "open"
                      ? `Connected as ${waPhone || "Linked phone"}. Ready for beneficiary outreach.`
                      : "Link your organization's Android or iPhone by scanning the QR code."}
                  </p>
                </div>
                <div className="checklist-action">
                  {waState === "open" ? (
                    <span className="chip-badge chip-success">Connected</span>
                  ) : (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => setCurrentStep("auth")}
                    >
                      Link WhatsApp
                    </button>
                  )}
                </div>
              </div>

              {/* Item 2 */}
              <div className="checklist-row">
                <div className={`checklist-step-num ${brand.hasLogo ? "is-done" : ""}`}>
                  {brand.hasLogo ? <IconCheck className="w-4 h-4" /> : "2"}
                </div>
                <div className="checklist-details">
                  <h3 className="checklist-title">Charity Organization Logo</h3>
                  <p className="checklist-desc">
                    {brand.hasLogo
                      ? "Custom official organization logo is active in the navigation header."
                      : "Replace default 'C' icon with your charity's official emblem or logo."}
                  </p>
                </div>
                <div className="checklist-action">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setSettingsActiveTab("logo")}
                  >
                    {brand.hasLogo ? "Change Logo" : "Upload Logo"}
                  </button>
                </div>
              </div>

              {/* Item 3 */}
              <div className="checklist-row">
                <div className={`checklist-step-num ${smsSettings.ready ? "is-done" : ""}`}>
                  {smsSettings.ready ? <IconCheck className="w-4 h-4" /> : "3"}
                </div>
                <div className="checklist-details">
                  <h3 className="checklist-title">Automatic SMS Fallback (httpSMS)</h3>
                  <p className="checklist-desc">
                    {smsSettings.ready
                      ? "Active. Undelivered WhatsApp messages will automatically send as standard SMS after 10 minutes."
                      : "Ensures beneficiaries who have no internet access still receive your outreach via cellular SMS."}
                  </p>
                </div>
                <div className="checklist-action">
                  <button
                    type="button"
                    className={smsSettings.ready ? "btn-secondary" : "btn-primary"}
                    onClick={() => setSettingsActiveTab("sms")}
                  >
                    {smsSettings.ready ? "Edit Settings" : "Configure SMS"}
                  </button>
                </div>
              </div>

              {/* Item 4 */}
              <div className="checklist-row">
                <div className="checklist-step-num is-done">
                  <IconPrinter className="w-4 h-4" />
                </div>
                <div className="checklist-details">
                  <h3 className="checklist-title">Bills Printer & Receipt Width</h3>
                  <p className="checklist-desc">
                    Aid pickup receipts print on your thermal bills printer. Current paper width is {printerSettings.paperWidthMm || 80} mm.
                  </p>
                </div>
                <div className="checklist-action">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setSettingsActiveTab("printer")}
                  >
                    Printer Settings
                  </button>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* Tab 2: SMS Fallback */}
        {activeSettingsTab === "sms" && (
          <div className="settings-section max-w-2xl">
            {/* Guide Info */}
            <div className="info-callout">
              <div className="info-callout-header">
                <IconShield className="w-4 h-4 text-emerald-600" />
                <strong>How httpSMS Fallback Works:</strong>
              </div>
              <ul className="info-callout-list">
                <li>Install the free <strong>httpSMS</strong> app on your charity Android phone with an active SIM card.</li>
                <li>Copy your API key from <strong>httpsms.com/settings</strong>.</li>
                <li>Enter the API key and phone number (+961 or +963 format) below.</li>
                <li>When any WhatsApp message remains undelivered for 10 minutes, Chatrix automatically triggers an SMS to that number.</li>
              </ul>
            </div>

            {/* Toggle switch */}
            <div className="modern-switch-row">
              <label className="switch-control">
                <input
                  type="checkbox"
                  checked={smsEnabled}
                  onChange={(e) => setSmsEnabled(e.target.checked)}
                />
                <span className="switch-slider" />
              </label>
              <div className="switch-label-wrap">
                <span className="switch-title">Enable Automatic SMS Fallback</span>
                <span className="switch-hint">Triggers an SMS if a recipient has no WhatsApp delivery after 10 minutes</span>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="sms-key-input">
                httpSMS API Key
              </label>
              <input
                id="sms-key-input"
                type="password"
                className="form-input"
                placeholder={
                  smsSettings.hasApiKey
                    ? `Saved (${smsSettings.apiKeyMasked || "••••••••"}) · Paste new key to update`
                    : "Paste API key from httpsms.com"
                }
                value={smsApiKey}
                onChange={(e) => setSmsApiKey(e.target.value)}
              />
              <span className="form-hint">Stored securely on your local server.</span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="sms-from-input">
                Sender Android Phone Number (+961 or +963 format)
              </label>
              <input
                id="sms-from-input"
                type="tel"
                className="form-input"
                placeholder="+9613154131"
                value={smsFrom}
                onChange={(e) => setSmsFrom(e.target.value)}
              />
              <span className="form-hint">Must match the phone number with the SIM card in the httpSMS app.</span>
            </div>

            <div className="form-actions">
              <button type="button" className="btn-primary" onClick={handleSaveSms}>
                <IconCheck className="w-4 h-4 mr-1.5" />
                <span>Save SMS Settings</span>
              </button>
            </div>
          </div>
        )}

        {/* Tab 3: Brand Logo */}
        {activeSettingsTab === "logo" && (
          <div className="settings-section max-w-2xl">
            <div className="brand-current-card">
              <div className="brand-avatar-view">
                {brand.hasLogo ? (
                  <img src={brand.url} alt="Logo" className="brand-avatar-img" />
                ) : (
                  <span className="brand-avatar-letter">C</span>
                )}
              </div>
              <div className="brand-meta">
                <h3 className="brand-name-title">Organization Brand Emblem</h3>
                <p className="brand-name-desc">
                  {brand.hasLogo
                    ? "Custom logo uploaded and active across the sidebar header."
                    : "Default emblem active. Upload your charity's official logo to customize the application."}
                </p>
                {brand.hasLogo && (
                  <button
                    type="button"
                    className="btn-danger-text"
                    onClick={clearLogo}
                  >
                    Remove logo and restore default
                  </button>
                )}
              </div>
            </div>

            <div
              className="modern-dropzone"
              onClick={() => document.getElementById("logo-upload-input")?.click()}
              role="button"
              tabIndex={0}
            >
              <input
                id="logo-upload-input"
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files?.[0]) handleLogoFile(e.target.files[0]);
                }}
              />
              <div className="dropzone-body">
                <div className="dropzone-icon-circle">
                  <IconUpload className="w-6 h-6 text-emerald-600" />
                </div>
                <span className="dropzone-title">Click to upload charity logo</span>
                <span className="dropzone-hint">
                  PNG, JPG, WEBP, or SVG · Square image recommended (512×512)
                </span>
              </div>
            </div>
          </div>
        )}

        {activeSettingsTab === "printer" && (
          <div className="settings-section printer-settings-grid">
            <div className="printer-settings-form">
              <div className="info-callout">
                <div className="info-callout-header">
                  <IconPrinter className="w-4 h-4 text-emerald-600" />
                  <strong>How pickup receipts print:</strong>
                </div>
                <ul className="info-callout-list">
                  <li>Connect a USB or network <strong>bills / thermal printer</strong> in Windows and set it as the printer in the print dialog.</li>
                  <li>Choose <strong>58 mm</strong> or <strong>80 mm</strong> to match the paper roll. Use custom if your roll is a different width.</li>
                  <li>At the Aid Pickup desk, Accept & Print marks the person as collected and opens this receipt.</li>
                  <li>The aid ID is sequential for every campaign <strong>sent on the same date</strong> (example: 260911-0007).</li>
                </ul>
              </div>

              <div className="form-group">
                <span className="form-label">Bills paper width</span>
                <div className="pickup-filter-group printer-width-presets">
                  {(printerSettings.presets || [58, 80]).map((mm) => (
                    <button
                      key={mm}
                      type="button"
                      className={`pickup-filter-btn ${Number(paperWidthMm) === mm ? "active" : ""}`}
                      onClick={() => setPaperWidthMm(mm)}
                    >
                      {mm} mm
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="paper-width-input">
                  Custom width (mm)
                </label>
                <input
                  id="paper-width-input"
                  type="number"
                  min={printerSettings.minWidthMm || 40}
                  max={printerSettings.maxWidthMm || 120}
                  className="form-input"
                  value={paperWidthMm}
                  onChange={(e) => setPaperWidthMm(e.target.value)}
                />
                <span className="form-hint">
                  Allowed range {printerSettings.minWidthMm || 40}–{printerSettings.maxWidthMm || 120} mm. Most charity bills printers use 58 or 80.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="receipt-header-input">
                  Organization name on receipt (optional)
                </label>
                <input
                  id="receipt-header-input"
                  type="text"
                  className="form-input"
                  dir="auto"
                  placeholder="اسم الجمعية"
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                  maxLength={80}
                />
                <span className="form-hint">Printed at the top. Leave empty to show only the receipt title and logo.</span>
              </div>

              <div className="form-actions printer-form-actions">
                <button type="button" className="btn-primary" onClick={handleSavePrinter}>
                  <IconCheck className="w-4 h-4 mr-1.5" />
                  <span>Save Printer Settings</span>
                </button>
                <button type="button" className="btn-secondary" onClick={handleTestPrint}>
                  <IconPrinter className="w-4 h-4 mr-1.5" />
                  <span>Test Print</span>
                </button>
              </div>
            </div>

            <div className="receipt-preview-card">
              <span className="form-label">Live preview · {clampPaperWidth(paperWidthMm)} mm</span>
              <div className="receipt-preview-frame">
                <iframe
                  title="Receipt preview"
                  className="receipt-preview-iframe"
                  style={{ width: `${clampPaperWidth(paperWidthMm) * 3.2}px` }}
                  srcDoc={previewHtml}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
