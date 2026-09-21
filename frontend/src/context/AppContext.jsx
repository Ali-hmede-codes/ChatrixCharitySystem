import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import { phoneKey } from "../services/phone.js";
import { DEFAULT_NAME_TEMPLATE, MAX_PEOPLE } from "../constants/config.js";
import { printReceipt } from "../services/receipt.js";
import { namesEqual } from "../services/names.js";
import { downloadCollectedExcel } from "../services/excel.js";
import {
  saveSnapshot,
  loadSnapshot,
  enqueueOp,
  listQueue,
  removeFromQueue,
  clearQueue,
  queueCount,
} from "../services/offline-db.js";
import {
  searchPickupOffline,
  exportOffline,
  markOffline,
  reprintOffline,
  undoOffline,
  applyRecipientEventToSnapshot,
  applyInventoryToSnapshot,
} from "../services/pickup-offline.js";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const socketRef = useRef(null);
  const hadConnectionRef = useRef(false);
  const smsSettingsRef = useRef(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // WhatsApp connection state
  const [waState, setWaState] = useState("starting");
  const [waPhone, setWaPhone] = useState(null);
  const [waMessage, setWaMessage] = useState("Starting WhatsApp connection…");
  const [qrCode, setQrCode] = useState(null);
  const [disconnecting, setDisconnecting] = useState(false);

  // Settings & Brand
  const [smsSettings, setSmsSettings] = useState({
    enabled: false,
    hasApiKey: false,
    from: "",
    apiKeyMasked: "",
    ready: false,
    deliveryWaitMinutes: 10,
    recallWindowMinutes: 15,
  });
  const [messageSettings, setMessageSettings] = useState({
    useNameTemplate: false,
    template: DEFAULT_NAME_TEMPLATE,
  });
  const [brand, setBrand] = useState({ hasLogo: false, url: "" });
  const [printerSettings, setPrinterSettings] = useState({
    paperWidthMm: 80,
    headerText: "",
    minWidthMm: 40,
    maxWidthMm: 120,
    presets: [58, 80],
  });
  const printerSettingsRef = useRef(printerSettings);

  // Contacts
  const [savedContacts, setSavedContacts] = useState([]);
  const [savingContacts, setSavingContacts] = useState(false);
  const [checkingContacts, setCheckingContacts] = useState(false);
  const [contactProgressHint, setContactProgressHint] = useState("");
  const [waCheckMap, setWaCheckMap] = useState({});

  // Active People List (imported from Excel)
  const [people, setPeople] = useState([]);
  const [importedFileName, setImportedFileName] = useState("");
  const [listColumns, setListColumns] = useState({ hasNames: false, hasCodes: false });

  // Campaigns & History
  const [campaigns, setCampaigns] = useState([]);
  const [activeCampaignDetails, setActiveCampaignDetails] = useState(null);
  const [loadingCampaignDetails, setLoadingCampaignDetails] = useState(false);
  // True until the first batch of campaign data arrives (or refresh after a
  // reconnect). Drives the skeleton loader on the Campaigns screen.
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [pickupBusy, setPickupBusy] = useState(false);
  const pickupBusyRef = useRef(false);
  // True while a pickup search is in flight. Drives the skeleton loader on
  // the Pickup screen so a slow connection shows shimmer rows, not a freeze.
  const [pickupLoading, setPickupLoading] = useState(false);
  // Aid inventory at the pickup desk. Decrements -1 on each collection, blocks
  // collecting at 0, and warns when under 20.
  const [inventory, setInventory] = useState({ count: 0, label: "Aid portions", updatedAt: null });
  const inventoryRef = useRef(inventory);
  const [pickupResults, setPickupResults] = useState({
    query: "",
    scope: "today",
    status: "pending",
    total: 0,
    items: [],
  });

  // Offline Aid Pickup cache + queue. The desk keeps working when the server
  // (Socket.io) is unreachable by searching/collecting against a cached
  // snapshot, then replaying the queued ops on reconnect. See
  // services/offline-db.js and services/pickup-offline.js.
  const [offlineSnapshot, setOfflineSnapshot] = useState(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const offlineSnapshotRef = useRef(null);
  const brandRef = useRef(brand);
  const syncingRef = useRef(false);

  // Sending Job & Delivery
  const [sendJob, setSendJob] = useState({
    running: false,
    paused: false,
    locked: false,
    stepText: "",
    progressPercent: 0,
    logs: [],
    deliverySummary: null,
    pauseReason: null,
    campaignId: null,
    remaining: 0,
    autoResume: false,
  });
  const [resumableCampaigns, setResumableCampaigns] = useState([]);

  // Navigation Step
  const [currentStep, setCurrentStep] = useState("boot");
  const [settingsActiveTab, setSettingsActiveTab] = useState("setup");
  const [navOpen, setNavOpen] = useState(false);

  // Notifications / Feedback
  const [toast, setToast] = useState(null);

  function showToast(message, type = "info") {
    setToast({ message, type, id: Date.now() });
    setTimeout(() => {
      setToast((current) => (current?.id ? null : current));
    }, 4500);
  }

  useEffect(() => {
    printerSettingsRef.current = printerSettings;
  }, [printerSettings]);

  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);

  // Debounced persistence of the offline cache. We do NOT write on every
  // `campaigns:recipient` event (those fire per-recipient during a send and
  // would hammer IndexedDB). The queue itself is durable (each op is written
  // immediately when enqueued), so a delayed cache write never loses a
  // collection — the next `pickup:snapshot` on reconnect reconstructs it.
  const snapshotSaveTimerRef = useRef(null);
  function scheduleSnapshotSave() {
    if (snapshotSaveTimerRef.current) return;
    snapshotSaveTimerRef.current = setTimeout(() => {
      snapshotSaveTimerRef.current = null;
      if (offlineSnapshotRef.current) saveSnapshot(offlineSnapshotRef.current);
    }, 1500);
  }

  useEffect(() => {
    offlineSnapshotRef.current = offlineSnapshot;
    if (offlineSnapshot) {
      setOfflineReady(true);
      scheduleSnapshotSave();
    }
  }, [offlineSnapshot]);

  useEffect(() => {
    brandRef.current = brand;
  }, [brand]);

  // Load the cached snapshot + pending queue count on first mount so the
  // desk works immediately even if the page is opened while offline.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const snap = await loadSnapshot();
      if (cancelled) return;
      if (snap) {
        setOfflineSnapshot(snap);
        setOfflineReady(true);
        // Keep the live inventory in sync with the cache on a cold start
        // so the stock badge matches what was last persisted.
        if (snap.inventory) setInventory(snap.inventory);
      }
      const count = await queueCount();
      if (cancelled) return;
      setPendingCount(count);
    })();
    return () => {
      cancelled = true;
    };
  }, []);


  // Network / Wifi offline listener
  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      showToast("Internet connection restored.", "success");
    }
    function handleOffline() {
      setIsOnline(false);
      showToast("Wi-Fi or network disconnected. Chatrix will reconnect when back.", "warning");
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Initialize Socket.io
  useEffect(() => {
    const socket = io({
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketConnected(true);
      setCampaignsLoading(true);
      socket.emit("contacts:list");
      socket.emit("sms:get");
      socket.emit("message:get");
      socket.emit("logo:get");
      socket.emit("campaigns:list");
      socket.emit("send:sync");
      socket.emit("printer:get");
      socket.emit("inventory:get");
      socket.emit("pickup:hydrate");
      if (hadConnectionRef.current) {
        showToast("Reconnected to Chatrix. Campaigns and send status refreshed.", "success");
      }
      hadConnectionRef.current = true;
    });

    socket.on("disconnect", () => {
      setSocketConnected(false);
      pickupBusyRef.current = false;
      setPickupBusy(false);
      setPickupLoading(false);
      showToast("Lost connection to Chatrix. Your campaigns stay saved. Reconnecting…", "warning");
    });

    socket.on("wa:status", (event) => {
      setWaState(event.state || "starting");
      setWaPhone(event.phone || null);
      setWaMessage(event.message || "");
      setQrCode(event.qr || null);

      if (event.state === "open") {
        setDisconnecting(false);
        setCurrentStep((prev) => {
          if (prev !== "boot" && prev !== "auth") return prev;
          if (event.remaining > 0 || event.paused || event.sending) return "send";
          return "excel";
        });
      } else if (event.paused || event.sending) {
        setDisconnecting(false);
        if (event.state === "qr" || event.state === "logged-out" || event.state === "error") {
          setCurrentStep((prev) => (prev === "boot" || prev === "send" || prev === "list" || prev === "excel" ? "auth" : prev));
        }
      } else if (event.state === "qr" || event.state === "logged-out" || event.state === "error") {
        setDisconnecting(false);
        setCurrentStep((prev) => (prev === "boot" ? "auth" : prev));
      }
    });

    socket.on("contacts:data", (event) => {
      const list = Array.isArray(event?.contacts) ? event.contacts : [];
      setSavedContacts(list);
    });

    socket.on("contacts:progress", (event) => {
      setSavingContacts(true);
      const key = phoneKey(event.phone);
      if (key && (event.state === "saved" || event.state === "updated" || event.state === "exists")) {
        setWaCheckMap((prev) => ({ ...prev, [key]: { exists: true, invalid: false } }));
      }
      if (key && event.state === "skipped") {
        setWaCheckMap((prev) => ({
          ...prev,
          [key]: { exists: false, invalid: /invalid/i.test(event.detail || "") },
        }));
      }
      setContactProgressHint(
        `${event.index + 1} of ${event.total} · ${event.name ? event.name + " · " : ""}${event.detail || ""}`
      );
    });

    socket.on("contacts:done", (event) => {
      setSavingContacts(false);
      const bits = [];
      if (event.saved) bits.push(`${event.saved} saved`);
      if (event.updated) bits.push(`${event.updated} updated`);
      if (event.exists) bits.push(`${event.exists} already current`);
      if (event.skipped) bits.push(`${event.skipped} not on WhatsApp`);
      if (event.failed) bits.push(`${event.failed} failed`);
      setContactProgressHint(bits.join(" · ") || "Contacts sync finished.");
      showToast(bits.join(" · ") || "Contacts sync finished.", "success");
    });

    socket.on("contacts:checked", (event) => {
      setCheckingContacts(false);
      const results = Array.isArray(event?.results) ? event.results : [];
      const updates = {};
      results.forEach((item) => {
        const key = phoneKey(item.phone);
        if (key) {
          updates[key] = {
            exists: item.exists === true ? true : item.exists === false ? false : null,
            invalid: Boolean(item.invalid),
          };
        }
      });
      setWaCheckMap((prev) => ({ ...prev, ...updates }));
      const onWa = results.filter((r) => r.exists === true && !r.invalid).length;
      const offWa = results.filter((r) => r.exists === false || r.invalid).length;
      const unknown = results.filter((r) => r.exists == null && !r.invalid).length;
      setContactProgressHint(
        `WhatsApp check: ${onWa} on WhatsApp · ${offWa} not on WhatsApp${
          unknown ? ` · ${unknown} could not verify` : ""
        }`
      );
      if (event?.error) showToast(event.error, "error");
    });

    socket.on("contacts:error", (msg) => {
      setSavingContacts(false);
      setCheckingContacts(false);
      setContactProgressHint(msg);
      showToast(msg, "error");
    });

    // Send and delivery events
    socket.on("send:progress", (event) => {
      setSendJob((prev) => {
        const percent = Math.round(((event.index + 1) / event.total) * 100);
        const existingLogs = prev.logs.filter((l) => l.phone !== event.phone).slice(0, 79);
        const newLog = {
          phone: event.phone,
          state: event.state,
          detail: event.detail,
          timestamp: Date.now(),
        };
        return {
          ...prev,
          running: true,
          paused: false,
          stepText: `${event.index + 1} of ${event.total} · ${event.detail || ""}`,
          progressPercent: percent,
          campaignId: event.campaignId || prev.campaignId,
          logs: [newLog, ...existingLogs],
        };
      });
    });

    socket.on("send:status", (event) => {
      if (!event) return;
      setSendJob((prev) => ({
        ...prev,
        running: Boolean(event.running),
        paused: Boolean(event.paused),
        pauseReason: event.pauseReason || null,
        campaignId: event.campaignId || prev.campaignId,
        remaining: event.remaining || 0,
        autoResume: Boolean(event.autoResume),
        stepText: event.stepText || prev.stepText,
        progressPercent: event.progressPercent ?? prev.progressPercent,
        locked: !event.running && prev.locked,
      }));
    });

    socket.on("send:resumable", (data) => {
      setResumableCampaigns(Array.isArray(data?.campaigns) ? data.campaigns : []);
    });

    socket.on("send:done", (event) => {
      setSendJob((prev) => ({
        ...prev,
        running: false,
        paused: false,
        locked: !event.resumable,
        remaining: event.remaining || 0,
        campaignId: event.campaignId || prev.campaignId,
        progressPercent: event.resumable
          ? Math.round(((event.total - (event.remaining || 0)) / Math.max(1, event.total)) * 100)
          : 100,
        stepText: event.resumable
          ? `Paused with ${event.remaining} remaining. Resume when WhatsApp is linked.`
          : `${event.stopped ? "Stopped. " : "Finished. "}${event.sent} sent · ${event.failed} failed · ${event.skipped || 0} skipped. Waiting ${smsSettingsRef.current?.deliveryWaitMinutes || 10} minutes for WhatsApp delivery.`,
        deliverySummary: event.delivery || prev.deliverySummary,
      }));
      if (event.resumable && event.stopped) {
        showToast(`Stopped · ${event.remaining} remaining. Resume anytime to continue.`, "info");
      } else if (event.resumable) {
        showToast(`Campaign paused · ${event.remaining} recipients still waiting.`, "warning");
      } else {
        showToast(`Send completed: ${event.sent} sent, ${event.failed} failed`, "success");
      }
    });

    socket.on("delivery:update", (event) => {
      setSendJob((prev) => {
        const existingLogs = prev.logs.filter((l) => l.phone !== event.phone).slice(0, 79);
        const updatedLog = {
          phone: event.phone,
          state: event.state,
          detail: event.detail,
          timestamp: Date.now(),
        };
        return {
          ...prev,
          logs: [updatedLog, ...existingLogs],
          deliverySummary: event.summary || prev.deliverySummary,
        };
      });
    });

    socket.on("delivery:done", (event) => {
      setSendJob((prev) => ({
        ...prev,
        deliverySummary: { ...event, done: true },
        stepText: `Delivery check complete. ${event.delivered || 0} delivered on WhatsApp · ${event.undelivered || 0} undelivered.`,
      }));
      showToast("Delivery tracking finished.", "info");
    });

    socket.on("send:error", (msg) => {
      setSendJob((prev) => ({
        ...prev,
        running: false,
        locked: true,
        stepText: msg,
      }));
      showToast(msg, "error");
    });

    socket.on("send:notice", (msg) => {
      if (!msg) return;
      const text = typeof msg === "string" ? msg : msg.message;
      const level = typeof msg === "string" ? "warning" : msg.level || "info";
      if (!text) return;
      const type = level === "success" ? "success" : level === "warn" || level === "warning" ? "warning" : level === "error" ? "error" : "info";
      showToast(text, type);
    });

    // SMS & Message & Brand settings
    socket.on("sms:settings", (data) => {
      smsSettingsRef.current = data;
      setSmsSettings(data);
    });
    socket.on("wa:reset:done", () => {
      setDisconnecting(false);
      showToast("WhatsApp session cleared. Scan the new QR code.", "success");
    });
    socket.on("wa:reset:error", (msg) => {
      setDisconnecting(false);
      showToast(msg || "Could not clear the WhatsApp session.", "error");
    });
    socket.on("sms:saved", (msg) => showToast(msg, "success"));
    socket.on("sms:error", (msg) => showToast(msg, "error"));

    socket.on("message:settings", (data) => setMessageSettings(data));
    socket.on("message:saved", (msg) => showToast(msg, "success"));
    socket.on("message:error", (msg) => showToast(msg, "error"));

    socket.on("brand:data", (data) => setBrand(data));
    socket.on("logo:saved", (msg) => showToast(msg, "success"));
    socket.on("logo:error", (msg) => showToast(msg, "error"));

    // Campaigns & Stats
    socket.on("campaigns:data", (data) => {
      setCampaigns(Array.isArray(data?.campaigns) ? data.campaigns : []);
      setCampaignsLoading(false);
    });

    socket.on("campaigns:update", (updated) => {
      if (!updated?.id) return;
      setCampaigns((prev) => {
        const idx = prev.findIndex((c) => c.id === updated.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...updated };
          return next;
        }
        return [updated, ...prev];
      });
      setActiveCampaignDetails((current) => {
        if (current && current.id === updated.id) {
          return { ...current, ...updated };
        }
        return current;
      });
    });

    socket.on("campaigns:details", (data) => {
      setActiveCampaignDetails(data);
      setLoadingCampaignDetails(false);
    });

    socket.on("campaigns:saved", (result) => {
      if (result?.details) {
        setActiveCampaignDetails((current) => {
          if (current && current.id === result.details.id) return result.details;
          return current;
        });
      }
      if (result?.removed) {
        showToast(
          result.blocked
            ? `Removed ${result.removed} ${result.removed === 1 ? "person" : "people"}. ${result.blocked} still sending.`
            : `Removed ${result.removed} ${result.removed === 1 ? "person" : "people"} from the campaign.`,
          "success"
        );
        return;
      }
      showToast("Campaign updated.", "success");
    });

    socket.on("campaigns:deleted", (result) => {
      const ids = Array.isArray(result?.ids) ? result.ids : [];
      setActiveCampaignDetails((current) => (current && ids.includes(current.id) ? null : current));
      const count = Number(result?.deleted) || ids.length || 1;
      showToast(count > 1 ? `${count} campaigns deleted.` : "Campaign deleted.", "info");
    });

    socket.on("campaigns:error", (msg) => {
      if (msg) showToast(msg, "error");
    });

    socket.on("campaigns:merged", (result) => {
      const name = result?.campaign?.name || "one campaign";
      const sources = Number(result?.sourceCount) || 0;
      const people = Number(result?.totalRecipients) || 0;
      const dupes = Number(result?.duplicates) || 0;
      showToast(
        `Merged ${sources} campaigns into "${name}" · ${people} people${dupes ? ` · ${dupes} shared numbers combined` : ""}.`,
        "success"
      );
    });

    socket.on("campaigns:recipient", (event) => {
      if (!event?.campaignId || !event?.recipient) return;
      const nextRecipient = event.recipient;
      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === event.campaignId
            ? { ...c, stats: event.stats ? { ...c.stats, ...event.stats } : c.stats }
            : c
        )
      );
      setActiveCampaignDetails((current) => {
        if (!current || current.id !== event.campaignId) return current;
        const list = current.recipients || [];
        return {
          ...current,
          stats: event.stats ? { ...current.stats, ...event.stats } : current.stats,
          recipients: list.map((r) =>
            r.phone === nextRecipient.phone ? { ...r, ...nextRecipient } : r
          ),
        };
      });
      setPickupResults((current) => ({
        ...current,
        items: (current.items || []).map((item) => {
          if (item.campaignId !== event.campaignId || item.phone !== nextRecipient.phone) return item;
          const personName = item.personName || item.name;
          const pickups = nextRecipient.pickups || [];
          const pickup =
            event.pickup && namesEqual(event.pickup.personName || event.pickup.name, personName)
              ? event.pickup
              : pickups.find((p) => namesEqual(p.name, personName));
          if (!pickup) return item;
          return {
            ...item,
            pickups,
            familyNames: pickups.map((p) => p.name),
            familySize: pickups.length,
            familyTaken: pickups.filter((p) => p.takenAt).length,
            name: pickup.name || personName,
            personName: pickup.name || personName,
            takenAt: pickup.takenAt || null,
            takenAidId: pickup.takenAidId || "",
            printCount: pickup.printCount || 0,
            signed: Boolean(pickup.signed || pickup.signature),
            signature: pickup.signature || item.signature || "",
          };
        }),
      }));
      // Keep the offline cache fresh while online so a later disconnect
      // reflects the most recent collections.
      setOfflineSnapshot((current) =>
        current ? applyRecipientEventToSnapshot(current, event) : current
      );
    });

    socket.on("pickup:results", (data) => {
      setPickupResults({
        query: data?.query || "",
        scope: data?.scope || "all",
        campaignDay: data?.campaignDay || "all",
        campaignId: data?.campaignId || "",
        status: data?.status || "all",
        total: data?.total || 0,
        items: Array.isArray(data?.items) ? data.items : [],
      });
      setPickupLoading(false);
    });

    socket.on("pickup:export-data", (data) => handleExportData(data));

    socket.on("pickup:done", (event) => applyPickupDone(event));

    socket.on("pickup:snapshot", (data) => {
      if (!data || typeof data !== "object") return;
      const snap = {
        savedAt: Date.now(),
        campaigns: Array.isArray(data.campaigns) ? data.campaigns : [],
        inventory:
          data.inventory && typeof data.inventory === "object"
            ? data.inventory
            : { count: 0, label: "Aid portions", updatedAt: null },
      };
      setOfflineSnapshot(snap);
      if (snap.inventory) setInventory(snap.inventory);
    });

    socket.on("pickup:apply-offline:done", (data) => {
      // Server finished replaying our queued ops. Clear the ones it accepted;
      // any conflict is surfaced per-op. The fresh `pickup:snapshot` broadcast
      // (sent right after by the server) reconciles the cache.
      handleApplyOfflineDone(data);
    });

    socket.on("inventory:state", (data) => {
      if (!data) return;
      const inv = { count: Number(data.count) || 0, label: data.label || "Aid portions", updatedAt: data.updatedAt || null };
      setInventory(inv);
      setOfflineSnapshot((current) => (current ? applyInventoryToSnapshot(current, inv) : current));
    });

    socket.on("inventory:saved", (data) => {
      if (!data) return;
      const inv = { count: Number(data.count) || 0, label: data.label || "Aid portions", updatedAt: data.updatedAt || null };
      setInventory(inv);
      setOfflineSnapshot((current) => (current ? applyInventoryToSnapshot(current, inv) : current));
      showToast(`Inventory updated · ${data.count} ${data.label || "aid"} in stock.`, "success");
    });

    socket.on("printer:settings", (data) => {
      if (!data) return;
      setPrinterSettings((prev) => ({ ...prev, ...data }));
    });
    socket.on("printer:saved", (msg) => showToast(msg, "success"));
    socket.on("printer:error", (msg) => showToast(msg, "error"));

    return () => {
      socket.disconnect();
    };
  }, []);

  // On (re)connect: replay queued offline ops. On disconnect: persist the
  // cache immediately so a reload right after losing the server still has
  // the latest data.
  useEffect(() => {
    if (!socketConnected) {
      if (snapshotSaveTimerRef.current) {
        clearTimeout(snapshotSaveTimerRef.current);
        snapshotSaveTimerRef.current = null;
      }
      if (offlineSnapshotRef.current) saveSnapshot(offlineSnapshotRef.current);
      return;
    }
    flushOfflineQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socketConnected]);

  useEffect(() => {
    if (currentStep !== "boot") return undefined;
    const timer = window.setTimeout(() => {
      setCurrentStep((prev) => (prev === "boot" ? "auth" : prev));
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [currentStep]);

  useEffect(() => {
    setNavOpen(false);
  }, [currentStep]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1025px)");
    const onChange = (event) => {
      if (event.matches) setNavOpen(false);
    };
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  // Actions
  function logout() {
    if (!socketRef.current || disconnecting) return;
    setDisconnecting(true);
    setCurrentStep("auth");
    setQrCode(null);
    socketRef.current.emit(waState === "open" ? "wa:logout" : "wa:reset");
  }

  function resetSession() {
    if (!socketRef.current || disconnecting) return;
    const ok = window.confirm(
      "Clear the saved WhatsApp session and scan a new QR code?\n\nUnfinished campaigns stay saved. After you link (even a new number), you can continue from the last unsent recipient. Contacts and SMS settings are kept."
    );
    if (!ok) return;
    setDisconnecting(true);
    setCurrentStep("auth");
    setQrCode(null);
    setWaMessage("Clearing saved WhatsApp session…");
    socketRef.current.emit("wa:reset");
  }

  function startSend(recipientsList, text, options = {}) {
    if (!socketRef.current) return;
    if (sendJob.running) {
      showToast(
        "A send is already running. Wait for it to finish, or press Stop Sending first. Your campaign was not launched.",
        "warning"
      );
      return;
    }
    if (!navigator.onLine) {
      showToast("This computer is offline. Reconnect Wi-Fi, then launch the campaign.", "warning");
      return;
    }
    if (!socketRef.current.connected) {
      showToast("Chatrix server is disconnected. Wait for reconnect, then try again.", "warning");
      return;
    }
    setSendJob({
      running: true,
      paused: false,
      locked: false,
      stepText: `Starting send for ${recipientsList.length} numbers…`,
      progressPercent: 0,
      logs: [],
      deliverySummary: null,
      pauseReason: null,
      campaignId: null,
      remaining: recipientsList.length,
      autoResume: true,
    });
    const allowSms = Boolean(options.enableSms) && Boolean(smsSettings.ready);
    if (options.enableSms && !smsSettings.ready) {
      showToast(
        "SMS is not configured. This campaign will send WhatsApp only. Open Settings & SMS to enable fallback.",
        "warning"
      );
    }
    socketRef.current.emit("send:start", {
      recipients: recipientsList,
      message: text,
      campaignName: options.campaignName,
      enableSms: allowSms,
      useNameTemplate: Boolean(options.useNameTemplate),
      nameTemplate: options.nameTemplate,
    });
  }

  function resumeCampaign(id) {
    if (!socketRef.current || !id || sendJob.running) return;
    if (!navigator.onLine) {
      showToast("Reconnect Wi-Fi first, then resume the campaign.", "warning");
      return;
    }
    if (!socketRef.current.connected) {
      showToast("Chatrix server is disconnected. Wait for reconnect, then resume.", "warning");
      return;
    }
    setCurrentStep("send");
    setSendJob((prev) => ({
      ...prev,
      running: true,
      paused: false,
      locked: false,
      stepText: "Resuming unfinished campaign…",
    }));
    socketRef.current.emit("send:resume", { id });
  }

  function stopSend() {
    if (socketRef.current) {
      socketRef.current.emit("send:stop");
    }
  }

  function fetchCampaignDetails(id) {
    if (!socketRef.current || !id) return;
    setLoadingCampaignDetails(true);
    socketRef.current.emit("campaigns:get", { id });
  }

  function clearCampaignDetails() {
    setActiveCampaignDetails(null);
    setLoadingCampaignDetails(false);
  }

  function deleteCampaign(id) {
    if (!socketRef.current || !id) return;
    socketRef.current.emit("campaigns:delete", { id });
  }

  function deleteCampaigns(ids) {
    if (!socketRef.current) return;
    const list = (Array.isArray(ids) ? ids : []).filter(Boolean);
    if (!list.length) return;
    if (list.length === 1) {
      socketRef.current.emit("campaigns:delete", { id: list[0] });
      return;
    }
    socketRef.current.emit("campaigns:delete-many", { ids: list });
  }

  function updateCampaign(id, patch) {
    if (!socketRef.current || !id) return;
    socketRef.current.emit("campaigns:update", { id, ...patch });
  }

  function removeCampaignRecipients(id, phones) {
    if (!socketRef.current || !id) return;
    socketRef.current.emit("campaigns:remove-recipients", { id, phones });
  }

  function mergeCampaigns(ids, name) {
    if (!socketRef.current) return;
    const list = (Array.isArray(ids) ? ids : []).filter(Boolean);
    if (list.length < 2) return;
    socketRef.current.emit("campaigns:merge", { ids: list, name });
  }

  function brandingForReceipt() {
    return {
      logoUrl: brandRef.current?.url || "",
      headerText: printerSettingsRef.current?.headerText || "",
      paperWidthMm: printerSettingsRef.current?.paperWidthMm || 80,
    };
  }

  // Commit a new offline cache snapshot: update the ref synchronously (so a
  // rapid second offline op reads the already-mutated cache) and the state
  // (for render). The debounced persistence runs via the snapshot effect.
  function commitOfflineSnapshot(snapshot) {
    if (!snapshot) return;
    offlineSnapshotRef.current = snapshot;
    setOfflineSnapshot(snapshot);
  }

  // Refresh the visible pickup list from a recipient payload (publicPickup
  // shape). Used by the offline path because, unlike online, no
  // `campaigns:recipient` event arrives to update the rows. Also called on
  // the online path — it's idempotent with the `campaigns:recipient` update.
  function updatePickupResultsFromRecipient(recipient) {
    if (!recipient || !recipient.campaignId || !recipient.phone) return;
    const pickups = Array.isArray(recipient.pickups) ? recipient.pickups : [];
    const personName = recipient.personName || recipient.name;
    setPickupResults((current) => ({
      ...current,
      items: (current.items || []).map((item) => {
        if (item.campaignId !== recipient.campaignId || item.phone !== recipient.phone) return item;
        const pickup = pickups.find((p) => namesEqual(p.name, personName));
        if (!pickup) {
          return {
            ...item,
            pickups,
            familyNames: pickups.map((p) => p.name),
            familySize: pickups.length,
            familyTaken: pickups.filter((p) => p.takenAt).length,
          };
        }
        return {
          ...item,
          pickups,
          familyNames: pickups.map((p) => p.name),
          familySize: pickups.length,
          familyTaken: pickups.filter((p) => p.takenAt).length,
          name: pickup.name || personName,
          personName: pickup.name || personName,
          takenAt: pickup.takenAt || null,
          takenAidId: pickup.takenAidId || "",
          printCount: pickup.printCount || 0,
          signed: Boolean(pickup.signed || pickup.signature),
          signature: pickup.signature || item.signature || "",
        };
      }),
    }));
  }

  // Shared handler for the backend `pickup:done` event AND the offline path.
  // Keeps online and offline behaviour identical (busy clear, inventory
  // update, receipt print, toasts, list refresh).
  function applyPickupDone(event) {
    pickupBusyRef.current = false;
    setPickupBusy(false);
    if (event?.inventory) {
      // Update the ref synchronously so a rapid second offline collection
      // reads the already-decremented stock (the state update + ref effect
      // would otherwise lag by one render).
      inventoryRef.current = event.inventory;
      setInventory(event.inventory);
    }
    if (!event?.ok) {
      showToast(event?.error || "Could not update pickup.", "error");
      return;
    }
    updatePickupResultsFromRecipient(event.recipient);
    if (event.undone) {
      showToast("Marked as not collected. The same aid ID will be reused if they collect again.", "info");
      return;
    }
    const receipt = event.receipt;
    if (receipt && event.reprint) {
      printReceipt(receipt, printerSettingsRef.current);
      showToast(`Reprinting ${receipt.aidId}`, "success");
      return;
    }
    if (receipt && !event.alreadyTaken) {
      printReceipt(receipt, printerSettingsRef.current);
      const inv = event.inventory;
      const low = inv && inv.count > 0 && inv.count < 20;
      showToast(
        low
          ? `Collected · ${receipt.aidId} · printing receipt. ⚠ Only ${inv.count} ${inv.label || "aid"} left in inventory.`
          : `Collected · ${receipt.aidId} · printing receipt`,
        low ? "warning" : "success"
      );
      return;
    }
    if (event.alreadyTaken) {
      const who = event.recipient?.name || "This person";
      const id = event.receipt?.aidId ? ` (${event.receipt.aidId})` : "";
      showToast(`${who} already collected aid${id}. Reprint if the paper is missing.`, "warning");
    }
  }

  async function refreshPendingCount() {
    const count = await queueCount();
    setPendingCount(count);
  }

  // Replay queued offline ops to the server. Idempotent: the server's
  // applyOfflineOp is safe to re-apply, so a dropped ack just retries on the
  // next reconnect.
  async function flushOfflineQueue() {
    if (syncingRef.current) return;
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;
    const ops = await listQueue();
    if (!ops.length) return;
    syncingRef.current = true;
    setSyncing(true);
    // Tag each op with its queue id so the server's ack can tell us which to
    // remove. The server ignores unknown fields and echoes `op` back.
    const tagged = ops.map((entry) => ({ ...entry, clientId: entry.id }));
    socket.emit("pickup:apply-offline", { ops: tagged });
  }

  async function handleApplyOfflineDone(data) {
    syncingRef.current = false;
    setSyncing(false);
    const results = Array.isArray(data?.results) ? data.results : [];
    let conflicts = 0;
    let errors = 0;
    for (const item of results) {
      const op = item?.op;
      const result = item?.result;
      if (result?.ok) {
        if (result.conflict) conflicts += 1;
        if (op?.clientId != null) await removeFromQueue(op.clientId);
      } else {
        errors += 1;
      }
    }
    await refreshPendingCount();
    setLastSyncAt(Date.now());
    if (errors > 0) {
      showToast(
        `${errors} change${errors === 1 ? "" : "s"} could not sync yet. They stay queued and will retry on the next reconnect.`,
        "warning"
      );
    } else if (conflicts > 0) {
      showToast(
        `${conflicts} change${conflicts === 1 ? "" : "s"} synced with a conflict — the server already had a newer record, so its version was kept.`,
        "warning"
      );
    } else if (results.length > 0) {
      showToast("Offline changes synced to Chatrix.", "success");
    }
  }

  function searchPickup(payload = {}) {
    if (!socketRef.current?.connected) {
      const snap = offlineSnapshotRef.current;
      if (!snap) {
        setPickupLoading(false);
        setPickupResults({
          query: "",
          scope: "all",
          campaignDay: "all",
          campaignId: "",
          status: "all",
          total: 0,
          items: [],
        });
        return;
      }
      setPickupLoading(true);
      const result = searchPickupOffline(snap, payload);
      setPickupResults(result);
      setPickupLoading(false);
      return;
    }
    if (!socketRef.current) return;
    setPickupLoading(true);
    socketRef.current.emit("pickup:search", payload);
  }

  function exportCollected(payload = {}) {
    if (!socketRef.current?.connected) {
      const snap = offlineSnapshotRef.current;
      if (!snap) {
        showToast("No cached pickup list to export. Connect once online to load it.", "warning");
        return;
      }
      const result = exportOffline(snap, payload);
      handleExportData(result);
      return;
    }
    if (!socketRef.current) return;
    socketRef.current.emit("pickup:export", payload);
  }

  // Shared by the online `pickup:export-data` handler and the offline export
  // path so both produce the same Excel file + toast.
  async function handleExportData(data) {
    const rows = Array.isArray(data?.items) ? data.items : [];
    const wantStatus =
      data?.status === "pending" || data?.status === "all" ? data.status : "taken";
    if (!rows.length) {
      const noneMsg =
        wantStatus === "taken"
          ? "No collected people match this campaign date to export."
          : wantStatus === "pending"
            ? "No not-collected people match this campaign date to export."
            : "No people match this campaign date to export.";
      showToast(noneMsg, "warning");
      return;
    }
    try {
      const saved = await downloadCollectedExcel(rows, {
        campaignDay: data?.campaignDay || "all",
        campaignName: rows.length === 1 ? rows[0].campaignName : "",
        status: wantStatus,
      });
      const label =
        wantStatus === "taken"
          ? "collected"
          : wantStatus === "pending"
            ? "not-collected"
            : "collected and not-collected";
      showToast(`Exported ${saved.count} ${label} ${saved.count === 1 ? "person" : "people"} to Excel.`, "success");
    } catch {
      showToast("Could not export Excel. Try again.", "error");
    }
  }

  function markPickup(campaignId, phone, personName, signature) {
    if (!campaignId || !phone || pickupBusyRef.current) return;
    if (!socketRef.current?.connected) {
      const snap = offlineSnapshotRef.current;
      if (!snap) {
        showToast("No cached pickup list. Connect once online to load it, then it works offline.", "warning");
        return;
      }
      pickupBusyRef.current = true;
      setPickupBusy(true);
      const { snapshot, event, op } = markOffline(
        snap,
        inventoryRef.current,
        { campaignId, phone, personName, signature },
        brandingForReceipt()
      );
      commitOfflineSnapshot(snapshot);
      if (op) {
        enqueueOp(op).then(() => refreshPendingCount());
      }
      applyPickupDone(event);
      return;
    }
    if (!socketRef.current) return;
    pickupBusyRef.current = true;
    setPickupBusy(true);
    socketRef.current.emit("pickup:mark", { campaignId, phone, personName, signature });
  }

  function reprintPickup(campaignId, phone, personName, signature) {
    if (!campaignId || !phone || pickupBusyRef.current) return;
    if (!socketRef.current?.connected) {
      const snap = offlineSnapshotRef.current;
      if (!snap) {
        showToast("No cached pickup list. Connect once online to load it, then it works offline.", "warning");
        return;
      }
      pickupBusyRef.current = true;
      setPickupBusy(true);
      const { snapshot, event, op } = reprintOffline(
        snap,
        inventoryRef.current,
        { campaignId, phone, personName, signature },
        brandingForReceipt()
      );
      commitOfflineSnapshot(snapshot);
      if (op) {
        enqueueOp(op).then(() => refreshPendingCount());
      }
      applyPickupDone(event);
      return;
    }
    if (!socketRef.current) return;
    pickupBusyRef.current = true;
    setPickupBusy(true);
    socketRef.current.emit("pickup:reprint", { campaignId, phone, personName, signature });
  }

  function undoPickup(campaignId, phone, personName) {
    if (!campaignId || !phone || pickupBusyRef.current) return;
    if (!socketRef.current?.connected) {
      const snap = offlineSnapshotRef.current;
      if (!snap) {
        showToast("No cached pickup list. Connect once online to load it, then it works offline.", "warning");
        return;
      }
      pickupBusyRef.current = true;
      setPickupBusy(true);
      const { snapshot, event, op } = undoOffline(
        snap,
        inventoryRef.current,
        { campaignId, phone, personName }
      );
      commitOfflineSnapshot(snapshot);
      if (op) {
        enqueueOp(op).then(() => refreshPendingCount());
      }
      applyPickupDone(event);
      return;
    }
    if (!socketRef.current) return;
    pickupBusyRef.current = true;
    setPickupBusy(true);
    socketRef.current.emit("pickup:undo", { campaignId, phone, personName });
  }

  function savePrinter(payload) {
    if (socketRef.current) socketRef.current.emit("printer:save", payload);
  }

  function saveInventory(payload) {
    if (socketRef.current) socketRef.current.emit("inventory:set", payload || {});
  }

  function saveContactsToPhone(actionableContacts) {
    if (!socketRef.current || savingContacts) return;
    setSavingContacts(true);
    setContactProgressHint("Checking and syncing contacts…");
    socketRef.current.emit("contacts:save", { contacts: actionableContacts });
  }

  function checkContactsOnWhatsApp(phoneList) {
    if (!socketRef.current || checkingContacts) return;
    setCheckingContacts(true);
    setContactProgressHint("Checking which numbers are on WhatsApp…");
    socketRef.current.emit("contacts:check", { phones: phoneList });
  }

  function saveSms(payload) {
    if (socketRef.current) socketRef.current.emit("sms:save", payload);
  }

  function saveMessageTemplate(payload) {
    if (socketRef.current) socketRef.current.emit("message:save", payload);
  }

  function uploadLogo(payload) {
    if (socketRef.current) socketRef.current.emit("logo:save", payload);
  }

  function clearLogo() {
    if (socketRef.current) socketRef.current.emit("logo:clear");
  }

  const value = {
    socketConnected,
    isOnline,
    waState,
    waPhone,
    waMessage,
    qrCode,
    disconnecting,
    smsSettings,
    messageSettings,
    brand,
    printerSettings,
    inventory,
    saveInventory,
    savedContacts,
    savingContacts,
    checkingContacts,
    contactProgressHint,
    waCheckMap,
    people,
    setPeople,
    importedFileName,
    setImportedFileName,
    listColumns,
    setListColumns,
    sendJob,
    campaigns,
    campaignsLoading,
    resumableCampaigns,
    activeCampaignDetails,
    loadingCampaignDetails,
    fetchCampaignDetails,
    clearCampaignDetails,
    deleteCampaign,
    deleteCampaigns,
    updateCampaign,
    removeCampaignRecipients,
    mergeCampaigns,
    pickupBusy,
    pickupLoading,
    pickupResults,
    searchPickup,
    exportCollected,
    markPickup,
    reprintPickup,
    undoPickup,
    currentStep,
    setCurrentStep,
    settingsActiveTab,
    setSettingsActiveTab,
    navOpen,
    setNavOpen,
    toast,
    showToast,
    logout,
    resetSession,
    startSend,
    resumeCampaign,
    stopSend,
    saveContactsToPhone,
    checkContactsOnWhatsApp,
    saveSms,
    saveMessageTemplate,
    savePrinter,
    uploadLogo,
    clearLogo,
    // Offline Aid Pickup support
    offlineReady,
    offlineSnapshot,
    pendingCount,
    syncing,
    lastSyncAt,
    flushOfflineQueue,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
