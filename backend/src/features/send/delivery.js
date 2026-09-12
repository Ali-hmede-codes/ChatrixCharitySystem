import { plusPhone } from "../../shared/phone.js";

export function createDeliveryTracker(ctx) {
  const outboundById = new Map();
  const deliveryBatches = new Map();

  function summarizeBatch(batch) {
    let delivered = 0;
    let waiting = 0;
    let undelivered = 0;
    let smsSent = 0;
    let smsFailed = 0;
    let smsQueued = 0;
    for (const item of batch.items) {
      if (item.status === "delivered") delivered += 1;
      else if (item.status === "sms-sent") {
        undelivered += 1;
        smsSent += 1;
      } else if (item.status === "sms-failed") {
        undelivered += 1;
        smsFailed += 1;
      } else if (item.status === "sms-queued" || item.status === "undelivered") {
        undelivered += 1;
        smsQueued += 1;
      } else waiting += 1;
    }
    return {
      batchId: batch.id,
      campaignId: batch.campaignId || null,
      enableSms: Boolean(batch.enableSms),
      total: batch.items.length,
      delivered,
      waiting,
      undelivered,
      smsSent,
      smsFailed,
      smsQueued,
      done: waiting === 0,
      smsEnabled: Boolean(ctx.services.sms?.isEnabled?.()),
      smsReady: Boolean(ctx.services.sms?.ready?.()),
    };
  }

  function emitDelivery(item, batch, state, detail) {
    ctx.io.emit("delivery:update", {
      phone: plusPhone(item.phone),
      state,
      detail,
      summary: summarizeBatch(batch),
    });
  }

  async function queueSmsFallback(item, batch, reason) {
    if (batch.enableSms === false) {
      return { ok: false, reason: "campaign_sms_disabled", skipped: true };
    }
    if (item.settled || item.delivered) return { ok: false, reason: "already_settled", skipped: true };
    item.smsReason = reason;
    const fallbacks = ctx.channels.ready("fallback");
    const sms = fallbacks.find((channel) => channel.id === "sms") || fallbacks[0];
    if (!sms) return { ok: false, reason: "not_ready", skipped: true };
    return sms.send({ phone: item.phone, text: item.text || batch.message });
  }

  function settleItem(batch, item, status, detail) {
    if (!batch || !item || item.settled) return;
    item.settled = true;
    item.status = status;
    if (item.timer) {
      clearTimeout(item.timer);
      item.timer = null;
    }
    batch.pending = Math.max(0, batch.pending - 1);
    emitDelivery(item, batch, status, detail);

    if (batch.campaignId && ctx.services.campaigns) {
      const channel = status === "sms-sent" ? "sms" : status === "delivered" ? "whatsapp" : "none";
      ctx.services.campaigns.updateRecipient(batch.campaignId, {
        phone: item.phone,
        state: status,
        channel,
        detail,
      });
      ctx.services.campaigns.syncBatchStats(batch.campaignId, summarizeBatch(batch));
    }

    if (batch.pending === 0) {
      ctx.io.emit("delivery:done", summarizeBatch(batch));
    }
  }

  function markDeliveredByMessageId(messageId) {
    if (!messageId) return;
    const found = outboundById.get(String(messageId));
    if (!found) return;
    const { batch, item } = found;
    if (item.settled) return;
    item.delivered = true;
    settleItem(batch, item, "delivered", "Delivered on WhatsApp");
  }

  function applyReceipt(event) {
    if (!event) return;
    const statusName = String(event.status || "");
    if (statusName !== "delivered" && statusName !== "read" && statusName !== "played") return;
    const ids = new Set();
    for (const id of event.messageIds || []) {
      if (id) ids.add(String(id));
    }
    if (event.stanzaId) ids.add(String(event.stanzaId));
    for (const id of ids) markDeliveredByMessageId(id);
  }

  function trackDelivery(batch, { phone, messageId, waitReason, text }) {
    const item = {
      phone,
      messageId: messageId || null,
      status: "waiting",
      delivered: false,
      settled: false,
      waitReason: waitReason || "sent",
      text: String(text || batch.message || "").trim(),
      timer: null,
    };
    batch.items.push(item);
    batch.pending += 1;
    if (messageId) outboundById.set(String(messageId), { batch, item });
    item.timer = setTimeout(() => {
      if (item.settled) return;
      const reason = item.waitReason === "sent" ? "no_whatsapp_delivery" : item.waitReason;
      queueSmsFallback(item, batch, reason)
        .then((result) => {
          if (item.settled) return;
          if (batch.enableSms === false || result?.reason === "campaign_sms_disabled") {
            settleItem(
              batch,
              item,
              "undelivered",
              "Not delivered on WhatsApp · SMS fallback disabled for this campaign"
            );
            return;
          }
          const smsReady = Boolean(ctx.services.sms?.ready?.());
          if (result?.skipped || !smsReady) {
            settleItem(
              batch,
              item,
              "sms-queued",
              ctx.services.sms?.isEnabled?.()
                ? "Not delivered in 10 minutes · SMS is not fully configured"
                : "Not delivered in 10 minutes · SMS fallback is off"
            );
            return;
          }
          if (result?.ok) {
            settleItem(batch, item, "sms-sent", "Not delivered on WhatsApp · SMS sent");
            return;
          }
          settleItem(
            batch,
            item,
            "sms-failed",
            "Not delivered on WhatsApp · SMS failed" + (result?.reason ? ": " + result.reason : "")
          );
        })
        .catch(() => {
          if (!item.settled) {
            settleItem(batch, item, "sms-failed", "Not delivered on WhatsApp · SMS failed");
          }
        });
    }, ctx.config.DELIVERY_WAIT_MS);
    return item;
  }

  function createBatch(message, options = {}) {
    const batch = {
      id: options.id || `b-${Date.now()}`,
      campaignId: options.campaignId || null,
      enableSms:
        options.enableSms !== undefined
          ? Boolean(options.enableSms) && Boolean(ctx.services.sms?.ready?.())
          : Boolean(ctx.services.sms?.ready?.()),
      message,
      items: [],
      pending: 0,
    };
    deliveryBatches.set(batch.id, batch);
    return batch;
  }

  ctx.events.on("whatsapp:receipt", (event) => {
    try {
      applyReceipt(event);
    } catch (error) {
      ctx.logger.warn({ err: error }, "delivery receipt handling failed");
    }
  });

  return { summarizeBatch, trackDelivery, createBatch };
}
