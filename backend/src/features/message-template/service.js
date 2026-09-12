import { createJsonStore } from "../../infrastructure/json-file.js";
import { applyCodePlaceholder, applyPersonNameTemplate } from "../../shared/names.js";

export function createMessageTemplateService(ctx) {
  const { DEFAULT_NAME_TEMPLATE, MESSAGE_SETTINGS_PATH } = ctx.config;
  const store = createJsonStore(MESSAGE_SETTINGS_PATH, {
    useNameTemplate: false,
    template: DEFAULT_NAME_TEMPLATE,
  });

  let settings = { useNameTemplate: false, template: DEFAULT_NAME_TEMPLATE };

  function load() {
    const raw = store.read();
    const template = String(raw?.template || "").trim() || DEFAULT_NAME_TEMPLATE;
    settings = {
      useNameTemplate: Boolean(raw?.useNameTemplate),
      template: template.slice(0, 500),
    };
    return settings;
  }

  async function write() {
    await store.write({
      useNameTemplate: Boolean(settings.useNameTemplate),
      template: settings.template,
    });
  }

  function publicSettings() {
    return {
      useNameTemplate: Boolean(settings.useNameTemplate),
      template: settings.template || DEFAULT_NAME_TEMPLATE,
    };
  }

  function emit(socket) {
    const payload = publicSettings();
    if (socket) socket.emit("message:settings", payload);
    else ctx.io.emit("message:settings", payload);
  }

  function buildRecipientMessage(names, body, extras = {}) {
    const bodyText = String(body || "").trim();
    const nameList = Array.isArray(names) ? names.filter(Boolean) : [];
    let result = bodyText;

    const useNameTemplate = Boolean(extras.useNameTemplate);
    if (useNameTemplate) {
      const template =
        String(extras.nameTemplate || settings.template || DEFAULT_NAME_TEMPLATE).trim() ||
        DEFAULT_NAME_TEMPLATE;
      if (nameList.length) {
        const greetings = nameList
          .map((name) => applyPersonNameTemplate(template, name).trim())
          .filter(Boolean);
        const greetingBlock = greetings.join("\n");
        if (!bodyText) result = greetingBlock;
        else if (/\[PersonName\]/i.test(bodyText)) {
          result = nameList
            .map((name) => applyPersonNameTemplate(bodyText, name).trim())
            .filter(Boolean)
            .join("\n\n");
        } else {
          result = greetingBlock + "\n\n" + bodyText;
        }
      }
    } else if (nameList.length && /\[PersonName\]/i.test(bodyText)) {
      result = nameList
        .map((name) => applyPersonNameTemplate(bodyText, name).trim())
        .filter(Boolean)
        .join("\n\n");
    }

    return applyCodePlaceholder(result, extras.code);
  }

  async function save(payload, socket) {
    const useNameTemplate = Boolean(payload?.useNameTemplate);
    const template = String(payload?.template || "").trim() || DEFAULT_NAME_TEMPLATE;
    if (useNameTemplate && !/\[PersonName\]/i.test(template)) {
      socket.emit("message:error", "Add [PersonName] in the template, for example: مرحبا [PersonName]");
      return;
    }
    settings = {
      useNameTemplate,
      template: template.slice(0, 500),
    };
    try {
      await write();
      emit();
      socket.emit(
        "message:saved",
        useNameTemplate
          ? "Name template is on. Shared numbers get a greeting for each person, then one send."
          : "Name template is off. The typed message is sent as-is."
      );
    } catch {
      socket.emit("message:error", "Could not save the message template.");
    }
  }

  load();

  return {
    load,
    publicSettings,
    emit,
    save,
    buildRecipientMessage,
    usesNameTemplate: () => Boolean(settings.useNameTemplate),
  };
}
