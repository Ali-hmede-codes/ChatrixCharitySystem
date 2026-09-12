import React, { useMemo, useState } from "react";
import { useApp } from "../../context/AppContext.jsx";
import { matchesCampaign, matchesRecipient } from "../../services/search.js";
import { campaignDayKey } from "../../services/excel.js";
import { personNames } from "../../services/names.js";
import {
  IconCheck,
  IconEdit,
  IconHistory,
  IconMerge,
  IconSearch,
  IconSend,
  IconTrash,
  IconUsers,
  IconX,
} from "../common/Icons.jsx";

function statusLabel(campaign) {
  if (campaign.status === "running") return "Running";
  if (campaign.status === "interrupted") return `Paused · ${campaign.remainingCount || 0} left`;
  if (campaign.status === "stopped") return campaign.resumable ? `Stopped · ${campaign.remainingCount} left` : "Stopped";
  return "Completed";
}

function statusChip(campaign) {
  if (campaign.status === "running") return "chip-amber";
  if (campaign.status === "interrupted") return "chip-amber";
  if (campaign.status === "stopped") return "chip-danger";
  return "chip-success";
}

export function CampaignsScreen() {
  const {
    campaigns,
    sendJob,
    smsSettings,
    deleteCampaigns,
    updateCampaign,
    removeCampaignRecipients,
    mergeCampaigns,
    fetchCampaignDetails,
    clearCampaignDetails,
    activeCampaignDetails,
    loadingCampaignDetails,
    setCurrentStep,
    showToast,
  } = useApp();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState("");
  const [editMessage, setEditMessage] = useState("");
  const [editSms, setEditSms] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [peopleSearch, setPeopleSearch] = useState("");
  const [selectedPhones, setSelectedPhones] = useState(() => new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeName, setMergeName] = useState("");

  const liveId = sendJob.running ? sendJob.campaignId : null;
  const smsReady = Boolean(smsSettings.ready);

  const todayKey = campaignDayKey(Date.now());

  const filtered = useMemo(() => {
    return campaigns.filter((c) => {
      if (statusFilter === "today" && campaignDayKey(c.createdAt) !== todayKey) return false;
      if (statusFilter === "live" && c.status !== "running" && !c.resumable) return false;
      if (statusFilter === "done" && (c.status === "running" || c.resumable)) return false;
      return matchesCampaign(c, search);
    });
  }, [campaigns, search, statusFilter, todayKey]);

  const todayCampaigns = useMemo(
    () => campaigns.filter((c) => campaignDayKey(c.createdAt) === todayKey && c.id !== liveId),
    [campaigns, todayKey, liveId]
  );

  const selectedVisible = filtered.filter((c) => selectedIds.has(c.id));

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    const allOn = filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOn) filtered.forEach((c) => next.delete(c.id));
      else filtered.forEach((c) => next.add(c.id));
      return next;
    });
  }

  function openEdit(campaign) {
    setEditing(campaign);
    setEditName(campaign.name || "");
    setEditMessage(campaign.message || "");
    setEditSms(Boolean(campaign.enableSms) && smsReady);
  }

  function saveEdit() {
    if (!editing) return;
    const name = editName.trim();
    if (!name) {
      showToast("Enter a campaign name.", "warning");
      return;
    }
    updateCampaign(editing.id, {
      name,
      message: editMessage,
      enableSms: Boolean(editSms && smsReady),
    });
    setEditing(null);
  }

  function confirmDelete(ids) {
    const list = ids.filter((id) => id && id !== liveId);
    const skipped = ids.includes(liveId);
    if (!list.length) {
      showToast(skipped ? "Stop the live send first, then delete that campaign." : "Choose a campaign to delete.", "warning");
      return;
    }
    const title = list.length === 1
      ? `Delete campaign "${campaigns.find((c) => c.id === list[0])?.name || "this campaign"}"?`
      : `Delete ${list.length} campaigns?`;
    const recallMin = Number(smsSettings.recallWindowMinutes) || 0;
    const recallLine =
      recallMin > 0
        ? `\n\nMessages sent in the last ${recallMin} minutes will be unsent (deleted for everyone) from recipients' WhatsApp chats.`
        : `\n\nRecall is turned off — sent messages will stay in recipients' chats.`;
    if (!window.confirm(`${title}\n\nThis removes the campaign and its people from Chatrix. This cannot be undone.${recallLine}`)) {
      return;
    }
    deleteCampaigns(list);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      list.forEach((id) => next.delete(id));
      return next;
    });
    if (editing && list.includes(editing.id)) setEditing(null);
    if (activeCampaignDetails && list.includes(activeCampaignDetails.id)) setPeopleOpen(false);
    if (skipped) showToast("The running campaign was left in the list.", "warning");
  }

  function openPeople(campaign) {
    setPeopleSearch("");
    setSelectedPhones(new Set());
    setPeopleOpen(true);
    clearCampaignDetails();
    fetchCampaignDetails(campaign.id);
  }

  function closePeople() {
    setPeopleOpen(false);
    setSelectedPhones(new Set());
    clearCampaignDetails();
  }

  const peopleRows = useMemo(() => {
    const rec = activeCampaignDetails?.recipients || [];
    return rec.map((r) => ({
      ...r,
      displayName: r.name || personNames(r).join(" + ") || "Beneficiary",
    }));
  }, [activeCampaignDetails]);

  const filteredPeople = useMemo(() => {
    if (!peopleSearch.trim()) return peopleRows;
    return peopleRows.filter((r) => matchesRecipient({ ...r, name: r.displayName }, peopleSearch));
  }, [peopleRows, peopleSearch]);

  function togglePhone(phone) {
    setSelectedPhones((prev) => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone);
      else next.add(phone);
      return next;
    });
  }

  function selectToday() {
    setStatusFilter("today");
    setSelectedIds(new Set(todayCampaigns.map((c) => c.id)));
    if (todayCampaigns.length < 2) {
      showToast("Need at least two campaigns from today to merge.", "warning");
    }
  }

  function openMerge() {
    const list = selectedVisible.filter((c) => c.id !== liveId);
    if (list.length < 2) {
      showToast("Select at least two campaigns to merge into one.", "warning");
      return;
    }
    const first = [...list].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0];
    const dateStr = new Date(first?.createdAt || Date.now()).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    setMergeName(`حملة مدمجة - ${dateStr}`);
    setMergeOpen(true);
  }

  function confirmMerge() {
    const ids = selectedVisible.filter((c) => c.id !== liveId).map((c) => c.id);
    if (ids.length < 2) {
      showToast("Select at least two campaigns to merge.", "warning");
      return;
    }
    mergeCampaigns(ids, mergeName.trim());
    setMergeOpen(false);
    setSelectedIds(new Set());
    if (editing && ids.includes(editing.id)) setEditing(null);
    if (activeCampaignDetails && ids.includes(activeCampaignDetails.id)) setPeopleOpen(false);
  }

  function removePeople(phones) {
    if (!activeCampaignDetails?.id || !phones.length) return;
    const sending = new Set(
      (activeCampaignDetails.recipients || [])
        .filter((r) => r.state === "sending")
        .map((r) => r.phone)
    );
    const removable = phones.filter((phone) => !(liveId === activeCampaignDetails.id && sending.has(phone)));
    if (!removable.length) {
      showToast("Those people are being sent to right now. Wait, then remove them.", "warning");
      return;
    }
    if (!window.confirm(`Remove ${removable.length} ${removable.length === 1 ? "person" : "people"} from "${activeCampaignDetails.name}"?`)) {
      return;
    }
    removeCampaignRecipients(activeCampaignDetails.id, removable);
    setSelectedPhones((prev) => {
      const next = new Set(prev);
      removable.forEach((phone) => next.delete(phone));
      return next;
    });
  }

  return (
    <div className="page-view campaigns-manage-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Campaigns</h1>
          <p className="page-subtitle">
            Send in small batches, then merge today&apos;s campaigns into one list for pickup search and leftover sends.
          </p>
        </div>
        <div className="header-actions">
          {todayCampaigns.length >= 2 && (
            <button type="button" className="btn-secondary" onClick={selectToday}>
              <IconMerge className="w-4 h-4 mr-1.5" />
              <span>Select today ({todayCampaigns.length})</span>
            </button>
          )}
          {selectedVisible.length >= 2 && (
            <button type="button" className="btn-primary" onClick={openMerge}>
              <IconMerge className="w-4 h-4 mr-1.5" />
              <span>Merge into one ({selectedVisible.length})</span>
            </button>
          )}
          {selectedVisible.length > 0 && (
            <button
              type="button"
              className="btn-danger"
              onClick={() => confirmDelete(selectedVisible.map((c) => c.id))}
            >
              <IconTrash className="w-4 h-4 mr-1.5" />
              <span>Delete selected ({selectedVisible.length})</span>
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={() => setCurrentStep("send")}>
            <IconSend className="w-4 h-4 mr-1.5" />
            <span>Compose outreach</span>
          </button>
        </div>
      </div>

      <div className="page-content-scroll">
        <div className="table-toolbar">
          <div className="search-input-wrap">
            <IconSearch className="w-4 h-4 search-icon" />
            <input
              type="search"
              className="table-search-field"
              placeholder="Search by campaign name, message, status, or date…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              dir="auto"
            />
            {search && (
              <button type="button" className="search-clear-btn" onClick={() => setSearch("")} aria-label="Clear search">
                <IconX className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="toolbar-stats-group">
            <div className="campaign-filter-pills">
              {[
                { id: "all", label: "All" },
                { id: "today", label: "Today" },
                { id: "live", label: "Open / paused" },
                { id: "done", label: "Finished" },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`filter-pill ${statusFilter === item.id ? "active" : ""}`}
                  onClick={() => setStatusFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <span className="chip-badge chip-neutral">
              {filtered.length} of {campaigns.length}
            </span>
            {filtered.length > 0 && (
              <button type="button" className="btn-text" onClick={toggleAllVisible}>
                {filtered.every((c) => selectedIds.has(c.id)) ? "Clear selection" : "Select all"}
              </button>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-campaigns-view">
            <IconHistory className="w-10 h-10 text-slate-400 mb-2" />
            <h3>{campaigns.length === 0 ? "No campaigns yet" : "No campaigns match"}</h3>
            <p>
              {campaigns.length === 0
                ? "Launch an outreach campaign first. It will appear here so you can edit or delete it."
                : "Try another search or filter."}
            </p>
            {campaigns.length === 0 && (
              <button type="button" className="btn-primary mt-4" onClick={() => setCurrentStep("send")}>
                <IconSend className="w-4 h-4 mr-1.5" />
                <span>Compose first campaign</span>
              </button>
            )}
          </div>
        ) : (
          <div className="campaigns-grid-container">
            {filtered.map((c) => {
              const dateStr = new Date(c.createdAt).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });
              const isLive = liveId === c.id;
              const checked = selectedIds.has(c.id);
              return (
                <div key={c.id} className={`campaign-record-card ${checked ? "is-selected" : ""}`}>
                  <div className="campaign-card-header">
                    <label className="campaign-select">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isLive}
                        onChange={() => toggleSelected(c.id)}
                      />
                      <div>
                        <h3 className="campaign-card-title">{c.name}</h3>
                        <span className="campaign-card-date">{dateStr}</span>
                      </div>
                    </label>
                    <div className="campaign-card-badges">
                      <span className={`chip-badge ${statusChip(c)}`}>{statusLabel(c)}</span>
                      {c.mergedFrom > 1 && (
                        <span className="chip-badge chip-emerald">Merged · {c.mergedFrom} batches</span>
                      )}
                      {c.enableSms ? (
                        <span className="chip-badge chip-teal">SMS on</span>
                      ) : (
                        <span className="chip-badge chip-neutral">WhatsApp only</span>
                      )}
                    </div>
                  </div>

                  <div className="campaign-stats-strip">
                    <div className="strip-metric-item">
                      <span className="strip-metric-label">People</span>
                      <strong className="strip-metric-value">{c.totalRecipients || 0}</strong>
                    </div>
                    <div className="strip-metric-item">
                      <span className="strip-metric-label">Delivered</span>
                      <strong className="strip-metric-value text-emerald-700">{c.stats?.delivered || 0}</strong>
                    </div>
                    <div className="strip-metric-item">
                      <span className="strip-metric-label">SMS</span>
                      <strong className="strip-metric-value text-teal-700">{c.stats?.smsSent || 0}</strong>
                    </div>
                    <div className="strip-metric-item">
                      <span className="strip-metric-label">Collected</span>
                      <strong className="strip-metric-value text-emerald-700">
                        {c.stats?.taken || 0}
                        <span className="text-xs font-normal"> / {c.stats?.people || c.totalPeople || c.totalRecipients || 0}</span>
                      </strong>
                    </div>
                  </div>

                  {c.message ? (
                    <div className="campaign-message-snippet" dir="auto">
                      <p>{c.message}</p>
                    </div>
                  ) : null}

                  <div className="campaign-card-actions">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => openEdit(c)}>
                      <IconEdit className="w-3.5 h-3.5 mr-1" />
                      <span>Edit</span>
                    </button>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => openPeople(c)}>
                      <IconUsers className="w-3.5 h-3.5 mr-1" />
                      <span>People</span>
                    </button>
                    <button
                      type="button"
                      className="btn-ghost-danger btn-sm"
                      disabled={isLive}
                      title={isLive ? "Stop the live send first" : "Delete campaign"}
                      onClick={() => confirmDelete([c.id])}
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

      {mergeOpen && (
        <div className="modal-backdrop-clean" onClick={() => setMergeOpen(false)}>
          <div className="modal-content-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header-clean">
              <div>
                <h2 className="modal-title">Merge campaigns into one</h2>
                <span className="modal-subtitle">
                  Combines the selected batches into one campaign so pickup search and leftover sends stay on a single list. Shared phone numbers are kept once.
                </span>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setMergeOpen(false)} aria-label="Close">
                <IconX className="w-4 h-4" />
              </button>
            </div>

            <div className="campaign-edit-form">
              <label className="form-label" htmlFor="merge-campaign-name">Name of the combined campaign</label>
              <input
                id="merge-campaign-name"
                className="form-input"
                value={mergeName}
                onChange={(e) => setMergeName(e.target.value)}
                dir="auto"
              />
              <p className="form-hint">
                {selectedVisible.length} campaigns · about{" "}
                {selectedVisible.reduce((sum, c) => sum + (Number(c.totalRecipients) || 0), 0)} numbers
                (duplicates will be combined). The original batches are removed after the merge.
              </p>
              <ul className="merge-source-list">
                {selectedVisible.map((c) => (
                  <li key={c.id}>
                    <strong>{c.name}</strong>
                    <span>
                      {c.totalRecipients || 0} people · {statusLabel(c)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="modal-footer-clean">
              <button type="button" className="btn-secondary" onClick={() => setMergeOpen(false)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={confirmMerge}>
                <IconMerge className="w-4 h-4 mr-1.5" />
                Merge into one campaign
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="modal-backdrop-clean" onClick={() => setEditing(null)}>
          <div className="modal-content-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header-clean">
              <div>
                <h2 className="modal-title">Edit campaign</h2>
                <span className="modal-subtitle">Change the title, message, or SMS setting. Already-sent messages stay as they were.</span>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setEditing(null)} aria-label="Close">
                <IconX className="w-4 h-4" />
              </button>
            </div>

            <div className="campaign-edit-form">
              <label className="form-label" htmlFor="edit-campaign-name">Campaign name</label>
              <input
                id="edit-campaign-name"
                className="form-input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                dir="auto"
              />

              <label className="form-label" htmlFor="edit-campaign-message">Message</label>
              <textarea
                id="edit-campaign-message"
                className="composer-textarea campaign-edit-textarea"
                value={editMessage}
                onChange={(e) => setEditMessage(e.target.value)}
                dir="rtl"
                rows={6}
              />

              <label className={`campaign-edit-sms ${!smsReady ? "is-locked" : ""}`}>
                <input
                  type="checkbox"
                  checked={Boolean(editSms && smsReady)}
                  disabled={!smsReady}
                  onChange={(e) => setEditSms(e.target.checked)}
                />
                <span>
                  {smsReady
                    ? "Use SMS fallback on remaining / future sends for this campaign"
                    : "SMS is not configured, so this campaign cannot send SMS"}
                </span>
              </label>
            </div>

            <div className="modal-footer-clean">
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={saveEdit}>
                <IconCheck className="w-4 h-4 mr-1.5" />
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}

      {peopleOpen && (
        <div className="modal-backdrop-clean" onClick={closePeople}>
          <div className="modal-content-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header-clean">
              <div>
                <h2 className="modal-title">{activeCampaignDetails?.name || "Campaign people"}</h2>
                <span className="modal-subtitle">
                  {activeCampaignDetails?.totalRecipients || 0} people · select the ones you want to remove
                </span>
              </div>
              <button type="button" className="modal-close-btn" onClick={closePeople} aria-label="Close">
                <IconX className="w-4 h-4" />
              </button>
            </div>

            <div className="modal-toolbar">
              <div className="search-input-wrap flex-1">
                <IconSearch className="w-4 h-4 search-icon" />
                <input
                  type="search"
                  className="table-search-field"
                  placeholder="Search people by name, phone, or status…"
                  value={peopleSearch}
                  onChange={(e) => setPeopleSearch(e.target.value)}
                  dir="auto"
                />
              </div>
              <span className="modal-count-tag">
                {selectedPhones.size} selected · {filteredPeople.length} shown
              </span>
              {selectedPhones.size > 0 && (
                <button
                  type="button"
                  className="btn-danger btn-sm"
                  onClick={() => removePeople([...selectedPhones])}
                >
                  <IconTrash className="w-3.5 h-3.5 mr-1" />
                  Remove selected
                </button>
              )}
            </div>

            <div className="modal-table-scroll">
              {loadingCampaignDetails ? (
                <p className="empty-table-cell">Loading people…</p>
              ) : (
                <table className="modern-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}></th>
                      <th>Beneficiary</th>
                      <th>Phone</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPeople.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="empty-table-cell">
                          {peopleRows.length === 0 ? "No people left in this campaign." : "No people match this search."}
                        </td>
                      </tr>
                    ) : (
                      filteredPeople.map((r) => {
                        const sendingNow = liveId === activeCampaignDetails.id && r.state === "sending";
                        return (
                          <tr key={r.phone} className="table-row">
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedPhones.has(r.phone)}
                                disabled={sendingNow}
                                onChange={() => togglePhone(r.phone)}
                              />
                            </td>
                            <td>
                              <strong className="beneficiary-name" dir="auto">{r.displayName}</strong>
                            </td>
                            <td>
                              <code className="phone-mono-tag">{r.phone}</code>
                            </td>
                            <td>
                              <span className="chip-badge chip-neutral">{r.state || "queued"}</span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn-ghost-danger btn-xs"
                                disabled={sendingNow}
                                title={sendingNow ? "Wait until this send finishes" : "Remove this person"}
                                onClick={() => removePeople([r.phone])}
                              >
                                <IconTrash className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>

            <div className="modal-footer-clean">
              <button type="button" className="btn-secondary" onClick={closePeople}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
