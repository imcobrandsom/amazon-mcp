import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import Layout from './components/Layout';
import ClientOverview from './pages/ClientOverview';
import ClientDetail from './pages/ClientDetail';
import BolDashboard from './pages/BolDashboard';
import BolCompetitorResearch from './pages/BolCompetitorResearch';
import ConversationHistory from './pages/ConversationHistory';
import Settings from './pages/Settings';
import AcademyPage from './pages/AcademyPage';

function ProtectedRoutes() {
  const { session, loading, role, roleLoading } = useAuth();

  if (loading || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 text-slate-500">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            />
          </svg>
          <span className="text-sm font-medium">Loading…</span>
        </div>
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  // Academy users: only see Academy route
  if (role === 'academy') {
    return (
      <Layout>
        <Routes>
          <Route path="/academy/*" element={<AcademyPage />} />
          <Route path="*" element={<Navigate to="/academy" replace />} />
        </Routes>
      </Layout>
    );
  }

  // Admin users: full platform access
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ClientOverview />} />
        <Route path="/clients/:clientId" element={<ClientDetail />} />
        <Route path="/clients/:clientId/bol" element={<BolDashboard />} />
        <Route path="/clients/:clientId/bol-competitor-research" element={<BolCompetitorResearch />} />
        <Route
          path="/clients/:clientId/history"
          element={<ConversationHistory />}
        />
        <Route path="/settings" element={<Settings />} />
        <Route path="/academy/*" element={<AcademyPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={<ProtectedRoutes />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
