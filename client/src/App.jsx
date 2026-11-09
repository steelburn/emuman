import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { ConfirmProvider } from './context/ConfirmContext.jsx';
import { DataProvider } from './context/DataContext.jsx';
import { UiProvider } from './context/UiContext.jsx';
import Layout from './components/Layout.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Login from './pages/Login.jsx';
import Setup from './pages/Setup.jsx';
import Dashboard from './pages/Dashboard.jsx';
import VmList from './pages/VmList.jsx';
import VmDetail from './pages/VmDetail.jsx';
import Storage from './pages/Storage.jsx';
import TerminalPage from './pages/TerminalPage.jsx';
import HostPage from './pages/HostPage.jsx';
import AgentsPage from './pages/AgentsPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import ForcePasswordChange from './pages/ForcePasswordChange.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import NotFound from './pages/NotFound.jsx';

function Splash({ label = 'Starting emuman' }) {
  return (
    <div className="splash">
      <div className="brand-mark">e</div>
      <div>{label}…</div>
    </div>
  );
}

function ProtectedShell() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading) return <Splash />;
  if (auth.setupRequired) return <Navigate to="/setup" replace />;
  if (!auth.user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (auth.user.mustChangePassword) return <ForcePasswordChange />;
  return (
    <DataProvider>
      <UiProvider>
        <Outlet />
      </UiProvider>
    </DataProvider>
  );
}

function GuestOnly({ children }) {
  const auth = useAuth();
  if (auth.loading) return <Splash />;
  if (auth.setupRequired) return <Navigate to="/setup" replace />;
  if (auth.user) return <Navigate to="/" replace />;
  return children;
}

function RequirePermission({ permission, children }) {
  const auth = useAuth();
  if (auth.loading) return <Splash />;
  if (!auth.can(permission)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AuthProvider>
          <ErrorBoundary>
          <Routes>
            <Route
              path="/setup"
              element={
                <SetupGate>
                  <Setup />
                </SetupGate>
              }
            />
            <Route
              path="/login"
              element={
                <GuestOnly>
                  <Login />
                </GuestOnly>
              }
            />
            <Route element={<ProtectedShell />}>
              <Route element={<Layout />}>
                <Route index element={<Dashboard />} />
                <Route path="vms" element={<VmList />} />
                <Route path="vms/:id" element={<VmDetail />} />
                <Route path="storage" element={<Storage />} />
                <Route path="terminal" element={<RequirePermission permission="vm.ssh"><TerminalPage /></RequirePermission>} />
                <Route path="agents" element={<RequirePermission permission="agents.manage"><AgentsPage /></RequirePermission>} />
                <Route path="users" element={<RequirePermission permission="users.manage"><UsersPage /></RequirePermission>} />
                <Route path="host" element={<HostPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Route>
          </Routes>
          </ErrorBoundary>
        </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

function SetupGate({ children }) {
  const auth = useAuth();
  if (auth.loading) return <Splash />;
  if (!auth.setupRequired) return <Navigate to={auth.user ? '/' : '/login'} replace />;
  return children;
}
