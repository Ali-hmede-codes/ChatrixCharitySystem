import React, { useState, useMemo, useRef, useEffect } from "react";
import { useApp } from "../../context/AppContext.jsx";
import {
  personNames,
  personInitials,
  buildPreviewMessage,
  messageHasCodePlaceholder,
  messageHasNamePlaceholder,
  sanitizeAidCode,
  namesEqual,
} from "../../services/names.js";
import { getAvatarColor } from "../../constants/colors.js";
import { matchesCampaign, matchesRecipient } from "../../services/search.js";
import { DEFAULT_NAME_TEMPLATE } from "../../constants/config.js";
import {
  MESSAGE_TEMPLATES,
  AID_CODE_PLACEHOLDER,
  PERSON_NAME_PLACEHOLDER,
  isTemplateAvailable,
  constrainMessageToColumns,
} from "../../constants/templates.js";
import {
  IconSend,
  IconStop,
  IconShield,
  IconCheck,
  IconHistory,
  IconPhone,
  IconSearch,
  IconTrash,
  IconX,
  IconRefresh,
  IconUsers,
  IconKey,
  IconSparkles,
  IconPrinter,
  IconTicket,
} from "../common/Icons.jsx";

export function SendScreen() {
  const {
    people,
    sendJob,
    startSend,
    stopSend,
    resumeCampaign,
    listColumns,
    smsSettings,
    waState,
    showToast,
    campaigns,
    isOnline,
    socketConnected,
    setCurrentStep,
    activeCampaignDetails,
    loadingCampaignDetails,
    fetchCampaignDetails,
    clearCampaignDetails,
    deleteCampaign,
    pickupBusy,
    markPickup,
    reprintPickup,
  } = useApp();

  const [activeTab, setActiveTab] = useState("compose"); // "compose" | "history"

  // Campaign Compose State
  const defaultCampaignName = useMemo(() => {
    const today = new Date();
    const dateStr = today.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    return `حملة توزيع - ${dateStr}`;
  }, []);

  const [campaignName, setCampaignName] = useState(defaultCampaignName);
  const [enableSms, setEnableSms] = useState(Boolean(smsSettings.ready));
  const [messageText, setMessageText] = useState("");
  const [includeGreeting, setIncludeGreeting] = useState(() => Boolean(listColumns.hasNames));
  const [activeTemplateId, setActiveTemplateId] = useState("");
  const messageTextareaRef = useRef(null);

  // History search & modal filter state
  const [historySearch, setHistorySearch] = useState("");
  const [modalSearch, setModalSearch] = useState("");

  // Compose recipients preview state
  const [showComposeRecipients, setShowComposeRecipients] = useState(false);
  const [composeSearch, setComposeSearch] = useState("");

  const hasNames = Boolean(listColumns.hasNames);
  const hasCodes = Boolean(listColumns.hasCodes);
  const peopleWithCodes = useMemo(
    () => (hasCodes ? people.filter((p) => sanitizeAidCode(p.code)).length : 0),
    [people, hasCodes]
  );
  const peopleWithNames = useMemo(
    () => (hasNames ? people.filter((p) => personNames(p).length > 0).length : 0),
    [people, hasNames]
  );

  useEffect(() => {
    setMessageText((prev) => constrainMessageToColumns(prev, { hasNames, hasCodes }));
    setActiveTemplateId((id) => {
      const template = MESSAGE_TEMPLATES.find((item) => item.id === id);
      if (!template) return id;
      return isTemplateAvailable(template, { hasNames, hasCodes }) ? id : "";
    });
    setIncludeGreeting((prev) => (hasNames ? prev : false));
  }, [hasNames, hasCodes]);

  const availableTemplates = useMemo(
    () => MESSAGE_TEMPLATES.filter((template) => isTemplateAvailable(template, { hasNames, hasCodes })),
    [hasNames, hasCodes]
  );

  const greetingConfig = useMemo(
    () => ({
      useNameTemplate: hasNames && includeGreeting,
      template: DEFAULT_NAME_TEMPLATE,
    }),
    [hasNames, includeGreeting]
  );

  const sampleRecipient = useMemo(() => {
    const first = people[0];
    if (!first) {
      return {
        phone: "+961 70 123 456",
        names: hasNames ? ["أحمد"] : [],
        name: hasNames ? "أحمد" : "",
        code: hasCodes ? "AID-0926" : "",
      };
    }
    return {
      ...first,
      names: hasNames ? personNames(first) : [],
      name: hasNames ? first.name || "" : "",
      code: hasCodes ? sanitizeAidCode(first.code) : "",
    };
  }, [people, hasNames, hasCodes]);

  const previewText = buildPreviewMessage(sampleRecipient, messageText, greetingConfig, {
    code: hasCodes ? sanitizeAidCode(sampleRecipient.code) : "",
  });

  function setConstrainedMessage(next) {
    setMessageText(constrainMessageToColumns(next, { hasNames, hasCodes }));
  }

  function insertToken(token) {
    if (token === PERSON_NAME_PLACEHOLDER && !hasNames) return;
    if (token === AID_CODE_PLACEHOLDER && !hasCodes) return;
    const textarea = messageTextareaRef.current;
    if (!textarea) {
      setConstrainedMessage(messageText ? `${messageText} ${token}` : token);
      setActiveTemplateId("");
      return;
    }
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    const next = `${textarea.value.slice(0, start)}${token}${textarea.value.slice(end)}`;
    setConstrainedMessage(next);
    setActiveTemplateId("");
    requestAnimationFrame(() => {
      textarea.focus();
      const pos = start + token.length;
      textarea.setSelectionRange(pos, pos);
    });
  }

  function applyTemplate(template) {
    if (!isTemplateAvailable(template, { hasNames, hasCodes })) return;
    setConstrainedMessage(template.body);
    setActiveTemplateId(template.id);
    requestAnimationFrame(() => {
      messageTextareaRef.current?.focus();
    });
  }

  function handleStartSend() {
    if (waState !== "open") {
      showToast("Link WhatsApp first before sending.", "error");
      return;
    }
    if (!isOnline || !socketConnected) {
      showToast("Reconnect Wi-Fi / Chatrix first. Unfinished campaigns stay saved.", "warning");
      return;
    }
    const useGreeting = hasNames && includeGreeting;
    const body = constrainMessageToColumns(messageText, { hasNames, hasCodes }).trim();
    if (!body && !useGreeting) {
      showToast("Please type a message or pick a template to send.", "warning");
      return;
    }
    if (people.length === 0) {
      showToast("No recipients in the list.", "warning");
      return;
    }

    if (messageHasNamePlaceholder(body) && !hasNames) {
      showToast("No name column was selected. Names will not be sent. Remove [PersonName] or re-import with a name column.", "warning");
      return;
    }
    if (messageHasCodePlaceholder(body) && !hasCodes) {
      showToast("No pickup-code column was selected. Codes will not be sent. Pick a template without [Code], or re-import with a code column.", "warning");
      return;
    }

    if (messageHasNamePlaceholder(body) || useGreeting) {
      const missing = people.filter((p) => personNames(p).length === 0);
      if (missing.length) {
        showToast(
          `${missing.length} recipients have no name in the Excel name column. Re-import with a complete name column, or turn off the name greeting.`,
          "warning"
        );
        return;
      }
    }

    if (messageHasCodePlaceholder(body)) {
      const missing = people.filter((p) => !sanitizeAidCode(p.code));
      if (missing.length) {
        showToast(
          missing.length === people.length
            ? "The selected code column has no pickup codes. Re-import with a code column, or pick a template without [Code]."
            : `${missing.length} recipients have no pickup code in Excel. Fill the code column, or pick a template without [Code].`,
          "warning"
        );
        return;
      }
    }

    const title = campaignName.trim() || defaultCampaignName;

    const actionable = people.map((p) => ({
      phone: p.phone,
      names: hasNames ? personNames(p) : [],
      name: hasNames ? p.name || "" : "",
      code: hasCodes ? sanitizeAidCode(p.code) : "",
    }));

    startSend(actionable, body, {
      campaignName: title,
      enableSms: Boolean(enableSms),
      useNameTemplate: useGreeting,
      nameTemplate: DEFAULT_NAME_TEMPLATE,
    });
  }

  function handleReuseCampaign(c) {
    const next = constrainMessageToColumns(c.message || "", { hasNames, hasCodes });
    setConstrainedMessage(next);
    setActiveTemplateId("");
    setCampaignName(`متابعة: ${c.name}`);
    setEnableSms(Boolean(c.enableSms));
    setActiveTab("compose");
    if ((c.message && next !== String(c.message || "").trim()) || (!hasCodes && c.aidCode)) {
      showToast("Loaded the message. Names/codes that this list cannot send were removed.", "info");
    } else {
      showToast(`Loaded message from "${c.name}" into composer`, "success");
    }
  }

  const { running, paused, locked, stepText, progressPercent, logs, deliverySummary, remaining } = sendJob;
  const sendingBusy = running || paused;

  // Filter campaigns with Arabic & phone normalization
  const filteredCampaigns = useMemo(() => {
    if (!historySearch.trim()) return campaigns;
    return campaigns.filter((c) => matchesCampaign(c, historySearch));
  }, [campaigns, historySearch]);

  // Filter modal recipients with Arabic & phone normalization
  const expandedModalRecipients = useMemo(() => {
    const rec = activeCampaignDetails?.recipients || [];
    const rows = [];
    rec.forEach((r) => {
      const names = personNames(r);
      const people = names.length ? names : [r.name || "Beneficiary"];
      const pickups = Array.isArray(r.pickups) ? r.pickups : [];
      people.forEach((name) => {
        const pickup = pickups.find((p) => namesEqual(p.name, name)) || {};
        rows.push({
          ...r,
          personName: name,
          displayName: name,
          takenAt: pickup.takenAt || null,
          takenAidId: pickup.takenAidId || "",
          familySize: people.length,
          familyNames: people,
        });
      });
    });
    return rows;
  }, [activeCampaignDetails]);

  const filteredModalRecipients = useMemo(() => {
    if (!expandedModalRecipients.length) return [];
    if (!modalSearch.trim()) return expandedModalRecipients;
    return expandedModalRecipients.filter((r) =>
      matchesRecipient({ ...r, name: r.displayName, takenAidId: r.takenAidId }, modalSearch)
    );
  }, [expandedModalRecipients, modalSearch]);

  // Filter compose recipients
  const filteredComposeRecipients = useMemo(() => {
    if (!people.length) return [];
    if (!composeSearch.trim()) return people;
    return people.filter((p) =>
      matchesRecipient({ name: p.name, phone: p.phone, code: p.code }, composeSearch)
    );
  }, [people, composeSearch]);

  return (
    <div className="page-view send-page">
      {/* Header with Sub-Tabs */}
      <div className="page-header">
        <div className="page-header-title-group">
          <div className="header-tabs-pills">
            <button
              type="button"
              className={`header-tab-pill ${activeTab === "compose" ? "active" : ""}`}
              onClick={() => setActiveTab("compose")}
            >
              <IconSend className="w-3.5 h-3.5 mr-1" />
              <span>Compose Outreach</span>
            </button>
            <button
              type="button"
              className={`header-tab-pill ${activeTab === "history" ? "active" : ""}`}
              onClick={() => setActiveTab("history")}
            >
              <IconHistory className="w-3.5 h-3.5 mr-1" />
              <span>Past Campaigns & Stats</span>
              {campaigns.length > 0 && (
                <span className="tab-pill-counter">{campaigns.length}</span>
              )}
            </button>
          </div>
          <p className="page-subtitle">
            {activeTab === "compose"
              ? "Names and pickup codes are included only if you selected those Excel columns. Write the message here — not in Settings."
              : "Review delivery rates, confirmed WhatsApp receipts, and cellular SMS stats across campaigns"}
          </p>
        </div>

        <div className="header-actions">
          {activeTab === "compose" && (
            <>
              {running ? (
                <button type="button" className="btn-danger" onClick={stopSend}>
                  <IconStop className="w-4 h-4 mr-1.5" />
                  <span>{paused ? "Stop remaining" : "Stop Sending"}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleStartSend}
                  disabled={people.length === 0 || !isOnline || !socketConnected}
                >
                  <IconSend className="w-4 h-4 mr-1.5" />
                  <span>Launch Campaign ({people.length})</span>
                </button>
              )}
            </>
          )}

          {activeTab === "history" && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setActiveTab("compose")}
            >
              <IconSend className="w-3.5 h-3.5 mr-1" />
              <span>New Campaign</span>
            </button>
          )}
        </div>
      </div>

      <div className="page-content-scroll">
        {/* ================================================================= */}
        {/* TAB 1: COMPOSE OUTREACH                                           */}
        {/* ================================================================= */}
        {activeTab === "compose" && (
          <>
            {/* Progress Bar when Active */}
            {(running || locked || stepText) && (
              <div className={`send-progress-banner ${paused ? "is-paused" : ""}`}>
                <div className="progress-info-line">
                  <span className="progress-status-text">{stepText}</span>
                  <span className="progress-percentage">
                    {paused && remaining ? `${remaining} left` : `${progressPercent}%`}
                  </span>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            {/* 2-Column Unboxed Workspace */}
            <div className="send-workspace-grid">
              {/* Left Column: Campaign Setup & Composer */}
              <div className="composer-column">
                {/* Step 1: Campaign */}
                <div className="campaign-setup-card">
                  <div className="compose-step-label">Step 1 · Campaign</div>
                  <div className="form-field-group mb-3">
                    <label className="field-label" htmlFor="campaign-title-input">
                      Campaign Name / اسم الحملة
                    </label>
                    <input
                      id="campaign-title-input"
                      type="text"
                      className="form-input"
                      placeholder="e.g. حملة توزيع السلات الغذائية - أيلول 2026"
                      value={campaignName}
                      onChange={(e) => setCampaignName(e.target.value)}
                      disabled={sendingBusy}
                      dir="auto"
                    />
                  </div>

                  <div className="compose-include-grid">
                    <div className={`include-status-card ${hasNames ? "is-on" : "is-off"}`}>
                      <div className="include-status-top">
                        <IconUsers className="w-4 h-4" />
                        <strong>Person names</strong>
                        <span className={`chip-badge ${hasNames ? "chip-success" : "chip-neutral"}`}>
                          {hasNames ? "From Excel" : "Off"}
                        </span>
                      </div>
                      <p className="include-status-desc">
                        {hasNames
                          ? `${peopleWithNames} of ${people.length} people have a name from the column you selected.`
                          : "Name column is None. Recipients will not receive a personal name in this campaign."}
                      </p>
                      {hasNames && (
                        <label className="include-greeting-toggle">
                          <input
                            type="checkbox"
                            checked={includeGreeting}
                            onChange={(e) => setIncludeGreeting(e.target.checked)}
                            disabled={sendingBusy}
                          />
                          <span>Start with greeting: مرحبا [PersonName]</span>
                        </label>
                      )}
                    </div>

                    <div className={`include-status-card ${hasCodes ? "is-on-code" : "is-off"}`}>
                      <div className="include-status-top">
                        <IconKey className="w-4 h-4" />
                        <strong>Pickup codes / كود الاستلام</strong>
                        <span className={`chip-badge ${hasCodes ? "chip-warning" : "chip-neutral"}`}>
                          {hasCodes ? "From Excel" : "Off"}
                        </span>
                      </div>
                      <p className="include-status-desc">
                        {hasCodes
                          ? `${peopleWithCodes} of ${people.length} people have a pickup code. Pick a template with [Code] to send each person's Excel code.`
                          : "Code column is None. This campaign cannot send pickup codes — there is no code to type here."}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Step 2: Message */}
                <div className="composer-card">
                  <div className="compose-step-label">Step 2 · Message</div>
                  <div className="composer-header">
                    <label className="composer-label" htmlFor="outreach-textarea">
                      Message for {people.length} recipients
                    </label>
                    <div className="composer-badges">
                      {hasNames && includeGreeting && (
                        <span className="chip-badge chip-emerald">Greeting on</span>
                      )}
                      {hasCodes && peopleWithCodes > 0 && (
                        <span className="chip-badge chip-warning">
                          <IconKey className="w-3 h-3 mr-1" />
                          {peopleWithCodes} codes
                        </span>
                      )}
                      <span className="char-count">{messageText.length} chars</span>
                      {people.length > 0 && (
                        <button
                          type="button"
                          className="btn-secondary btn-xs"
                          onClick={() => setShowComposeRecipients(true)}
                          title="Search and inspect recipients in this campaign"
                        >
                          <IconUsers className="w-3 h-3 mr-1" />
                          <span>Recipients ({people.length})</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="template-chip-row">
                    <span className="template-chip-label">
                      <IconSparkles className="w-3.5 h-3.5" />
                      Templates
                    </span>
                    {availableTemplates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        className={`template-chip ${
                          activeTemplateId === template.id ? "active" : ""
                        }`}
                        onClick={() => applyTemplate(template)}
                        disabled={sendingBusy}
                        title={template.body}
                      >
                        {template.titleAr}
                      </button>
                    ))}
                  </div>

                  {(hasNames || hasCodes) && (
                    <div className="insert-token-row">
                      <span className="insert-token-label">Insert</span>
                      {hasNames && (
                        <button
                          type="button"
                          className="insert-token-btn"
                          onClick={() => insertToken(PERSON_NAME_PLACEHOLDER)}
                          disabled={sendingBusy}
                          title="Insert the beneficiary name from Excel"
                        >
                          {PERSON_NAME_PLACEHOLDER}
                        </button>
                      )}
                      {hasCodes && (
                        <button
                          type="button"
                          className="insert-token-btn insert-token-code"
                          onClick={() => insertToken(AID_CODE_PLACEHOLDER)}
                          disabled={sendingBusy}
                          title="Insert the Excel pickup code"
                        >
                          {AID_CODE_PLACEHOLDER}
                        </button>
                      )}
                      <span className="insert-token-hint">
                        {hasNames && hasCodes
                          ? "[PersonName] and [Code] are replaced from the Excel columns you selected."
                          : hasNames
                          ? "[PersonName] becomes each beneficiary's name from Excel."
                          : "[Code] becomes each beneficiary's pickup code from Excel."}
                      </span>
                    </div>
                  )}

                  <textarea
                    id="outreach-textarea"
                    ref={messageTextareaRef}
                    className="composer-textarea"
                    placeholder={
                      hasCodes
                        ? "Pick a template, or write here. Click [Code] where the Excel pickup code should appear…"
                        : hasNames
                        ? "Pick a template, or write here. Click [PersonName] where the name should appear…"
                        : "Write the same announcement for everyone. Names and codes are off because those Excel columns were None."
                    }
                    dir="auto"
                    value={messageText}
                    onChange={(e) => {
                      setConstrainedMessage(e.target.value);
                      setActiveTemplateId("");
                    }}
                    disabled={sendingBusy}
                  />
                </div>

                {/* Step 3: Delivery */}
                <div className="campaign-setup-card">
                  <div className="compose-step-label">Step 3 · Delivery</div>
                  <div
                    className={`campaign-sms-card ${
                      enableSms ? "sms-active" : "sms-inactive"
                    }`}
                  >
                    <div className="sms-card-header">
                      <div className="sms-card-left">
                        <label className="switch-control">
                          <input
                            type="checkbox"
                            checked={enableSms}
                            onChange={(e) => setEnableSms(e.target.checked)}
                            disabled={sendingBusy}
                          />
                          <span className="switch-slider" />
                        </label>
                        <div>
                          <strong className="sms-card-title">
                            {enableSms
                              ? "Send SMS in this campaign (Automatic 10-Min Fallback)"
                              : "WhatsApp Only (SMS Fallback disabled for this campaign)"}
                          </strong>
                          <p className="sms-card-desc">
                            {enableSms
                              ? "If a WhatsApp message isn't confirmed delivered within 10 minutes or the recipient is not on WhatsApp, httpSMS will automatically send via cellular SMS."
                              : "No cellular SMS will be sent for this campaign. Beneficiaries without WhatsApp or with delays will be skipped to save SMS credits."}
                          </p>
                        </div>
                      </div>

                      <div className="sms-card-badge">
                        {enableSms ? (
                          <span className="chip-badge chip-success">
                            <IconCheck className="w-3 h-3 mr-1" />
                            SMS Fallback Active
                          </span>
                        ) : (
                          <span className="chip-badge chip-neutral">
                            WhatsApp Only
                          </span>
                        )}
                      </div>
                    </div>

                    {!smsSettings.ready && enableSms && (
                      <div className="sms-warning-inline">
                        <IconPhone className="w-3.5 h-3.5 mr-1" />
                        <span>
                          Note: Cellular SMS gateway is not configured yet. You can configure httpSMS credentials in <strong>Settings & SMS</strong>.
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Pacing and Protection note */}
                <div className="info-callout">
                  <div className="info-callout-header">
                    <IconShield className="w-4 h-4 text-emerald-600" />
                    <strong>Anti-Ban Protection & Safe Pacing</strong>
                  </div>
                  <p className="callout-desc">
                    Simulates real human typing (1.4s–4s) with safety intervals (9s–18s) and resting pauses
                    every 7 messages to protect the charity phone from spam restrictions.
                  </p>
                  <div className="callout-sub-status text-emerald-700">
                    <IconCheck className="w-3.5 h-3.5 mr-1 inline" />
                    Campaign stats and delivery status will be saved automatically for future review.
                  </div>
                </div>
              </div>

              {/* Right Column: Live Mockup + Live Logs + Delivery stats */}
              <div className="preview-column">
                <div className="preview-card-clean">
                  <div className="preview-title-row">
                    <span className="preview-title">
                      WhatsApp Preview ({hasNames ? sampleRecipient.name || "Recipient" : "Recipient"})
                    </span>
                    <span className="chip-badge chip-neutral">Live Preview</span>
                  </div>

                  {/* Realistic WhatsApp Chat Preview */}
                  <div className="wa-clean-mockup">
                    <div className="wa-mockup-header-clean">
                      <div className="wa-mockup-avatar">
                        {hasNames ? sampleRecipient.name?.[0] || "C" : "C"}
                      </div>
                      <div className="wa-mockup-meta">
                        <strong className="wa-mockup-name">
                          {hasNames ? sampleRecipient.name || "Beneficiary" : "Beneficiary"}
                        </strong>
                        <span className="wa-mockup-status">online</span>
                      </div>
                    </div>

                    <div className="wa-mockup-chat-canvas">
                      <div className="wa-bubble-clean" dir="auto">
                        <p className="wa-msg-text">
                          {previewText ||
                            "Your message preview will appear here as the beneficiary receives it…"}
                        </p>
                        <div className="wa-msg-time-row">
                          <span className="wa-msg-time">
                            {new Date().toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          <span className="wa-blue-ticks">✓✓</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Delivery Summary Grid */}
                {deliverySummary && (
                  <div className="delivery-metrics-card">
                    <h3 className="metrics-title">
                      <IconCheck className="w-4 h-4 text-emerald-600 mr-1.5" />
                      Delivery & 10-Minute SMS Verification
                    </h3>
                    <div className="metrics-grid">
                      <div className="metric-box border-emerald-500">
                        <strong className="metric-num text-emerald-700">
                          {deliverySummary.delivered || 0}
                        </strong>
                        <span className="metric-label">WhatsApp Delivered</span>
                      </div>
                      <div className="metric-box border-amber-500">
                        <strong className="metric-num text-amber-700">
                          {deliverySummary.waiting || 0}
                        </strong>
                        <span className="metric-label">Waiting (10 min check)</span>
                      </div>
                      <div className="metric-box border-rose-500">
                        <strong className="metric-num text-rose-700">
                          {deliverySummary.undelivered || 0}
                        </strong>
                        <span className="metric-label">Undelivered</span>
                      </div>
                      <div className="metric-box border-teal-500">
                        <strong className="metric-num text-teal-700">
                          {deliverySummary.smsSent || 0}
                        </strong>
                        <span className="metric-label">SMS Triggered</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Live Logs */}
                {logs.length > 0 && (
                  <div className="logs-panel">
                    <div className="logs-header-bar">
                      <span className="logs-title">Outbound Activity</span>
                      <span className="chip-badge chip-neutral">
                        {logs.length} updates
                      </span>
                    </div>
                    <div className="logs-scrollable">
                      {logs.map((log, idx) => (
                        <div key={idx} className={`log-row log-state-${log.state}`}>
                          <code className="log-phone">{log.phone}</code>
                          <span className={`log-state-tag tag-${log.state}`}>
                            {log.state}
                          </span>
                          <span className="log-detail">{log.detail}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ================================================================= */}
        {/* TAB 2: PAST CAMPAIGNS & STATS                                     */}
        {/* ================================================================= */}
        {activeTab === "history" && (
          <div className="campaign-history-view">
            {/* Search and stats bar */}
            <div className="campaign-history-toolbar">
              <div className="search-input-wrap campaign-search-wrap">
                <IconSearch className="w-4 h-4 search-icon" />
                <input
                  type="search"
                  className="table-search-field"
                  placeholder="Search past campaigns by name, message, status, or date…"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  dir="auto"
                />
                {historySearch && (
                  <button
                    type="button"
                    className="search-clear-btn"
                    onClick={() => setHistorySearch("")}
                    title="Clear search"
                    aria-label="Clear search"
                  >
                    <IconX className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="toolbar-stats-group">
                {historySearch && (
                  <span className="search-match-count">
                    Found {filteredCampaigns.length} of {campaigns.length}
                  </span>
                )}
                <span className="chip-badge chip-neutral">
                  {campaigns.length} total campaigns saved
                </span>
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={() => setCurrentStep("pickup")}
                >
                  <IconTicket className="w-3.5 h-3.5 mr-1" />
                  <span>Aid Pickup Desk</span>
                </button>
              </div>
            </div>

            {/* Campaign Cards List */}
            {filteredCampaigns.length === 0 ? (
              <div className="empty-campaigns-view">
                <IconHistory className="w-10 h-10 text-slate-400 mb-2" />
                <h3>No outreach campaigns found</h3>
                <p>
                  {campaigns.length === 0
                    ? "When you launch a campaign in 'Compose Outreach', its message, SMS fallback setting, and delivery stats will be saved here automatically."
                    : `No campaigns match "${historySearch}". Try searching by another word or clear the search box.`}
                </p>
                {campaigns.length === 0 ? (
                  <button
                    type="button"
                    className="btn-primary mt-4"
                    onClick={() => setActiveTab("compose")}
                  >
                    <IconSend className="w-4 h-4 mr-1.5" />
                    <span>Create First Campaign</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary mt-3"
                    onClick={() => setHistorySearch("")}
                  >
                    <IconRefresh className="w-3.5 h-3.5 mr-1.5" />
                    <span>Clear Search</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="campaigns-grid-container">
                {filteredCampaigns.map((c) => {
                  const dateStr = new Date(c.createdAt).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  const total = c.totalRecipients || 0;
                  const delivered = c.stats?.delivered || 0;
                  const deliveredPercent = total > 0 ? Math.round((delivered / total) * 100) : 0;
                  const smsSent = c.stats?.smsSent || 0;
                  const undelivered = c.stats?.undelivered || 0;
                  const taken = c.stats?.taken || 0;
                  const people = c.stats?.people || c.totalPeople || total;

                  return (
                    <div key={c.id} className="campaign-record-card">
                      {/* Top Row: Meta + Badges */}
                      <div className="campaign-card-header">
                        <div>
                          <h3 className="campaign-card-title">{c.name}</h3>
                          <span className="campaign-card-date">{dateStr}</span>
                        </div>

                        <div className="campaign-card-badges">
                          {c.status === "running" ? (
                            <span className="chip-badge chip-amber">
                              <span className="live-dot-pulse" />
                              Running Now
                            </span>
                          ) : c.status === "interrupted" ? (
                            <span className="chip-badge chip-amber">Paused · {c.remainingCount || 0} left</span>
                          ) : c.status === "stopped" ? (
                            <span className="chip-badge chip-danger">
                              Stopped{c.resumable ? ` · ${c.remainingCount} left` : ""}
                            </span>
                          ) : (
                            <span className="chip-badge chip-success">Completed</span>
                          )}

                          {c.enableSms ? (
                            <span className="chip-badge chip-teal">SMS Fallback ON</span>
                          ) : (
                            <span className="chip-badge chip-neutral">WhatsApp Only</span>
                          )}
                          {c.aidCode && (
                            <span className="chip-badge chip-warning">
                              <IconKey className="w-3 h-3 mr-1" />
                              {c.aidCode}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Stats Metric Strip */}
                      <div className="campaign-stats-strip">
                        <div className="strip-metric-item">
                          <span className="strip-metric-label">Recipients</span>
                          <strong className="strip-metric-value">{total}</strong>
                        </div>
                        <div className="strip-metric-item">
                          <span className="strip-metric-label">WhatsApp Delivered</span>
                          <strong className="strip-metric-value text-emerald-700">
                            {delivered} <span className="text-xs font-normal">({deliveredPercent}%)</span>
                          </strong>
                        </div>
                        <div className="strip-metric-item">
                          <span className="strip-metric-label">SMS Sent</span>
                          <strong className="strip-metric-value text-teal-700">{smsSent}</strong>
                        </div>
                        <div className="strip-metric-item">
                          <span className="strip-metric-label">Undelivered</span>
                          <strong className="strip-metric-value text-rose-700">{undelivered}</strong>
                        </div>
                        <div className="strip-metric-item">
                          <span className="strip-metric-label">Aid Collected</span>
                          <strong className="strip-metric-value text-emerald-700">
                            {taken}
                            <span className="text-xs font-normal"> / {people}</span>
                          </strong>
                        </div>
                      </div>

                      {/* Message Content Snippet */}
                      {c.message && (
                        <div className="campaign-message-snippet" dir="auto">
                          <p>{c.message}</p>
                        </div>
                      )}

                      {/* Card Footer Actions */}
                      <div className="campaign-card-actions">
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => fetchCampaignDetails(c.id)}
                        >
                          <IconTicket className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                          <span>Collect & Print</span>
                        </button>

                        {c.resumable && (
                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            onClick={() => {
                              if (waState !== "open") {
                                setCurrentStep("auth");
                                showToast("Link WhatsApp, then this campaign will continue from the remaining people.", "info");
                                return;
                              }
                              resumeCampaign(c.id);
                              setActiveTab("compose");
                            }}
                            disabled={sendingBusy}
                            title="Continue from the last unsent recipient"
                          >
                            <IconSend className="w-3.5 h-3.5 mr-1" />
                            <span>Resume ({c.remainingCount})</span>
                          </button>
                        )}

                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => handleReuseCampaign(c)}
                          title="Reuse this message and settings in composer"
                        >
                          <IconRefresh className="w-3.5 h-3.5 mr-1" />
                          <span>Reuse Message</span>
                        </button>

                        <button
                          type="button"
                          className="btn-ghost-danger btn-sm"
                          onClick={() => {
                            if (window.confirm(`Delete campaign "${c.name}" from history?`)) {
                              deleteCampaign(c.id);
                            }
                          }}
                          title="Delete from history"
                        >
                          <IconTrash className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* =================================================================== */}
      {/* COMPOSE RECIPIENTS SEARCH & PREVIEW MODAL                           */}
      {/* =================================================================== */}
      {showComposeRecipients && (
        <div className="modal-backdrop-clean" onClick={() => setShowComposeRecipients(false)}>
          <div
            className="modal-content-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header-clean">
              <div>
                <h2 className="modal-title">Campaign Recipients</h2>
                <span className="modal-subtitle">
                  {people.length} beneficiaries currently selected for this campaign
                  {hasNames ? ` · ${peopleWithNames} with names` : " · names off"}
                  {hasCodes ? ` · ${peopleWithCodes} with pickup codes` : " · pickup codes off"}
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowComposeRecipients(false)}
                aria-label="Close"
              >
                <IconX className="w-4 h-4" />
              </button>
            </div>

            {/* Search Toolbar */}
            <div className="modal-toolbar">
              <div className="search-input-wrap flex-1">
                <IconSearch className="w-4 h-4 search-icon" />
                <input
                  type="search"
                  className="table-search-field"
                  placeholder="Search beneficiaries by name or phone number…"
                  value={composeSearch}
                  onChange={(e) => setComposeSearch(e.target.value)}
                  dir="auto"
                  autoFocus
                />
                {composeSearch && (
                  <button
                    type="button"
                    className="search-clear-btn"
                    onClick={() => setComposeSearch("")}
                    title="Clear search"
                  >
                    <IconX className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <span className="modal-count-tag">
                {filteredComposeRecipients.length} / {people.length}
              </span>
            </div>

            {/* Recipient Table */}
            <div className="modal-table-scroll">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th style={{ width: "40px" }}></th>
                    <th>Beneficiary Name</th>
                    <th>Phone Number</th>
                    {hasCodes && <th>Aid Code</th>}
                    <th>Family Members</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredComposeRecipients.length === 0 ? (
                    <tr>
                      <td colSpan={hasCodes ? 5 : 4} className="empty-table-cell">
                        No beneficiaries match "{composeSearch}".
                      </td>
                    </tr>
                  ) : (
                    filteredComposeRecipients.map((p, idx) => {
                      const avatarBg = getAvatarColor(p.name || p.phone);
                      const initials = personInitials(p.name, p.phone);
                      const names = personNames(p);

                      return (
                        <tr key={`${p.phone}-${idx}`} className="table-row">
                          <td>
                            <div
                              className="table-avatar"
                              style={{ backgroundColor: avatarBg }}
                            >
                              {initials}
                            </div>
                          </td>
                          <td>
                            <strong className="beneficiary-name">
                              {hasNames ? p.name || "Beneficiary" : "—"}
                            </strong>
                          </td>
                          <td>
                            <code className="phone-mono-tag">{p.phone}</code>
                          </td>
                          {hasCodes && (
                            <td>
                              {p.code ? (
                                <code className="aid-code-tag">{p.code}</code>
                              ) : (
                                <span className="text-slate-400 text-xs">—</span>
                              )}
                            </td>
                          )}
                          <td>
                            {names.length > 1 ? (
                              <span className="family-share-badge">
                                {names.length} family members
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="modal-footer-clean">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowComposeRecipients(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* CAMPAIGN RECIPIENTS BREAKDOWN MODAL                                 */}
      {/* =================================================================== */}
      {activeCampaignDetails && (
        <div className="modal-backdrop-clean" onClick={clearCampaignDetails}>
          <div
            className="modal-content-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header-clean">
              <div>
                <h2 className="modal-title">{activeCampaignDetails.name}</h2>
                <span className="modal-subtitle">
                  {new Date(activeCampaignDetails.createdAt).toLocaleString()} ·{" "}
                  {activeCampaignDetails.totalRecipients} recipients ·{" "}
                  {activeCampaignDetails.enableSms ? "SMS Fallback Active" : "WhatsApp Only"}
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={clearCampaignDetails}
                aria-label="Close"
              >
                <IconX className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Stats Bar */}
            <div className="modal-stats-bar">
              <div className="stat-pill">
                <span>Total:</span>
                <strong>{activeCampaignDetails.totalRecipients || 0}</strong>
              </div>
              <div className="stat-pill stat-emerald">
                <span>Delivered:</span>
                <strong>{activeCampaignDetails.stats?.delivered || 0}</strong>
              </div>
              <div className="stat-pill stat-teal">
                <span>SMS Sent:</span>
                <strong>{activeCampaignDetails.stats?.smsSent || 0}</strong>
              </div>
              <div className="stat-pill stat-rose">
                <span>Undelivered:</span>
                <strong>{activeCampaignDetails.stats?.undelivered || 0}</strong>
              </div>
              <div className="stat-pill stat-emerald">
                <span>Collected:</span>
                <strong>
                  {activeCampaignDetails.stats?.taken || 0}
                  {activeCampaignDetails.stats?.people
                    ? ` / ${activeCampaignDetails.stats.people}`
                    : ""}
                </strong>
              </div>
            </div>

            {/* Modal Search Toolbar */}
            <div className="modal-toolbar">
              <div className="search-input-wrap flex-1">
                <IconSearch className="w-4 h-4 search-icon" />
                <input
                  type="search"
                  className="table-search-field"
                  placeholder="Search by beneficiary name, phone number, channel, or status…"
                  value={modalSearch}
                  onChange={(e) => setModalSearch(e.target.value)}
                  dir="auto"
                  autoFocus
                />
                {modalSearch && (
                  <button
                    type="button"
                    className="search-clear-btn"
                    onClick={() => setModalSearch("")}
                    title="Clear filter"
                    aria-label="Clear filter"
                  >
                    <IconX className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <span className="modal-count-tag">
                {filteredModalRecipients.length} / {expandedModalRecipients.length} people
              </span>
            </div>

            {/* Modal Recipient Table */}
            <div className="modal-table-scroll">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Beneficiary</th>
                    <th>Phone</th>
                    <th>Aid Code</th>
                    <th>Channel</th>
                    <th>Delivery Status</th>
                    <th>Collected</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredModalRecipients.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="empty-table-cell">
                        No recipients match "{modalSearch}".
                      </td>
                    </tr>
                  ) : (
                    filteredModalRecipients.map((r, idx) => (
                      <tr key={`${r.phone}-${r.personName || r.displayName}-${idx}`} className="table-row">
                        <td>
                          <strong className="beneficiary-name" dir="auto">
                            {r.displayName || r.name || "Beneficiary"}
                          </strong>
                          {r.familySize > 1 ? (
                            <div>
                              <span className="family-share-badge">
                                Shares phone · {r.familyNames.filter((n) => !namesEqual(n, r.personName)).join(" · ") || "family"}
                              </span>
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <code className="phone-mono-tag">{r.phone}</code>
                        </td>
                        <td>
                          {r.code ? (
                            <code className="aid-code-tag">{r.code}</code>
                          ) : (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                        </td>
                        <td>
                          {r.channel === "sms" ? (
                            <span className="chip-badge chip-teal">Cellular SMS</span>
                          ) : r.channel === "whatsapp" ? (
                            <span className="chip-badge chip-emerald">WhatsApp</span>
                          ) : (
                            <span className="chip-badge chip-neutral">-</span>
                          )}
                        </td>
                        <td>
                          <span
                            className={`chip-badge ${
                              r.state === "delivered" || r.state === "sms-sent"
                                ? "chip-success"
                                : r.state === "waiting" || r.state === "sending"
                                ? "chip-amber"
                                : r.state === "failed"
                                ? "chip-danger"
                                : "chip-neutral"
                            }`}
                          >
                            {r.state === "delivered" ? (
                              <>
                                <IconCheck className="w-3 h-3 mr-1" />
                                Delivered ✓✓
                              </>
                            ) : (
                              r.state
                            )}
                          </span>
                        </td>
                        <td>
                          {r.takenAt ? (
                            <span className="chip-badge chip-success" title={r.takenAidId || ""}>
                              <IconCheck className="w-3 h-3 mr-1" />
                              {r.takenAidId || "Taken"}
                            </span>
                          ) : (
                            <span className="chip-badge chip-warning">Not yet</span>
                          )}
                        </td>
                        <td>
                          <div className="pickup-row-actions">
                            {r.takenAt ? (
                              <button
                                type="button"
                                className="btn-secondary btn-xs"
                                disabled={pickupBusy}
                                onClick={() => reprintPickup(activeCampaignDetails.id, r.phone, r.personName)}
                                title="Reprint receipt"
                              >
                                <IconPrinter className="w-3 h-3 mr-1" />
                                Reprint
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn-primary btn-xs"
                                disabled={pickupBusy}
                                onClick={() => markPickup(activeCampaignDetails.id, r.phone, r.personName)}
                                title="Mark collected and print receipt"
                              >
                                <IconTicket className="w-3 h-3 mr-1" />
                                Accept
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="modal-footer-clean">
              <button
                type="button"
                className="btn-secondary"
                onClick={clearCampaignDetails}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
