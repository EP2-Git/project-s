
import { lazy, Suspense, type ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from '@/hooks/useAuth';
import { env } from '@/config/env';
import { isHostedAudience, type DeploymentAudience } from '@/config/deploymentAudience';
import NotFound from "./pages/NotFound";

// Keep this as a direct import.meta.env comparison so production bundlers can
// remove the entire hosted website graph from a self-hosted build.
const buildIncludesHostedWebsite =
  import.meta.env.VITE_PROJECT_S_DEPLOYMENT_AUDIENCE === 'hosted';

const Index = buildIncludesHostedWebsite ? lazy(() => import("./pages/Index")) : NotFound;
const About = buildIncludesHostedWebsite ? lazy(() => import("./pages/About")) : NotFound;
const BookingConfirmationPage = lazy(() => import("./pages/BookingConfirmationPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const Demo = lazy(() => import("./pages/Demo"));
const EmailVerification = lazy(() => import("./pages/EmailVerification"));
const Features = buildIncludesHostedWebsite ? lazy(() => import("./pages/Features")) : NotFound;
const Login = lazy(() => import("./pages/Login"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const ProfileSettingsPage = lazy(() => import("./pages/ProfileSettingsPage"));
const PublicBookingPage = lazy(() => import("./pages/PublicBookingPage"));
const Signup = lazy(() => import("./pages/Signup"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const AuthorityPipeline = buildIncludesHostedWebsite
  ? lazy(() => import("./pages/design-lab/AuthorityPipeline"))
  : NotFound;
const SchedulingKernel = buildIncludesHostedWebsite
  ? lazy(() => import("./pages/design-lab/SchedulingKernel"))
  : NotFound;
const OwnBookingFlow = buildIncludesHostedWebsite
  ? lazy(() => import("./pages/design-lab/OwnBookingFlow"))
  : NotFound;
const SelectedDirection = buildIncludesHostedWebsite
  ? lazy(() => import("./pages/design-lab/SelectedDirection"))
  : NotFound;

const queryClient = new QueryClient();

export const PrivateRoute = ({ children }: { children: ReactNode }) => {
  const { user, loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status">
        <div>Loading authentication…</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

const RouteLoading = () => (
  <div className="flex min-h-screen items-center justify-center" role="status">
    <div>Loading page…</div>
  </div>
);

interface DeploymentRootProps {
  audience?: DeploymentAudience;
  hostedHome?: ReactNode;
}

export const DeploymentRoot = ({
  audience = env.deploymentAudience,
  hostedHome = <Index />,
}: DeploymentRootProps) => {
  if (isHostedAudience(audience)) {
    return <>{hostedHome}</>;
  }

  return <SelfHostedRoot />;
};

export const SelfHostedRoot = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return <RouteLoading />;
  }

  return <Navigate to={user ? "/dashboard" : "/login"} replace />;
};

interface HostedOnlyRouteProps {
  audience?: DeploymentAudience;
  children: ReactNode;
}

export const HostedOnlyRoute = ({
  audience = env.deploymentAudience,
  children,
}: HostedOnlyRouteProps) => (
  isHostedAudience(audience) ? <>{children}</> : <NotFound />
);

interface ApplicationRoutesProps {
  audience?: DeploymentAudience;
}

export const ApplicationRoutes = ({
  audience = env.deploymentAudience,
}: ApplicationRoutesProps) => (
  <Routes>
    <Route path="/" element={<DeploymentRoot audience={audience} />} />
    <Route path="/login" element={<Login />} />
    <Route path="/signup" element={<Signup />} />
    <Route path="/email-verification" element={<EmailVerification />} />
    <Route path="/demo" element={<Demo />} />
    <Route
      path="/features"
      element={<HostedOnlyRoute audience={audience}><Features /></HostedOnlyRoute>}
    />
    <Route
      path="/about"
      element={<HostedOnlyRoute audience={audience}><About /></HostedOnlyRoute>}
    />
    <Route path="/privacy" element={<PrivacyPolicy />} />
    <Route path="/terms" element={<TermsOfService />} />
    <Route
      path="/dashboard"
      element={(
        <PrivateRoute>
          <DashboardPage />
        </PrivateRoute>
      )}
    />
    <Route path="/dashboard-new" element={<Navigate to="/dashboard" replace />} />
    <Route
      path="/profile-settings"
      element={(
        <PrivateRoute>
          <ProfileSettingsPage />
        </PrivateRoute>
      )}
    />
    <Route path="/book/:username" element={<PublicBookingPage />} />
    <Route path="/booking/confirm" element={<BookingConfirmationPage />} />
    <Route path="/embed/:username" element={<PublicBookingPage embed />} />
    <Route
      path="/design-lab/authority-pipeline"
      element={<HostedOnlyRoute audience={audience}><AuthorityPipeline /></HostedOnlyRoute>}
    />
    <Route
      path="/design-lab/scheduling-kernel"
      element={<HostedOnlyRoute audience={audience}><SchedulingKernel /></HostedOnlyRoute>}
    />
    <Route
      path="/design-lab/own-your-booking-flow"
      element={<HostedOnlyRoute audience={audience}><OwnBookingFlow /></HostedOnlyRoute>}
    />
    <Route
      path="/design-lab/selected-direction"
      element={<HostedOnlyRoute audience={audience}><SelectedDirection /></HostedOnlyRoute>}
    />
    <Route path="*" element={<NotFound />} />
  </Routes>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense
          fallback={<RouteLoading />}
        >
          <ApplicationRoutes />
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
