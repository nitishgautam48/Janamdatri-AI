import { Route, Routes } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import HomePage from "./pages/HomePage";
import ProviderPage from "./pages/ProviderPage";
import AssessPage from "./pages/AssessPage";
import GuidePage from "./pages/GuidePage";
import ComingSoon from "./pages/ComingSoon";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/provider" element={<ProviderPage />} />
        <Route path="/assess" element={<AssessPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/nutrition" element={<ComingSoon title="Nutrition Analysis" />} />
        <Route path="/mental-wellness" element={<ComingSoon title="Mental Wellness" />} />
        <Route path="/postpartum" element={<ComingSoon title="Postpartum Care" />} />
        <Route path="/history" element={<ComingSoon title="History" />} />
        <Route path="/reports" element={<ComingSoon title="Reports" />} />
        <Route path="/profile" element={<ComingSoon title="My Profile" />} />
        <Route path="/help" element={<ComingSoon title="Helplines" />} />
        <Route path="/privacy" element={<ComingSoon title="Privacy & Consent Centre" />} />
      </Route>
    </Routes>
  );
}
