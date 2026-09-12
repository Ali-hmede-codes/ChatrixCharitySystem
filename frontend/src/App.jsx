import React from "react";
import { useApp } from "./context/AppContext.jsx";
import { Sidebar } from "./components/layout/Sidebar.jsx";
import { ConnectionBanner } from "./components/layout/ConnectionBanner.jsx";
import { MobileTopBar, NavOverlay, MobileBottomNav } from "./components/layout/MobileChrome.jsx";
import { BootScreen } from "./components/screens/BootScreen.jsx";
import { AuthScreen } from "./components/screens/AuthScreen.jsx";
import { ContactsScreen } from "./components/screens/ContactsScreen.jsx";
import { SettingsScreen } from "./components/screens/SettingsScreen.jsx";
import { SendingMessagesScreen } from "./components/screens/SendingMessagesScreen.jsx";
import { PickupScreen } from "./components/screens/PickupScreen.jsx";

export function App() {
  const { currentStep, toast, navOpen } = useApp();

  if (currentStep === "boot") {
    return (
      <div className="boot-fullscreen-viewport">
        <BootScreen />
        {toast && (
          <div className={`toast-notification toast-${toast.type}`}>
            <span>{toast.message}</span>
          </div>
        )}
      </div>
    );
  }

  const isWorkflow = ["excel", "list", "send", "sending"].includes(currentStep);

  return (
    <div className={`app-shell ${navOpen ? "nav-open" : ""}`}>
      <MobileTopBar />

      <div className="app-shell-body">
        <NavOverlay />
        <Sidebar />

        <main className="main-viewport">
          <ConnectionBanner />
          {currentStep === "auth" && <AuthScreen />}
          {isWorkflow && <SendingMessagesScreen />}
          {currentStep === "pickup" && <PickupScreen />}
          {currentStep === "contacts" && <ContactsScreen />}
          {currentStep === "settings" && <SettingsScreen />}
        </main>
      </div>

      <MobileBottomNav />

      {toast && (
        <div className={`toast-notification toast-${toast.type}`}>
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
