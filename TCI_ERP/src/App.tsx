import { Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { AppShell } from './components/layout/AppShell'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { BuyersPage } from './features/buyers'
import { LimitsPage } from './features/limits'
import { PolicyholdersPage } from './features/policyholders'
import { PoliciesPage } from './features/policies'
import { DeclarationsPage } from './features/declarations'
import { ClaimsPage } from './features/claims'
import { AdminPage } from './features/admin'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="buyers" element={<BuyersPage />} />
          <Route path="limits" element={<LimitsPage />} />
          <Route path="policyholders" element={<PolicyholdersPage />} />
          <Route path="policies" element={<PoliciesPage />} />
          <Route path="declarations" element={<DeclarationsPage />} />
          <Route path="claims" element={<ClaimsPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
