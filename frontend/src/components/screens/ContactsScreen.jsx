import React, { useState, useMemo } from "react";
import { useApp } from "../../context/AppContext.jsx";
import { getAvatarColor } from "../../constants/colors.js";
import { personInitials } from "../../services/names.js";
import {
  IconSearch,
  IconPhone,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
} from "../common/Icons.jsx";

const PAGE_SIZE = 50;

export function ContactsScreen() {
  const { savedContacts } = useApp();
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const filtered = useMemo(() => {
    if (!search.trim()) return savedContacts;
    const term = search.toLowerCase().trim();
    return savedContacts.filter((c) => {
      const name = String(c.name || "").toLowerCase();
      const phone = String(c.phone || "").toLowerCase();
      return name.includes(term) || phone.includes(term);
    });
  }, [savedContacts, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const validPage = Math.min(currentPage, totalPages);

  const paginated = useMemo(() => {
    const start = (validPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, validPage]);

  return (
    <div className="page-view contacts-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Contacts Directory</h1>
          <p className="page-subtitle">
            Contacts synced directly into the charity phone's WhatsApp address book
          </p>
        </div>

        <div className="header-stats-pill">
          <span className="stats-num">{savedContacts.length}</span>
          <span className="stats-desc">Contacts on phone</span>
        </div>
      </div>

      <div className="page-content-scroll">
        {/* Toolbar */}
        <div className="table-toolbar">
          <div className="search-input-wrap">
            <IconSearch className="w-4 h-4 search-icon" />
            <input
              type="search"
              placeholder="Search saved contacts by name or number…"
              value={search}
              onChange={(e) => {
                setSearch((e.target.value));
                setCurrentPage(1);
              }}
              className="table-search-field"
            />
          </div>

          <span className="chip-badge chip-neutral">
            {filtered.length} {filtered.length === 1 ? "contact" : "contacts"}
            {filtered.length !== savedContacts.length && ` (of ${savedContacts.length})`}
          </span>
        </div>

        {/* Unboxed Modern Table */}
        <div className="modern-table-container">
          <table className="modern-table">
            <thead>
              <tr>
                <th style={{ width: "48px" }}></th>
                <th>Beneficiary Name</th>
                <th>Phone Number</th>
                <th>Sync Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-table-cell">
                    <div className="empty-table-view">
                      <IconPhone className="w-8 h-8 text-slate-400 mb-2" />
                      <p>
                        {savedContacts.length === 0
                          ? "No contacts saved to phone yet. Import a list in 'Choose List' and click 'Save to Phone'."
                          : "No contacts match your search."}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginated.map((item, idx) => {
                  const initials = personInitials(item.name, item.phone);
                  const avatarBg = getAvatarColor(item.name || item.phone);

                  return (
                    <tr key={`${item.phone}-${idx}`} className="table-row">
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
                          {item.name || "Unknown"}
                        </strong>
                      </td>
                      <td>
                        <code className="phone-mono-tag">{item.phone}</code>
                      </td>
                      <td>
                        <span className="chip-badge chip-success">
                          <IconCheck className="w-3 h-3 mr-1" />
                          Synced to WhatsApp
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {filtered.length > PAGE_SIZE && (
          <div className="table-pagination-bar">
            <span className="pagination-info">
              Showing {(validPage - 1) * PAGE_SIZE + 1}–
              {Math.min(validPage * PAGE_SIZE, filtered.length)} of {filtered.length} contacts
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
