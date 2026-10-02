import React from "react";
import { useApp } from "../../context/AppContext.jsx";
import { SignaturePad } from "./SignaturePad.jsx";

function sheetCopy(session) {
  const device = session?.targetName || "The other device";
  const person = session?.person?.name || session?.person?.personName || "This person";
  if (session?.status === "waiting") {
    return {
      title: `Waiting for ${device}`,
      body: `${person} is signing on ${device}. Keep this page open. The receipt prints here after they tap OK.`,
      chip: "Waiting",
    };
  }
  if (session?.status === "timeout") {
    return {
      title: "Signature timed out",
      body: session.message || `No signature arrived from ${device}.`,
      chip: "Timed out",
    };
  }
  if (session?.status === "busy") {
    return {
      title: `${device} is busy`,
      body: session.message || `${device} is already signing for someone else.`,
      chip: "Busy",
    };
  }
  if (session?.status === "declined") {
    return {
      title: "Signature was closed",
      body: session.message || `${device} closed the signature without signing.`,
      chip: "Closed",
    };
  }
  if (session?.status === "offline") {
    return {
      title: `${device} is unreachable`,
      body: session.message || `This computer cannot reach ${device}.`,
      chip: "Offline",
    };
  }
  if (session?.status === "error") {
    return {
      title: "Could not send the signature",
      body: session.message || "The signing device did not accept the request.",
      chip: "Not sent",
    };
  }
  return {
    title: `${device} disconnected`,
    body: session?.message || `${device} disconnected before the signature was saved.`,
    chip: "Disconnected",
  };
}

function HandoffSheet({ session, socketConnected, onSignHere, onRetry, onClose }) {
  const copy = sheetCopy(session);
  const person = session?.person?.name || session?.person?.personName || "This person";
  const waiting = session?.status === "waiting";
  const canRetry = !waiting && socketConnected;

  return (
    <>
      <div className="sign-sheet-backdrop is-open" aria-hidden="true" />
      <aside
        className="sign-sheet is-open sign-handoff"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-handoff-title"
      >
        <div className={`sign-handoff-status is-${session.status || "disconnected"}`}>
          <span className={`sign-handoff-dot ${waiting ? "is-live" : ""}`} aria-hidden="true" />
          <span>{copy.chip}</span>
        </div>
        <div className="sign-sheet-head">
          <h2 id="sign-handoff-title">{copy.title}</h2>
          <p>{copy.body}</p>
        </div>
        <dl className="sign-handoff-facts">
          <div>
            <dt>Person</dt>
            <dd dir="auto">{person}</dd>
          </div>
          <div>
            <dt>Signs on</dt>
            <dd>{session.targetName || "Other device"}</dd>
          </div>
          <div>
            <dt>Prints on</dt>
            <dd>This device</dd>
          </div>
        </dl>
        <div className="sign-sheet-actions sign-handoff-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {waiting ? "Cancel" : "Close"}
          </button>
          {canRetry && (
            <button type="button" className="btn-secondary" onClick={onRetry}>
              Try again
            </button>
          )}
          <button type="button" className="btn-primary" onClick={onSignHere}>
            Sign on this device
          </button>
        </div>
      </aside>
    </>
  );
}

export function SignHandoff() {
  const {
    outgoingSign,
    incomingSign,
    incomingSignBusy,
    localSign,
    pickupBusy,
    socketConnected,
    cancelOutgoingSign,
    retryOutgoingSign,
    signOutgoingHere,
    submitIncomingSign,
    cancelIncomingSign,
    confirmLocalSign,
    cancelLocalSign,
  } = useApp();

  const incomingName = incomingSign?.person?.name || incomingSign?.person?.personName || "";
  const fromName = incomingSign?.fromName || "The desk";
  const localName = localSign?.person?.name || localSign?.person?.personName || "";

  return (
    <>
      {outgoingSign && (
        <HandoffSheet
          session={outgoingSign}
          socketConnected={socketConnected}
          onSignHere={signOutgoingHere}
          onRetry={retryOutgoingSign}
          onClose={cancelOutgoingSign}
        />
      )}
      <SignaturePad
        open={Boolean(localSign) && !incomingSign}
        personName={localName}
        busy={pickupBusy}
        onCancel={cancelLocalSign}
        onConfirm={confirmLocalSign}
      />
      <SignaturePad
        open={Boolean(incomingSign)}
        stack="front"
        personName={incomingName}
        busy={incomingSignBusy}
        title="Sign on this device"
        okLabel="OK"
        description={
          <>
            <strong dir="auto">{incomingName || "This person"}</strong> signs here. {fromName} prints the receipt
            on the other device after you tap OK. Nothing prints here.
          </>
        }
        onCancel={cancelIncomingSign}
        onConfirm={submitIncomingSign}
      />
    </>
  );
}
