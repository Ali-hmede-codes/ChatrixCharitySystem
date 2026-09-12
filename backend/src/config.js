import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(SRC_DIR, "..");
const ROOT_DIR = path.resolve(BACKEND_DIR, "..");
const AUTH_DIR = path.join(BACKEND_DIR, ".auth");

export const config = {
  ROOT_DIR,
  BACKEND_DIR,
  SRC_DIR,
  FRONTEND_DIR: path.join(ROOT_DIR, "frontend"),
  AUTH_DIR,
  SQLITE_PATH: path.join(AUTH_DIR, "state.sqlite"),
  CONTACTS_PATH: path.join(AUTH_DIR, "saved-contacts.json"),
  CAMPAIGNS_PATH: path.join(AUTH_DIR, "campaigns.json"),
  SMS_SETTINGS_PATH: path.join(AUTH_DIR, "sms-settings.json"),
  MESSAGE_SETTINGS_PATH: path.join(AUTH_DIR, "message-settings.json"),
  PRINTER_SETTINGS_PATH: path.join(AUTH_DIR, "printer-settings.json"),
  AID_SEQ_PATH: path.join(AUTH_DIR, "aid-seq.json"),
  LOGO_PATH: path.join(AUTH_DIR, "brand-logo"),
  LOGO_META_PATH: path.join(AUTH_DIR, "brand-logo.json"),
  BAILEYS_DIR: path.join(BACKEND_DIR, "auth_session"),
  HOST: process.env.HOST || "127.0.0.1",
  PORT: Number(process.env.PORT) || 4173,
  LOCK_PORT: Number(process.env.LOCK_PORT) || 4179,
  SESSION_ID: "default",
  MAX_PEOPLE: 400,
  SEND_GAP_MIN_MS: 9_000,
  SEND_GAP_MAX_MS: 18_000,
  REST_EVERY: 7,
  REST_MIN_MS: 40_000,
  REST_MAX_MS: 80_000,
  DELIVERY_WAIT_MS: 10 * 60 * 1000,
  SMS_SEND_URL: "https://api.httpsms.com/v1/messages/send",
  SMS_GAP_MS: 3_000,
  LOGO_MAX_BYTES: 1_500_000,
  DEFAULT_NAME_TEMPLATE: "مرحبا [PersonName]",
  CONTACTS_SYNC_VERSION: 2,
  LOG_LEVEL: process.env.LOG_LEVEL || "error",
  LOGO_MIMES: new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/svg+xml",
  ]),
  FATAL_REASONS: new Set([
    "stream_error_replaced",
    "stream_error_device_removed",
    "stream_error_force_logout",
    "failure_not_authorized",
    "failure_banned",
    "failure_locked",
    "failure_bad_user_agent",
    "primary_identity_key_change",
  ]),
};
