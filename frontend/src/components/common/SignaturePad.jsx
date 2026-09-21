import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { compressSignatureCanvas } from "../../services/signature.js";
import { IconCheck, IconX } from "./Icons.jsx";

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, rect.width);
  const cssH = Math.max(1, rect.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2.6;
  return ctx;
}

function pointerPos(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

export function SignaturePad({
  open,
  personName = "",
  busy = false,
  onCancel,
  onConfirm,
}) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const drawingRef = useRef(false);
  const lastRef = useRef(null);
  const [hasInk, setHasInk] = useState(false);

  const resetPad = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    ctxRef.current = fitCanvas(canvas);
    drawingRef.current = false;
    lastRef.current = null;
    setHasInk(false);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    resetPad();
  }, [open, resetPad]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape" && !busy) onCancel?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  function startDraw(event) {
    if (busy) return;
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    event.preventDefault();
    try {
      event.currentTarget?.setPointerCapture?.(event.pointerId);
    } catch {
      /* capture is optional; drawing still works without it */
    }
    drawingRef.current = true;
    const pos = pointerPos(event, canvas);
    lastRef.current = pos;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, Math.max(1.2, ctx.lineWidth / 2), 0, Math.PI * 2);
    ctx.fillStyle = "#111827";
    ctx.fill();
    if (!hasInk) setHasInk(true);
  }

  function moveDraw(event) {
    if (busy) return;
    if (!drawingRef.current && event.buttons === 1) {
      startDraw(event);
    }
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    const last = lastRef.current;
    if (!canvas || !ctx || !last) return;
    event.preventDefault();
    const next = pointerPos(event, canvas);
    const dx = next.x - last.x;
    const dy = next.y - last.y;
    if (dx * dx + dy * dy < 0.6) return;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    lastRef.current = next;
    if (!hasInk) setHasInk(true);
  }

  function endDraw(event) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastRef.current = null;
    try {
      event.currentTarget?.releasePointerCapture?.(event.pointerId);
    } catch {
      /* already released */
    }
  }

  function handleOk() {
    if (!hasInk || busy) return;
    const dataUrl = compressSignatureCanvas(canvasRef.current);
    if (!dataUrl) return;
    onConfirm?.(dataUrl);
  }

  if (!open) return null;

  return (
    <>
      <div className="sign-sheet-backdrop is-open" onClick={() => !busy && onCancel?.()} aria-hidden="true" />
      <aside className="sign-sheet is-open" role="dialog" aria-modal="true" aria-label="Signature">
        <button type="button" className="pickup-sheet-close" onClick={() => !busy && onCancel?.()} aria-label="Close signature">
          <IconX className="w-5 h-5" />
        </button>
        <div className="sign-sheet-head">
          <h2>Sign to collect</h2>
          <p>
            {personName ? (
              <>
                <strong dir="auto">{personName}</strong> signs here, then tap OK to print the receipt.
              </>
            ) : (
              "The person signs here, then tap OK to print the receipt."
            )}
          </p>
        </div>

        <div
          className="sign-pad-wrap"
          role="application"
          aria-label="Signature"
          tabIndex={0}
          onPointerDown={startDraw}
          onPointerMove={moveDraw}
          onPointerUp={endDraw}
          onPointerCancel={endDraw}
        >
          {!hasInk && <span className="sign-pad-hint">Sign here</span>}
          <canvas ref={canvasRef} className="sign-pad-canvas" />
        </div>

        <div className="sign-sheet-actions">
          <button type="button" className="btn-secondary" disabled={busy || !hasInk} onClick={resetPad}>
            Clear
          </button>
          <button type="button" className="btn-primary" disabled={busy || !hasInk} onClick={handleOk}>
            <IconCheck className="w-4 h-4 mr-1.5" />
            <span>OK</span>
          </button>
        </div>
      </aside>
    </>
  );
}
