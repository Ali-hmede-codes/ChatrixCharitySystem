import * as XLSX from "xlsx";
import { formatPhone, normalizePhone, toWhatsAppDigits } from "./phone.js";
import { signatureImageParts } from "./signature.js";

export function cellText(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Math.abs(value) >= 1e16) return String(value);
    return String(Math.trunc(value));
  }
  const text = String(value).replace(/\s+/g, " ").trim();
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(text)) {
    const n = Number(text);
    if (Number.isFinite(n) && Math.abs(n) < 1e16) return String(Math.trunc(n));
  }
  return text;
}

export function headerLooksLikePhone(header) {
  return /phone|mobile|whatsapp|whats.?app|cell|msisdn|جوال|هاتف|موبايل|تلفون|ارقام/i.test(
    String(header || "")
  );
}

export function headerLooksLikeNationality(header) {
  return /nationality|جنسية|national/i.test(String(header || ""));
}

export function headerLooksLikeCode(header) {
  const text = String(header || "");
  if (headerLooksLikePhone(text)) return false;
  if (headerLooksLikeNationality(text)) return false;
  if (/head of hous|household|recipient|name|اسم|مسؤول|مستلم|الاسم|جنسية/i.test(text) && !/كود|code/i.test(text)) {
    return false;
  }
  if (/postal|zip|بريد/i.test(text)) return false;
  return /(?:^|[\s\/_(-])(code|pin|voucher|coupon|token|كود)(?:$|[\s\/_)-])|aid.?code|pickup.?code|رقم.?الكود|كود.?الاستلام|رمز.?الاستلام/i.test(
    text
  );
}

export function headerRowScore(row) {
  let score = 0;
  for (const cell of row || []) {
    const text = cellText(cell);
    if (headerLooksLikePhone(text)) score += 10;
    if (headerLooksLikeNationality(text)) score += 4;
    if (headerLooksLikeCode(text)) score += 4;
    if (/head of hous|household|recipient|name|اسم|مسؤول|مستلم|الاسم/i.test(text)) score += 3;
    if (/food kit|hygiene|signature|توقيع|حصة|kit/i.test(text)) score += 1;
  }
  return score;
}

export function findHeaderIndex(rows) {
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i += 1) {
    const score = headerRowScore(rows[i] || []);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= 8 ? best : 0;
}

export function isNoiseRow(row) {
  const line = row.map(cellText).join(" ").trim();
  if (!line) return true;
  if (/^(total|مجموع|count|عدد|signature|توقيع|page|صفحة)\b/i.test(line)) return true;
  return false;
}

export function guessPhoneCol(headers, rows) {
  let best = 0;
  let bestScore = -1;
  headers.forEach((header, index) => {
    let score = headerLooksLikePhone(header) ? 80 : 0;
    for (const row of rows) {
      if (normalizePhone(row[index])) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}

export function guessNameCol(headers, phoneIndex) {
  let best = -1;
  let bestScore = -1;
  headers.forEach((header, index) => {
    if (index === phoneIndex) return;
    const text = String(header || "");
    let score = 0;
    if (/head of hous|household|مسؤول|رب الاسرة/i.test(text)) score += 5;
    else if (/recipient|مستلم/i.test(text)) score += 3;
    else if (/name|اسم/i.test(text)) score += 2;
    if (headerLooksLikeCode(text)) score -= 4;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return bestScore > 0 ? best : -1;
}

export function guessCodeCol(headers, phoneIndex, nameIndex) {
  let best = -1;
  let bestScore = 0;
  headers.forEach((header, index) => {
    if (index === phoneIndex || index === nameIndex) return;
    let score = headerLooksLikeCode(header) ? 10 : 0;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return bestScore >= 10 ? best : -1;
}

export function getColumnStats(rows, index) {
  let hits = 0;
  let invalid = 0;
  let lebanon = 0;
  let syria = 0;
  const samples = [];
  const invalidSamples = [];
  for (const row of rows || []) {
    const raw = row[index];
    const digits = toWhatsAppDigits(raw);
    if (digits) {
      hits += 1;
      if (digits.startsWith("963")) syria += 1;
      else lebanon += 1;
      if (samples.length < 2) samples.push(formatPhone(digits));
      continue;
    }
    if (String(raw ?? "").trim()) {
      invalid += 1;
      if (invalidSamples.length < 2) invalidSamples.push(String(raw).trim());
    }
  }
  return { hits, invalid, lebanon, syria, samples, invalidSamples };
}

export async function parseSpreadsheet(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("This file has no sheets.");
  }
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) {
    throw new Error("Cannot read the first sheet.");
  }

  const rawRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    blankrows: true,
    defval: "",
  });

  const rows = rawRows.map((row) => (Array.isArray(row) ? row.map(cellText) : []));
  if (!rows.some((row) => row.some((cell) => cell))) {
    throw new Error("This sheet is empty.");
  }

  const headerIndex = findHeaderIndex(rows);
  const english = rows[headerIndex] || [];
  let dataStart = headerIndex + 1;
  if (rows[dataStart] && headerRowScore(rows[dataStart]) >= 8) {
    dataStart += 1;
  }
  const arabic = dataStart === headerIndex + 2 ? rows[headerIndex + 1] : [];

  let width = Math.max(
    english.length,
    arabic.length,
    ...rows.slice(dataStart).map((row) => row.length),
    1
  );

  while (width > 1) {
    const last = width - 1;
    const headerEmpty = !cellText(english[last]) && !cellText(arabic[last]);
    const dataEmpty = rows.slice(dataStart).every((row) => !cellText(row[last]));
    if (headerEmpty && dataEmpty) width -= 1;
    else break;
  }

  const headers = [];
  for (let i = 0; i < width; i += 1) {
    const top = cellText(english[i]);
    const bottom = cellText(arabic[i]);
    if (top && bottom && top !== bottom) headers.push(`${top} / ${bottom}`);
    else headers.push(top || bottom || `Column ${i + 1}`);
  }

  const origin = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]).s.r : 0;
  const dataRows = rows
    .slice(dataStart)
    .map((row) => {
      const next = [];
      for (let i = 0; i < width; i += 1) next.push(cellText(row[i]));
      return next;
    })
    .filter((row) => row.some((cell) => cell) && !isNoiseRow(row));

  if (!dataRows.length) {
    throw new Error("No data rows found below the header row.");
  }

  const nationalityCol = headers.findIndex((h) => headerLooksLikeNationality(h));

  return {
    headers,
    rows: dataRows,
    fileName: file.name,
    headerRow: origin + headerIndex + 1,
    nationalityCol,
  };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function campaignDayKey(ts) {
  const d = new Date(Number(ts) || Date.now());
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

export function formatCampaignDay(dayKey) {
  const digits = String(dayKey || "").replace(/\D/g, "");
  if (digits.length !== 8) return "";
  const y = Number(digits.slice(0, 4));
  const m = Number(digits.slice(4, 6));
  const d = Number(digits.slice(6, 8));
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return digits;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function dayKeyToInputValue(dayKey) {
  const digits = String(dayKey || "").replace(/\D/g, "");
  if (digits.length !== 8) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

export function inputValueToDayKey(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 8 ? digits : "";
}

export function formatSheetDateTime(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export async function downloadCollectedExcel(rows, { campaignDay, campaignName, status = "taken" } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const wantStatus = status === "pending" || status === "all" ? status : "taken";

  const columns = [
    { key: "aidId", header: "Aid ID", width: 14 },
    { key: "name", header: "Name", width: 28 },
    { key: "phone", header: "Phone", width: 18 },
    { key: "code", header: "Pickup code", width: 14 },
    { key: "campaign", header: "Campaign", width: 28 },
    { key: "campaignDate", header: "Campaign date", width: 14 },
    { key: "collectedAt", header: "Collected at", width: 18 },
    { key: "printCount", header: "Print count", width: 12 },
    { key: "status", header: "Status", width: 14 },
    { key: "signature", header: "Signature", width: 22 },
  ];

  const buildRow = (row) => ({
    aidId: row.takenAidId || "",
    name: row.name || row.personName || "",
    phone: row.phone || "",
    code: row.code || "",
    campaign: row.campaignName || "",
    campaignDate:
      formatSheetDateTime(row.campaignDate).slice(0, 10) || formatCampaignDay(campaignDay),
    collectedAt: formatSheetDateTime(row.takenAt),
    printCount: row.printCount || 0,
    status: row.takenAt ? "Collected" : "Not collected",
    signature: row.takenAt ? row.signature || "" : "",
  });

  const sheetRows = list.map(buildRow);
  const ExcelJSModule = await import("exceljs");
  const ExcelJS = ExcelJSModule.default || ExcelJSModule;
  const workbook = new ExcelJS.Workbook();
  const sheetName =
    wantStatus === "taken" ? "Collected" : wantStatus === "pending" ? "Not collected" : "Aid";
  const sheet = workbook.addWorksheet(String(sheetName).slice(0, 31));

  sheet.columns = columns.map((c) => ({
    key: c.key,
    header: c.header,
    width: c.width,
  }));

  const headerRow = sheet.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF305496" } };
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
    cell.alignment = { horizontal: "left", vertical: "middle" };
  });

  const sigColIndex = columns.findIndex((c) => c.key === "signature");

  sheetRows.forEach((r, idx) => {
    const excelRow = sheet.addRow({
      aidId: r.aidId,
      name: r.name,
      phone: r.phone,
      code: r.code,
      campaign: r.campaign,
      campaignDate: r.campaignDate,
      collectedAt: r.collectedAt,
      printCount: r.printCount,
      status: r.status,
      signature: "",
    });
    const image = signatureImageParts(r.signature);
    if (image && sigColIndex >= 0) {
      excelRow.height = 38;
      const imageId = workbook.addImage({
        base64: image.base64,
        extension: image.extension,
      });
      sheet.addImage(imageId, {
        tl: { col: sigColIndex, row: idx + 1 },
        ext: { width: 140, height: 46 },
        editAs: "oneCell",
      });
    }
    if (wantStatus === "all" && !r.collectedAt) {
      excelRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } };
        cell.font = { color: { argb: "FF9C0006" } };
      });
    }
  });

  const prefix =
    wantStatus === "taken"
      ? "collected-aid"
      : wantStatus === "pending"
        ? "not-collected-aid"
        : "all-aid";
  const dayPart = campaignDay && campaignDay !== "all" ? campaignDay : "all-dates";
  const campPart = campaignName
    ? `-${String(campaignName).replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 40)}`
    : "";
  const fileName = `${prefix}-${dayPart}${campPart}.xlsx`;

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return { fileName, count: list.length, status: wantStatus };
}
