import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { MapPage } from './pages/MapPage';
import { ReportsPage } from './pages/ReportsPage';
import { LoginPage } from './pages/LoginPage';
import { UserManagementPage } from './pages/UserManagementPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AiDatasetPage } from './pages/AiDatasetPage';
import { TeamsPage } from './pages/TeamsPage';
import { AuthProvider, useAuth } from './context/AuthContext';
import 'leaflet/dist/leaflet.css';

function ProtectedRoute({ children, adminOnly = false }) {
  const { role } = useAuth();
  if (!role) return <Navigate to="/login" replace />;
  if (adminOnly && role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

// Admins and authorities plan the city, so they land on the analytics that
// support that decision rather than a raw report dump. Workers land on the
// simple operational dashboard, which is what a field role actually needs.
function HomeRoute() {
  const { role } = useAuth();
  const isPlanner = role === 'admin' || role === 'authority' || role?.startsWith('authority_');
  return isPlanner ? <AnalyticsPage /> : <DashboardPage />;
}

function AppRoutes() {
  const { role } = useAuth();

  return (
    <Routes>
      {!role ? (
        <>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </>
      ) : (
        <Route path="/" element={<Layout />}>
          <Route index element={<HomeRoute />} />
          <Route path="map" element={<MapPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route
            path="teams"
            element={
              <ProtectedRoute>
                <TeamsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="analytics"
            element={
              <ProtectedRoute>
                <AnalyticsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="users"
            element={
              <ProtectedRoute adminOnly>
                <UserManagementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="ai-dataset"
            element={
              <ProtectedRoute adminOnly>
                <AiDatasetPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
