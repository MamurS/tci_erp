import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { RoleGuard } from './auth/RoleGuard'
import { AppShell } from './components/layout/AppShell'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { NoAccessPage } from './pages/NoAccessPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { EntitiesPage, EntityDetailPage, StatementFormPage } from './features/entities'
import { ReportPage } from './features/entities/report/ReportPage'
import { legacyRedirect } from './features/entities/redirects'
import { LimitRequestPage, LimitsPage } from './features/limits'
import { RequestDetailPage, RequestsPage } from './features/requests'
import { PoliciesPage, PolicyDetailPage, PolicyFormPage } from './features/policies'
import { DeclarationsPage } from './features/declarations'
import { ClaimsPage } from './features/claims'
import { AdminPage } from './features/admin'

/** Old /buyers and /policyholders bookmarks land on /entities (query kept). */
function LegacyRedirect() {
  const location = useLocation()
  const target = legacyRedirect(location.pathname)
  return <Navigate to={target ? target + location.search : '/entities'} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="entities/:id/report" element={<ReportPage />} />
        <Route path="buyers/:id/report" element={<LegacyRedirect />} />
        <Route element={<AppShell />}>
          {/* Unguarded: legacy redirects and the access notice itself */}
          <Route path="no-access" element={<NoAccessPage />} />
          <Route path="buyers" element={<LegacyRedirect />} />
          <Route path="buyers/*" element={<LegacyRedirect />} />
          <Route path="policyholders" element={<LegacyRedirect />} />
          <Route path="policyholders/*" element={<LegacyRedirect />} />

          {/* Every real section is gated by the role map (navigation.ts) */}
          <Route element={<RoleGuard />}>
            <Route index element={<DashboardPage />} />
            <Route path="entities" element={<EntitiesPage />} />
            <Route path="entities/:id" element={<EntityDetailPage />} />
            <Route path="entities/:id/statements/new" element={<StatementFormPage />} />
            <Route
              path="entities/:id/statements/:statementId/edit"
              element={<StatementFormPage />}
            />
            <Route path="requests" element={<RequestsPage />} />
            <Route path="requests/:id" element={<RequestDetailPage />} />
            <Route path="limits" element={<LimitsPage />} />
            <Route path="limits/:id" element={<LimitRequestPage />} />
            <Route path="policies" element={<PoliciesPage />} />
            <Route path="policies/new" element={<PolicyFormPage />} />
            <Route path="policies/:id" element={<PolicyDetailPage />} />
            <Route path="policies/:id/edit" element={<PolicyFormPage />} />
            <Route path="declarations" element={<DeclarationsPage />} />
            <Route path="claims" element={<ClaimsPage />} />
            <Route path="admin" element={<AdminPage />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
