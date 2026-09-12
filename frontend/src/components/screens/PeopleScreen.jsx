import React, { useState, useMemo } from "react";
import { useApp } from "../../context/AppContext.jsx";
import { phoneKey } from "../../services/phone.js";
import { contactSaveName, personInitials, personNames } from "../../services/names.js";
import { getAvatarColor } from "../../constants/colors.js";
import {
  IconSearch,
  IconUsers,
  IconWhatsApp,
  IconPhone,
  IconSend,
  IconChevronLeft,
  IconChevronRight,
  IconCheck,
} from "../common/Icons.jsx";

const PAGE_SIZE = 50;

export function PeopleScreen() {
  const {
    people,
    setPeople,
    setImportedFileName,
    listColumns,
    setListColumns,
    setCurrentStep,
    savedContacts,
    waCheckMap,
    savingContacts,
    checkingContacts,
    contactProgressHint,
    saveContactsToPhone,
    checkContactsOnWhatsApp,
    waState,
    showToast,
  } = useApp();

  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const hasAidCodes = Boolean(listColumns.hasCodes);

  const savedMap = useMemo(() => {
    const map = new Map();
    savedContacts.forEach((c) => {
      const key = phoneKey(c.phone);
      if (key) map.set(key, c);
    });
    return map;
  }, [savedContacts]);

  const filteredPeople = useMemo(() => {
    if (!searchTerm.trim()) return people;
    const term = searchTerm.toLowerCase().trim();
    return people.filter((p) => {
      const name = String(p.name || "").toLowerCase();
      const phone = String(p.phone || "").toLowerCase();
      const code = String(p.code || "").toLowerCase();
      return name.includes(term) || phone.includes(term) || code.includes(term);
    });
  }, [people, searchTerm]);

  // Reset page when search term changes
  const totalPages = Math.max(1, Math.ceil(filteredPeople.length / PAGE_SIZE));
  const validPage = Math.min(currentPage, totalPages);

  const paginatedPeople = useMemo(() => {
    const start = (validPage - 1) * PAGE_SIZE;
    return filteredPeople.slice(start, start + PAGE_SIZE);
  }, [filteredPeople, validPage]);

  function handleCheckWhatsApp() {
    if (waState !== "open") {
      showToast("Link WhatsApp first to check numbers.", "warning");
      return;
    }
    const phones = people.map((p) => p.phone);
    checkContactsOnWhatsApp(phones);
  }

  function handleSaveContacts() {
    if (waState !== "open") {
      showToast("Link WhatsApp first to save contacts.", "warning");
      return;
    }
    const actionable = people.map((p) => ({
      phone: p.phone,
      names: personNames(p),
      name: p.name || "",
    }));
    saveContactsToPhone(actionable);
  }

  function handleClear() {
    if (window.confirm("Are you sure you want to clear the current list?")) {
      setPeople([]);
      setImportedFileName("");
      setListColumns({ hasNames: false, hasCodes: false });
      setCurrentStep("excel");
    }
  }

  return (
    <div className="page-view people-page">
      {/* Page Header with Actions */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Beneficiaries List</h1>
          <p className="page-subtitle">
            Review uploaded numbers, verify WhatsApp accounts, and sync to charity phone
          </p>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="btn-secondary"
            disabled={checkingContacts || savingContacts || people.length === 0}
            onClick={handleCheckWhatsApp}
          >
            <IconWhatsApp className="w-4 h-4 mr-1.5 text-emerald-600" />
            <span>{checkingContacts ? "Checking…" : "Check WhatsApp"}</span>
          </button>

          <button
            type="button"
            className="btn-secondary"
            disabled={savingContacts || checkingContacts || people.length === 0}
            onClick={handleSaveContacts}
          >
            <IconPhone className="w-4 h-4 mr-1.5 text-teal-600" />
            <span>{savingContacts ? "Saving…" : "Save to Phone"}</span>
          </button>

          <button
            type="button"
            className="btn-primary"
            disabled={people.length === 0}
            onClick={() => setCurrentStep("send")}
          >
            <IconSend className="w-4 h-4 mr-1.5" />
            <span>Compose Outreach</span>
          </button>
        </div>
      </div>

      <div className="page-content-scroll">
        {/* Progress notification banner */}
        {contactProgressHint && (
          <div className="inline-progress-banner">
            <span className="spinner-dot" />
            <span>{contactProgressHint}</span>
          </div>
        )}

        {/* Toolbar: Search + Quick stats + Clear */}
        <div className="table-toolbar">
          <div className="search-input-wrap">
            <IconSearch className="w-4 h-4 search-icon" />
            <input
              type="search"
              placeholder="Search by beneficiary name, phone, or aid code…"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="table-search-field"
            />
          </div>

          <div className="toolbar-stats-group">
            <span className="chip-badge chip-neutral">
              {filteredPeople.length} {filteredPeople.length === 1 ? "person" : "people"}
              {filteredPeople.length !== people.length && ` (of ${people.length})`}
            </span>

            {people.length > 0 && (
              <button
                type="button"
                className="btn-text-danger"
                onClick={handleClear}
              >
                Clear list
              </button>
            )}
          </div>
        </div>

        {/* Unboxed Modern Table */}
        <div className="modern-table-container">
          <table className="modern-table">
            <thead>
              <tr>
                <th style={{ width: "48px" }}></th>
                <th>Beneficiary Name</th>
                <th>Phone Number</th>
                {hasAidCodes && <th>Aid Code</th>}
                <th>WhatsApp & Phone Sync Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredPeople.length === 0 ? (
                <tr>
                      <td colSpan={hasAidCodes ? 5 : 4} className="empty-table-cell">
                    <div className="empty-table-view">
                      <IconUsers className="w-8 h-8 text-slate-400 mb-2" />
                      <p>
                        {people.length === 0
                          ? "No people loaded yet. Go to 'Choose List' to upload an Excel file."
                          : "No beneficiaries match your search criteria."}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedPeople.map((person, idx) => {
                  const key = phoneKey(person.phone);
                  const saved = savedMap.get(key);
                  const check = waCheckMap[key];
                  const avatarBg = getAvatarColor(person.name || person.phone);
                  const initials = personInitials(person.name, person.phone);

                  return (
                    <tr key={`${person.phone}-${idx}`} className="table-row">
                      <td>
                        <div
                          className="table-avatar"
                          style={{ backgroundColor: avatarBg }}
                        >
                          {initials}
                        </div>
                      </td>
                      <td>
                        <div className="beneficiary-name-wrap">
                          <strong className="beneficiary-name">
                            {listColumns.hasNames ? person.name || "Unknown" : "—"}
                          </strong>
                          {person.names && person.names.length > 1 && (
                            <span className="family-share-badge">
                              {person.names.length} family members · save as {contactSaveName(person)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <code className="phone-mono-tag">{person.phone}</code>
                      </td>
                      {hasAidCodes && (
                        <td>
                          {person.code ? (
                            <code className="aid-code-tag">{person.code}</code>
                          ) : (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                        </td>
                      )}
                      <td>
                        <div className="status-tags-row">
                          {saved?.savedOnPrimary && (
                            <span className="chip-badge chip-success">
                              <IconCheck className="w-3 h-3 mr-1" />
                              Saved on Phone
                            </span>
                          )}
                          {check && check.exists && (
                            <span className="chip-badge chip-emerald">
                              <span className="dot-indicator bg-emerald-500" />
                              WhatsApp Active
                            </span>
                          )}
                          {check && (!check.exists || check.invalid) && (
                            <span className="chip-badge chip-danger">
                              <span className="dot-indicator bg-red-500" />
                              Not on WhatsApp
                            </span>
                          )}
                          {!saved?.savedOnPrimary && !check && (
                            <span className="chip-badge chip-neutral">
                              Ready for outreach
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {filteredPeople.length > PAGE_SIZE && (
          <div className="table-pagination-bar">
            <span className="pagination-info">
              Showing {(validPage - 1) * PAGE_SIZE + 1}–
              {Math.min(validPage * PAGE_SIZE, filteredPeople.length)} of {filteredPeople.length} beneficiaries
            </span>

            <div className="pagination-controls">
              <button
                type="button"
                className="pagination-btn"
                disabled={validPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                <IconChevronLeft className="w-4 h-4 mr-1" />
                Previous
              </button>
              <span className="pagination-current">
                Page {validPage} of {totalPages}
              </span>
              <button
                type="button"
                className="pagination-btn"
                disabled={validPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
                <IconChevronRight className="w-4 h-4 ml-1" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
