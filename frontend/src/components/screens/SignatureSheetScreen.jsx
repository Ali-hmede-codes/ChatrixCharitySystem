import React, { useMemo, useRef, useState } from "react";
import { useApp } from "../../context/AppContext.jsx";
import { codeKey, sanitizeAidCode } from "../../services/names.js";
import {
  codesOnSheet,
  downloadSignedWorkbook,
  indexSignatureMatches,
  readSignatureWorkbook,
} from "../../services/signature-sheet.js";
import { IconCheck, IconSpreadsheet, IconUpload } from "../common/Icons.jsx";

function rowStatus(code, match, { matching, lookupError }) {
  if (!code) return { label: "No code", tone: "chip-neutral" };
  if (matching) return { label: "Checking…", tone: "chip-neutral" };
  if (lookupError) return { label: "Not checked", tone: "chip-warning" };
  if (!match) return { label: "Code not in pickup", tone: "chip-danger" };
  if (match.signature) return { label: "Signature ready", tone: "chip-success" };
  return { label: "No signature saved", tone: "chip-warning" };
}

export function SignatureSheetScreen() {
  const { lookupSignatures, showToast } = useApp();
  const fileInputRef = useRef(null);
  const lookupSeq = useRef(0);

  const [isDragging, setIsDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [matching, setMatching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [codeCol, setCodeCol] = useState(-1);
  const [nameCol, setNameCol] = useState(-1);
  const [signatureCol, setSignatureCol] = useState(-1);
  const [matches, setMatches] = useState(() => new Map());
  const [lookupError, setLookupError] = useState("");

  const sheet = file?.sheets?.[activeIndex] || null;

  const summary = useMemo(() => {
    const rows = sheet?.rows || [];
    let ready = 0;
    let missingSign = 0;
    let unknown = 0;
    let blank = 0;
    for (const row of rows) {
      const code = codeCol >= 0 ? sanitizeAidCode(row.cells[codeCol]) : "";
      const status = rowStatus(code, code ? matches.get(codeKey(code)) : null, { matching, lookupError });
      if (status.label === "Signature ready") ready += 1;
      else if (status.label === "No signature saved") missingSign += 1;
      else if (status.label === "Code not in pickup") unknown += 1;
      else blank += 1;
    }
    return { ready, missingSign, unknown, blank, total: rows.length };
  }, [sheet, codeCol, matches, matching, lookupError]);

  async function matchCodes(nextFile, nextIndex, nextCodeCol) {
    const nextSheet = nextFile?.sheets?.[nextIndex];
    const seq = lookupSeq.current + 1;
    lookupSeq.current = seq;
    const codes = codesOnSheet(nextSheet, nextCodeCol);
    if (!codes.length) {
      setMatches(new Map());
      setLookupError("");
      setMatching(false);
      return;
    }
    setMatching(true);
    setLookupError("");
    const result = await lookupSignatures(codes);
    if (lookupSeq.current !== seq) return;
    setMatching(false);
    if (!result?.ok) {
      setMatches(new Map());
      setLookupError(result?.error || "Could not load signatures.");
      return;
    }
    setMatches(indexSignatureMatches(result.items));
  }

  async function handleFile(picked) {
    if (!picked) return;
    setReading(true);
    setLookupError("");
    try {
      const parsed = await readSignatureWorkbook(picked);
      const index = parsed.activeIndex || 0;
      const active = parsed.sheets[index];
      setFile(parsed);
      setActiveIndex(index);
      setCodeCol(active.codeCol);
      setNameCol(active.nameCol);
      setSignatureCol(active.signatureCol);
      setReading(false);
      showToast(`Loaded ${active.rows.length} rows from ${parsed.fileName}`, "success");
      matchCodes(parsed, index, active.codeCol);
    } catch (err) {
      setReading(false);
      showToast(err.message || "Could not read this file.", "error");
    }
  }

  function selectSheet(index) {
    const next = file?.sheets?.[index];
    if (!next) return;
    setActiveIndex(index);
    setCodeCol(next.codeCol);
    setNameCol(next.nameCol);
    setSignatureCol(next.signatureCol);
    matchCodes(file, index, next.codeCol);
  }

  function changeCodeCol(value) {
    const next = Number(value);
    setCodeCol(next);
    if (next >= 0 && next === nameCol) setNameCol(-1);
    if (next >= 0 && next === signatureCol) setSignatureCol(-1);
    matchCodes(file, activeIndex, next);
  }

  async function saveSheet() {
    if (!file || !sheet || saving) return;
    if (codeCol < 0 || signatureCol < 0) {
      showToast("Choose the pickup code column and the signature column.", "warning");
      return;
    }
    if (!summary.ready) {
      showToast("None of these codes have a saved signature yet.", "warning");
      return;
    }
    setSaving(true);
    try {
      const saved = await downloadSignedWorkbook(file, {
        sheetName: sheet.sheetName,
        rows: sheet.rows,
        codeCol,
        signatureCol,
        matches,
      });
      showToast(
        `Saved ${saved.fileName} with ${saved.stamped} signature${saved.stamped === 1 ? "" : "s"}.`,
        "success"
      );
    } catch (err) {
      showToast(err.message || "Could not save the Excel file.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-view">
      <div className="page-header">
        <div>
          <h1 className="page-title">Signature sheet</h1>
          <p className="page-subtitle">
            Upload the pickup Excel. Each code is matched to the signature collected at the desk, then written into the signature column. The download keeps the same sheet design.
          </p>
        </div>
        {sheet && (
          <div className="header-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={saveSheet}
              disabled={saving || matching || signatureCol < 0 || codeCol < 0 || summary.ready === 0}
            >
              <span>{saving ? "Saving…" : "Save Excel with signatures"}</span>
            </button>
          </div>
        )}
      </div>

      <div className="page-content-scroll">
        <div
          className={`modern-dropzone ${isDragging ? "is-dragging" : ""} ${file ? "is-loaded" : ""}`}
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
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          role="button"
          tabIndex={0}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files?.[0]) handleFile(e.target.files[0]);
              e.target.value = "";
            }}
          />
          <div className="dropzone-body">
            <div className="dropzone-icon-circle">
              {file ? <IconCheck className="w-7 h-7 text-emerald-600" /> : <IconSpreadsheet className="w-7 h-7 text-emerald-600" />}
            </div>
            <h3 className="dropzone-title">
              {reading ? "Reading spreadsheet…" : file ? file.fileName : "Drop the pickup Excel here"}
            </h3>
            <p className="dropzone-hint">
              {file
                ? "Click or drop another .xlsx file to replace this one"
                : "Use the .xlsx sheet that already has people, their pickup codes, and a signature column"}
            </p>
            {!file && (
              <button type="button" className="btn-secondary mt-2">
                <IconUpload className="w-4 h-4 mr-1.5" />
                Browse Computer Files
              </button>
            )}
          </div>
        </div>

        {sheet && (
          <>
            <div className="sign-sheet-summary">
              <span className="chip-badge chip-success">{summary.ready} with signature</span>
              <span className="chip-badge chip-warning">{summary.missingSign} code found, no signature</span>
              <span className="chip-badge chip-danger">{summary.unknown} code not in pickup</span>
              <span className="chip-badge chip-neutral">{summary.total} rows</span>
              {matching && <span className="chip-badge chip-neutral">Matching codes…</span>}
            </div>

            {lookupError && (
              <div className="info-callout mt-4">
                <div className="info-callout-header">
                  <span>{lookupError}</span>
                </div>
              </div>
            )}

            <div className="sign-sheet-columns">
              {file.sheets.length > 1 && (
                <label>
                  Excel tab
                  <select className="form-select" value={activeIndex} onChange={(e) => selectSheet(Number(e.target.value))}>
                    {file.sheets.map((item, index) => (
                      <option key={item.sheetName} value={index}>
                        {item.sheetName}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Pickup code column
                <select className="form-select" value={codeCol} onChange={(e) => changeCodeCol(e.target.value)}>
                  <option value={-1}>Choose a column</option>
                  {sheet.headers.map((header, index) => (
                    <option key={index} value={index}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Name column
                <select
                  className="form-select"
                  value={nameCol}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setNameCol(next);
                    if (next >= 0 && next === signatureCol) setSignatureCol(-1);
                  }}
                >
                  <option value={-1}>None</option>
                  {sheet.headers.map((header, index) => (
                    <option key={index} value={index} disabled={index === codeCol}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Signature column
                <select
                  className="form-select"
                  value={signatureCol}
                  onChange={(e) => setSignatureCol(Number(e.target.value))}
                >
                  <option value={-1}>Choose a column</option>
                  {sheet.headers.map((header, index) => (
                    <option key={index} value={index} disabled={index === codeCol || index === nameCol}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="modern-table-container sign-sheet-table">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Signature</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((row) => {
                    const code = codeCol >= 0 ? sanitizeAidCode(row.cells[codeCol]) : "";
                    const sheetName = nameCol >= 0 ? row.cells[nameCol] || "" : "";
                    const match = code ? matches.get(codeKey(code)) : null;
                    const status = rowStatus(code, match, { matching, lookupError });
                    const displayName = sheetName || match?.name || "—";
                    return (
                      <tr key={row.excelRow} className="table-row">
                        <td>
                          <code className="phone-mono-tag">{code || "—"}</code>
                        </td>
                        <td>{displayName}</td>
                        <td>
                          {match?.signature ? (
                            <img className="sign-sheet-thumb" src={match.signature} alt={`Signature for ${displayName}`} />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          <span className={`chip-badge ${status.tone}`}>{status.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
