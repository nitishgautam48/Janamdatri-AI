import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import CareTeamGate from "./components/auth/CareTeamGate";
import StaffWorkspace from "./pages/StaffWorkspace";
import { useAuth } from "./context/AuthContext";
import HomePage from "./pages/HomePage";
import ProviderPage from "./pages/ProviderPage";
import CaregiverPage from "./pages/CaregiverPage";
import AssessPage from "./pages/AssessPage";
import GuidePage from "./pages/GuidePage";
import NutritionPage from "./pages/NutritionPage";
import MentalWellnessPage from "./pages/MentalWellnessPage";
import PostpartumPage from "./pages/PostpartumPage";
import HistoryPage from "./pages/HistoryPage";
import ReportsPage from "./pages/ReportsPage";
import ReferralSummaryPage from "./pages/ReferralSummaryPage";
import HelplinesPage from "./pages/HelplinesPage";
import ProfilePage from "./pages/ProfilePage";
import PrivacyPage from "./pages/PrivacyPage";

// /counsellor and /doctor need a real counsellor-or-doctor account, unlike
// /provider and /caregiver (a patient's share code is credential enough for
// those) - anyone without one is sent to the Care Team sign-in instead of
// seeing a blank or broken workspace. Either staff role reaches the same
// unified StaffWorkspace shell (queue, conversations, forwarded cases, and
// the caregiver lookup all live behind one login - see STAFF_ROLES in
// src/api/main.py for the matching backend access).
function StaffRoute({ children }) {
  const { role } = useAuth();
  if (!role) return <Navigate to="/care-team" replace />;
  if (role !== "counsellor" && role !== "doctor") return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/care-team" element={<CareTeamGate />} />
      <Route path="/counsellor" element={<StaffRoute><StaffWorkspace initialSection="queue" /></StaffRoute>} />
      <Route path="/doctor" element={<StaffRoute><StaffWorkspace initialSection="docq" /></StaffRoute>} />
      <Route element={<AppShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/provider" element={<ProviderPage />} />
        <Route path="/caregiver" element={<CaregiverPage />} />
        <Route path="/assess" element={<AssessPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/nutrition" element={<NutritionPage />} />
        <Route path="/mental-wellness" element={<MentalWellnessPage />} />
        <Route path="/postpartum" element={<PostpartumPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/referral" element={<ReferralSummaryPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/help" element={<HelplinesPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
      </Route>
    </Routes>
  );
}
