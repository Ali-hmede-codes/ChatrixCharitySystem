import {
  cellText,
  findHeaderIndex,
  guessCodeCol,
  guessNameCol,
  guessSignatureCol,
  headerRowScore,
  isNoiseRow,
} from "./excel.js";
import { codeKey, sanitizeAidCode } from "./names.js";
import { signatureImageParts } from "./signature.js";

function cloneBytes(buffer) {
  const bytes = new Uint8Array(buffer);
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function excelCellText(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return cellText(value.toISOString().slice(0, 10));
  }
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) {
      return cellText(value.richText.map((part) => part?.text || "").join(""));
    }
    if (value.result != null) return excelCellText(value.result);
    if (value.text != null) return cellText(value.text);
    return "";
  }
  return cellText(value);
}

function headersFrom(english, arabic, width) {
  const headers = [];
  for (let i = 0; i < width; i += 1) {
    const top = cellText(english[i]);
    const bottom = cellText(arabic[i]);
    if (top && bottom && top !== bottom) headers.push(`${top} / ${bottom}`);
    else headers.push(top || bottom || `Column ${i + 1}`);
  }
  return headers;
}

function parseSheet(sheet) {
  const colCount = Math.min(Math.max(sheet.columnCount || 1, 1), 40);
  const last = Math.min(sheet.rowCount || 0, 8000);
  const matrix = [];
  const excelRows = [];
  let emptyRun = 0;

  for (let r = 1; r <= last; r += 1) {
    const row = sheet.getRow(r);
    const cells = [];
    let any = false;
    for (let c = 1; c <= colCount; c += 1) {
      const text = excelCellText(row.getCell(c).value);
      if (text) any = true;
      cells.push(text);
    }
    if (!any) {
      emptyRun += 1;
      if (matrix.length > 0 && emptyRun > 25) break;
    } else {
      emptyRun = 0;
    }
    matrix.push(cells);
    excelRows.push(r);
  }

  if (!matrix.some((row) => row.some(Boolean))) return null;

  const headerIndex = findHeaderIndex(matrix);
  let dataStart = headerIndex + 1;
  if (matrix[dataStart] && headerRowScore(matrix[dataStart]) >= 8) dataStart += 1;

  const english = matrix[headerIndex] || [];
  const arabic = dataStart === headerIndex + 2 ? matrix[headerIndex + 1] || [] : [];
  let width = Math.max(english.length, arabic.length, 1);
  for (let i = dataStart; i < matrix.length; i += 1) width = Math.max(width, matrix[i].length);
  width = Math.min(width, colCount);

  while (width > 1) {
    const lastCol = width - 1;
    const headerEmpty = !cellText(english[lastCol]) && !cellText(arabic[lastCol]);
    const dataEmpty = matrix.slice(dataStart).every((row) => !cellText(row[lastCol]));
    if (headerEmpty && dataEmpty) width -= 1;
    else break;
  }

  const headers = headersFrom(english, arabic, width);
  let nameCol = guessNameCol(headers, -1);
  const codeCol = guessCodeCol(headers, -1, nameCol);
  if (nameCol === codeCol) nameCol = -1;
  let signatureCol = guessSignatureCol(headers, [codeCol, nameCol]);
  if (signatureCol === codeCol || signatureCol === nameCol) signatureCol = -1;

  const rows = [];
  for (let i = dataStart; i < matrix.length; i += 1) {
    const cells = [];
    for (let c = 0; c < width; c += 1) cells.push(cellText(matrix[i][c]));
    if (!cells.some(Boolean) || isNoiseRow(cells)) continue;
    rows.push({ excelRow: excelRows[i], cells });
  }
  if (!rows.length) return null;

  const coded = codeCol >= 0 ? rows.filter((row) => sanitizeAidCode(row.cells[codeCol])).length : 0;
  const score = (codeCol >= 0 ? 20 : 0) + (signatureCol >= 0 ? 20 : 0) + Math.min(coded || rows.length, 40);

  return { headers, codeCol, nameCol, signatureCol, rows, score };
}

export async function readSignatureWorkbookFromBuffer(buffer, fileName = "pickup.xlsx") {
  const stored = cloneBytes(buffer);
  const ExcelJSModule = await import("exceljs");
  const ExcelJS = ExcelJSModule.default || ExcelJSModule;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(cloneBytes(stored));

  const sheets = [];
  workbook.eachSheet((sheet) => {
    const parsed = parseSheet(sheet);
    if (parsed) sheets.push({ sheetName: sheet.name, ...parsed });
  });
  if (!sheets.length) {
    throw new Error("This workbook has no data rows.");
  }

  let activeIndex = 0;
  sheets.forEach((sheet, index) => {
    if (sheet.score > sheets[activeIndex].score) activeIndex = index;
  });

  return {
    fileName,
    buffer: stored,
    sheets,
    activeIndex,
  };
}

export async function readSignatureWorkbook(file) {
  const name = String(file?.name || "");
  if (!/\.xlsx$/i.test(name)) {
    throw new Error("Use an .xlsx file so the original design stays intact. In Excel, choose Save As → Excel Workbook (.xlsx).");
  }
  const buffer = await file.arrayBuffer();
  return readSignatureWorkbookFromBuffer(buffer, file.name);
}

function signedFileName(name) {
  const raw = String(name || "pickup.xlsx");
  return `${raw.replace(/\.xlsx$/i, "")}-signed.xlsx`;
}

export function codesOnSheet(sheet, codeCol) {
  if (!sheet || codeCol < 0) return [];
  const seen = new Set();
  const codes = [];
  for (const row of sheet.rows || []) {
    const code = sanitizeAidCode(row.cells[codeCol]);
    const key = codeKey(code);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    codes.push(code);
  }
  return codes;
}

export function indexSignatureMatches(items) {
  const map = new Map();
  for (const item of items || []) {
    const key = codeKey(item?.code);
    if (key) map.set(key, item);
  }
  return map;
}

export async function buildSignedWorkbookBuffer(workbookFile, { sheetName, rows, codeCol, signatureCol, matches }) {
  if (codeCol < 0) throw new Error("Choose the pickup code column first.");
  if (signatureCol < 0) throw new Error("Choose the signature column first.");

  const ExcelJSModule = await import("exceljs");
  const ExcelJS = ExcelJSModule.default || ExcelJSModule;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(cloneBytes(workbookFile.buffer));
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new Error("That sheet is no longer in this file.");

  const column = sheet.getColumn(signatureCol + 1);
  if ((Number(column.width) || 0) < 18) column.width = 22;

  let stamped = 0;
  let missing = 0;

  for (const row of rows || []) {
    const key = codeKey(row.cells?.[codeCol]);
    if (!key) continue;
    const image = signatureImageParts(matches?.get(key)?.signature);
    if (!image) {
      missing += 1;
      continue;
    }
    const excelRow = sheet.getRow(row.excelRow);
    if ((Number(excelRow.height) || 0) < 36) excelRow.height = 42;
    excelRow.getCell(signatureCol + 1).value = null;
    const imageId = workbook.addImage({
      base64: image.base64,
      extension: image.extension,
    });
    sheet.addImage(imageId, {
      tl: { col: signatureCol + 0.06, row: row.excelRow - 1 + 0.12 },
      ext: { width: 128, height: 40 },
      editAs: "oneCell",
    });
    stamped += 1;
  }

  const fileName = signedFileName(workbookFile.fileName);
  const out = await workbook.xlsx.writeBuffer();
  return { fileName, stamped, missing, buffer: out };
}

export async function downloadSignedWorkbook(workbookFile, options) {
  const saved = await buildSignedWorkbookBuffer(workbookFile, options);
  const blob = new Blob([saved.buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = saved.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return { fileName: saved.fileName, stamped: saved.stamped, missing: saved.missing };
}
