import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import CareTeamGate from "./components/auth/CareTeamGate";
import CounsellorPage from "./pages/CounsellorPage";
import DoctorPage from "./pages/DoctorPage";
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

// /counsellor and /doctor need a real account of a specific role, unlike
// /provider and /caregiver (a patient's share code is credential enough
// for those) - anyone not logged in as the right role is sent to the
// Care Team sign-in instead of seeing a blank or broken workspace.
function RoleRoute({ role, children }) {
  const { role: myRole } = useAuth();
  if (!myRole) return <Navigate to="/care-team" replace />;
  if (myRole !== role) return <Navigate to={myRole === "doctor" ? "/doctor" : myRole === "counsellor" ? "/counsellor" : "/"} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/care-team" element={<CareTeamGate />} />
      <Route path="/counsellor" element={<RoleRoute role="counsellor"><CounsellorPage /></RoleRoute>} />
      <Route path="/doctor" element={<RoleRoute role="doctor"><DoctorPage /></RoleRoute>} />
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
