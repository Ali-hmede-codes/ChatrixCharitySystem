#!/usr/bin/env node
// Seed a small completed campaign of fake people so you can try
// Aid Pickup → Sign & Print without sending WhatsApp.
//
//   node backend/scripts/seed-pickup-test.js
//   node backend/scripts/seed-pickup-test.js --reset    (clear collected/signatures)
//   node backend/scripts/seed-pickup-test.js --remove   (delete this test campaign only)
//
// Then restart Chatrix so it reloads campaigns.json:
//   npm start          (local)
//   pm2 restart chatrix (VPS)

import { readFileSync, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { plusPhone } from "../src/shared/phone.js";

const TEST_CAMPAIGN_ID = "camp-pickup-test";
const TEST_CAMPAIGN_NAME = "Pickup signature test";
const MIN_STOCK = 40;

const PEOPLE = [
  { name: "Ahmad Test", phone: "+96171111111", code: "TST-001" },
  { name: "Sara Test", phone: "+96171111112", code: "TST-002" },
  { name: "Omar Test", phone: "+96171111113", code: "TST-003" },
  { name: "Nour Test", phone: "+96171111115", code: "TST-005" },
  {
    names: ["Karim Test", "Lina Test"],
    phone: "+96171111114",
    nameCodes: { "karim test": "TST-004A", "lina test": "TST-004B" },
  },
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUTH_DIR = path.join(ROOT, ".auth");
const CAMPAIGNS_PATH = path.join(AUTH_DIR, "campaigns.json");
const INVENTORY_PATH = path.join(AUTH_DIR, "inventory.json");

function readJson(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    return raw ?? fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function makePickup(name) {
  return {
    name,
    takenAt: null,
    takenAidId: "",
    printCount: 0,
    signature: "",
  };
}

function makeRecipient(person) {
  const phone = plusPhone(person.phone);
  if (!phone) {
    throw new Error(`Invalid test phone: ${person.phone}`);
  }
  const names = Array.isArray(person.names)
    ? person.names.map((n) => String(n).trim()).filter(Boolean)
    : [String(person.name || "").trim()].filter(Boolean);
  if (!names.length) throw new Error("Test person is missing a name.");
  return {
    phone,
    name: names.join(" + "),
    names,
    code: String(person.code || "").trim(),
    nameCodes: person.nameCodes || null,
    state: "delivered",
    channel: "none",
    detail: "Test person — not a real send",
    updatedAt: Date.now(),
    takenAt: null,
    takenAidId: "",
    printCount: 0,
    sentNames: [],
    messageIds: [],
    sentAt: null,
    jid: "",
    pickups: names.map(makePickup),
  };
}

function buildCampaign(recipients) {
  const now = Date.now();
  const people = recipients.reduce((sum, r) => sum + (r.pickups?.length || 1), 0);
  return {
    id: TEST_CAMPAIGN_ID,
    name: TEST_CAMPAIGN_NAME,
    createdAt: now,
    completedAt: now,
    pausedAt: null,
    status: "completed",
    pauseReason: null,
    enableSms: false,
    message: "Test campaign — do not send",
    aidCode: "TST",
    senderPhone: "",
    sendOptions: {
      message: "Test campaign — do not send",
      useNameTemplate: false,
      nameTemplate: "",
      enableSms: false,
    },
    mergedFrom: 0,
    totalRecipients: recipients.length,
    stats: {
      sent: recipients.length,
      delivered: recipients.length,
      waiting: 0,
      undelivered: 0,
      smsSent: 0,
      smsFailed: 0,
      failed: 0,
      skipped: 0,
      taken: 0,
      people,
    },
    recipients,
  };
}

function listPeople(campaign) {
  const rows = [];
  for (const r of campaign.recipients || []) {
    for (const p of r.pickups || []) {
      rows.push({
        name: p.name,
        phone: r.phone,
        code: r.nameCodes?.[String(p.name).toLowerCase()] || r.code || "",
      });
    }
  }
  return rows;
}

async function restockInventory() {
  const current = readJson(INVENTORY_PATH, { count: 0, label: "Aid portions", updatedAt: null });
  const count = Math.max(Number(current.count) || 0, MIN_STOCK);
  const next = {
    count,
    label: current.label || "Aid portions",
    updatedAt: Date.now(),
  };
  await writeJson(INVENTORY_PATH, next);
  return next;
}

const args = new Set(process.argv.slice(2));
const campaigns = readJson(CAMPAIGNS_PATH, []);
if (!Array.isArray(campaigns)) {
  throw new Error(`Expected an array in ${CAMPAIGNS_PATH}`);
}

if (args.has("--remove")) {
  const next = campaigns.filter((c) => c?.id !== TEST_CAMPAIGN_ID);
  await writeJson(CAMPAIGNS_PATH, next);
  console.log(`Removed "${TEST_CAMPAIGN_NAME}". Other campaigns were left as they were.`);
  console.log("Restart Chatrix, then refresh the site.");
  process.exit(0);
}

if (args.has("--reset")) {
  const found = campaigns.find((c) => c?.id === TEST_CAMPAIGN_ID);
  if (!found) {
    console.log("No test campaign yet. Run without flags to create one.");
    process.exit(0);
  }
  for (const r of found.recipients || []) {
    r.takenAt = null;
    r.takenAidId = "";
    r.printCount = 0;
    r.updatedAt = Date.now();
    r.pickups = (r.pickups || []).map((p) => ({
      ...p,
      takenAt: null,
      printCount: 0,
      signature: "",
    }));
  }
  found.stats = { ...(found.stats || {}), taken: 0 };
  found.completedAt = Date.now();
  await writeJson(CAMPAIGNS_PATH, campaigns);
  const inventory = await restockInventory();
  console.log(`Reset collected flags on "${TEST_CAMPAIGN_NAME}".`);
  console.log(`Inventory is ${inventory.count} ${inventory.label}.`);
  console.log("Restart Chatrix, then refresh Aid Pickup.");
  process.exit(0);
}

const recipients = PEOPLE.map(makeRecipient);
const campaign = buildCampaign(recipients);
const nextCampaigns = [campaign, ...campaigns.filter((c) => c?.id !== TEST_CAMPAIGN_ID)];
await writeJson(CAMPAIGNS_PATH, nextCampaigns);
const inventory = await restockInventory();

const people = listPeople(campaign);
console.log(`Seeded "${TEST_CAMPAIGN_NAME}" with ${people.length} test people.`);
console.log(`Inventory is ${inventory.count} ${inventory.label}.`);
console.log("");
console.log("People you can collect:");
for (const row of people) {
  console.log(`  • ${row.name.padEnd(14)}  ${row.phone}  ${row.code}`);
}
console.log("");
console.log("Restart Chatrix so it loads this list:");
console.log("  local:  stop the server, then npm start");
console.log("  VPS:    pm2 restart chatrix");
console.log("Then open Aid Pickup → All dates → Sign & Print.");
console.log("Remove later with:  node backend/scripts/seed-pickup-test.js --remove");
