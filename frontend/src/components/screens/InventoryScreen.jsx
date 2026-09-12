import React, { useEffect, useState } from "react";
import { useApp } from "../../context/AppContext.jsx";
import { IconTicket, IconCheck, IconAlertCircle, IconRefresh } from "../common/Icons.jsx";

const LOW_THRESHOLD = 20;

export function InventoryScreen() {
  const { inventory, saveInventory, showToast } = useApp();
  const [countInput, setCountInput] = useState(String(inventory.count || 0));
  const [labelInput, setLabelInput] = useState(inventory.label || "Aid portions");

  useEffect(() => {
    setCountInput(String(inventory.count || 0));
  }, [inventory.count]);

  useEffect(() => {
    setLabelInput(inventory.label || "Aid portions");
  }, [inventory.label]);

  const count = Number(inventory.count) || 0;
  const blocked = count <= 0;
  const low = count > 0 && count < LOW_THRESHOLD;

  function handleSave(e) {
    e?.preventDefault?.();
    const next = Math.max(0, Math.trunc(Number(countInput) || 0));
    setCountInput(String(next));
    saveInventory({ count: next, label: labelInput.trim() || "Aid portions" });
  }

  function quickAdjust(delta) {
    const next = Math.max(0, Math.trunc(Number(countInput) || 0) + delta);
    setCountInput(String(next));
  }

  return (
    <div className="page-view inventory-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Aid Inventory</h1>
          <p className="page-subtitle">
            Set how much aid you have in stock. Each time a beneficiary collects at the Aid Pickup desk, the count goes down by 1.
            Collecting is blocked when it reaches 0, and you get a warning when it drops under {LOW_THRESHOLD}.
          </p>
        </div>
      </div>

      <div className="page-content-scroll">
        <div className="inventory-layout">
          {/* Current stock card */}
          <section className={`inventory-status-card ${blocked ? "is-blocked" : low ? "is-low" : "is-ok"}`}>
            <div className="inventory-status-icon">
              <IconTicket className="w-7 h-7" />
            </div>
            <div className="inventory-status-num">{count}</div>
            <div className="inventory-status-label">{inventory.label || "Aid portions"} in stock</div>
            {blocked ? (
              <div className="inventory-status-flag flag-danger">
                <IconAlertCircle className="w-4 h-4" />
                <span>Out of stock — collecting is blocked. Restock below.</span>
              </div>
            ) : low ? (
              <div className="inventory-status-flag flag-warn">
                <IconAlertCircle className="w-4 h-4" />
                <span>Running low — only {count} left. Restock soon.</span>
              </div>
            ) : (
              <div className="inventory-status-flag flag-ok">
                <IconCheck className="w-4 h-4" />
                <span>Stock healthy.</span>
              </div>
            )}
          </section>

          {/* Set / restock form */}
          <section className="inventory-form-card">
            <h3 className="card-section-title">Set or restock inventory</h3>
            <p className="card-section-desc">
              Enter the total amount you currently have. Saving replaces the count (use the +/− buttons to adjust quickly).
            </p>

            <form className="inventory-form" onSubmit={handleSave}>
              <div className="form-group">
                <label className="form-label" htmlFor="inv-count-input">
                  Amount in stock
                </label>
                <div className="inventory-stepper">
                  <button type="button" className="btn-secondary inventory-step-btn" onClick={() => quickAdjust(-10)}>
                    −10
                  </button>
                  <button type="button" className="btn-secondary inventory-step-btn" onClick={() => quickAdjust(-1)}>
                    −1
                  </button>
                  <input
                    id="inv-count-input"
                    type="number"
                    min="0"
                    step="1"
                    className="form-input inventory-step-input"
                    value={countInput}
                    onChange={(e) => setCountInput(e.target.value)}
                  />
                  <button type="button" className="btn-secondary inventory-step-btn" onClick={() => quickAdjust(1)}>
                    +1
                  </button>
                  <button type="button" className="btn-secondary inventory-step-btn" onClick={() => quickAdjust(10)}>
                    +10
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="inv-label-input">
                  What is this aid? (label)
                </label>
                <input
                  id="inv-label-input"
                  type="text"
                  className="form-input"
                  placeholder="Aid portions"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  maxLength={60}
                />
                <span className="form-hint">Shown on the pickup desk and toasts. e.g. “Aid portions”, “Food boxes”, “Blankets”.</span>
              </div>

              <div className="form-actions">
                <button type="submit" className="btn-primary">
                  <IconCheck className="w-4 h-4 mr-1.5" />
                  <span>Save inventory</span>
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setCountInput("0");
                    showToast("Set to 0 — press Save to confirm. Collecting will be blocked.", "warning");
                  }}
                >
                  <IconRefresh className="w-4 h-4 mr-1.5" />
                  <span>Reset to 0</span>
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
