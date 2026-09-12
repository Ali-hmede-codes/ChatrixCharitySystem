import { createJsonStore } from "../../infrastructure/json-file.js";

const MIN_WIDTH_MM = 40;
const MAX_WIDTH_MM = 120;
const DEFAULT_WIDTH_MM = 80;

function clampWidth(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_WIDTH_MM;
  return Math.min(MAX_WIDTH_MM, Math.max(MIN_WIDTH_MM, Math.round(n)));
}

export function createPrinterService(ctx) {
  const store = createJsonStore(ctx.config.PRINTER_SETTINGS_PATH, {
    paperWidthMm: DEFAULT_WIDTH_MM,
    headerText: "",
  });
  let settings = {
    paperWidthMm: DEFAULT_WIDTH_MM,
    headerText: "",
  };

  function load() {
    const raw = store.read();
    settings = {
      paperWidthMm: clampWidth(raw?.paperWidthMm),
      headerText: String(raw?.headerText || "").trim().slice(0, 80),
    };
    return settings;
  }

  async function write() {
    await store.write({
      paperWidthMm: settings.paperWidthMm,
      headerText: settings.headerText,
    });
  }

  function publicSettings() {
    return {
      paperWidthMm: settings.paperWidthMm,
      headerText: settings.headerText,
      minWidthMm: MIN_WIDTH_MM,
      maxWidthMm: MAX_WIDTH_MM,
      presets: [58, 80],
    };
  }

  function emit(socket) {
    const payload = publicSettings();
    if (socket) socket.emit("printer:settings", payload);
    else ctx.io.emit("printer:settings", payload);
  }

  async function save(payload, socket) {
    settings = {
      paperWidthMm: clampWidth(payload?.paperWidthMm ?? settings.paperWidthMm),
      headerText: String(payload?.headerText ?? settings.headerText).trim().slice(0, 80),
    };
    try {
      await write();
      emit();
      socket.emit(
        "printer:saved",
        `Receipt paper width saved at ${settings.paperWidthMm} mm. Choose your bills printer in the print dialog.`
      );
    } catch {
      socket.emit("printer:error", "Could not save receipt printer settings.");
    }
  }

  load();

  return {
    load,
    publicSettings,
    emit,
    save,
  };
}
