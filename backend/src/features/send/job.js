import { waitGap, delay, withTimeout } from "../../shared/delay.js";
import {
  namesFromRecipient,
  namesEqual,
  sanitizeAidCode,
  messageHasCodePlaceholder,
  messageHasNamePlaceholder,
  shouldSendPerPerson,
} from "../../shared/names.js";
import { toWhatsAppDigits } from "../../shared/phone.js";
import { createDeliveryTracker } from "./delivery.js";
import { looksRateLimited, respectServerLimits } from "./pacing.js";
import {
  classifyWhatsAppClose,
  isConnectionError,
  pauseCopy,
  shouldAutoResume,
} from "./interrupt.js";

export function createSendService(ctx) {
  const delivery = createDeliveryTracker(ctx);
  let sendJob = emptyJob();

  function emptyJob() {
    return {
      running: false,
      paused: false,
      cancelled: false,
      autoResume: true,
      campaignId: null,
      campaignName: "",
      pauseReason: null,
      index: 0,
      total: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
    };
  }

  function isCancelled() {
    return sendJob.cancelled;
  }

  function stepText() {
    if (!sendJob.running) return "";
    if (sendJob.paused) {
      const copy = pauseCopy(sendJob.pauseReason);
      const left = ctx.services.campaigns?.remainingCount?.(sendJob.campaignId) ?? 0;
      return `${copy.title}. ${left} remaining. ${copy.detail}`;
    }
    return `Sending ${sendJob.index + 1} of ${sendJob.total}…`;
  }

  function publicStatus() {
    const remaining = sendJob.campaignId
      ? ctx.services.campaigns?.remainingCount?.(sendJob.campaignId) ?? 0
      : 0;
    return {
      running: sendJob.running,
      paused: sendJob.paused,
      campaignId: sendJob.campaignId,
      campaignName: sendJob.campaignName,
      pauseReason: sendJob.pauseReason,
      autoResume: sendJob.autoResume,
      index: sendJob.index,
      total: sendJob.total,
      remaining,
      sent: sendJob.sent,
      failed: sendJob.failed,
      skipped: sendJob.skipped,
      progressPercent: sendJob.total ? Math.min(100, Math.round((sendJob.index / sendJob.total) * 100)) : 0,
      stepText: stepText(),
    };
  }

  function emitStatus() {
    ctx.io.emit("send:status", publicStatus());
    ctx.broadcast();
  }

  // Reply to a request whether or not the originating client is still
  // connected. If the user's socket dropped, broadcast so any other tab (or
  // the same tab after reconnect) still sees the notice/error. This keeps
  // server-side work independent of the user's connection.
  function reply(socket, event, payload) {
    if (socket && socket.connected) socket.emit(event, payload);
    else ctx.io.emit(event, payload);
  }

  // Minutes to wait for WhatsApp delivery before SMS fallback, from Settings.
  function deliveryWaitMinutes() {
    const ms = ctx.services.sms?.deliveryWaitMs?.();
    const fallback = ctx.config.DELIVERY_WAIT_MS || 10 * 60_000;
    const value = Number.isFinite(ms) && ms > 0 ? ms : fallback;
    return Math.max(1, Math.round(value / 60_000));
  }

  async function waitUntilCanSend() {
    while (sendJob.running && !sendJob.cancelled) {
      const open = Boolean(ctx.services.whatsapp?.isOpen?.());
      if (!sendJob.paused && open) return true;
      if (!open && !sendJob.paused) {
        pauseFromClose({ reason: "client_disconnected", fatal: false });
      }
      emitStatus();
      await delay(400);
    }
    return false;
  }

  function pauseFromClose(info = {}) {
    if (!sendJob.running || sendJob.cancelled) return;
    const reason = classifyWhatsAppClose(info);
    sendJob.paused = true;
    sendJob.pauseReason = reason;
    sendJob.autoResume = shouldAutoResume(reason);
    if (sendJob.campaignId) {
      ctx.services.campaigns?.interrupt?.(sendJob.campaignId, reason, pauseCopy(reason).detail);
    }
    emitStatus();
  }

  function onWhatsAppClosed(info) {
    pauseFromClose(info);
  }

  function onWhatsAppOpen() {
    const phone = ctx.services.whatsapp?.getStatus?.()?.phone || "";
    if (sendJob.running && sendJob.paused && sendJob.autoResume) {
      sendJob.paused = false;
      sendJob.pauseReason = null;
      if (sendJob.campaignId) {
        ctx.services.campaigns?.markRunning?.(sendJob.campaignId, phone);
      }
      emitStatus();
      ctx.io.emit("send:progress", {
        index: sendJob.index,
        total: sendJob.total,
        phone: phone || "",
        state: "sending",
        detail: phone ? `Linked ${phone}. Continuing remaining recipients…` : "WhatsApp is back. Continuing…",
        campaignId: sendJob.campaignId,
      });
      return;
    }
    ctx.io.emit("send:resumable", {
      campaigns: ctx.services.campaigns?.listResumable?.() || [],
    });
    // No active job — auto-resume the most recent interrupted campaign that
    // the user did not explicitly stop, so work continues after a server
    // restart or a WhatsApp drop without anyone pressing Resume.
    if (!sendJob.running) queueAutoResume(phone);
  }

  let autoResumeTimer = null;
  function queueAutoResume(phone) {
    if (autoResumeTimer) return;
    autoResumeTimer = setTimeout(async () => {
      autoResumeTimer = null;
      if (sendJob.running) return;
      if (!ctx.services.whatsapp?.isOpen?.()) return;
      const resumable = ctx.services.campaigns?.listResumable?.() || [];
      const candidate = resumable
        .filter((c) => c.pauseReason !== "user_stop")
        .sort((a, b) => (Number(b.pausedAt) || 0) - (Number(a.pausedAt) || 0))[0];
      if (!candidate) return;
      ctx.logger.info({ campaignId: candidate.id }, "auto-resuming interrupted campaign");
      ctx.io.emit(
        "send:notice",
        `WhatsApp reconnected — automatically resuming "${candidate.name}" so the campaign continues.`
      );
      try {
        await resume({ id: candidate.id }, null);
      } catch (error) {
        ctx.logger.warn({ err: error }, "auto-resume failed");
      }
    }, 2_000);
  }

  // After a server restart, recipients that were "waiting" for WhatsApp
  // delivery lost their in-memory SMS-fallback timers. Re-arm them so the
  // configured wait still applies and SMS fallback still fires — entirely
  // server-side, independent of any user connection.
  let didRecoverWaiting = false;
  function recoverWaitingDeliveries() {
    if (didRecoverWaiting) return;
    didRecoverWaiting = true;
    try {
      const batches = ctx.services.campaigns?.waitingRecipients?.() || [];
      if (!batches.length) return;
      const buildMessages = messageBuilder();
      let reArmed = 0;
      for (const b of batches) {
        const body = String(b.sendOptions?.message || b.message || "").trim();
        const extrasFor = (r) => ({
          code: r.code,
          useNameTemplate: Boolean(b.sendOptions?.useNameTemplate),
          nameTemplate: String(b.sendOptions?.nameTemplate || ""),
        });
        const batch = delivery.createBatch(b.message, {
          campaignId: b.campaignId,
          enableSms: b.enableSms,
        });
        for (const r of b.recipients) {
          const texts = buildMessages(r.names, body, extrasFor(r));
          const text = texts.join("\n\n") || b.message;
          delivery.trackDelivery(batch, {
            phone: r.phone,
            messageId: null,
            waitReason: "no_whatsapp_delivery",
            text,
          });
          reArmed += 1;
        }
      }
      ctx.logger.info({ reArmed }, "re-armed waiting delivery timers after restart");
      ctx.io.emit(
        "send:notice",
        `Server restarted — ${reArmed} message${reArmed === 1 ? "" : "s"} still waiting for WhatsApp delivery. SMS fallback will fire automatically if not delivered in time.`
      );
    } catch (error) {
      ctx.logger.warn({ err: error }, "recover waiting deliveries failed");
    }
  }

  function normalizeRecipients(incoming, extraNumbers) {
    const recipients = [];
    const seen = new Set();
    const source = Array.isArray(incoming) && incoming.length ? incoming : [];
    for (const item of source) {
      const phone = toWhatsAppDigits(item?.phone);
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      recipients.push({
        phone,
        names: namesFromRecipient(item),
        name: String(item?.name || "").trim(),
        code: sanitizeAidCode(item?.code),
        sentNames: Array.isArray(item?.sentNames) ? item.sentNames : [],
      });
      if (recipients.length >= ctx.config.MAX_PEOPLE) break;
    }
    if (!recipients.length && Array.isArray(extraNumbers)) {
      for (const value of extraNumbers) {
        const phone = toWhatsAppDigits(value);
        if (!phone || seen.has(phone)) continue;
        seen.add(phone);
        recipients.push({ phone, names: [], name: "", code: "" });
        if (recipients.length >= ctx.config.MAX_PEOPLE) break;
      }
    }
    return recipients;
  }

  function messageBuilder() {
    return (
      ctx.services.messages?.buildRecipientMessages ||
      ((names, text, extras) => {
        const buildOne =
          ctx.services.messages?.buildRecipientMessage ||
          ((_names, body, extra) => {
            const next = String(body || "").trim();
            return extra?.code ? next.replace(/\[(?:Aid)?Code\]|\[كود\]/gi, extra.code) : next;
          });
        if (shouldSendPerPerson(names, text, extras)) {
          return (names || []).map((name) => buildOne([name], text, extras)).filter(Boolean);
        }
        const one = buildOne(names, text, extras);
        return one ? [one] : [];
      })
    );
  }

  function validateMessages(recipients, body, extrasFor) {
    const buildMessages = messageBuilder();
    const sampleTexts = buildMessages(recipients[0].names, body, extrasFor(recipients[0]));
    const sampleText = sampleTexts[0] || "";
    if (!sampleText) {
      return { error: "Write a message first, or pick a template on the Compose screen." };
    }
    const leftoverName = recipients.some((r) =>
      buildMessages(r.names, body, extrasFor(r)).some((text) => messageHasNamePlaceholder(text))
    );
    if (leftoverName) {
      return {
        error:
          "The message includes [PersonName] but some recipients have no name. Select a Name column when importing Excel, or remove [PersonName] from the message.",
      };
    }
    const leftoverCode = recipients.some((r) =>
      buildMessages(r.names, body, extrasFor(r)).some((text) => messageHasCodePlaceholder(text))
    );
    if (leftoverCode) {
      return {
        error:
          "The message includes [Code] but some recipients have no pickup code. Select a Code column when importing Excel, or pick a template without [Code].",
      };
    }
    return { buildMessages, sampleText };
  }

  async function sendOne(jid, message) {
    const client = ctx.services.whatsapp.getClient();
    if (!client || !ctx.services.whatsapp.isOpen()) {
      const err = new Error("WhatsApp is disconnected");
      err.beforeSend = true;
      throw err;
    }
    const typingMs = Math.min(4_000, Math.max(1_400, message.length * 22));
    try {
      await client.presence.sendChatstate(jid, { state: "composing" });
    } catch {
      // Presence is best-effort.
    }
    await waitGap(typingMs, isCancelled);
    if (sendJob.cancelled) return null;
    if (!ctx.services.whatsapp.isOpen()) {
      const err = new Error("WhatsApp is disconnected");
      err.beforeSend = true;
      throw err;
    }
    // From here on the send was attempted — even if this throws (timeout or
    // disconnect mid-send), the message may already be on its way. Flag it so
    // the caller marks "waiting" instead of "retry" to avoid a duplicate.
    let result = null;
    try {
      result = await withTimeout(client.message.send(jid, message), 45_000, "WhatsApp send timed out");
    } catch (error) {
      error.sendAttempted = true;
      throw error;
    }
    try {
      await client.presence.sendChatstate(jid, { state: "paused" });
    } catch {
      // Ignore.
    }
    return result;
  }

  async function runLoop({ campaign, recipients, body, enableSms, extrasFor, sampleText, buildMessages }) {
    const batch = delivery.createBatch(sampleText, {
      campaignId: campaign?.id || null,
      enableSms,
    });
    const { SEND_PACE_MS, FAMILY_GAP_MS } = ctx.config;
    const offset = Math.max(0, (campaign?.totalRecipients || recipients.length) - recipients.length);

    let index = 0;
    while (index < recipients.length) {
      if (sendJob.cancelled) break;
      const ready = await waitUntilCanSend();
      if (!ready) break;

      const recipientStartedAt = Date.now();
      const recipient = recipients[index];
      const { phone, names } = recipient;
      const extras = extrasFor(recipient);
      const perPerson = shouldSendPerPerson(names, body, extras);
      const alreadySent = Array.isArray(recipient.sentNames) ? recipient.sentNames : [];
      const pendingNames = perPerson
        ? names.filter((name) => !alreadySent.some((sent) => namesEqual(sent, name)))
        : names;
      const globalIndex = offset + index;
      sendJob.index = globalIndex;
      sendJob.total = campaign?.totalRecipients || recipients.length;
      const texts = buildMessages(perPerson ? pendingNames : names, body, extras);
      const text = texts.join("\n\n") || sampleText;

      if (perPerson && alreadySent.length && !pendingNames.length) {
        sendJob.sent += 1;
        const waitingDetail = enableSms
          ? `Sent · waiting ${deliveryWaitMinutes()} minutes for delivery (SMS fallback active)`
          : "Sent · waiting for delivery (SMS off for this campaign)";
        ctx.io.emit("send:progress", {
          index: globalIndex,
          total: sendJob.total,
          phone: `+${phone}`,
          state: "waiting",
          detail: waitingDetail,
          campaignId: campaign?.id || null,
        });
        if (campaign) {
          ctx.services.campaigns.updateRecipient(campaign.id, {
            phone,
            state: "waiting",
            channel: "whatsapp",
            detail: waitingDetail,
            sentNames: alreadySent,
          });
        }
        index += 1;
        continue;
      }

      if (campaign) {
        ctx.services.campaigns.updateRecipient(campaign.id, {
          phone,
          state: "sending",
          channel: "none",
          detail: "Checking number…",
        });
      }

      ctx.io.emit("send:progress", {
        index: globalIndex,
        total: sendJob.total,
        phone: `+${phone}`,
        state: "sending",
        detail: "Checking number…",
        campaignId: campaign?.id || null,
      });

      try {
        const client = ctx.services.whatsapp.getClient();
        if (!client || !ctx.services.whatsapp.isOpen()) {
          throw new Error("WhatsApp is disconnected");
        }
        const limit = await respectServerLimits(client);
        if (limit) {
          ctx.io.emit("send:progress", {
            index: globalIndex,
            total: sendJob.total,
            phone: `+${phone}`,
            state: "sending",
            detail: limit.reason,
            campaignId: campaign?.id || null,
          });
          await waitGap(limit.waitMs, isCancelled);
          if (sendJob.cancelled) break;
          if (!ctx.services.whatsapp.isOpen()) throw new Error("WhatsApp is disconnected");
        }

        const target = await ctx.services.whatsapp.resolveTarget(phone);
        if (target.skip) {
          sendJob.skipped += 1;
          const smsHint = enableSms
            ? ` · waiting ${deliveryWaitMinutes()} min, then SMS if still undelivered`
            : " · not on WhatsApp (SMS off for this campaign)";
          const skipDetail = `${target.reason}${smsHint}`;
          ctx.io.emit("send:progress", {
            index: globalIndex,
            total: sendJob.total,
            phone: `+${phone}`,
            state: "skipped",
            detail: skipDetail,
            campaignId: campaign?.id || null,
          });
          delivery.trackDelivery(batch, { phone, waitReason: "not_on_whatsapp", text });
          if (campaign) {
            ctx.services.campaigns.updateRecipient(campaign.id, {
              phone,
              state: "skipped",
              channel: "none",
              detail: skipDetail,
            });
          }
          index += 1;
        } else {
          const outgoing = texts.length ? texts : [text];
          const sentSoFar = [...alreadySent];
          const sentMessageIds = [];
          let lastResult = null;
          let stoppedMid = false;

          for (let m = 0; m < outgoing.length; m += 1) {
            if (m > 0) {
              await waitGap(FAMILY_GAP_MS, isCancelled);
              if (sendJob.cancelled) {
                stoppedMid = true;
                break;
              }
              if (!ctx.services.whatsapp.isOpen()) {
                throw new Error("WhatsApp is disconnected");
              }
            }
            const familyLabel =
              perPerson && names.length > 1
                ? `Typing & sending ${sentSoFar.length + 1} of ${names.length}…`
                : "Typing & sending…";
            ctx.io.emit("send:progress", {
              index: globalIndex,
              total: sendJob.total,
              phone: `+${phone}`,
              state: "sending",
              detail: familyLabel,
              campaignId: campaign?.id || null,
            });
            lastResult = await sendOne(target.jid, outgoing[m]);
            if (sendJob.cancelled && !lastResult) {
              stoppedMid = true;
              break;
            }
            if (lastResult?.id) sentMessageIds.push(String(lastResult.id));
            if (perPerson && pendingNames[m]) {
              sentSoFar.push(pendingNames[m]);
              recipient.sentNames = sentSoFar;
              if (campaign) {
                ctx.services.campaigns.updateRecipient(campaign.id, {
                  phone,
                  state: "sending",
                  channel: "whatsapp",
                  detail: `Sent ${sentSoFar.length} of ${names.length} family messages`,
                  sentNames: sentSoFar,
                });
              }
            }
          }

          if (stoppedMid) {
            if (campaign) {
              ctx.services.campaigns.updateRecipient(campaign.id, {
                phone,
                state: "retry",
                channel: "none",
                detail: "Stopped before send · will retry if you resume",
                sentNames: sentSoFar,
                messageIds: sentMessageIds,
                jid: target.jid,
              });
            }
            break;
          }

          sendJob.sent += 1;
          delivery.trackDelivery(batch, { phone, messageId: lastResult?.id, waitReason: "sent", text });
          const sentAt = Date.now();
          const waitingDetail = enableSms
            ? `Sent · waiting ${deliveryWaitMinutes()} minutes for delivery (SMS fallback active)`
            : "Sent · waiting for delivery (SMS off for this campaign)";
          ctx.io.emit("send:progress", {
            index: globalIndex,
            total: sendJob.total,
            phone: `+${phone}`,
            state: "waiting",
            detail: waitingDetail,
            campaignId: campaign?.id || null,
          });
          if (campaign) {
            ctx.services.campaigns.updateRecipient(campaign.id, {
              phone,
              state: "waiting",
              channel: "whatsapp",
              detail: waitingDetail,
              sentNames: sentSoFar,
              messageIds: sentMessageIds,
              sentAt,
              jid: target.jid,
            });
          }
          index += 1;
        }
      } catch (error) {
        if (isConnectionError(error) && !sendJob.cancelled) {
          pauseFromClose({ reason: "client_disconnected", fatal: false });
          // If the send was already attempted (message may be on its way),
          // mark "waiting" and track delivery instead of "retry" — this
          // prevents re-sending the same person twice after a Wi-Fi drop.
          // If it wasn't delivered, the delivery timer + SMS fallback cover it.
          const sendAttempted = Boolean(error.sendAttempted);
          const nextState = sendAttempted ? "waiting" : "retry";
          const nextDetail = sendAttempted
            ? "Sent, but the connection dropped before delivery was confirmed. Waiting for delivery / SMS fallback."
            : "Network or WhatsApp dropped. Will retry this number.";
          if (campaign) {
            ctx.services.campaigns.updateRecipient(campaign.id, {
              phone,
              state: nextState,
              channel: sendAttempted ? "whatsapp" : "none",
              detail: nextDetail,
              sentNames: recipient.sentNames,
            });
            if (sendAttempted) {
              delivery.trackDelivery(batch, {
                phone,
                messageId: null,
                waitReason: "no_whatsapp_delivery",
                text,
              });
            }
          }
          ctx.io.emit("send:progress", {
            index: globalIndex,
            total: sendJob.total,
            phone: `+${phone}`,
            state: nextState,
            detail: sendAttempted
              ? "Paused — message sent, waiting for delivery confirmation."
              : "Paused — will retry this number when WhatsApp is back.",
            campaignId: campaign?.id || null,
          });
          if (sendAttempted) index += 1;
          continue;
        }

        sendJob.failed += 1;
        const failDetail = enableSms
          ? `${error.message || "Could not send"} · waiting ${deliveryWaitMinutes()} min, then SMS`
          : `${error.message || "Could not send"} (SMS off for this campaign)`;
        ctx.io.emit("send:progress", {
          index: globalIndex,
          total: sendJob.total,
          phone: `+${phone}`,
          state: "failed",
          detail: failDetail,
          campaignId: campaign?.id || null,
        });
        delivery.trackDelivery(batch, { phone, waitReason: "send_failed", text });
        if (campaign) {
          ctx.services.campaigns.updateRecipient(campaign.id, {
            phone,
            state: "failed",
            channel: "none",
            detail: failDetail,
          });
        }
        if (looksRateLimited(error)) {
          ctx.io.emit("send:progress", {
            index: globalIndex,
            total: sendJob.total,
            phone: `+${phone}`,
            state: "failed",
            detail: "Paused — WhatsApp is throttling. Waiting 8 minutes.",
            campaignId: campaign?.id || null,
          });
          await waitGap(8 * 60 * 1000, isCancelled);
        }
        index += 1;
      }

      if (index < recipients.length && !sendJob.cancelled) {
        // Fixed pace: make each recipient cycle take SEND_PACE_MS (10s) total,
        // regardless of typing/send duration. No random jitter, no long rests.
        const elapsed = Date.now() - recipientStartedAt;
        const remaining = Math.max(0, SEND_PACE_MS - elapsed);
        if (remaining > 0) await waitGap(remaining, isCancelled);
      }
    }

    const stopped = sendJob.cancelled;
    const remaining = campaign ? ctx.services.campaigns.remainingCount(campaign.id) : 0;
    const summary = delivery.summarizeBatch(batch);
    sendJob.running = false;
    sendJob.paused = false;
    const pauseReason = sendJob.pauseReason;
    sendJob.cancelled = false;

    if (campaign) {
      await ctx.services.campaigns.finishCampaign(campaign.id, {
        stopped,
        interrupted: !stopped && remaining > 0,
        reason: stopped ? "user_stop" : remaining > 0 ? pauseReason : null,
        summary,
      });
    }

    ctx.io.emit("send:done", {
      sent: sendJob.sent,
      failed: sendJob.failed,
      skipped: sendJob.skipped,
      stopped,
      remaining,
      total: sendJob.total,
      delivery: summary,
      campaignId: campaign?.id || null,
      resumable: remaining > 0,
    });
    sendJob = emptyJob();
    emitStatus();
  }

  async function start(payload, socket) {
    if (sendJob.running) {
      reply(socket, "send:error", "A send is already running.");
      return;
    }
    if (!ctx.services.whatsapp?.isOpen?.()) {
      reply(socket, "send:error", "Link WhatsApp with the QR code first.");
      return;
    }

    const body = String(payload?.message || "").trim();
    const useNameTemplate = Boolean(payload?.useNameTemplate);
    const nameTemplate = String(payload?.nameTemplate || "").trim();
    const recipients = normalizeRecipients(payload?.recipients, payload?.numbers);
    if (!recipients.length) {
      reply(socket, "send:error", "No Lebanon (+961) or Syria (+963) numbers found.");
      return;
    }
    if (recipients.length > ctx.config.MAX_PEOPLE) {
      reply(socket, "send:error", `Maximum ${ctx.config.MAX_PEOPLE} numbers per send.`);
      return;
    }

    const extrasFor = (recipient) => ({
      code: recipient?.code,
      useNameTemplate,
      nameTemplate,
    });
    const checked = validateMessages(recipients, body, extrasFor);
    if (checked.error) {
      reply(socket, "send:error", checked.error);
      return;
    }

    const requestedSms =
      payload?.enableSms !== undefined ? Boolean(payload?.enableSms) : Boolean(ctx.services.sms?.ready?.());
    const enableSms = requestedSms && Boolean(ctx.services.sms?.ready?.());
    if (requestedSms && !enableSms) {
      reply(
        socket,
        "send:notice",
        "SMS is not configured. This campaign will send WhatsApp only. Open Settings & SMS to add the httpSMS API key and sender number."
      );
    }
    const campaignName = String(payload?.campaignName || payload?.name || "").trim();
    const senderPhone = ctx.services.whatsapp?.getStatus?.()?.phone || "";

    sendJob = {
      ...emptyJob(),
      running: true,
      total: recipients.length,
    };
    emitStatus();

    let campaign = null;
    if (ctx.services.campaigns) {
      campaign = await ctx.services.campaigns.create({
        name: campaignName,
        message: body || checked.sampleText,
        aidCode: "",
        recipients,
        enableSms,
        senderPhone,
        sendOptions: {
          message: body,
          useNameTemplate,
          nameTemplate,
          enableSms,
        },
      });
      sendJob.campaignId = campaign.id;
      sendJob.campaignName = campaign.name;
    }

    await runLoop({
      campaign,
      recipients,
      body,
      enableSms,
      extrasFor,
      sampleText: checked.sampleText,
      buildMessages: checked.buildMessages,
    });
  }

  async function resume(payload, socket) {
    if (sendJob.running) {
      reply(socket, "send:error", "A send is already running.");
      return;
    }
    if (!ctx.services.whatsapp?.isOpen?.()) {
      reply(socket, "send:error", "Link WhatsApp first, then resume the unfinished campaign.");
      return;
    }
    const id = payload?.id || payload?.campaignId;
    const campaign = ctx.services.campaigns?.get?.(id);
    if (!campaign) {
      reply(socket, "send:error", "That campaign was not found.");
      return;
    }
    if (!campaign.resumable) {
      reply(socket, "send:error", "This campaign is already finished.");
      return;
    }
    const allRemaining = ctx.services.campaigns.remainingRecipients(campaign.id);
    if (!allRemaining.length) {
      reply(socket, "send:error", "No remaining recipients to send.");
      return;
    }
    const remaining = allRemaining.slice(0, ctx.config.MAX_PEOPLE);
    if (allRemaining.length > remaining.length) {
      reply(
        socket,
        "send:notice",
        `Resuming the next ${remaining.length} of ${allRemaining.length} remaining people. Merge stays one campaign — resume again after this batch.`
      );
    }

    const body = String(campaign.sendOptions?.message || campaign.message || "").trim();
    const useNameTemplate = Boolean(campaign.sendOptions?.useNameTemplate);
    const nameTemplate = String(campaign.sendOptions?.nameTemplate || "").trim();
    const requestedSms =
      campaign.sendOptions?.enableSms !== undefined
        ? Boolean(campaign.sendOptions.enableSms)
        : Boolean(campaign.enableSms);
    const enableSms = requestedSms && Boolean(ctx.services.sms?.ready?.());
    if (requestedSms && !enableSms) {
      reply(
        socket,
        "send:notice",
        "SMS is not configured, so this resume will send WhatsApp only. Configure Settings & SMS before SMS fallback can run."
      );
    }
    const extrasFor = (recipient) => ({
      code: recipient?.code,
      useNameTemplate,
      nameTemplate,
    });
    const checked = validateMessages(remaining, body, extrasFor);
    if (checked.error) {
      reply(socket, "send:error", checked.error);
      return;
    }

    const senderPhone = ctx.services.whatsapp?.getStatus?.()?.phone || "";
    ctx.services.campaigns.markRunning(campaign.id, senderPhone);

    sendJob = {
      ...emptyJob(),
      running: true,
      campaignId: campaign.id,
      campaignName: campaign.name,
      total: campaign.totalRecipients || remaining.length,
      index: (campaign.totalRecipients || remaining.length) - remaining.length,
    };
    emitStatus();
    ctx.io.emit("send:progress", {
      index: sendJob.index,
      total: sendJob.total,
      phone: senderPhone || "",
      state: "sending",
      detail: senderPhone
        ? `Resuming on ${senderPhone} · ${remaining.length} remaining`
        : `Resuming · ${remaining.length} remaining`,
      campaignId: campaign.id,
    });

    await runLoop({
      campaign: ctx.services.campaigns.get(campaign.id) ? { ...campaign, id: campaign.id, totalRecipients: campaign.totalRecipients } : campaign,
      recipients: remaining,
      body,
      enableSms,
      extrasFor,
      sampleText: checked.sampleText,
      buildMessages: checked.buildMessages,
    });
  }

  function stop() {
    if (!sendJob.running) return;
    sendJob.cancelled = true;
    sendJob.autoResume = false;
    sendJob.pauseReason = "user_stop";
  }

  function pause(reason = "whatsapp_disconnect") {
    if (!sendJob.running || sendJob.cancelled) return;
    sendJob.paused = true;
    sendJob.pauseReason = reason;
    sendJob.autoResume = shouldAutoResume(reason);
    if (sendJob.campaignId) {
      ctx.services.campaigns?.interrupt?.(sendJob.campaignId, reason, pauseCopy(reason).detail);
    }
    emitStatus();
  }

  function sync(socket) {
    const payload = publicStatus();
    const resumable = { campaigns: ctx.services.campaigns?.listResumable?.() || [] };
    if (socket) {
      socket.emit("send:status", payload);
      socket.emit("send:resumable", resumable);
    } else {
      ctx.io.emit("send:status", payload);
      ctx.io.emit("send:resumable", resumable);
    }
  }

  // Re-arm any "waiting" delivery timers lost during a restart. Deferred
  // to the next tick so all services and the socket bus are fully wired.
  setTimeout(recoverWaitingDeliveries, 1_500);

  // Watchdog: if a send is paused (auto-resumable) but WhatsApp is actually
  // open, un-pause it. This covers reconnects where the whatsapp:open event
  // was missed or arrived out of order, so the user never has to click Resume.
  setInterval(() => {
    if (
      sendJob.running &&
      sendJob.paused &&
      sendJob.autoResume &&
      !sendJob.cancelled &&
      ctx.services.whatsapp?.isOpen?.()
    ) {
      try {
        onWhatsAppOpen();
      } catch (error) {
        ctx.logger.warn({ err: error }, "send watchdog auto-resume failed");
      }
    }
  }, 3_000);

  // Recall (unsend) the WhatsApp messages that were sent to every number in
  // a campaign, but only if they were sent within the configured recall
  // window (default 15 minutes). WhatsApp only lets the sender revoke a
  // message for everyone within a short window, so older sends are skipped.
  // Runs entirely server-side in the background so the user's connection
  // (or a Wi-Fi drop) doesn't affect it — the UI only gets progress notices.
  function recallMessages(items, campaignName) {
    const windowMs = ctx.services.sms?.recallWindowMs?.() ?? 0;
    if (!windowMs) {
      ctx.io.emit("send:notice", {
        level: "info",
        message: `Recall is turned off — the messages sent for "${campaignName}" were not deleted from recipients' chats.`,
      });
      return;
    }
    const windowMin = Math.round(windowMs / 60_000);
    const recallable = (Array.isArray(items) ? items : [])
      .map((it) => ({
        phone: String(it?.phone || ""),
        jid: String(it?.jid || ""),
        messageIds: Array.isArray(it?.messageIds) ? it.messageIds.map((id) => String(id || "")).filter(Boolean) : [],
        sentAt: Number(it?.sentAt) || 0,
      }))
      .filter((it) => it.phone && it.messageIds.length && it.sentAt && Date.now() - it.sentAt <= windowMs);

    const totalIds = recallable.reduce((n, it) => n + it.messageIds.length, 0);
    if (!totalIds) {
      ctx.io.emit("send:notice", {
        level: "info",
        message: `No messages to recall for "${campaignName}" — none were sent within the last ${windowMin} minutes.`,
      });
      return;
    }
    ctx.io.emit("send:notice", {
      level: "info",
      message: `Deleting ${totalIds} sent message${totalIds === 1 ? "" : "s"} from "${campaignName}" (recall window ${windowMin} min).`,
    });
    runRecall(recallable, campaignName, windowMs).catch((error) => {
      ctx.logger.warn({ err: error }, "recall job failed");
      ctx.io.emit("send:notice", {
        level: "warn",
        message: `Recall for "${campaignName}" stopped: ${error.message || "unexpected error"}.`,
      });
    });
  }

  async function runRecall(items, campaignName, windowMs) {
    let ok = 0;
    let fail = 0;
    let skipped = 0;
    // A recall can fail transiently (the recipient device-list query times
    // out, or a brief network blip drops the revoke). Retry once after a short
    // gap — a second attempt often succeeds once the device fanout is cached.
    const RECALL_ATTEMPTS = 2;
    const RECALL_RETRY_GAP_MS = 2_500;
    for (const it of items) {
      if (!ctx.services.whatsapp?.isOpen?.()) {
        ctx.io.emit("send:notice", {
          level: "warn",
          message: `WhatsApp disconnected — recall for "${campaignName}" paused. Reconnect and delete the campaign again to finish.`,
        });
        break;
      }
      // Prefer the exact jid the message was sent to (stored on the
      // recipient). Fall back to resolving it from the phone for old data.
      let jid = it.jid;
      if (!jid) {
        try {
          const target = await ctx.services.whatsapp.resolveTarget(it.phone);
          if (!target || target.skip) {
            skipped += it.messageIds.length;
            continue;
          }
          jid = target.jid;
        } catch {
          skipped += it.messageIds.length;
          continue;
        }
      }
      const client = ctx.services.whatsapp.getClient();
      for (const messageId of it.messageIds) {
        if (!ctx.services.whatsapp?.isOpen?.()) break;
        if (Date.now() - it.sentAt > windowMs) {
          skipped += 1;
          continue;
        }
        let succeeded = false;
        let lastError = null;
        for (let attempt = 1; attempt <= RECALL_ATTEMPTS && !succeeded; attempt += 1) {
          if (!ctx.services.whatsapp?.isOpen?.()) break;
          try {
            await withTimeout(
              client.message.send(jid, {
                type: "revoke",
                target: { remoteJid: jid, id: messageId, fromMe: true },
              }),
              20_000,
              "Recall timed out"
            );
            succeeded = true;
          } catch (error) {
            lastError = error;
            // Only retry if WhatsApp is still connected; otherwise the outer
            // loop will report the disconnect and stop.
            if (attempt < RECALL_ATTEMPTS && ctx.services.whatsapp?.isOpen?.()) {
              await waitGap(RECALL_RETRY_GAP_MS, () => false);
            }
          }
        }
        if (succeeded) {
          ok += 1;
        } else {
          fail += 1;
          ctx.logger.warn({ err: lastError, phone: it.phone, messageId }, "recall failed");
        }
        // Pace the recalls so we don't trip WhatsApp's rate limiter.
        await waitGap(1_500, () => false);
      }
    }
    const level = fail === 0 ? "success" : ok === 0 ? "warn" : "info";
    let message = `Recall for "${campaignName}" done: ${ok} deleted, ${fail} failed${skipped ? `, ${skipped} skipped` : ""}.`;
    if (ok === 0 && fail > 0) {
      message += ` The campaign was removed, but its messages could not be deleted from recipients' chats (WhatsApp refused the revoke). They may still see the message.`;
    }
    ctx.io.emit("send:notice", { level, message });
  }

  return {
    start,
    resume,
    stop,
    pause,
    onWhatsAppClosed,
    onWhatsAppOpen,
    isRunning: () => sendJob.running,
    isPaused: () => sendJob.paused,
    getStatus: publicStatus,
    sync,
    recallMessages,
  };
}
