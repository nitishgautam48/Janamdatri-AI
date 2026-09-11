import { Outlet, useLocation } from "react-router-dom";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";
import GlobalEmergencyBanner from "./GlobalEmergencyBanner";
import ChatWidget from "../chat/ChatWidget";
import { useAuth } from "../../context/AuthContext";
import WelcomeGate from "../auth/WelcomeGate";

// /provider is deliberately login-free (a provider has no account of
// their own - the patient's share code IS the credential), so it's the
// one route that bypasses the welcome gate entirely.
const PUBLIC_PATHS = new Set(["/provider"]);

export default function AppShell() {
  const { hasIdentity } = useAuth();
  const location = useLocation();
  const isPublicRoute = PUBLIC_PATHS.has(location.pathname);

  return (
    <div className="min-h-screen bg-bg text-ink">
      <TopBar />
      {hasIdentity && <GlobalEmergencyBanner />}
      {hasIdentity || isPublicRoute ? (
        <div className="mx-auto flex max-w-7xl">
          {hasIdentity && <Sidebar />}
          <main className="min-w-0 flex-1 px-4 py-8 pb-24 lg:px-8 lg:pb-8">
            <Outlet />
          </main>
        </div>
      ) : (
        <WelcomeGate />
      )}
      {hasIdentity && <BottomNav />}
      {hasIdentity && <ChatWidget />}
    </div>
  );
}
