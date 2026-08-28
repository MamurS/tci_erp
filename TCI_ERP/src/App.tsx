import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { RequirePasswordChange } from './auth/RequirePasswordChange'
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
import { DeclarationDetailPage, DeclarationsPage } from './features/declarations'
import { OverdueDetailPage, OverduesPage } from './features/overdue'
import { ClaimsPage } from './features/claims'
import { AdminPage } from './features/admin'
import { AgendaPage } from './features/agenda'
import { ChangePasswordPage } from './features/account'
import {
  PortalAccountPage,
  PortalDeclarationsPage,
  PortalLimitsPage,
  PortalOverduesPage,
  PortalPoliciesPage,
  PortalPremiumPage,
  PortalShell,
  PortalSubmissionsPage,
} from './features/portal'
import { PortalRedirect } from './auth/PortalRedirect'

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
        {/* The portal: its own shell, its own navigation, no staff sections.
            Still behind the password gate — a provisioned client must rotate
            their temporary password before reaching any of it. */}
        <Route element={<RequirePasswordChange />}>
          <Route element={<PortalRedirect />}>
            <Route path="portal" element={<PortalShell />}>
              <Route index element={<PortalPoliciesPage />} />
              <Route path="limits" element={<PortalLimitsPage />} />
              <Route path="declarations" element={<PortalDeclarationsPage />} />
              <Route path="premium" element={<PortalPremiumPage />} />
              <Route path="overdues" element={<PortalOverduesPage />} />
              <Route path="submissions" element={<PortalSubmissionsPage />} />
              <Route path="account" element={<PortalAccountPage />} />
            </Route>
          </Route>
        </Route>

        <Route element={<AppShell />}>
          {/* Above the password gate: this is the one place a user holding
              a temporary password is allowed to be. */}
          <Route path="change-password" element={<ChangePasswordPage />} />

          {/* Unguarded: legacy redirects and the access notice itself */}
          <Route path="no-access" element={<NoAccessPage />} />
          <Route path="buyers" element={<LegacyRedirect />} />
          <Route path="buyers/*" element={<LegacyRedirect />} />
          <Route path="policyholders" element={<LegacyRedirect />} />
          <Route path="policyholders/*" element={<LegacyRedirect />} />

          {/* Everything below is unreachable until a temporary password
              has been rotated, then gated by the role map (navigation.ts) */}
          <Route element={<RequirePasswordChange />}>
            <Route element={<PortalRedirect />}>
              <Route element={<RoleGuard />}>
                <Route index element={<DashboardPage />} />
                <Route path="agenda" element={<AgendaPage />} />
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
                <Route path="declarations/:id" element={<DeclarationDetailPage />} />
                <Route path="overdues" element={<OverduesPage />} />
                <Route path="overdues/:id" element={<OverdueDetailPage />} />
                <Route path="claims" element={<ClaimsPage />} />
                <Route path="admin" element={<AdminPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
