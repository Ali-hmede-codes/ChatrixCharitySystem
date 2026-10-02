import { createSignDeviceService } from "../src/features/sign-devices/service.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function createHarness(sessionMs = 40) {
  const sockets = new Map();
  let seq = 0;
  function add() {
    seq += 1;
    const sock = {
      id: `s${seq}`,
      events: [],
      emit(event, payload) {
        this.events.push({ event, payload });
      },
    };
    sockets.set(sock.id, sock);
    return sock;
  }
  const svc = createSignDeviceService({ io: { sockets: { sockets } } }, { sessionMs });
  return { svc, add };
}

function last(sock, event) {
  return [...sock.events].reverse().find((item) => item.event === event) || null;
}

function saw(sock, needle) {
  return sock.events.some((item) => JSON.stringify(item.payload).includes(needle));
}

const signature = `data:image/jpeg;base64,${"A".repeat(48)}`;
const laptopId = "laptop-device-01";
const phoneId = "phone-device-0001";
const otherId = "other-device-0001";

const { svc, add } = createHarness();
const laptop = add();
const phone = add();
const other = add();

svc.hello(laptop, { deviceId: laptopId, name: "Front desk", kind: "computer" });
svc.hello(phone, { deviceId: phoneId, name: "Counter phone", kind: "phone" });
svc.hello(other, { deviceId: otherId, name: "Back office", kind: "computer" });

const listed = last(laptop, "sign-device:list");
assert(listed.payload.devices.length === 3, "expected 3 devices");
assert(listed.payload.devices.find((device) => device.deviceId === laptopId).self === true, "laptop should be self");
assert(listed.payload.devices.find((device) => device.deviceId === phoneId).self === false, "phone should not be self");
assert(!saw(laptop, "base64"), "device list leaked a signature");

svc.request(laptop, {
  requestId: "req-same-device",
  targetDeviceId: laptopId,
  campaignId: "c1",
  phone: "963944000001",
  personName: "Ada",
});
assert(last(laptop, "pickup:sign-error").payload.code === "self", "same device should be rejected");

svc.request(laptop, {
  requestId: "req-missing01",
  targetDeviceId: "missing-device-1",
  campaignId: "c1",
  phone: "963944000001",
  personName: "Ada",
});
assert(last(laptop, "pickup:sign-error").payload.code === "offline", "missing device should be offline");

svc.request(laptop, {
  requestId: "req-sign-0001",
  targetDeviceId: phoneId,
  campaignId: "camp-1",
  phone: "963944000001",
  personName: "Ada Lovelace",
  name: "Ada Lovelace",
  mode: "mark",
});
const incoming = last(phone, "pickup:sign-incoming");
assert(incoming.payload.person.name === "Ada Lovelace", "phone should see the person");
assert(incoming.payload.fromName === "Front desk", "phone should see the desk name");
assert(!("signature" in incoming.payload), "incoming request must not include a signature");
assert(last(laptop, "pickup:sign-waiting").payload.targetName === "Counter phone", "desk should wait on the phone");
assert(!last(other, "pickup:sign-incoming"), "a third device must not receive the sign request");

svc.request(laptop, {
  requestId: "req-busy-0001",
  targetDeviceId: phoneId,
  campaignId: "c1",
  phone: "963944000002",
  personName: "Bob",
});
assert(last(laptop, "pickup:sign-error").payload.code === "busy", "phone should be busy");

svc.submit(phone, { requestId: "req-sign-0001", signature: "nope" });
assert(/Draw the signature/i.test(last(phone, "pickup:sign-error").payload.error), "empty signature should be rejected");
assert(!last(laptop, "pickup:sign-ready"), "desk must not print an empty signature");

svc.submit(other, { requestId: "req-sign-0001", signature });
assert(/no longer active/i.test(last(other, "pickup:sign-error").payload.error), "another device cannot submit");

svc.submit(phone, { requestId: "req-sign-0001", signature });
const ready = last(laptop, "pickup:sign-ready");
assert(ready.payload.signature === signature, "desk should receive the signature");
assert(ready.payload.mode === "mark", "mode should stay mark");
assert(last(phone, "pickup:sign-finished").payload.name === "Ada Lovelace", "phone should be told it sent");
assert(!saw(phone, signature), "phone events must not echo the signature image");
assert(!last(other, "pickup:sign-ready"), "third device must not receive the signature");

svc.submit(phone, { requestId: "req-sign-0001", signature });
assert(/no longer active/i.test(last(phone, "pickup:sign-error").payload.error), "a finished request cannot be submitted again");

svc.request(laptop, {
  requestId: "req-drop-0001",
  targetDeviceId: phoneId,
  campaignId: "c1",
  phone: "963944000003",
  personName: "Grace",
});
svc.onDisconnect(phone);
assert(last(laptop, "pickup:sign-cancelled").payload.reason === "disconnected", "desk should see the phone disconnect");
assert(!last(laptop, "sign-device:list").payload.devices.some((device) => device.deviceId === phoneId), "phone should leave the list");

svc.hello(phone, { deviceId: phoneId, name: "Counter phone", kind: "phone" });
svc.request(laptop, {
  requestId: "req-decline-01",
  targetDeviceId: phoneId,
  campaignId: "c1",
  phone: "963944000003",
  personName: "Grace",
});
assert(last(laptop, "pickup:sign-waiting"), "phone should accept a new request after reconnect");
svc.cancel(phone, { requestId: "req-decline-01" });
assert(last(laptop, "pickup:sign-cancelled").payload.reason === "declined", "closing the pad should tell the desk");

svc.request(laptop, {
  requestId: "req-cancel-001",
  targetDeviceId: phoneId,
  campaignId: "c1",
  phone: "963944000003",
  personName: "Grace",
});
svc.cancel(laptop, { requestId: "req-cancel-001" });
assert(last(phone, "pickup:sign-cancelled").payload.reason === "cancelled", "desk cancel should close the phone");

svc.request(laptop, {
  requestId: "req-desk-00001",
  targetDeviceId: phoneId,
  campaignId: "c1",
  phone: "963944000003",
  personName: "Grace",
});
svc.onDisconnect(laptop);
assert(last(phone, "pickup:sign-cancelled").payload.reason === "desk-disconnected", "phone should hear that the desk left");
svc.submit(phone, { requestId: "req-desk-00001", signature });
assert(/no longer active|not saved/i.test(last(phone, "pickup:sign-error")?.payload.error || last(phone, "pickup:sign-cancelled").payload.message), "a late signature must not be saved");

const phoneTab = add();
svc.hello(laptop, { deviceId: laptopId, name: "Front desk", kind: "computer" });
svc.request(laptop, {
  requestId: "req-retarget01",
  targetDeviceId: phoneId,
  campaignId: "c1",
  phone: "963944000003",
  personName: "Grace",
});
svc.hello(phoneTab, { deviceId: phoneId, name: "Counter phone", kind: "phone" });
assert(last(phone, "sign-device:replaced"), "the old phone tab should be told it was replaced");
assert(last(laptop, "pickup:sign-cancelled").payload.reason === "disconnected", "a new phone tab should cancel the open request");

svc.rename(phoneTab, { name: "Window phone" });
assert(last(laptop, "sign-device:list").payload.devices.some((device) => device.name === "Window phone"), "rename should reach the desk");

svc.request(laptop, {
  requestId: "req-timeout-01",
  targetDeviceId: phoneId,
  campaignId: "c1",
  phone: "963944000003",
  personName: "Grace",
});
await new Promise((resolve) => setTimeout(resolve, 80));
assert(last(laptop, "pickup:sign-cancelled").payload.reason === "timeout", "desk should time out");
assert(last(phoneTab, "pickup:sign-cancelled").payload.reason === "timeout", "phone should time out");

console.log("sign-device checks passed");
