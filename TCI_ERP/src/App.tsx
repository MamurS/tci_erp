import { Suspense } from 'react'
import { useUiScaleSync } from './features/account/uiScaleApi'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { RequirePasswordChange } from './auth/RequirePasswordChange'
import { RequireMfa } from './auth/RequireMfa'
import { RoleGuard } from './auth/RoleGuard'
import { AppShell } from './components/layout/AppShell'
import { LoginPage } from './pages/LoginPage'
import { MfaVerifyPage } from './pages/MfaVerifyPage'
import { NoAccessPage } from './pages/NoAccessPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PortalRedirect } from './auth/PortalRedirect'
import { LoadingScreen } from './components/ui'
import { lazyPage } from './lib/lazyPage'
import { legacyRedirect } from './features/entities/redirects'
import { LEGACY_POLICY_VIEW_PATHS } from './features/policies/views'
import { LEGACY_LIMIT_VIEW_PATHS } from './features/limits/workbench/views'

// Every page is its own chunk, fetched when first visited: the sign-in
// screen does not download the claims module, and a policyholder in the
// portal never downloads the staff app. The shells keep their frame on
// screen while a page loads (Suspense inside AppShell / PortalShell).
const DashboardPage = lazyPage(() => import('./pages/DashboardPage'), 'DashboardPage')
const entities = () => import('./features/entities')
const EntitiesPage = lazyPage(entities, 'EntitiesPage')
const EntityDetailPage = lazyPage(entities, 'EntityDetailPage')
const StatementFormPage = lazyPage(entities, 'StatementFormPage')
const ReportPage = lazyPage(() => import('./features/entities/report/ReportPage'), 'ReportPage')
const limits = () => import('./features/limits')
const LimitsSection = lazyPage(limits, 'LimitsSection')
const dataDesk = () => import('./features/data')
const DataSection = lazyPage(dataDesk, 'DataSection')
const DataRequestPage = lazyPage(dataDesk, 'RequestPage')
const LimitRequestPage = lazyPage(limits, 'LimitRequestPage')
const requests = () => import('./features/requests')
const RequestsPage = lazyPage(requests, 'RequestsPage')
const RequestDetailPage = lazyPage(requests, 'RequestDetailPage')
const policies = () => import('./features/policies')
const PoliciesSection = lazyPage(policies, 'PoliciesSection')
const PolicyDetailPage = lazyPage(policies, 'PolicyDetailPage')
const PolicyFormPage = lazyPage(policies, 'PolicyFormPage')
const declarations = () => import('./features/declarations')
const DeclarationsPage = lazyPage(declarations, 'DeclarationsPage')
const DeclarationDetailPage = lazyPage(declarations, 'DeclarationDetailPage')
const overdue = () => import('./features/overdue')
const OverduesPage = lazyPage(overdue, 'OverduesPage')
const OverdueDetailPage = lazyPage(overdue, 'OverdueDetailPage')
const claims = () => import('./features/claims')
const ClaimsPage = lazyPage(claims, 'ClaimsPage')
const ClaimDetailPage = lazyPage(claims, 'ClaimDetailPage')
const contractDrafts = () => import('./features/contracts')
const ContractViewPage = lazyPage(contractDrafts, 'ContractViewPage')
const ContractEditPage = lazyPage(contractDrafts, 'ContractEditPage')
const ContractComparePage = lazyPage(contractDrafts, 'ContractComparePage')
const ContractPrintPage = lazyPage(contractDrafts, 'ContractPrintPage')
const PortalContractsPage = lazyPage(() => import('./features/contracts/portal'), 'PortalContractsPage')
const offers = () => import('./features/offers')
const OfferPage = lazyPage(offers, 'OfferPage')
const OfferPrintPage = lazyPage(offers, 'OfferPrintPage')
const PortalOfferPrintPage = lazyPage(offers, 'PortalOfferPrintPage')
const PortalOffersPage = lazyPage(offers, 'PortalOffersPage')
const PortalOfferPage = lazyPage(offers, 'PortalOfferPage')
const AdminPage = lazyPage(() => import('./features/admin'), 'AdminPage')
const AgendaPage = lazyPage(() => import('./features/agenda'), 'AgendaPage')
const account = () => import('./features/account')
const AccountPage = lazyPage(account, 'AccountPage')
const ChangePasswordPage = lazyPage(account, 'ChangePasswordPage')
const portal = () => import('./features/portal')
const PortalShell = lazyPage(portal, 'PortalShell')
const PortalPoliciesPage = lazyPage(portal, 'PortalPoliciesPage')
const PortalLimitsPage = lazyPage(portal, 'PortalLimitsPage')
const PortalDeclarationsPage = lazyPage(portal, 'PortalDeclarationsPage')
const PortalPremiumPage = lazyPage(portal, 'PortalPremiumPage')
const PortalOverduesPage = lazyPage(portal, 'PortalOverduesPage')
const PortalClaimsPage = lazyPage(portal, 'PortalClaimsPage')
const PortalSubmissionsPage = lazyPage(portal, 'PortalSubmissionsPage')
const PortalAccountPage = lazyPage(portal, 'PortalAccountPage')

/** Old /buyers and /policyholders bookmarks land on /entities (query kept). */
function LegacyRedirect() {
  const location = useLocation()
  const target = legacyRedirect(location.pathname)
  return <Navigate to={target ? target + location.search : '/entities'} replace />
}

export default function App() {
  // The person's interface text size, once signed in (0076).
  useUiScaleSync()
  return (
    <Suspense fallback={<LoadingScreen />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="entities/:id/report" element={<ReportPage />} />
        <Route path="buyers/:id/report" element={<LegacyRedirect />} />
        {/* A contract draft on paper: the browser's «Save as PDF» (0057). */}
        <Route path="policies/contracts/:draftId/print" element={<ContractPrintPage />} />
        {/* A commercial offer on paper (0058); the role guard of /requests is
            not needed here — RLS returns nothing to anyone else. */}
        <Route path="requests/offers/:offerId/print" element={<OfferPrintPage />} />
        {/* The portal: its own shell, its own navigation, no staff sections.
            Still behind the password gate — a provisioned client must rotate
            their temporary password before reaching any of it. */}
        {/* The MFA step-up, standalone like the login page. */}
        <Route path="mfa/verify" element={<MfaVerifyPage />} />
        <Route element={<RequirePasswordChange />}>
          <Route element={<RequireMfa />}>
          <Route element={<PortalRedirect />}>
            <Route path="portal/offers/:offerId/print" element={<PortalOfferPrintPage />} />
            <Route path="portal" element={<PortalShell />}>
              <Route index element={<PortalPoliciesPage />} />
              <Route path="limits" element={<PortalLimitsPage />} />
              <Route path="declarations" element={<PortalDeclarationsPage />} />
              <Route path="premium" element={<PortalPremiumPage />} />
              <Route path="overdues" element={<PortalOverduesPage />} />
              <Route path="claims" element={<PortalClaimsPage />} />
              <Route path="submissions" element={<PortalSubmissionsPage />} />
              <Route path="contracts" element={<PortalContractsPage />} />
              <Route path="offers" element={<PortalOffersPage />} />
              <Route path="offers/:offerId" element={<PortalOfferPage />} />
              <Route path="account" element={<PortalAccountPage />} />
            </Route>
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
            {/* Above the MFA gate: the policy sends people HERE to enrol. */}
            <Route path="account" element={<AccountPage />} />
            <Route element={<RequireMfa />}>
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
                <Route path="requests/offers/:offerId/edit" element={<OfferPage />} />
                <Route path="limits" element={<LimitsSection />} />
                <Route path="limits/:id" element={<LimitRequestPage />} />
                <Route path="policies" element={<PoliciesSection />} />
                <Route path="policies/new" element={<PolicyFormPage />} />
                <Route path="policies/:id" element={<PolicyDetailPage />} />
                <Route path="policies/:id/edit" element={<PolicyFormPage />} />
                {/* Contract drafts (0057): viewer, editor, comparison. */}
                <Route path="policies/contracts/:draftId" element={<ContractViewPage />} />
                <Route path="policies/contracts/:draftId/edit" element={<ContractEditPage />} />
                <Route path="policies/contracts/:draftId/compare" element={<ContractComparePage />} />
                <Route path="declarations" element={<DeclarationsPage />} />
                <Route path="declarations/:id" element={<DeclarationDetailPage />} />
                <Route path="overdues" element={<OverduesPage />} />
                <Route path="overdues/:id" element={<OverdueDetailPage />} />
                <Route path="claims" element={<ClaimsPage />} />
                <Route path="claims/:id" element={<ClaimDetailPage />} />
                {/* Contracts and their templates are views of «Полисы» now. */}
                <Route path="contracts" element={<Navigate to={LEGACY_POLICY_VIEW_PATHS['/contracts']} replace />} />
                <Route path="wording" element={<Navigate to={LEGACY_POLICY_VIEW_PATHS['/wording']} replace />} />
                {/* The portfolios are the overview views of «Полисы» and «Кредитные лимиты». */}
                <Route path="portfolio/policies" element={<Navigate to={LEGACY_POLICY_VIEW_PATHS['/portfolio/policies']} replace />} />
                <Route path="portfolio/credit" element={<Navigate to={LEGACY_LIMIT_VIEW_PATHS['/portfolio/credit']} replace />} />
                <Route path="data" element={<DataSection />} />
                <Route path="data/requests/:id" element={<DataRequestPage />} />
                {/* The brochure is the fixed offer template now (no editor, no
                    media library): an old link lands on the submissions, where
                    offers are prepared. */}
                <Route path="brochure" element={<Navigate to="/requests" replace />} />
                <Route path="admin" element={<AdminPage />} />
              </Route>
            </Route>
            </Route>
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
    </Suspense>
  )
}
