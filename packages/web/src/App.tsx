import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AutoLock } from "./pages/AutoLock.js";
import { LoginPage } from "./pages/LoginPage.js";
import { RegisterPage } from "./pages/RegisterPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { TerminalPage } from "./pages/TerminalPage.js";
import { VaultPage } from "./pages/VaultPage.js";

export function App() {
  return (
    <BrowserRouter>
      <AutoLock />
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/vault" element={<VaultPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/terminal" element={<TerminalPage />} />
      </Routes>
    </BrowserRouter>
  );
}
