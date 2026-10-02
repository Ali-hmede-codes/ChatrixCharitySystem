// Patch an .xlsx (a zip of XML) by adding signature pictures only.
// Rewriting the workbook with ExcelJS drops the logo, print setup, merges,
// borders, and column widths, so unchanged parts are copied as-is.

const DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const DRAWINGML_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PX_TO_EMU = 9525;
const PT_TO_EMU = 12700;

function u16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function putU16(bytes, offset, value) {
  bytes[offset] = value & 255;
  bytes[offset + 1] = (value >>> 8) & 255;
}

function putU32(bytes, offset, value) {
  bytes[offset] = value & 255;
  bytes[offset + 1] = (value >>> 8) & 255;
  bytes[offset + 2] = (value >>> 16) & 255;
  bytes[offset + 3] = (value >>> 24) & 255;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function findEocd(bytes) {
  const min = Math.max(0, bytes.length - (22 + 65535));
  for (let i = bytes.length - 22; i >= min; i -= 1) {
    if (u32(bytes, i) !== 0x06054b50) continue;
    if (i + 22 + u16(bytes, i + 20) === bytes.length) return i;
  }
  throw new Error("This Excel file could not be updated.");
}

export function readZip(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const eocd = findEocd(bytes);
  const count = u16(bytes, eocd + 10);
  const cdOffset = u32(bytes, eocd + 16);
  if (cdOffset === 0xffffffff) throw new Error("This Excel file is too large to update.");

  const entries = [];
  let cursor = cdOffset;
  for (let index = 0; index < count; index += 1) {
    if (u32(bytes, cursor) !== 0x02014b50) throw new Error("This Excel file could not be updated.");
    const versionNeeded = u16(bytes, cursor + 6);
    const flag = u16(bytes, cursor + 8);
    const method = u16(bytes, cursor + 10);
    const dosTime = u16(bytes, cursor + 12);
    const dosDate = u16(bytes, cursor + 14);
    const crc = u32(bytes, cursor + 16);
    const compressedSize = u32(bytes, cursor + 20);
    const uncompressedSize = u32(bytes, cursor + 24);
    const nameLength = u16(bytes, cursor + 28);
    const extraLength = u16(bytes, cursor + 30);
    const commentLength = u16(bytes, cursor + 32);
    const localOffset = u32(bytes, cursor + 42);
    const name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    const localNameLength = u16(bytes, localOffset + 26);
    const localExtraLength = u16(bytes, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({
      name,
      versionNeeded,
      flag: flag & ~8,
      method,
      dosTime,
      dosDate,
      crc,
      compressed: bytes.slice(dataStart, dataStart + compressedSize),
      uncompressedSize,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function entryBytes(entry) {
  if (entry.uncompressed) return entry.uncompressed;
  if (entry.method === 0) return entry.compressed;
  return inflateRaw(entry.compressed);
}

async function entryText(entry) {
  return new TextDecoder("utf-8").decode(await entryBytes(entry));
}

function dosNow() {
  const date = new Date();
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

async function materialize(entry) {
  if (!entry.uncompressed) return entry;
  const raw = entry.uncompressed;
  const crc = crc32(raw);
  const stored = entry.method === 0;
  const compressed = stored ? raw : await deflateRaw(raw);
  const when = dosNow();
  return {
    name: entry.name,
    versionNeeded: 20,
    flag: 0,
    method: stored ? 0 : 8,
    dosTime: when.dosTime,
    dosDate: when.dosDate,
    crc,
    compressed,
    uncompressedSize: raw.length,
  };
}

async function writeZip(entries) {
  const ready = [];
  for (const entry of entries) ready.push(await materialize(entry));

  const locals = [];
  const central = [];
  let offset = 0;
  for (const entry of ready) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const local = new Uint8Array(30 + nameBytes.length + entry.compressed.length);
    putU32(local, 0, 0x04034b50);
    putU16(local, 4, entry.versionNeeded || 20);
    putU16(local, 6, entry.flag || 0);
    putU16(local, 8, entry.method || 0);
    putU16(local, 10, entry.dosTime || 0);
    putU16(local, 12, entry.dosDate || 0);
    putU32(local, 14, entry.crc);
    putU32(local, 18, entry.compressed.length);
    putU32(local, 22, entry.uncompressedSize);
    putU16(local, 26, nameBytes.length);
    putU16(local, 28, 0);
    local.set(nameBytes, 30);
    local.set(entry.compressed, 30 + nameBytes.length);
    locals.push(local);

    const cd = new Uint8Array(46 + nameBytes.length);
    putU32(cd, 0, 0x02014b50);
    putU16(cd, 4, 20);
    putU16(cd, 6, entry.versionNeeded || 20);
    putU16(cd, 8, entry.flag || 0);
    putU16(cd, 10, entry.method || 0);
    putU16(cd, 12, entry.dosTime || 0);
    putU16(cd, 14, entry.dosDate || 0);
    putU32(cd, 16, entry.crc);
    putU32(cd, 20, entry.compressed.length);
    putU32(cd, 24, entry.uncompressedSize);
    putU16(cd, 28, nameBytes.length);
    putU16(cd, 30, 0);
    putU16(cd, 32, 0);
    putU16(cd, 34, 0);
    putU16(cd, 36, 0);
    putU32(cd, 38, 0);
    putU32(cd, 42, offset);
    cd.set(nameBytes, 46);
    central.push(cd);
    offset += local.length;
  }

  const cdBytes = concat(central);
  const eocd = new Uint8Array(22);
  putU32(eocd, 0, 0x06054b50);
  putU16(eocd, 8, ready.length);
  putU16(eocd, 10, ready.length);
  putU32(eocd, 12, cdBytes.length);
  putU32(eocd, 16, offset);
  return concat([...locals, cdBytes, eocd]);
}

function findEntry(entries, name) {
  return entries.find((entry) => entry.name === name) || null;
}

function replaceText(entries, name, text) {
  const bytes = new TextEncoder().encode(text);
  const existing = findEntry(entries, name);
  const next = { name, uncompressed: bytes, method: 8 };
  if (existing) {
    const index = entries.indexOf(existing);
    entries[index] = next;
  } else {
    entries.push(next);
  }
}

function addStored(entries, name, bytes) {
  entries.push({ name, uncompressed: bytes, method: 0 });
}

function attr(tag, name) {
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(tag).match(new RegExp(`${safe}="([^"]*)"`));
  return match ? match[1] : "";
}

function decodeXml(text) {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function xmlEscape(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolvePart(baseDir, target) {
  const stack = String(baseDir || "")
    .split("/")
    .filter(Boolean);
  for (const part of String(target || "").replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function relationships(xml) {
  const found = [];
  const re = /<Relationship\b[^>]*\/>/g;
  let match = re.exec(xml);
  while (match) {
    found.push({
      id: attr(match[0], "Id"),
      type: attr(match[0], "Type"),
      target: attr(match[0], "Target"),
    });
    match = re.exec(xml);
  }
  return found;
}

function nextRid(xml) {
  let max = 0;
  const re = /Id="rId(\d+)"/g;
  let match = re.exec(xml || "");
  while (match) {
    max = Math.max(max, Number(match[1]));
    match = re.exec(xml);
  }
  return max + 1;
}

function prefixFor(xml, uri, fallback) {
  const escaped = uri.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefixed = xml.match(new RegExp(`xmlns:([A-Za-z0-9]+)="${escaped}"`));
  if (prefixed) return `${prefixed[1]}:`;
  if (xml.includes(`xmlns="${uri}"`)) return "";
  return fallback;
}

function columnWidthPx(sheetXml, colIndex) {
  const colNumber = colIndex + 1;
  let width = 12;
  const re = /<col\b[^>]*\/>/g;
  let match = re.exec(sheetXml);
  while (match) {
    const min = Number(attr(match[0], "min"));
    const max = Number(attr(match[0], "max") || min);
    const value = Number(attr(match[0], "width"));
    if (colNumber >= min && colNumber <= max && value) width = value;
    match = re.exec(sheetXml);
  }
  return Math.max(48, Math.floor(((256 * width + Math.floor(128 / 7)) / 256) * 7));
}

function rowHeightPt(sheetXml, excelRow) {
  const match = sheetXml.match(new RegExp(`<row\\b[^>]*\\br="${excelRow}"[^>]*>`));
  if (match) {
    const height = Number(attr(match[0], "ht"));
    if (height) return height;
  }
  const fallback = sheetXml.match(/defaultRowHeight="([0-9.]+)"/);
  return fallback ? Number(fallback[1]) : 18;
}

function ensureRowHeight(sheetXml, excelRow, minPt) {
  const match = sheetXml.match(new RegExp(`<row\\b[^>]*\\br="${excelRow}"[^>]*/?>`));
  if (!match) return sheetXml;
  const tag = match[0];
  const current = Number(attr(tag, "ht")) || 0;
  if (current >= minPt) return sheetXml;
  const selfClosing = tag.endsWith("/>");
  let attrs = tag.slice(4, selfClosing ? -2 : -1);
  if (/\bht="/.test(attrs)) attrs = attrs.replace(/\bht="[0-9.]+"/, `ht="${minPt}"`);
  else attrs += ` ht="${minPt}"`;
  if (!/\bcustomHeight="/.test(attrs)) attrs += ' customHeight="1"';
  return sheetXml.replace(tag, `<row${attrs}${selfClosing ? "/>" : ">"}`);
}

function contentType(xml, extension, mime) {
  if (new RegExp(`Extension="${extension}"`, "i").test(xml)) return xml;
  return xml.replace("</Types>", `<Default Extension="${extension}" ContentType="${mime}"/></Types>`);
}

function ensureOverride(xml, partName, mime) {
  if (xml.includes(`PartName="${partName}"`)) return xml;
  return xml.replace("</Types>", `<Override PartName="${partName}" ContentType="${mime}"/></Types>`);
}

function anchorXml({ xdr, a, id, relId, col, row, cx, cy, colOff, rowOff }) {
  return (
    `<${xdr}oneCellAnchor>` +
    `<${xdr}from><${xdr}col>${col}</${xdr}col><${xdr}colOff>${colOff}</${xdr}colOff>` +
    `<${xdr}row>${row}</${xdr}row><${xdr}rowOff>${rowOff}</${xdr}rowOff></${xdr}from>` +
    `<${xdr}ext cx="${cx}" cy="${cy}"/>` +
    `<${xdr}pic><${xdr}nvPicPr><${xdr}cNvPr id="${id}" name="Signature ${id}"/>` +
    `<${xdr}cNvPicPr><${a}picLocks noChangeAspect="1"/></${xdr}cNvPicPr></${xdr}nvPicPr>` +
    `<${xdr}blipFill><${a}blip xmlns:r="${OFFICE_REL}" r:embed="${relId}"/>` +
    `<${a}stretch><${a}fillRect/></${a}stretch></${xdr}blipFill>` +
    `<${xdr}spPr><${a}xfrm><${a}off x="0" y="0"/><${a}ext cx="${cx}" cy="${cy}"/></${a}xfrm>` +
    `<${a}prstGeom prst="rect"><${a}avLst/></${a}prstGeom></${xdr}spPr></${xdr}pic>` +
    `<${xdr}clientData/></${xdr}oneCellAnchor>`
  );
}

function blankDrawing() {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<xdr:wsDr xmlns:xdr="${DRAWING_NS}" xmlns:a="${DRAWINGML_NS}"></xdr:wsDr>`
  );
}

function blankRels(body) {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="${REL_NS}">${body}</Relationships>`
  );
}

export async function stampSignaturesOnXlsx(buffer, { sheetName, images }) {
  const list = Array.isArray(images) ? images.filter((image) => image?.bytes?.length) : [];
  if (!list.length) return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  const entries = readZip(buffer);
  const workbookEntry = findEntry(entries, "xl/workbook.xml");
  const workbookRelsEntry = findEntry(entries, "xl/_rels/workbook.xml.rels");
  if (!workbookEntry || !workbookRelsEntry) throw new Error("This Excel file has no workbook.");

  const workbookXml = await entryText(workbookEntry);
  const workbookRelsXml = await entryText(workbookRelsEntry);
  const sheetTags = workbookXml.match(/<sheet\b[^>]*>/g) || [];
  const sheetTag = sheetTags.find((tag) => decodeXml(attr(tag, "name")) === sheetName);
  if (!sheetTag) throw new Error("That sheet is no longer in this file.");
  const sheetRid = attr(sheetTag, "r:id");
  const sheetRel = relationships(workbookRelsXml).find((rel) => rel.id === sheetRid);
  if (!sheetRel) throw new Error("That sheet is no longer in this file.");
  const sheetPath = resolvePart("xl", decodeXml(sheetRel.target));
  const sheetEntry = findEntry(entries, sheetPath);
  if (!sheetEntry) throw new Error("That sheet is no longer in this file.");

  let sheetXml = await entryText(sheetEntry);
  const sheetDir = sheetPath.slice(0, sheetPath.lastIndexOf("/"));
  const relsPath = `${sheetDir}/_rels/${sheetPath.slice(sheetPath.lastIndexOf("/") + 1)}.rels`;
  const relsEntry = findEntry(entries, relsPath);
  let relsXml = relsEntry ? await entryText(relsEntry) : blankRels("");
  const sheetRels = relationships(relsXml);
  let drawingRel = sheetRels.find((rel) => /\/drawing$/.test(rel.type));

  let drawingPath = "";
  let drawingXml = "";
  let drawingRelsPath = "";
  let drawingRelsXml = "";

  if (drawingRel) {
    drawingPath = resolvePart(sheetDir, decodeXml(drawingRel.target));
    const drawingEntry = findEntry(entries, drawingPath);
    if (!drawingEntry) throw new Error("The sheet drawing could not be read.");
    drawingXml = await entryText(drawingEntry);
    drawingRelsPath = `${drawingPath.slice(0, drawingPath.lastIndexOf("/"))}/_rels/${drawingPath.slice(drawingPath.lastIndexOf("/") + 1)}.rels`;
    const drawingRelsEntry = findEntry(entries, drawingRelsPath);
    drawingRelsXml = drawingRelsEntry ? await entryText(drawingRelsEntry) : blankRels("");
  } else {
    let drawingIndex = 1;
    while (findEntry(entries, `xl/drawings/drawing${drawingIndex}.xml`)) drawingIndex += 1;
    drawingPath = `xl/drawings/drawing${drawingIndex}.xml`;
    drawingXml = blankDrawing();
    drawingRelsPath = `xl/drawings/_rels/drawing${drawingIndex}.xml.rels`;
    drawingRelsXml = blankRels("");
    const rid = `rId${nextRid(relsXml)}`;
    const target = `../drawings/drawing${drawingIndex}.xml`;
    const relationship = `<Relationship Id="${rid}" Type="${OFFICE_REL}/drawing" Target="${target}"/>`;
    relsXml = relsXml.includes("</Relationships>")
      ? relsXml.replace("</Relationships>", `${relationship}</Relationships>`)
      : blankRels(relationship);
    if (!/<drawing\b/.test(sheetXml)) {
      sheetXml = sheetXml.replace("</worksheet>", `<drawing r:id="${rid}"/></worksheet>`);
    }
    replaceText(entries, relsPath, relsXml);
    let types = await entryText(findEntry(entries, "[Content_Types].xml"));
    types = ensureOverride(
      types,
      `/${drawingPath}`,
      "application/vnd.openxmlformats-officedocument.drawing+xml"
    );
    replaceText(entries, "[Content_Types].xml", types);
  }

  const xdr = prefixFor(drawingXml, DRAWING_NS, "xdr:");
  const a = prefixFor(drawingXml, DRAWINGML_NS, "a:");
  let picId = 1;
  const idRe = /<(?:[\w]+:)?cNvPr\b[^>]*\bid="(\d+)"/g;
  let idMatch = idRe.exec(drawingXml);
  while (idMatch) {
    picId = Math.max(picId, Number(idMatch[1]) + 1);
    idMatch = idRe.exec(drawingXml);
  }
  let relNumber = nextRid(drawingRelsXml);
  const anchors = [];
  const seen = new Map();

  for (const image of list) {
    const excelRow = image.row + 1;
    sheetXml = ensureRowHeight(sheetXml, excelRow, 30);
    const signature = `${image.bytes.length}:${crc32(image.bytes)}`;
    const extension = image.extension === "png" ? "png" : "jpeg";
    let relId = seen.get(signature);
    if (!relId) {
      const mediaName = `xl/media/signature${relNumber}.${extension}`;
      addStored(entries, mediaName, image.bytes);
      relId = `rId${relNumber}`;
      relNumber += 1;
      const target = `../media/${mediaName.slice("xl/media/".length)}`;
      const relationship = `<Relationship Id="${relId}" Type="${OFFICE_REL}/image" Target="${xmlEscape(target)}"/>`;
      drawingRelsXml = drawingRelsXml.includes("</Relationships>")
        ? drawingRelsXml.replace("</Relationships>", `${relationship}</Relationships>`)
        : blankRels(relationship);
      seen.set(signature, relId);
    }

    const heightPt = Math.max(rowHeightPt(sheetXml, excelRow), 30);
    const widthPx = columnWidthPx(sheetXml, image.col);
    const colOff = 3 * PX_TO_EMU;
    const rowOff = Math.round(1.5 * PT_TO_EMU);
    const cx = Math.max(180000, (widthPx - 8) * PX_TO_EMU);
    const cy = Math.max(140000, Math.round((heightPt - 4) * PT_TO_EMU));
    anchors.push(
      anchorXml({
        xdr,
        a,
        id: picId,
        relId,
        col: image.col,
        row: image.row,
        cx,
        cy,
        colOff,
        rowOff,
      })
    );
    picId += 1;
  }

  const close = `</${xdr}wsDr>`;
  if (!drawingXml.includes(close)) throw new Error("The sheet drawing could not be updated.");
  drawingXml = drawingXml.replace(close, anchors.join("") + close);

  const originalSheet = await entryText(sheetEntry);
  if (sheetXml !== originalSheet) replaceText(entries, sheetPath, sheetXml);
  replaceText(entries, drawingPath, drawingXml);
  replaceText(entries, drawingRelsPath, drawingRelsXml);

  const typesEntry = findEntry(entries, "[Content_Types].xml");
  const originalTypes = await entryText(typesEntry);
  let types = originalTypes;
  if (list.some((image) => image.extension !== "png")) types = contentType(types, "jpeg", "image/jpeg");
  if (list.some((image) => image.extension === "png")) types = contentType(types, "png", "image/png");
  if (types !== originalTypes) replaceText(entries, "[Content_Types].xml", types);

  return writeZip(entries);
}
