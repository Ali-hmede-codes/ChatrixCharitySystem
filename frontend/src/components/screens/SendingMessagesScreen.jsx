import React from "react";
import { useApp } from "../../context/AppContext.jsx";
import { ExcelScreen } from "./ExcelScreen.jsx";
import { PeopleScreen } from "./PeopleScreen.jsx";
import { SendScreen } from "./SendScreen.jsx";
import {
  IconSpreadsheet,
  IconUsers,
  IconSend,
  IconChevronRight,
  IconCheck,
} from "../common/Icons.jsx";

export function SendingMessagesScreen() {
  const {
    currentStep,
    setCurrentStep,
    people,
    sendJob,
    importedFileName,
  } = useApp();

  const activeStep = ["excel", "list", "send"].includes(currentStep)
    ? currentStep
    : people.length > 0
    ? (sendJob.running ? "send" : "list")
    : "excel";

  const steps = [
    {
      id: "excel",
      number: "1",
      label: "Choose List",
      icon: <IconSpreadsheet className="w-3.5 h-3.5" />,
      badge: importedFileName ? "File ready" : null,
      isDone: Boolean(importedFileName && people.length > 0),
      disabled: false,
    },
    {
      id: "list",
      number: "2",
      label: "Beneficiaries",
      icon: <IconUsers className="w-3.5 h-3.5" />,
      badge: people.length > 0 ? String(people.length) : null,
      isDone: people.length > 0 && activeStep === "send",
      disabled: people.length === 0,
    },
    {
      id: "send",
      number: "3",
      label: "Send Outreach",
      icon: <IconSend className="w-3.5 h-3.5" />,
      badge: sendJob.running ? "Live" : null,
      isDone: false,
      disabled: people.length === 0,
    },
  ];

  return (
    <div className="sending-messages-view">
      {/* Workflow Navigation Bar inside the Tab */}
      <div className="workflow-tab-bar" aria-label="Campaign Workflow">
        <div className="workflow-tab-meta">
          <span className="workflow-tab-title">Sending Messages</span>
          <span className="workflow-tab-desc">Outreach Campaign</span>
        </div>

        <nav className="workflow-stepper">
          {steps.map((step, idx) => {
            const isActive = activeStep === step.id;

            return (
              <React.Fragment key={step.id}>
                {idx > 0 && (
                  <div className="workflow-step-arrow" aria-hidden="true">
                    <IconChevronRight className="w-3.5 h-3.5" />
                  </div>
                )}
                <button
                  type="button"
                  className={`workflow-step-pill ${isActive ? "active" : ""} ${
                    step.disabled ? "disabled" : ""
                  }`}
                  disabled={step.disabled}
                  onClick={() => setCurrentStep(step.id)}
                  title={
                    step.disabled
                      ? "Upload a beneficiary spreadsheet first"
                      : step.label
                  }
                >
                  <span
                    className={`step-circle ${
                      isActive
                        ? "step-circle-active"
                        : step.isDone
                        ? "step-circle-done"
                        : "step-circle-idle"
                    }`}
                  >
                    {step.isDone && !isActive ? (
                      <IconCheck className="w-3 h-3 text-white" />
                    ) : (
                      step.number
                    )}
                  </span>

                  <span className="step-pill-icon">{step.icon}</span>
                  <span className="step-pill-label">{step.label}</span>

                  {step.badge && (
                    <span
                      className={`step-pill-badge ${
                        step.badge === "Live" ? "badge-live" : ""
                      }`}
                    >
                      {step.badge === "Live" && <span className="live-dot-pulse" />}
                      {step.badge}
                    </span>
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </nav>
      </div>

      {/* Screen View for Active Workflow Step */}
      <div className="workflow-content-stage">
        {activeStep === "excel" && <ExcelScreen />}
        {activeStep === "list" && <PeopleScreen />}
        {activeStep === "send" && <SendScreen />}
      </div>
    </div>
  );
}
