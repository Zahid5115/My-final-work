import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { ServicesSection } from './components/ServicesSection';
import { BeforeAfterGallery } from './components/BeforeAfterGallery';
import { QuoteEstimator, type EstimatePayload } from './components/QuoteEstimator';
import { WorkOrdersAndCoverage } from './components/WorkOrdersAndCoverage';
import { VendorPortal } from './components/VendorPortal';
import { AboutAndReviews } from './components/AboutAndReviews';
import { BidRequestModal } from './components/BidRequestModal';
import { FloatingDispatchWidget } from './components/FloatingDispatchWidget';
import { Footer } from './components/Footer';
import { usePublicBootstrap } from './hooks/usePublicBootstrap';
import { AdminAuthProvider } from './admin/hooks/useAdminAuth';
import { AdminLayout, ProtectedAdminRoute } from './admin/layout/AdminLayout';

const AdminLoginPage = lazy(() =>
  import('./admin/pages/AdminLoginPage').then((m) => ({ default: m.AdminLoginPage }))
);
const DashboardPage = lazy(() =>
  import('./admin/pages/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);
const WorkOrdersPage = lazy(() =>
  import('./admin/pages/WorkOrdersPage').then((m) => ({ default: m.WorkOrdersPage }))
);
const WorkOrderDetailPage = lazy(() =>
  import('./admin/pages/WorkOrderDetailPage').then((m) => ({ default: m.WorkOrderDetailPage }))
);
const VendorsPage = lazy(() =>
  import('./admin/pages/VendorsPage').then((m) => ({ default: m.VendorsPage }))
);
const VendorDetailPage = lazy(() =>
  import('./admin/pages/VendorDetailPage').then((m) => ({ default: m.VendorDetailPage }))
);
const ClientsPage = lazy(() =>
  import('./admin/pages/ClientsPage').then((m) => ({ default: m.ClientsPage }))
);
const ClientDetailPage = lazy(() =>
  import('./admin/pages/ClientDetailPage').then((m) => ({ default: m.ClientDetailPage }))
);
const BidRequestsPage = lazy(() =>
  import('./admin/pages/BidRequestsPage').then((m) => ({ default: m.BidRequestsPage }))
);
const BidRequestDetailPage = lazy(() =>
  import('./admin/pages/BidRequestDetailPage').then((m) => ({ default: m.BidRequestDetailPage }))
);
const DispatchPage = lazy(() =>
  import('./admin/pages/DispatchPage').then((m) => ({ default: m.DispatchPage }))
);
const ServicesAdminPage = lazy(() =>
  import('./admin/pages/ServicesAdminPage').then((m) => ({ default: m.ServicesAdminPage }))
);
const GalleryAdminPage = lazy(() =>
  import('./admin/pages/GalleryAdminPage').then((m) => ({ default: m.GalleryAdminPage }))
);
const CoverageAdminPage = lazy(() =>
  import('./admin/pages/CoverageAdminPage').then((m) => ({ default: m.CoverageAdminPage }))
);
const ReviewsAdminPage = lazy(() =>
  import('./admin/pages/ReviewsAdminPage').then((m) => ({ default: m.ReviewsAdminPage }))
);
const MessagesAdminPage = lazy(() =>
  import('./admin/pages/MessagesAdminPage').then((m) => ({ default: m.MessagesAdminPage }))
);
const ReportsAdminPage = lazy(() =>
  import('./admin/pages/ReportsAdminPage').then((m) => ({ default: m.ReportsAdminPage }))
);
const SettingsAdminPage = lazy(() =>
  import('./admin/pages/SettingsAdminPage').then((m) => ({ default: m.SettingsAdminPage }))
);
const ProfileAdminPage = lazy(() =>
  import('./admin/pages/ProfileAdminPage').then((m) => ({ default: m.ProfileAdminPage }))
);
const AdminUsersPage = lazy(() =>
  import('./admin/pages/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage }))
);

const RouteLoadingFallback = () => (
  <div className="flex min-h-[50vh] items-center justify-center p-8 text-sm font-medium text-[#052E16]/70 dark:text-lime-200/75">
    Loading portal view...
  </div>
);

function getInitialDarkState(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const saved = window.localStorage.getItem('theme');
    if (saved === 'dark') return true;
    if (saved === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function PublicSitePage({
  isDark,
  onToggleTheme
}: {
  isDark: boolean;
  onToggleTheme: () => void;
}) {
  const [aboutHighlighted, setAboutHighlighted] = useState<boolean>(false);
  const [prefilledEstimate, setPrefilledEstimate] = useState<EstimatePayload | null>(null);
  const [bidModalOpen, setBidModalOpen] = useState<boolean>(false);
  const [quotaExceeded, setQuotaExceeded] = useState<boolean>(false);

  const {
    services,
    galleryCases,
    coverageRegions,
    reviews,
    workOrders,
    businessInfo
  } = usePublicBootstrap();

  useEffect(() => {
    const handleQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuota);
  }, []);

  const handleAboutClick = useCallback(() => {
    setAboutHighlighted(true);
    window.setTimeout(() => setAboutHighlighted(false), 2400);
  }, []);

  const scrollToSection = useCallback((selector: string) => {
    const el = document.querySelector(selector);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleApplyEstimate = useCallback((payload: EstimatePayload) => {
    setPrefilledEstimate(payload);
    setBidModalOpen(true);
  }, []);

  return (
    <div className="min-h-screen overflow-x-clip bg-[#F6FAF1] text-[#052E16] dark:bg-[#03170C] dark:text-lime-50">
      {quotaExceeded && (
        <div
          role="status"
          className="sticky top-0 z-50 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-xs text-amber-900 shadow-sm md:text-sm"
        >
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-amber-950 underline hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      <Navbar
        isDark={isDark}
        onToggleTheme={onToggleTheme}
        onAboutClick={handleAboutClick}
        onRequestBidClick={() => setBidModalOpen(true)}
      />

      <main>
        <Hero
          onEstimateClick={() => scrollToSection('#estimator')}
          onRequestBidClick={() => setBidModalOpen(true)}
        />

        <ServicesSection services={services} />

        <BeforeAfterGallery cases={galleryCases} />

        <QuoteEstimator onApplyEstimate={handleApplyEstimate} />

        <WorkOrdersAndCoverage
          isDark={isDark}
          workOrders={workOrders}
          coverageRegions={coverageRegions}
        />

        <VendorPortal workOrders={workOrders} />

        <AboutAndReviews
          aboutHighlighted={aboutHighlighted}
          onRequestBidClick={() => setBidModalOpen(true)}
          businessInfo={businessInfo}
          reviews={reviews}
        />
      </main>

      <Footer businessInfo={businessInfo} />

      <BidRequestModal
        isOpen={bidModalOpen}
        onClose={() => setBidModalOpen(false)}
        prefilledEstimate={prefilledEstimate}
      />

      <FloatingDispatchWidget businessPhone={businessInfo.phone} />
    </div>
  );
}

export default function App() {
  const [isDark, setIsDark] = useState<boolean>(getInitialDarkState);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      window.localStorage.setItem('theme', isDark ? 'dark' : 'light');
    } catch {
      // Ignore storage errors
    }
  }, [isDark]);

  const handleToggleTheme = useCallback(() => {
    setIsDark((prev) => !prev);
  }, []);

  return (
    <AdminAuthProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
          <Route
            path="/"
            element={<PublicSitePage isDark={isDark} onToggleTheme={handleToggleTheme} />}
          />

          <Route path="/admin/login" element={<AdminLoginPage mode="login" />} />
          <Route path="/admin/setup" element={<AdminLoginPage mode="setup" />} />
          <Route path="/admin/forgot-password" element={<AdminLoginPage mode="forgot" />} />
          <Route path="/admin/reset-password" element={<AdminLoginPage mode="reset" />} />

          <Route
            path="/admin"
            element={
              <ProtectedAdminRoute>
                <AdminLayout isDark={isDark} onToggleTheme={handleToggleTheme} />
              </ProtectedAdminRoute>
            }
          >
            <Route index element={<Navigate to="/admin/dashboard" replace />} />
            <Route
              path="dashboard"
              element={
                <ProtectedAdminRoute requiredPermission="dashboard.view">
                  <DashboardPage />
                </ProtectedAdminRoute>
              }
            />
            <Route
              path="work-orders"
              element={
                <ProtectedAdminRoute requiredPermission="work_orders.read">
                  <WorkOrdersPage />
                </ProtectedAdminRoute>
              }
            />
            <Route
              path="work-orders/:id"
              element={
                <ProtectedAdminRoute requiredPermission="work_orders.read">
                  <WorkOrderDetailPage />
                </ProtectedAdminRoute>
              }
            />
            <Route
              path="vendors"
              element={
                <ProtectedAdminRoute requiredPermission="vendors.read">
                  <VendorsPage />
                </ProtectedAdminRoute>
              }
            />
            <Route
              path="vendors/:id"
              element={
                <ProtectedAdminRoute requiredPermission="vendors.read">
                  <VendorDetailPage />
                </ProtectedAdminRoute>
              }
            />
            <Route
              path="clients"
              element={
                <ProtectedAdminRoute requiredPermission="clients.read">
                  <ClientsPage />
                </ProtectedAdminRoute>
              }
            />
            <Route
              path="clients/:id"
              element={
                <ProtectedAdminRoute requiredPermission="clients.read">
                  <ClientDetailPage />
                </ProtectedAdminRoute>
              }
            />
            <Route
              path="bid-requests"
              element={
                <ProtectedAdminRoute requiredPermission="bid_requests.read">
                  <BidRequestsPage />
                </ProtectedAdminRoute>
              }
            />
            <Route
              path="bid-requests/:id"
              element={
                <ProtectedAdminRoute requiredPermission="bid_requests.read">
                  <BidRequestDetailPage />
                </ProtectedAdminRoute>
              }
            />
            <Route
              path="dispatch"
              element={
                <ProtectedAdminRoute requiredPermission="dispatch.read">
                  <DispatchPage />
                </ProtectedAdminRoute>
              }
            />
            <Route
              path="services"
              element={
                <ProtectedAdminRoute requiredPermission="services.manage">
                  <ServicesAdminPage />
                </ProtectedAdminRoute>
              }
            />
            <Route
              path="gallery"
              element={
                <ProtectedAdminRoute requiredPermission="gallery.manage">
                  <GalleryAdminPage />
                </ProtectedAdminRoute>
              }
            />
            <Route
              path="coverage"
              element={
                <ProtectedAdminRoute requiredPermission="coverage.manage">
                  <CoverageAdminPage />
                </ProtectedAdminRoute>
              }
            />
            <Route
              path="reviews"
              element={
                <ProtectedAdminRoute requiredPermission="reviews.manage">
                  <ReviewsAdminPage />
                </ProtectedAdminRoute>
              }
            />
            <Route
              path="messages"
              element={
                <ProtectedAdminRoute requiredPermission="messages.manage">
                  <MessagesAdminPage />
                </ProtectedAdminRoute>
              }
            />
            <Route
              path="reports"
              element={
                <ProtectedAdminRoute requiredPermission="reports.view">
                  <ReportsAdminPage />
                </ProtectedAdminRoute>
              }
            />
            <Route
              path="users"
              element={
                <ProtectedAdminRoute requiredPermission="admin_users.manage">
                  <AdminUsersPage />
                </ProtectedAdminRoute>
              }
            />
            <Route path="settings" element={<SettingsAdminPage />} />
            <Route path="profile" element={<ProfileAdminPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AdminAuthProvider>
  );
}
