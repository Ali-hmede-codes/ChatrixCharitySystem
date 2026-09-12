import React, { useEffect, useMemo, useState } from "react";
import { useApp } from "../../context/AppContext.jsx";
import { personInitials, namesEqual } from "../../services/names.js";
import { getAvatarColor } from "../../constants/colors.js";
import { formatReceiptTime } from "../../services/receipt.js";
import {
  campaignDayKey,
  dayKeyToInputValue,
  formatCampaignDay,
  inputValueToDayKey,
} from "../../services/excel.js";
import {
  IconSearch,
  IconTicket,
  IconPrinter,
  IconCheck,
  IconX,
  IconUsers,
  IconSpreadsheet,
  IconAlertCircle,
} from "../common/Icons.jsx";
import { Skeleton } from "../common/Skeleton.jsx";

function PickupListSkeleton({ rows = 6 }) {
  return (
    <div className="pickup-skeleton-list" aria-label="Loading list">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="pickup-result-row is-skeleton" key={i}>
          <Skeleton className="skeleton-circle" width="38px" height="38px" />
          <div className="pickup-result-copy">
            <Skeleton className="skeleton-line" width="55%" height="13px" />
            <Skeleton className="skeleton-line" width="75%" height="10px" />
          </div>
          <Skeleton width="64px" height="20px" rounded="999px" />
        </div>
      ))}
    </div>
  );
}

export function PickupScreen() {
  const {
    pickupResults,
    searchPickup,
    exportCollected,
    markPickup,
    reprintPickup,
    undoPickup,
    pickupBusy,
    pickupLoading,
    printerSettings,
    campaigns = [],
    socketConnected,
    inventory,
  } = useApp();

  const todayKey = campaignDayKey(Date.now());
  const invCount = Number(inventory?.count) || 0;
  const [query, setQuery] = useState("");
  const [campaignDay, setCampaignDay] = useState("all");
  const [campaignId, setCampaignId] = useState("");
  const [status, setStatus] = useState("pending");
  const [selected, setSelected] = useState(null);

  // Export chooser: opens as a centered modal on desktop and a bottom sheet
  // on mobile. It has its own scope (date + campaign) and a status choice
  // (collected / not collected / both) so the export is self-contained.
  const [exportOpen, setExportOpen] = useState(false);
  const [exportStatus, setExportStatus] = useState("taken");
  const [exportDay, setExportDay] = useState("all");
  const [exportCampaignId, setExportCampaignId] = useState("");

  // On mobile the confirm card is a bottom sheet that should only open when
  // the user taps a name — so we skip the "auto-select first row" behaviour on
  // small screens. On desktop the right pane always shows a person, so we
  // auto-select the first row there.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1025px)").matches
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1025px)");
    const handler = (e) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const searchPayload = useMemo(
    () => ({
      query,
      campaignDay,
      campaignId,
      status,
      limit: status === "taken" ? 2000 : 80,
    }),
    [query, campaignDay, campaignId, status]
  );

  useEffect(() => {
    if (!socketConnected || pickupBusy) return;
    searchPickup(searchPayload);
  }, [searchPayload, socketConnected, pickupBusy]);

  const items = useMemo(() => {
    let list = pickupResults.items || [];
    if (status === "pending") list = list.filter((item) => !item.takenAt);
    if (status === "taken") list = list.filter((item) => item.takenAt);
    return list;
  }, [pickupResults.items, status]);

  useEffect(() => {
    setSelected((current) => {
      const all = pickupResults.items || [];
      if (current) {
        const fresh = all.find(
          (item) =>
            item.campaignId === current.campaignId &&
            item.phone === current.phone &&
            namesEqual(item.personName || item.name, current.personName || current.name)
        );
        if (fresh) return fresh;
        if (status === "taken" && current.takenAt) return current;
        if (status === "pending" && !current.takenAt) return current;
        return isDesktop ? items[0] || null : null;
      }
      return isDesktop ? items[0] || null : null;
    });
  }, [pickupResults.items, items, status, isDesktop]);

  const campaignDates = useMemo(() => {
    const map = new Map();
    for (const campaign of campaigns) {
      const day = campaignDayKey(campaign.createdAt);
      if (!day) continue;
      const cur = map.get(day) || { day, campaigns: 0, taken: 0, people: 0 };
      cur.campaigns += 1;
      cur.taken += Number(campaign.stats?.taken) || 0;
      cur.people += Number(campaign.stats?.people) || Number(campaign.totalRecipients) || 0;
      map.set(day, cur);
    }
    return [...map.values()].sort((a, b) => b.day.localeCompare(a.day));
  }, [campaigns]);

  const campaignsOnDay = useMemo(() => {
    if (campaignDay === "all") return campaigns;
    return campaigns.filter((campaign) => campaignDayKey(campaign.createdAt) === campaignDay);
  }, [campaigns, campaignDay]);

  const totalTaken = useMemo(
    () => campaigns.reduce((sum, campaign) => sum + (Number(campaign.stats?.taken) || 0), 0),
    [campaigns]
  );
  const filteredTaken = useMemo(
    () => campaignsOnDay.reduce((sum, campaign) => sum + (Number(campaign.stats?.taken) || 0), 0),
    [campaignsOnDay]
  );

  const exportCampaignsOnDay = useMemo(() => {
    if (exportDay === "all") return campaigns;
    return campaigns.filter((campaign) => campaignDayKey(campaign.createdAt) === exportDay);
  }, [campaigns, exportDay]);

  const exportScope = useMemo(() => {
    const pool = exportCampaignId
      ? exportCampaignsOnDay.filter((c) => c.id === exportCampaignId)
      : exportCampaignsOnDay;
    const taken = pool.reduce((s, c) => s + (Number(c.stats?.taken) || 0), 0);
    const people = pool.reduce(
      (s, c) => s + (Number(c.stats?.people) || Number(c.totalRecipients) || 0),
      0
    );
    const pending = Math.max(0, people - taken);
    return { taken, pending, total: taken + pending, hasCampaigns: pool.length > 0 };
  }, [exportCampaignsOnDay, exportCampaignId]);

  useEffect(() => {
    if (!campaignId) return;
    if (!campaignsOnDay.some((campaign) => campaign.id === campaignId)) {
      setCampaignId("");
    }
  }, [campaignsOnDay, campaignId]);

  // Keep the export campaign select valid when its date changes.
  useEffect(() => {
    if (!exportOpen || !exportCampaignId) return;
    if (!exportCampaignsOnDay.some((c) => c.id === exportCampaignId)) {
      setExportCampaignId("");
    }
  }, [exportCampaignsOnDay, exportCampaignId, exportOpen]);

  function handleAccept() {
    if (!selected || pickupBusy) return;
    if (selected.takenAt) {
      const ok = window.confirm(
        `${selected.name || "This person"} already collected aid${selected.takenAidId ? ` (${selected.takenAidId})` : ""}. Print the receipt again?`
      );
      if (ok) reprintPickup(selected.campaignId, selected.phone, selected.personName || selected.name);
      return;
    }
    // Block new collections when the inventory is empty — the backend also
    // blocks, but disabling here gives instant feedback before the round-trip.
    if (invCount <= 0) {
      return;
    }
    markPickup(selected.campaignId, selected.phone, selected.personName || selected.name);
  }

  function handleReprint() {
    if (!selected || pickupBusy) return;
    reprintPickup(selected.campaignId, selected.phone, selected.personName || selected.name);
  }

  function handleUndo() {
    if (!selected || pickupBusy || !selected.takenAt) return;
    const ok = window.confirm(
      `Mark ${selected.name || "this person"} as not collected? The aid ID ${selected.takenAidId || ""} stays reserved for them.`
    );
    if (!ok) return;
    undoPickup(selected.campaignId, selected.phone, selected.personName || selected.name);
  }

  function openExport() {
    // Seed the chooser scope from the current screen filters so it reflects
    // what the user is looking at, then let them adjust inside the dialog.
    setExportDay(campaignDay);
    setExportCampaignId(campaignId);
    setExportStatus("taken");
    setExportOpen(true);
  }

  function runExport() {
    exportCollected({
      query: "",
      campaignDay: exportDay,
      campaignId: exportCampaignId,
      status: exportStatus,
    });
    setExportOpen(false);
  }

  function emptyCopy() {
    if (campaigns.length === 0) {
      return "No campaigns yet. Send an outreach campaign first, then people can collect aid here.";
    }
    if (query) return `No people match “${query}”.`;
    if (status === "taken") {
      return campaignDay === "all"
        ? "No collected people yet. Accept someone at the desk, then they will appear here."
        : `No collected people for ${formatCampaignDay(campaignDay)}. Pick another campaign date, or All dates.`;
    }
    return campaignDay === "all"
      ? "Nobody is waiting to collect."
      : `Nobody is waiting from campaigns dated ${formatCampaignDay(campaignDay)}.`;
  }

  return (
    <div className="page-view pickup-page">
      <div
        className={`pickup-sheet-backdrop ${selected ? "is-open" : ""}`}
        onClick={() => setSelected(null)}
        aria-hidden="true"
      />
      <div className="page-header">
        <div>
          <h1 className="page-title">Aid Pickup Desk</h1>
          <p className="page-subtitle">
            Filter by campaign date, then Accept & Print. Collected people stay listed for that date and can be exported to Excel.
          </p>
        </div>
        <div className="header-actions pickup-header-stats">
          <span className="chip-badge chip-success">
            {campaignDay === "all" ? totalTaken : filteredTaken} collected
            {campaignDay !== "all" ? ` · ${formatCampaignDay(campaignDay)}` : ""}
          </span>
          <span className="chip-badge chip-warning">{printerSettings.paperWidthMm} mm paper</span>
          <button
            type="button"
            className="btn-primary"
            onClick={openExport}
            disabled={!socketConnected || campaigns.length === 0}
          >
            <IconSpreadsheet className="w-4 h-4 mr-1.5" />
            <span>Export</span>
          </button>
        </div>
      </div>

      <div className="page-content-scroll">
        <div className="pickup-desk-layout">
          <section className="pickup-search-pane">
            <div className="pickup-search-hero">
              <div className="search-input-wrap pickup-search-field">
                <IconSearch className="w-5 h-5 search-icon" />
                <input
                  type="search"
                  className="table-search-field pickup-search-input"
                  placeholder="Search name, phone, pickup code, or aid ID…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAccept();
                    }
                  }}
                  dir="auto"
                  autoFocus
                />
                {query && (
                  <button type="button" className="search-clear-btn" onClick={() => setQuery("")} aria-label="Clear search">
                    <IconX className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="pickup-filter-row">
                <div className="pickup-filter-group">
                  <button
                    type="button"
                    className={`pickup-filter-btn ${status === "pending" ? "active" : ""}`}
                    onClick={() => setStatus("pending")}
                  >
                    Not collected
                  </button>
                  <button
                    type="button"
                    className={`pickup-filter-btn ${status === "taken" ? "active" : ""}`}
                    onClick={() => setStatus("taken")}
                  >
                    Collected
                  </button>
                  <button
                    type="button"
                    className={`pickup-filter-btn ${status === "all" ? "active" : ""}`}
                    onClick={() => setStatus("all")}
                  >
                    All people
                  </button>
                </div>
              </div>

              <div className="pickup-date-row">
                <span className="pickup-date-label">Campaign date</span>
                <div className="pickup-filter-group pickup-date-chips">
                  <button
                    type="button"
                    className={`pickup-filter-btn ${campaignDay === "all" ? "active" : ""}`}
                    onClick={() => setCampaignDay("all")}
                  >
                    All dates
                  </button>
                  <button
                    type="button"
                    className={`pickup-filter-btn ${campaignDay === todayKey ? "active" : ""}`}
                    onClick={() => setCampaignDay(todayKey)}
                  >
                    Today
                  </button>
                  {campaignDates.slice(0, 8).map((item) => (
                    <button
                      key={item.day}
                      type="button"
                      className={`pickup-filter-btn ${campaignDay === item.day ? "active" : ""}`}
                      onClick={() => setCampaignDay(item.day)}
                    >
                      {formatCampaignDay(item.day)}
                      {item.taken ? ` · ${item.taken}` : ""}
                    </button>
                  ))}
                </div>
                <label className="pickup-date-input-wrap">
                  <span className="sr-only">Pick campaign date</span>
                  <input
                    type="date"
                    className="form-input pickup-date-input"
                    value={dayKeyToInputValue(campaignDay === "all" ? todayKey : campaignDay)}
                    onChange={(e) => setCampaignDay(inputValueToDayKey(e.target.value) || "all")}
                  />
                </label>
              </div>

              {campaignsOnDay.length > 0 && (
                <div className="form-group pickup-campaign-select">
                  <label className="form-label" htmlFor="pickup-campaign-filter">
                    Campaign on this date
                  </label>
                  <select
                    id="pickup-campaign-filter"
                    className="form-select"
                    value={campaignId}
                    onChange={(e) => setCampaignId(e.target.value)}
                  >
                    <option value="">
                      All campaigns{campaignDay !== "all" ? ` · ${formatCampaignDay(campaignDay)}` : ""}
                    </option>
                    {campaignsOnDay.map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.name} · {campaign.stats?.taken || 0} collected
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="pickup-results-list">
              {pickupLoading && items.length === 0 ? (
                <PickupListSkeleton />
              ) : items.length === 0 ? (
                <div className="empty-table-view pickup-empty">
                  <IconUsers className="w-8 h-8 text-slate-400 mb-2" />
                  <p>{emptyCopy()}</p>
                </div>
              ) : (
                items.map((item) => {
                  const key = `${item.campaignId}:${item.phone}:${item.personName || item.name || ""}`;
                  const isActive =
                    selected &&
                    selected.campaignId === item.campaignId &&
                    selected.phone === item.phone &&
                    namesEqual(selected.personName || selected.name, item.personName || item.name);
                  const avatarBg = getAvatarColor(item.name || item.phone);
                  const familyOthers = (item.familyNames || item.names || []).filter(
                    (name) => !namesEqual(name, item.personName || item.name)
                  );
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`pickup-result-row ${isActive ? "active" : ""} ${item.takenAt ? "is-taken" : ""}`}
                      onClick={() => setSelected(item)}
                    >
                      <div className="table-avatar" style={{ backgroundColor: avatarBg }}>
                        {personInitials(item.name, item.phone)}
                      </div>
                      <div className="pickup-result-copy">
                        <strong className="beneficiary-name" dir="auto">
                          {item.name || "Beneficiary"}
                        </strong>
                        <span className="pickup-result-meta">
                          {item.code ? <code className="aid-code-tag">{item.code}</code> : null}
                          <span>{item.campaignName}</span>
                          <span>{formatCampaignDay(campaignDayKey(item.campaignDate))}</span>
                          {item.familySize > 1 ? (
                            <span className="family-share-badge">
                              {item.familyTaken || 0}/{item.familySize} collected
                            </span>
                          ) : null}
                        </span>
                        {familyOthers.length > 0 ? (
                          <span className="pickup-family-hint" dir="auto">
                            Shares phone with {familyOthers.join(" · ")}
                          </span>
                        ) : null}
                      </div>
                      {item.takenAt ? (
                        <span className="chip-badge chip-success">
                          <IconCheck className="w-3 h-3 mr-1" />
                          {item.takenAidId || "Taken"}
                        </span>
                      ) : (
                        <span className="chip-badge chip-warning">Waiting</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
            {pickupResults.total > items.length && (
              <p className="pickup-results-hint">
                Showing {items.length} of {pickupResults.total}. Type more of the name or code to narrow the list.
              </p>
            )}
          </section>

          <aside className={`pickup-confirm-pane ${selected ? "is-open" : ""}`}>
            {selected ? (
              <>
                <button
                  type="button"
                  className="pickup-sheet-close"
                  onClick={() => setSelected(null)}
                  aria-label="Close"
                >
                  <IconX className="w-5 h-5" />
                </button>
                <div className="pickup-confirm-card">
                  <div className="pickup-confirm-avatar" style={{ backgroundColor: getAvatarColor(selected.name || selected.phone) }}>
                    {personInitials(selected.name, selected.phone)}
                  </div>
                  <h2 className="pickup-confirm-name" dir="auto">{selected.name || "Beneficiary"}</h2>
                  <code className="phone-mono-tag">{selected.phone}</code>
                  <dl className="pickup-confirm-facts">
                    <div>
                      <dt>Campaign</dt>
                      <dd dir="auto">{selected.campaignName}</dd>
                    </div>
                    <div>
                      <dt>Campaign date</dt>
                      <dd>{formatCampaignDay(campaignDayKey(selected.campaignDate))}</dd>
                    </div>
                    {selected.code ? (
                      <div>
                        <dt>Pickup code</dt>
                        <dd><code className="aid-code-tag">{selected.code}</code></dd>
                      </div>
                    ) : null}
                    {selected.takenAidId ? (
                      <div>
                        <dt>Aid ID</dt>
                        <dd><strong className="pickup-aid-id">{selected.takenAidId}</strong></dd>
                      </div>
                    ) : (
                      <div>
                        <dt>Aid ID</dt>
                        <dd>Printed on accept · shared with all campaigns sent that day</dd>
                      </div>
                    )}
                    {selected.takenAt ? (
                      <div>
                        <dt>Collected</dt>
                        <dd>{formatReceiptTime(selected.takenAt)}</dd>
                      </div>
                    ) : null}
                    {selected.familySize > 1 ? (
                      <div>
                        <dt>Same phone</dt>
                        <dd dir="auto">
                          {(selected.familyNames || selected.names || [])
                            .filter((name) => !namesEqual(name, selected.personName || selected.name))
                            .join(" · ") || "Family share"}
                          {` · ${selected.familyTaken || 0}/${selected.familySize} collected`}
                        </dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Aid in stock</dt>
                      <dd>
                        <strong className={invCount <= 0 ? "text-red-600" : invCount < 20 ? "text-amber-600" : "text-emerald-700"}>
                          {invCount} {inventory?.label || "aid"}
                        </strong>
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="pickup-confirm-actions">
                  {!selected.takenAt && invCount <= 0 ? (
                    <div className="pickup-inventory-blocked">
                      <IconAlertCircle className="w-4 h-4" />
                      <span>Out of stock. Restock in Inventory before collecting.</span>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="btn-primary pickup-accept-btn"
                    disabled={pickupBusy || (!selected.takenAt && invCount <= 0)}
                    onClick={handleAccept}
                  >
                    <IconTicket className="w-4 h-4 mr-1.5" />
                    <span>{selected.takenAt ? "Already collected — Reprint" : "Accept & Print"}</span>
                  </button>
                  {selected.takenAt && (
                    <>
                      <button type="button" className="btn-secondary" disabled={pickupBusy} onClick={handleReprint}>
                        <IconPrinter className="w-4 h-4 mr-1.5" />
                        <span>Reprint receipt</span>
                      </button>
                      <button type="button" className="btn-text-danger" disabled={pickupBusy} onClick={handleUndo}>
                        Undo collected
                      </button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="pickup-confirm-empty">
                <IconTicket className="w-8 h-8 text-slate-400 mb-2" />
                <p>Search a beneficiary, then Accept & Print. Use campaign date to find collected people, then export them to Excel.</p>
              </div>
            )}
          </aside>
        </div>
      </div>

      <div
        className={`export-sheet-backdrop ${exportOpen ? "is-open" : ""}`}
        onClick={() => setExportOpen(false)}
        aria-hidden="true"
      />
      <aside
        className={`export-sheet ${exportOpen ? "is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Export pickup list"
      >
        <button
          type="button"
          className="pickup-sheet-close"
          onClick={() => setExportOpen(false)}
          aria-label="Close export"
        >
          <IconX className="w-5 h-5" />
        </button>
        <div className="export-sheet-head">
          <h2>Export pickup list</h2>
          <p>Choose what to include and the campaign scope, then export to Excel.</p>
        </div>

        <div className="export-section">
          <span className="export-section-label">What to export</span>
          <div className="export-radio-list">
            <label className={`export-radio ${exportStatus === "taken" ? "active" : ""}`}>
              <input
                type="radio"
                name="export-status"
                value="taken"
                checked={exportStatus === "taken"}
                onChange={() => setExportStatus("taken")}
              />
              <span className="export-radio-copy">
                <strong>Only collected</strong>
                <small>People who already collected aid.</small>
              </span>
            </label>
            <label className={`export-radio ${exportStatus === "pending" ? "active" : ""}`}>
              <input
                type="radio"
                name="export-status"
                value="pending"
                checked={exportStatus === "pending"}
                onChange={() => setExportStatus("pending")}
              />
              <span className="export-radio-copy">
                <strong>Only not collected</strong>
                <small>People who have not collected yet.</small>
              </span>
            </label>
            <label className={`export-radio ${exportStatus === "all" ? "active" : ""}`}>
              <input
                type="radio"
                name="export-status"
                value="all"
                checked={exportStatus === "all"}
                onChange={() => setExportStatus("all")}
              />
              <span className="export-radio-copy">
                <strong>Collected and not collected</strong>
                <small>Both in one sheet — not collected rows are highlighted red.</small>
              </span>
            </label>
          </div>
        </div>

        <div className="export-section">
          <span className="export-section-label">Campaign date</span>
          <div className="pickup-filter-group pickup-date-chips export-date-chips">
            <button
              type="button"
              className={`pickup-filter-btn ${exportDay === "all" ? "active" : ""}`}
              onClick={() => setExportDay("all")}
            >
              All dates
            </button>
            <button
              type="button"
              className={`pickup-filter-btn ${exportDay === todayKey ? "active" : ""}`}
              onClick={() => setExportDay(todayKey)}
            >
              Today
            </button>
            {campaignDates.slice(0, 8).map((item) => (
              <button
                key={item.day}
                type="button"
                className={`pickup-filter-btn ${exportDay === item.day ? "active" : ""}`}
                onClick={() => setExportDay(item.day)}
              >
                {formatCampaignDay(item.day)}
                {item.taken ? ` · ${item.taken}` : ""}
              </button>
            ))}
          </div>
          <label className="pickup-date-input-wrap">
            <span className="sr-only">Pick campaign date</span>
            <input
              type="date"
              className="form-input pickup-date-input"
              value={dayKeyToInputValue(exportDay === "all" ? todayKey : exportDay)}
              onChange={(e) => setExportDay(inputValueToDayKey(e.target.value) || "all")}
            />
          </label>
        </div>

        {exportCampaignsOnDay.length > 0 && (
          <div className="form-group pickup-campaign-select export-section">
            <label className="form-label" htmlFor="export-campaign-filter">
              Campaign on this date
            </label>
            <select
              id="export-campaign-filter"
              className="form-select"
              value={exportCampaignId}
              onChange={(e) => setExportCampaignId(e.target.value)}
            >
              <option value="">
                All campaigns{exportDay !== "all" ? ` · ${formatCampaignDay(exportDay)}` : ""}
              </option>
              {exportCampaignsOnDay.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name} · {campaign.stats?.taken || 0} collected
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="export-sheet-summary">
          <span className="chip-badge chip-success">{exportScope.taken} collected</span>
          <span className="chip-badge chip-warning">{exportScope.pending} not collected</span>
          <span className="chip-badge">{exportScope.total} total</span>
        </div>

        <div className="export-sheet-actions">
          <button type="button" className="btn-secondary" onClick={() => setExportOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={runExport}
            disabled={!socketConnected || exportScope.total === 0}
          >
            <IconSpreadsheet className="w-4 h-4 mr-1.5" />
            <span>Export Excel</span>
          </button>
        </div>
      </aside>
    </div>
  );
}
