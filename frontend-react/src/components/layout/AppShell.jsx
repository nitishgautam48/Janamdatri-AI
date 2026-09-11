import { Outlet, useLocation } from "react-router-dom";
import TopNav from "./TopNav";
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
      <TopNav />
      {hasIdentity || isPublicRoute ? (
        <main className="mx-auto max-w-7xl px-4 py-8 lg:px-8">
          <Outlet />
        </main>
      ) : (
        <WelcomeGate />
      )}
      {hasIdentity && <ChatWidget />}
    </div>
  );
}
