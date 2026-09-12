import React, { useState, useRef } from "react";
import { useApp } from "../../context/AppContext.jsx";
import {
  parseSpreadsheet,
  guessPhoneCol,
  guessNameCol,
  guessCodeCol,
  getColumnStats,
} from "../../services/excel.js";
import { describePhoneIssue, normalizePhone, phoneKey } from "../../services/phone.js";
import { addPersonName, sanitizeAidCode } from "../../services/names.js";
import { MAX_PEOPLE } from "../../constants/config.js";
import {
  IconUpload,
  IconSpreadsheet,
  IconCheck,
  IconSparkles,
} from "../common/Icons.jsx";

export function ExcelScreen() {
  const { setPeople, setImportedFileName, setListColumns, setCurrentStep, showToast } = useApp();

  const [sheetData, setSheetData] = useState(null);
  const [selectedPhoneCol, setSelectedPhoneCol] = useState(0);
  const [selectedNameCol, setSelectedNameCol] = useState(-1);
  const [selectedCodeCol, setSelectedCodeCol] = useState(-1);
  const [isDragging, setIsDragging] = useState(false);
  const [importHint, setImportHint] = useState("");
  const fileInputRef = useRef(null);

  async function handleFile(file) {
    if (!file) return;
    try {
      setImportHint("Reading spreadsheet…");
      const parsed = await parseSpreadsheet(file);
      setSheetData(parsed);

      const guessedPhone = guessPhoneCol(parsed.headers, parsed.rows);
      const guessedName = guessNameCol(parsed.headers, guessedPhone);
      const guessedCode = guessCodeCol(parsed.headers, guessedPhone, guessedName);

      setSelectedPhoneCol(guessedPhone);
      setSelectedNameCol(guessedName);
      setSelectedCodeCol(guessedCode);
      setImportHint(
        `Successfully loaded ${parsed.rows.length} rows from ${file.name}. Review phone column below.`
      );
      showToast(`Spreadsheet loaded: ${parsed.rows.length} records`, "success");
    } catch (err) {
      setImportHint(err.message || "Could not read this file.");
      showToast(err.message || "Could not read this file", "error");
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }

  function handleImportToList() {
    if (!sheetData) return;
    const phoneIdx = Number(selectedPhoneCol);
    const nameIdx = Number(selectedNameCol);
    const codeIdx = Number(selectedCodeCol);

    const byPhone = new Map();
    const resultList = [];
    let skippedInvalid = 0;
    let mergedDupes = 0;

    sheetData.rows.forEach((row) => {
      const rawPhone = row[phoneIdx];
      const phone = normalizePhone(rawPhone);
      if (!phone) {
        if (String(rawPhone ?? "").trim()) skippedInvalid += 1;
        return;
      }

      const key = phoneKey(phone);
      const rawName =
        nameIdx >= 0 && nameIdx !== phoneIdx ? String(row[nameIdx] || "").trim() : "";
      const rawCode =
        codeIdx >= 0 && codeIdx !== phoneIdx && codeIdx !== nameIdx
          ? sanitizeAidCode(row[codeIdx])
          : "";

      if (byPhone.has(key)) {
        const existing = byPhone.get(key);
        addPersonName(existing, rawName);
        if (rawCode && !existing.code) existing.code = rawCode;
        mergedDupes += 1;
        return;
      }

      if (resultList.length >= MAX_PEOPLE) return;

      const person = {
        phone,
        names: [],
        name: "",
        label: "",
        code: rawCode,
      };
      addPersonName(person, rawName);
      byPhone.set(key, person);
      resultList.push(person);
    });

    if (!resultList.length) {
      showToast(
        skippedInvalid
          ? `${skippedInvalid} number${skippedInvalid === 1 ? "" : "s"} in that column are not valid Lebanon (+961) or Syria (+963) phones. Fix the highlighted cells, or pick another column.`
          : "No valid Lebanon (+961) or Syria (+963) phone numbers in the selected column.",
        "error"
      );
      return;
    }

    const withCodes = resultList.filter((p) => p.code).length;
    const useNameCol = nameIdx >= 0 && nameIdx !== phoneIdx;
    const useCodeCol = codeIdx >= 0 && codeIdx !== phoneIdx && codeIdx !== nameIdx;
    setPeople(resultList);
    setImportedFileName(sheetData.fileName);
    setListColumns({ hasNames: useNameCol, hasCodes: useCodeCol });
    const extras = [];
    if (skippedInvalid) extras.push(`${skippedInvalid} invalid skipped`);
    if (mergedDupes) extras.push(`${mergedDupes} shared numbers combined`);
    if (useNameCol) extras.push("names included");
    else extras.push("no name column");
    if (useCodeCol) extras.push(`${withCodes} pickup codes`);
    else extras.push("no pickup-code column");
    showToast(`Imported ${resultList.length} valid numbers · ${extras.join(" · ")}`, skippedInvalid ? "warning" : "success");
    setCurrentStep("list");
  }

  const phoneStats = sheetData ? getColumnStats(sheetData.rows, selectedPhoneCol) : null;

  return (
    <div className="page-view excel-page">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Choose Beneficiary List</h1>
          <p className="page-subtitle">
            Upload the spreadsheet, then choose which columns to use. Leave Name or Pickup Code as None if you do not want to send those in messages.
          </p>
        </div>

        {sheetData && (
          <div className="header-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={handleImportToList}
              disabled={!phoneStats?.hits}
            >
              <span>Import to Beneficiaries List</span>
            </button>
          </div>
        )}
      </div>

      <div className="page-content-scroll">
        {/* Modern Clean Dropzone */}
        <div
          className={`modern-dropzone ${isDragging ? "is-dragging" : ""} ${sheetData ? "is-loaded" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
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
              {sheetData ? sheetData.fileName : "Drop your Excel or CSV spreadsheet here"}
            </h3>
            <p className="dropzone-hint">
              {sheetData
                ? "Click or drop a different spreadsheet to replace current data"
                : "Supports .xlsx, .xls, and .csv files from Excel, Google Sheets, or any charity database"}
            </p>
            {!sheetData && (
              <button type="button" className="btn-secondary mt-2">
                <IconUpload className="w-4 h-4 mr-1.5" />
                Browse Computer Files
              </button>
            )}
          </div>
        </div>

        {/* Import Hint info */}
        {importHint && (
          <div className="info-callout mt-4">
            <div className="info-callout-header">
              <IconSparkles className="w-4 h-4 text-emerald-600" />
              <span>{importHint}</span>
            </div>
          </div>
        )}

        {/* Column Configuration & Live Preview */}
        {sheetData && (
          <div className="excel-config-grid mt-6">
            {/* Left: Column Pickers */}
            <div className="config-column-card">
              <h3 className="card-section-title">1. Select Phone Number Column</h3>
              <p className="card-section-desc">
                Choose the column containing beneficiary mobile numbers. Only Lebanon (+961) and Syria (+963) numbers are imported. Invalid cells stay red below.
              </p>

              <div className="col-options-list">
                {sheetData.headers.map((header, idx) => {
                  const stats = getColumnStats(sheetData.rows, idx);
                  const isSelected = idx === selectedPhoneCol;
                  return (
                    <button
                      key={idx}
                      type="button"
                      className={`col-option-item ${isSelected ? "selected" : ""}`}
                      onClick={() => {
                        setSelectedPhoneCol(idx);
                        if (idx === selectedNameCol) setSelectedNameCol(-1);
                        if (idx === selectedCodeCol) setSelectedCodeCol(-1);
                      }}
                    >
                      <div className="col-option-header">
                        <strong className="col-option-name">{header || `Col ${idx + 1}`}</strong>
                        <span className="col-option-chips">
                          <span className={`chip-badge ${stats.hits > 0 ? "chip-success" : "chip-neutral"}`}>
                            {stats.hits} valid
                          </span>
                          {stats.invalid > 0 && (
                            <span className="chip-badge chip-danger">{stats.invalid} invalid</span>
                          )}
                        </span>
                      </div>
                      <span className="col-option-samples">
                        {stats.samples.join(" · ") || "No valid +961 / +963 numbers found"}
                        {stats.invalid > 0 && stats.invalidSamples.length
                          ? ` · skipped: ${stats.invalidSamples.join(" · ")}`
                          : ""}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Name Column Selection */}
              <div className="name-col-wrap">
                <h3 className="card-section-title">2. Beneficiary Name Column (optional)</h3>
                <p className="card-section-desc">
                  Choose the name column only if messages should include the person&apos;s name. Select None to send without names.
                </p>
                <select
                  value={selectedNameCol}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setSelectedNameCol(next);
                    if (next >= 0 && next === selectedCodeCol) setSelectedCodeCol(-1);
                  }}
                  className="form-select"
                >
                  <option value={-1}>None — do not send person names</option>
                  {sheetData.headers.map((header, idx) => (
                    <option key={idx} value={idx} disabled={idx === selectedPhoneCol}>
                      {header || `Column ${idx + 1}`}
                      {idx === selectedPhoneCol ? " (Phone column)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Aid Code Column Selection */}
              <div className="name-col-wrap">
                <h3 className="card-section-title">3. Aid Pickup Code Column / كود الاستلام (optional)</h3>
                <p className="card-section-desc">
                  Choose the code column only if each family has a pickup code in Excel. Select None to keep codes out of messages — you will not be asked to type a code later.
                </p>
                <select
                  value={selectedCodeCol}
                  onChange={(e) => setSelectedCodeCol(Number(e.target.value))}
                  className="form-select"
                >
                  <option value={-1}>None — do not send pickup codes</option>
                  {sheetData.headers.map((header, idx) => (
                    <option key={idx} value={idx} disabled={idx === selectedPhoneCol || idx === selectedNameCol}>
                      {header || `Column ${idx + 1}`}
                      {idx === selectedPhoneCol ? " (Phone column)" : ""}
                      {idx === selectedNameCol ? " (Name column)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Right: Preview Table */}
            <div className="config-preview-card">
              <div className="preview-header-line">
                <h3 className="card-section-title">Spreadsheet Preview</h3>
                <span className="chip-badge chip-neutral">
                  First {Math.min(sheetData.rows.length, 8)} of {sheetData.rows.length} rows
                </span>
              </div>

              <div className="preview-table-wrap">
                <table className="modern-table">
                  <thead>
                    <tr>
                      {sheetData.headers.map((h, i) => (
                        <th
                          key={i}
                          className={
                            i === selectedPhoneCol
                              ? "col-highlight"
                              : i === selectedNameCol
                              ? "col-highlight-name"
                              : i === selectedCodeCol
                              ? "col-highlight-code"
                              : ""
                          }
                        >
                          {h || `Col ${i + 1}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheetData.rows.slice(0, 8).map((row, rIdx) => (
                      <tr key={rIdx}>
                        {sheetData.headers.map((_, cIdx) => (
                          <td
                            key={cIdx}
                            className={
                              cIdx === selectedPhoneCol
                                ? "col-highlight"
                                : cIdx === selectedNameCol
                                ? "col-highlight-name"
                                : cIdx === selectedCodeCol
                                ? "col-highlight-code"
                                : ""
                            }
                          >
                            {cIdx === selectedPhoneCol ? (
                              (() => {
                                const formatted = normalizePhone(row[cIdx]);
                                const raw = String(row[cIdx] ?? "").trim();
                                if (formatted) {
                                  return <code className="phone-mono-tag">{formatted}</code>;
                                }
                                if (!raw) return "—";
                                return (
                                  <span className="phone-invalid-wrap">
                                    <code className="phone-mono-tag is-invalid">{raw}</code>
                                    <span className="phone-invalid-reason">
                                      Invalid · {describePhoneIssue(raw)}
                                    </span>
                                  </span>
                                );
                              })()
                            ) : (
                              String(row[cIdx] || "—")
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {phoneStats?.invalid > 0 && (
                <div className="excel-invalid-banner" role="status">
                  <strong>{phoneStats.invalid} number{phoneStats.invalid === 1 ? "" : "s"} will not import.</strong>
                  {" "}
                  Only Lebanon (+961) and Syria (+963) phones are valid. Fix the red cells or pick another column.
                </div>
              )}

              <div className="preview-action-footer">
                <button
                  type="button"
                  className="btn-primary w-full"
                  onClick={handleImportToList}
                  disabled={!phoneStats?.hits}
                >
                  <span>
                    Import {phoneStats?.hits || 0} valid beneficiar{phoneStats?.hits === 1 ? "y" : "ies"}
                    {phoneStats?.invalid ? ` · skip ${phoneStats.invalid} invalid` : ""}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
