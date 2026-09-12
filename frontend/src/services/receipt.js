const DEFAULT_WIDTH_MM = 80;
const MIN_WIDTH_MM = 40;
const MAX_WIDTH_MM = 120;

export function clampPaperWidth(mm) {
  const n = Number(mm);
  if (!Number.isFinite(n)) return DEFAULT_WIDTH_MM;
  return Math.min(MAX_WIDTH_MM, Math.max(MIN_WIDTH_MM, Math.round(n)));
}

export function formatReceiptTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildReceiptHtml(receipt, settings = {}) {
  const widthMm = clampPaperWidth(settings.paperWidthMm || receipt.paperWidthMm || DEFAULT_WIDTH_MM);
  const header = String(settings.headerText || receipt.headerText || "").trim();
  const logoUrl = receipt.logoUrl || "";
  const name = escapeHtml(receipt.name || "Beneficiary");
  const aidId = escapeHtml(receipt.aidId || "—");
  const code = String(receipt.code || "").trim();
  const campaignName = escapeHtml(receipt.campaignName || "");
  const takenAt = formatReceiptTime(receipt.takenAt);
  const reprint = receipt.reprint ? `<div class="reprint">نسخة إعادة طباعة</div>` : "";

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>Aid ${aidId}</title>
  <style>
    @page { size: ${widthMm}mm auto; margin: 2mm; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #111;
      font-family: "Segoe UI", Tahoma, Arial, sans-serif;
    }
    .ticket {
      width: ${widthMm}mm;
      max-width: 100%;
      box-sizing: border-box;
      padding: 2mm 2.5mm 4mm;
      text-align: center;
    }
    .logo {
      max-width: 18mm;
      max-height: 18mm;
      margin: 0 auto 2mm;
      display: block;
    }
    .org {
      font-size: 11px;
      font-weight: 700;
      line-height: 1.3;
      margin-bottom: 2mm;
    }
    .title {
      font-size: 12px;
      font-weight: 800;
      margin: 0 0 2mm;
    }
    .rule {
      border: 0;
      border-top: 1px dashed #222;
      margin: 2mm 0;
    }
    .aid-label {
      font-size: 10px;
      letter-spacing: 0.4px;
      color: #333;
    }
    .aid-id {
      font-size: ${widthMm <= 58 ? 18 : 22}px;
      font-weight: 800;
      letter-spacing: 0.6px;
      font-family: "Cascadia Mono", "Consolas", "Courier New", monospace;
      direction: ltr;
      unicode-bidi: isolate;
      margin: 1mm 0 2mm;
    }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 2mm;
      text-align: right;
      font-size: 11px;
      line-height: 1.35;
      margin: 1.4mm 0;
    }
    .row span {
      color: #444;
      flex-shrink: 0;
    }
    .row strong {
      font-weight: 700;
      word-break: break-word;
    }
    .code {
      font-family: "Cascadia Mono", "Consolas", "Courier New", monospace;
      direction: ltr;
      unicode-bidi: isolate;
    }
    .foot {
      font-size: 9.5px;
      color: #333;
      line-height: 1.35;
    }
    .reprint {
      font-size: 10px;
      font-weight: 700;
      margin-top: 1.5mm;
    }
    .ok {
      font-size: 12px;
      font-weight: 800;
      margin-top: 2mm;
    }
  </style>
</head>
<body>
  <div class="ticket">
    ${logoUrl ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="" />` : ""}
    ${header ? `<div class="org">${escapeHtml(header)}</div>` : ""}
    <h1 class="title">إيصال استلام مساعدة</h1>
    <hr class="rule" />
    <div class="aid-label">رقم الإيصال · Aid ID</div>
    <div class="aid-id">${aidId}</div>
    <hr class="rule" />
    <div class="row"><span>الاسم</span><strong>${name}</strong></div>
    ${
      code
        ? `<div class="row"><span>الكود</span><strong class="code">${escapeHtml(code)}</strong></div>`
        : ""
    }
    ${campaignName ? `<div class="row"><span>الحملة</span><strong>${campaignName}</strong></div>` : ""}
    ${takenAt ? `<div class="row"><span>التاريخ</span><strong dir="ltr">${escapeHtml(takenAt)}</strong></div>` : ""}
    <hr class="rule" />
    <div class="ok">تم الاستلام ✓</div>
    ${reprint}
    <div class="foot">احتفظوا بهذا الإيصال</div>
  </div>
</body>
</html>`;
}

export function printReceipt(receipt, settings = {}) {
  if (!receipt?.aidId) return false;
  const html = buildReceiptHtml(receipt, settings);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) {
    iframe.remove();
    return false;
  }

  doc.open();
  doc.write(html);
  doc.close();

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    window.setTimeout(() => iframe.remove(), 400);
  };

  const runPrint = () => {
    try {
      win.addEventListener("afterprint", cleanup);
      win.focus();
      win.print();
    } catch {
      cleanup();
    }
  };

  window.setTimeout(cleanup, 60_000);

  const images = Array.from(doc.images || []);
  if (images.length === 0) {
    window.setTimeout(runPrint, 40);
    return true;
  }

  Promise.all(
    images.map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => resolve();
        })
    )
  ).then(() => window.setTimeout(runPrint, 40));
  return true;
}

export function sampleReceipt(overrides = {}) {
  return {
    aidId: "260911-0001",
    name: "أحمد محمد",
    code: "AID-0926",
    campaignName: "حملة توزيع",
    campaignDate: Date.now(),
    takenAt: Date.now(),
    reprint: false,
    printCount: 1,
    logoUrl: "",
    headerText: "",
    ...overrides,
  };
}
