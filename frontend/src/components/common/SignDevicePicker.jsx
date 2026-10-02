import React, { useState } from "react";
import { describeSignTarget, deviceListLabel, kindLabel } from "../../services/sign-device.js";

export function SignDevicePicker({ self, devices, target, socketConnected, onTargetChange, onRename }) {
  const described = describeSignTarget({ target, self, devices, socketConnected });
  const others = (devices || []).filter((device) => !device.self && device.deviceId !== self?.deviceId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(self?.name || "");

  const names = new Map();
  for (const device of others) {
    const key = String(device.name || "").toLowerCase();
    names.set(key, (names.get(key) || 0) + 1);
  }

  const savedMissing =
    described.where === "remote" && !others.some((device) => device.deviceId === described.deviceId);

  function commitRename() {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === self?.name) return;
    onRename?.(next);
  }

  function onSelect(event) {
    const value = event.target.value;
    if (value === "self") {
      onTargetChange?.({ id: "self", name: "", kind: self?.kind || "computer" });
      return;
    }
    const live = others.find((device) => device.deviceId === value);
    if (live) {
      onTargetChange?.({ id: live.deviceId, name: live.name, kind: live.kind });
      return;
    }
    if (target?.id === value) onTargetChange?.(target);
  }

  let status = "People sign on this device. The receipt prints here.";
  let statusKind = "self";
  if (!socketConnected && described.where === "remote") {
    status = `This computer is offline, so ${described.name} cannot receive a signature until the connection returns.`;
    statusKind = "offline";
  } else if (described.where === "remote" && described.online) {
    status = `${described.name} is online. People sign there. This device prints.`;
    statusKind = "online";
  } else if (described.where === "remote") {
    status = `${described.name} is offline. Open this site on that device, or collecting will offer to sign here.`;
    statusKind = "offline";
  }

  const kindName = kindLabel(self?.kind);
  const customName = self?.name && self.name.toLowerCase() !== kindName.toLowerCase();
  const selfLabel = customName ? `This ${kindName.toLowerCase()} (${self.name})` : `This ${kindName.toLowerCase()}`;

  return (
    <div className="sign-device-picker">
      <div className="sign-device-picker-head">
        <div>
          <span className="switch-title">Sign on</span>
          <span className="switch-hint">Choose once. Pickup keeps using this device until you change it.</span>
        </div>
        {editing ? (
          <form
            className="sign-device-rename"
            onSubmit={(event) => {
              event.preventDefault();
              commitRename();
            }}
          >
            <input
              className="form-input"
              value={draft}
              maxLength={40}
              aria-label="Name this device"
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitRename}
            />
          </form>
        ) : (
          <button
            type="button"
            className="btn-secondary sign-device-rename-btn"
            onClick={() => {
              setDraft(self?.name || "");
              setEditing(true);
            }}
          >
            Rename
          </button>
        )}
      </div>

      <label className="sr-only" htmlFor="sign-device-select">
        Signing device
      </label>
      <select
        id="sign-device-select"
        className="form-select"
        value={described.where === "self" ? "self" : described.deviceId}
        onChange={onSelect}
      >
        <option value="self">{selfLabel}</option>
        {others.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {deviceListLabel(device, {
              online: true,
              duplicate: (names.get(String(device.name || "").toLowerCase()) || 0) > 1,
            })}
          </option>
        ))}
        {savedMissing && (
          <option value={described.deviceId}>
            {deviceListLabel(
              { deviceId: described.deviceId, name: described.name, kind: described.kind },
              { online: false, duplicate: false }
            )}
          </option>
        )}
      </select>

      <p className={`sign-device-status is-${statusKind}`} role="status">
        <span className="sign-device-dot" aria-hidden="true" />
        <span>{status}</span>
      </p>

      {others.length === 0 && described.where === "self" && (
        <p className="sign-device-empty">
          No other device is connected. Open this site on the phone and leave it open. It will show up here.
        </p>
      )}
    </div>
  );
}
