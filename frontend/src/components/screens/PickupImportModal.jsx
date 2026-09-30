import React, { useMemo, useRef, useState } from "react";
import {
  getColumnStats,
  guessCodeCol,
  guessNameCol,
  guessPhoneCol,
  parseSpreadsheet,
  peopleFromSheetRows,
} from "../../services/excel.js";
import { IconCheck, IconSpreadsheet, IconUpload, IconX } from "../common/Icons.jsx";

const PICKUP_IMPORT_LIMIT = 5000;

function defaultListName(fileName) {
  const base = String(fileName || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  if (base) return base.slice(0, 160);
  const dateStr = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return `Pickup list ${dateStr}`;
}

export function PickupImportModal({ onClose, onImport, showToast }) {
  const fileInputRef = useRef(null);
  const [sheetData, setSheetData] = useState(null);
  const [listName, setListName] = useState("");
  const [phoneCol, setPhoneCol] = useState(0);
  const [nameCol, setNameCol] = useState(-1);
  const [codeCol, setCodeCol] = useState(-1);
  const [isDragging, setIsDragging] = useState(false);
  const [reading, setReading] = useState(false);

  const parsed = useMemo(() => {
    if (!sheetData) return null;
    return peopleFromSheetRows(sheetData.rows, {
      phoneIdx: phoneCol,
      nameIdx: nameCol,
      codeIdx: codeCol,
      limit: PICKUP_IMPORT_LIMIT,
    });
  }, [sheetData, phoneCol, nameCol, codeCol]);

  const phoneStats = sheetData ? getColumnStats(sheetData.rows, phoneCol) : null;

  async function handleFile(file) {
    if (!file) return;
    try {
      setReading(true);
      const next = await parseSpreadsheet(file);
      const guessedPhone = guessPhoneCol(next.headers, next.rows);
      const guessedName = guessNameCol(next.headers, guessedPhone);
      const guessedCode = guessCodeCol(next.headers, guessedPhone, guessedName);
      setSheetData(next);
      setPhoneCol(guessedPhone);
      setNameCol(guessedName);
      setCodeCol(guessedCode);
      setListName(defaultListName(next.fileName));
    } catch (err) {
      showToast(err.message || "Could not read this file.", "error");
    } finally {
      setReading(false);
    }
  }

  function submit() {
    if (!parsed?.people?.length) {
      showToast(
        parsed?.skippedInvalid
          ? "No valid Lebanon (+961) or Syria (+963) numbers in that column."
          : "Choose the phone column, then add the list.",
        "error"
      );
      return;
    }
    if (parsed.overflow) {
      showToast(
        `This spreadsheet has more than ${PICKUP_IMPORT_LIMIT} people. Split it and import the parts separately.`,
        "error"
      );
      return;
    }
    const name = listName.trim();
    if (!name) {
      showToast("Enter a name for this pickup list.", "warning");
      return;
    }
    onImport({
      name,
      recipients: parsed.people.map((person) => ({
        phone: person.phone,
        name: person.name,
        names: person.names,
        code: person.code,
        nameCodes: person.nameCodes,
      })),
    });
  }

  return (
    <div className="modal-backdrop-clean" onClick={onClose}>
      <div
        className="modal-content-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pickup-import-title"
      >
        <div className="modal-header-clean">
          <div>
            <h2 className="modal-title" id="pickup-import-title">Import a pickup list</h2>
            <span className="modal-subtitle">
              Use this when messages were already sent outside Chatrix. People are added to the desk only — no WhatsApp or SMS is sent.
            </span>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">
            <IconX className="w-4 h-4" />
          </button>
        </div>

        <div className="modal-body-scroll pickup-import-body">
          <div
            className={`modern-dropzone ${isDragging ? "is-dragging" : ""} ${sheetData ? "is-loaded" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
            }}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files?.[0]) handleFile(e.target.files[0]);
                e.target.value = "";
              }}
            />
            <div className="dropzone-body">
              <div className="dropzone-icon-circle">
                {sheetData ? (
                  <IconCheck className="w-7 h-7 text-emerald-600" />
                ) : (
                  <IconSpreadsheet className="w-7 h-7 text-emerald-600" />
                )}
              </div>
              <h3 className="dropzone-title">
                {reading ? "Reading spreadsheet…" : sheetData ? sheetData.fileName : "Drop an Excel or CSV file here"}
              </h3>
              <p className="dropzone-hint">
                {sheetData
                  ? "Click or drop another file to replace this one."
                  : "Same columns as a send list: phone, and optional name and pickup code."}
              </p>
              {!sheetData && (
                <span className="btn-secondary mt-2">
                  <IconUpload className="w-4 h-4 mr-1.5" />
                  Browse files
                </span>
              )}
            </div>
          </div>

          {sheetData && (
            <div className="pickup-import-fields">
              <label className="form-label" htmlFor="pickup-import-name">List name</label>
              <input
                id="pickup-import-name"
                className="form-input"
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                dir="auto"
              />

              <label className="form-label" htmlFor="pickup-import-phone">Phone column</label>
              <select
                id="pickup-import-phone"
                className="form-select"
                value={phoneCol}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setPhoneCol(next);
                  if (next === nameCol) setNameCol(-1);
                  if (next === codeCol) setCodeCol(-1);
                }}
              >
                {sheetData.headers.map((header, idx) => (
                  <option key={idx} value={idx}>
                    {header || `Column ${idx + 1}`}
                  </option>
                ))}
              </select>

              <label className="form-label" htmlFor="pickup-import-name-col">Name column</label>
              <select
                id="pickup-import-name-col"
                className="form-select"
                value={nameCol}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setNameCol(next);
                  if (next >= 0 && next === codeCol) setCodeCol(-1);
                }}
              >
                <option value={-1}>None — search by phone only</option>
                {sheetData.headers.map((header, idx) => (
                  <option key={idx} value={idx} disabled={idx === phoneCol}>
                    {header || `Column ${idx + 1}`}
                  </option>
                ))}
              </select>

              <label className="form-label" htmlFor="pickup-import-code">Pickup code column</label>
              <select
                id="pickup-import-code"
                className="form-select"
                value={codeCol}
                onChange={(e) => setCodeCol(Number(e.target.value))}
              >
                <option value={-1}>None</option>
                {sheetData.headers.map((header, idx) => (
                  <option key={idx} value={idx} disabled={idx === phoneCol || idx === nameCol}>
                    {header || `Column ${idx + 1}`}
                  </option>
                ))}
              </select>

              <p className="form-hint">
                {phoneStats?.hits || 0} valid numbers
                {parsed?.people?.length ? ` · ${parsed.people.length} people on the desk` : ""}
                {parsed?.mergedDupes ? ` · ${parsed.mergedDupes} shared numbers combined` : ""}
                {parsed?.skippedInvalid ? ` · ${parsed.skippedInvalid} invalid skipped` : ""}
                {nameCol < 0 ? " · no names" : ""}
                {codeCol < 0 ? " · no pickup codes" : ""}
                {parsed?.overflow ? ` · more than ${PICKUP_IMPORT_LIMIT} people, split the file` : ""}
              </p>
            </div>
          )}
        </div>

        <div className="modal-footer-clean">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn-primary"
            onClick={submit}
            disabled={!parsed?.people?.length || parsed?.overflow}
          >
            <IconCheck className="w-4 h-4 mr-1.5" />
            Add to pickup desk
          </button>
        </div>
      </div>
    </div>
  );
}
