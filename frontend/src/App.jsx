import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout.jsx';
import { AuthLayout } from './components/layout/AuthLayout.jsx';
import { PageLoader } from './components/ui/Feedback.jsx';
import { useAuth } from './context/AuthContext.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';

/* Route-level code splitting keeps the initial bundle lean; each screen loads
 * on demand behind the shared loading state. */
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const DeploymentsPage = lazy(() => import('./pages/DeploymentsPage.jsx'));
const IncidentDetailPage = lazy(() => import('./pages/IncidentDetailPage.jsx'));
const IncidentsPage = lazy(() => import('./pages/IncidentsPage.jsx'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'));
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage.jsx'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage.jsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'));
const TimelinePage = lazy(() => import('./pages/TimelinePage.jsx'));

function BootScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <PageLoader label="Restoring session…" />
    </div>
  );
}

/** Full-viewport fallback while a lazy screen chunk loads. */
function ScreenFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <PageLoader label="Loading…" />
    </div>
  );
}

/** Gate for authenticated screens; preserves the intended destination. */
function RequireAuth({ children }) {
  const { user, booting } = useAuth();
  const location = useLocation();
  if (booting) return <BootScreen />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

/** Login/Register are unreachable while signed in. */
function RedirectIfAuthed({ children }) {
  const { user, booting } = useAuth();
  if (booting) return <BootScreen />;
  if (user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Suspense fallback={<ScreenFallback />}>
      <Routes>
        <Route
          element={
            <RedirectIfAuthed>
              <AuthLayout />
            </RedirectIfAuthed>
          }
        >
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="deployments" element={<DeploymentsPage />} />
          <Route path="incidents" element={<IncidentsPage />} />
          <Route path="incidents/:incidentId" element={<IncidentDetailPage />} />
          <Route path="timeline" element={<TimelinePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
