import { Route, Routes } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import HomePage from "./pages/HomePage";
import ProviderPage from "./pages/ProviderPage";
import AssessPage from "./pages/AssessPage";
import GuidePage from "./pages/GuidePage";
import NutritionPage from "./pages/NutritionPage";
import MentalWellnessPage from "./pages/MentalWellnessPage";
import PostpartumPage from "./pages/PostpartumPage";
import HistoryPage from "./pages/HistoryPage";
import ReportsPage from "./pages/ReportsPage";
import HelplinesPage from "./pages/HelplinesPage";
import ProfilePage from "./pages/ProfilePage";
import PrivacyPage from "./pages/PrivacyPage";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/provider" element={<ProviderPage />} />
        <Route path="/assess" element={<AssessPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/nutrition" element={<NutritionPage />} />
        <Route path="/mental-wellness" element={<MentalWellnessPage />} />
        <Route path="/postpartum" element={<PostpartumPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/help" element={<HelplinesPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
      </Route>
    </Routes>
  );
}
