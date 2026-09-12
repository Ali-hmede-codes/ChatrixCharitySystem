import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import { phoneKey } from "../services/phone.js";
import { DEFAULT_NAME_TEMPLATE, MAX_PEOPLE } from "../constants/config.js";
import { printReceipt } from "../services/receipt.js";
import { namesEqual } from "../services/names.js";
import { downloadCollectedExcel } from "../services/excel.js";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const socketRef = useRef(null);
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
  const [pickupBusy, setPickupBusy] = useState(false);
  const pickupBusyRef = useRef(false);
  const [pickupResults, setPickupResults] = useState({
    query: "",
    scope: "today",
    status: "pending",
    total: 0,
    items: [],
  });

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
      socket.emit("contacts:list");
      socket.emit("sms:get");
      socket.emit("message:get");
      socket.emit("logo:get");
      socket.emit("campaigns:list");
      socket.emit("send:sync");
      socket.emit("printer:get");
    });

    socket.on("disconnect", () => {
      setSocketConnected(false);
      pickupBusyRef.current = false;
      setPickupBusy(false);
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
            exists: item.exists === true,
            invalid: Boolean(item.invalid),
          };
        }
      });
      setWaCheckMap((prev) => ({ ...prev, ...updates }));
      const onWa = results.filter((r) => r.exists && !r.invalid).length;
      const offWa = results.filter((r) => r.exists === false || r.invalid).length;
      setContactProgressHint(`WhatsApp check: ${onWa} on WhatsApp · ${offWa} not on WhatsApp`);
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
          : `${event.stopped ? "Stopped. " : "Finished. "}${event.sent} sent · ${event.failed} failed · ${event.skipped || 0} skipped. Waiting 10 minutes for WhatsApp delivery.`,
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

    // SMS & Message & Brand settings
    socket.on("sms:settings", (data) => setSmsSettings(data));
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
          };
        }),
      }));
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
    });

    socket.on("pickup:export-data", (data) => {
      const rows = Array.isArray(data?.items) ? data.items : [];
      if (!rows.length) {
        showToast("No collected people match this campaign date to export.", "warning");
        return;
      }
      const saved = downloadCollectedExcel(rows, {
        campaignDay: data?.campaignDay || "all",
        campaignName: rows.length === 1 ? rows[0].campaignName : "",
      });
      showToast(`Exported ${saved.count} collected ${saved.count === 1 ? "person" : "people"} to Excel.`, "success");
    });

    socket.on("pickup:done", (event) => {
      pickupBusyRef.current = false;
      setPickupBusy(false);
      if (!event?.ok) {
        showToast(event?.error || "Could not update pickup.", "error");
        return;
      }
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
        showToast(`Collected · ${receipt.aidId} · printing receipt`, "success");
        return;
      }
      if (event.alreadyTaken) {
        const who = event.recipient?.name || "This person";
        const id = event.receipt?.aidId ? ` (${event.receipt.aidId})` : "";
        showToast(`${who} already collected aid${id}. Reprint if the paper is missing.`, "warning");
      }
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
    if (!socketRef.current || sendJob.running) return;
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
    socketRef.current.emit("send:start", {
      recipients: recipientsList,
      message: text,
      campaignName: options.campaignName,
      enableSms: options.enableSms,
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
    showToast("Campaign deleted.", "info");
    if (activeCampaignDetails?.id === id) {
      setActiveCampaignDetails(null);
    }
  }

  function searchPickup(payload = {}) {
    if (!socketRef.current) return;
    socketRef.current.emit("pickup:search", payload);
  }

  function exportCollected(payload = {}) {
    if (!socketRef.current) return;
    socketRef.current.emit("pickup:export", payload);
  }

  function markPickup(campaignId, phone, personName) {
    if (!socketRef.current || !campaignId || !phone || pickupBusyRef.current) return;
    pickupBusyRef.current = true;
    setPickupBusy(true);
    socketRef.current.emit("pickup:mark", { campaignId, phone, personName });
  }

  function reprintPickup(campaignId, phone, personName) {
    if (!socketRef.current || !campaignId || !phone || pickupBusyRef.current) return;
    pickupBusyRef.current = true;
    setPickupBusy(true);
    socketRef.current.emit("pickup:reprint", { campaignId, phone, personName });
  }

  function undoPickup(campaignId, phone, personName) {
    if (!socketRef.current || !campaignId || !phone || pickupBusyRef.current) return;
    pickupBusyRef.current = true;
    setPickupBusy(true);
    socketRef.current.emit("pickup:undo", { campaignId, phone, personName });
  }

  function savePrinter(payload) {
    if (socketRef.current) socketRef.current.emit("printer:save", payload);
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
    resumableCampaigns,
    activeCampaignDetails,
    loadingCampaignDetails,
    fetchCampaignDetails,
    clearCampaignDetails,
    deleteCampaign,
    pickupBusy,
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
