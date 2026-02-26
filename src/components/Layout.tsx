import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutGrid, LogOut, ChevronRight, Settings, ChevronDown, ShoppingCart } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import clsx from 'clsx';

interface LayoutProps {
  children: React.ReactNode;
}

interface BolNavCustomer {
  id: string;
  seller_name: string;
  client_id: string | null;
}

export default function Layout({ children }: LayoutProps) {
  const { user, signOut } = useAuth();
  const location = useLocation();

  const [bolCustomers, setBolCustomers] = useState<BolNavCustomer[]>([]);
  const [bolOpen, setBolOpen] = useState(() =>
    location.pathname.includes('/bol')
  );

  // Fetch bol customers once on mount
  useEffect(() => {
    fetch('/api/bol-customers')
      .then(r => r.ok ? r.json() : { customers: [] })
      .then((data: { customers?: BolNavCustomer[] }) => {
        setBolCustomers(
          (data.customers ?? []).filter(c => c.client_id)
        );
      })
      .catch(() => {});
  }, []);

  // Auto-expand when navigating to a bol page
  useEffect(() => {
    if (location.pathname.includes('/bol')) setBolOpen(true);
  }, [location.pathname]);

  const isBolActive = location.pathname.includes('/bol');

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-navy-950 flex flex-col text-white">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-navy-800">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-brand-500 flex items-center justify-center">
              <span className="text-white font-bold text-xs">F</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-white leading-tight">
                Follo AI
              </p>
              <p className="text-[10px] text-navy-300 leading-tight">
                Marketplace Platform
              </p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          <Link
            to="/"
            className={clsx(
              'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
              location.pathname === '/'
                ? 'bg-brand-600 text-white'
                : 'text-navy-200 hover:bg-navy-800 hover:text-white'
            )}
          >
            <LayoutGrid size={15} />
            Clients
          </Link>

          {/* Bol.com section */}
          {bolCustomers.length > 0 && (
            <div>
              <button
                onClick={() => setBolOpen(o => !o)}
                className={clsx(
                  'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors w-full',
                  isBolActive
                    ? 'text-orange-300'
                    : 'text-navy-200 hover:bg-navy-800 hover:text-white'
                )}
              >
                <div className="w-3.5 h-3.5 bg-orange-500 rounded-sm flex-shrink-0" />
                <span className="flex-1 text-left">Bol.com</span>
                <ChevronDown
                  size={12}
                  className={clsx('transition-transform duration-150', bolOpen && 'rotate-180')}
                />
              </button>

              {bolOpen && (
                <div className="mt-0.5 ml-2 space-y-0.5">
                  {bolCustomers.map(c => (
                    <Link
                      key={c.id}
                      to={`/clients/${c.client_id}/bol`}
                      className={clsx(
                        'flex items-center gap-2 pl-5 pr-3 py-1.5 rounded-md text-xs transition-colors',
                        location.pathname === `/clients/${c.client_id}/bol`
                          ? 'bg-orange-500/20 text-orange-300 font-medium'
                          : 'text-navy-300 hover:bg-navy-800 hover:text-white'
                      )}
                    >
                      <ShoppingCart size={11} className="flex-shrink-0 opacity-60" />
                      {c.seller_name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          <Link
            to="/settings"
            className={clsx(
              'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
              location.pathname === '/settings'
                ? 'bg-brand-600 text-white'
                : 'text-navy-200 hover:bg-navy-800 hover:text-white'
            )}
          >
            <Settings size={15} />
            Settings
          </Link>
        </nav>

        {/* User */}
        <div className="px-3 py-4 border-t border-navy-800">
          {user && (
            <div className="flex items-center gap-2.5 mb-3 px-2">
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.full_name ?? user.email}
                  className="w-7 h-7 rounded-full object-cover"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-brand-600 flex items-center justify-center text-xs font-medium text-white">
                  {(user.full_name ?? user.email)[0].toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium text-white truncate">
                  {user.full_name ?? user.email.split('@')[0]}
                </p>
                <p className="text-[10px] text-navy-400 truncate">{user.email}</p>
              </div>
            </div>
          )}
          <button
            onClick={signOut}
            className="flex items-center gap-2 px-3 py-1.5 w-full rounded-md text-sm text-navy-300 hover:text-white hover:bg-navy-800 transition-colors"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Breadcrumb bar */}
        <Breadcrumb />
        <div className="flex-1 overflow-auto">{children}</div>
      </main>
    </div>
  );
}

function Breadcrumb() {
  const location = useLocation();
  const parts = location.pathname.split('/').filter(Boolean);

  if (parts.length === 0) return null;

  const crumbs: Array<{ label: string; to?: string }> = [
    { label: 'Clients', to: '/' },
  ];

  // We'd need client name here — keep it simple with path segments
  if (parts[0] === 'clients' && parts[1]) {
    crumbs.push({ label: 'Client Detail' });
    if (parts[2] === 'history') {
      crumbs[crumbs.length - 1].to = `/clients/${parts[1]}`;
      crumbs.push({ label: 'Conversation History' });
    }
  }

  return (
    <div className="h-10 border-b border-slate-200 bg-white flex items-center px-6 gap-1 flex-shrink-0">
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <ChevronRight size={13} className="text-slate-400" />}
          {c.to ? (
            <Link
              to={c.to}
              className="text-xs text-slate-500 hover:text-slate-900 transition-colors"
            >
              {c.label}
            </Link>
          ) : (
            <span className="text-xs text-slate-900 font-medium">{c.label}</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
