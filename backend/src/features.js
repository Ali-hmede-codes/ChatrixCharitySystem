/**
 * Feature registry — this is the only file you edit to turn features on/off.
 *
 * Add a feature:
 *   1. Create backend/src/features/<name>/index.js that exports `{ name, init, http?, sockets? }`
 *   2. Import it below and push it into `enabledFeatures`
 *
 * Remove a feature:
 *   1. Delete (or comment out) its entry in `enabledFeatures`
 *   2. Optionally delete its folder
 *
 * Features talk through ctx.services, ctx.channels, and ctx.events — never import each other.
 */
import { brandFeature } from "./features/brand/index.js";
import { campaignsFeature } from "./features/campaigns/index.js";
import { contactsFeature } from "./features/contacts/index.js";
import { inventoryFeature } from "./features/inventory/index.js";
import { messageTemplateFeature } from "./features/message-template/index.js";
import { printerFeature } from "./features/printer/index.js";
import { sendFeature } from "./features/send/index.js";
import { smsFeature } from "./features/sms/index.js";
import { whatsappFeature } from "./features/whatsapp/index.js";

export const enabledFeatures = [
  brandFeature,
  campaignsFeature,
  messageTemplateFeature,
  printerFeature,
  smsFeature,
  whatsappFeature,
  contactsFeature,
  sendFeature,
  inventoryFeature,
];
