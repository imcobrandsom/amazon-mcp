import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  LayoutDashboard,
  Lightbulb,
  Package,
  Layers,
  ShoppingCart,
  BarChart3,
  Key,
  Search,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import { getBolSummaryForClient } from '../lib/bol-api';
import type { BolCustomerAnalysisSummary, BolAnalysis, BolRecommendation } from '../types/bol';
import clsx from 'clsx';

// ── Types ──────────────────────────────────────────────────────────────────────

type NavSection =
  | 'overview'
  | 'recommendations'
  | 'products'
  | 'inventory'
  | 'orders'
  | 'campaigns'
  | 'keywords'
  | 'competitors';

// ── Helpers ────────────────────────────────────────────────────────────────────

function scoreTextColor(score: number | null): string {
  if (score === null) return 'text-slate-400';
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-amber-600';
  return 'text-red-600';
}

function scoreBg(score: number | null): string {
  if (score === null) return 'bg-slate-50 border-slate-200';
  if (score >= 80) return 'bg-green-50 border-green-200';
  if (score >= 60) return 'bg-amber-50 border-amber-200';
  return 'bg-red-50 border-red-200';
}

function scoreLabel(score: number | null): string {
  if (score === null) return 'No data';
  if (score >= 80) return 'Healthy';
  if (score >= 60) return 'Needs attention';
  return 'Action required';
}

function priorityBadgeClass(priority: BolRecommendation['priority']): string {
  if (priority === 'high')   return 'bg-red-50 text-red-700 border-red-200';
  if (priority === 'medium') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-blue-50 text-blue-700 border-blue-200';
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Shared mini components ─────────────────────────────────────────────────────

function CircleScore({ score, size = 'sm' }: { score: number | null; size?: 'sm' | 'lg' }) {
  const dim = size === 'lg' ? 72 : 52;
  const r   = size === 'lg' ? 29 : 21;
  const sw  = size === 'lg' ? 6  : 4;
  const circ = 2 * Math.PI * r;
  const dash = ((score ?? 0) / 100) * circ;
  const col  = score === null ? '#94a3b8' : score >= 80 ? '#16a34a' : score >= 60 ? '#d97706' : '#dc2626';
  return (
    <div className="relative flex-shrink-0" style={{ width: dim, height: dim }}>
      <svg width={dim} height={dim} className="absolute inset-0 -rotate-90">
        <circle cx={dim / 2} cy={dim / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={sw} />
        <circle cx={dim / 2} cy={dim / 2} r={r} fill="none" stroke={col} strokeWidth={sw}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={clsx('font-bold', size === 'lg' ? 'text-xl' : 'text-sm')} style={{ color: col }}>
          {score ?? '—'}
        </span>
      </div>
    </div>
  );
}

function SyncPending() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <RefreshCw size={24} className="text-slate-300 mb-3" />
      <p className="text-sm font-medium text-slate-500">No data yet</p>
      <p className="text-xs text-slate-400 mt-1">Data will appear after the next sync.</p>
    </div>
  );
}

function RecList({ recs }: { recs: BolRecommendation[] }) {
  if (!recs.length) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Recommendations</h3>
      <div className="space-y-2">
        {recs.map((rec, i) => (
          <div key={i} className="p-3 bg-white border border-slate-200 rounded-lg text-xs">
            <span className={clsx('inline-block text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border mr-2', priorityBadgeClass(rec.priority))}>
              {rec.priority}
            </span>
            <span className="font-medium text-slate-800">{rec.title}</span>
            <p className="text-slate-500 mt-1 leading-relaxed">{rec.action}</p>
            <p className="text-[11px] text-green-700 font-medium mt-1.5">💡 {rec.impact}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Overview Section ───────────────────────────────────────────────────────────

function OverviewSection({ summary }: { summary: BolCustomerAnalysisSummary }) {
  const categories = [
    { label: 'Content Quality',   analysis: summary.content,   description: 'Title completeness, pricing & keyword compliance' },
    { label: 'Inventory Health',  analysis: summary.inventory, description: 'Stock levels and fulfilment model' },
    { label: 'Order Performance', analysis: summary.orders,    description: 'Cancellation rate and fulfilment quality' },
  ] as const;

  return (
    <div className="space-y-5">
      {/* Overall score card */}
      <div className="flex items-center gap-5 p-5 bg-white border border-slate-200 rounded-xl">
        <CircleScore score={summary.overall_score} size="lg" />
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-slate-900">Overall Health Score</h2>
          <p className="text-sm text-slate-500 mt-0.5">Combined across content, inventory and orders.</p>
          {summary.overall_score !== null && (
            <span className={clsx('inline-block mt-2 text-xs font-semibold px-2 py-0.5 rounded border',
              scoreBg(summary.overall_score), scoreTextColor(summary.overall_score)
            )}>
              {scoreLabel(summary.overall_score)}
            </span>
          )}
        </div>
        {summary.last_sync_at && (
          <div className="flex items-center gap-1.5 text-xs text-slate-400 flex-shrink-0">
            <Clock size={11} />
            {relativeTime(summary.last_sync_at)}
          </div>
        )}
      </div>

      {/* Category cards */}
      <div className="grid grid-cols-3 gap-4">
        {categories.map(({ label, analysis, description }) => (
          <div key={label} className={clsx('p-4 rounded-xl border', scoreBg(analysis?.score ?? null))}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-slate-800">{label}</span>
              <span className={clsx('text-2xl font-bold', scoreTextColor(analysis?.score ?? null))}>
                {analysis?.score ?? '—'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-3 leading-relaxed">{description}</p>
            {analysis ? (
              <div className="flex items-center gap-1.5">
                {analysis.score >= 80
                  ? <CheckCircle2 size={11} className="text-green-500" />
                  : analysis.score >= 60
                  ? <AlertTriangle size={11} className="text-amber-500" />
                  : <XCircle size={11} className="text-red-500" />}
                <span className={clsx('text-xs font-medium', scoreTextColor(analysis.score))}>
                  {scoreLabel(analysis.score)}
                </span>
              </div>
            ) : (
              <span className="text-xs text-slate-400">Sync pending</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Recommendations Section ────────────────────────────────────────────────────

function RecommendationsSection({ summary }: { summary: BolCustomerAnalysisSummary }) {
  type RichRec = BolRecommendation & { category: string };
  const allRecs: RichRec[] = [
    ...(summary.content?.recommendations   ?? []).map(r => ({ ...r, category: 'Content' })),
    ...(summary.inventory?.recommendations ?? []).map(r => ({ ...r, category: 'Inventory' })),
    ...(summary.orders?.recommendations    ?? []).map(r => ({ ...r, category: 'Orders' })),
  ];

  const high   = allRecs.filter(r => r.priority === 'high');
  const medium = allRecs.filter(r => r.priority === 'medium');
  const low    = allRecs.filter(r => r.priority === 'low');

  if (!allRecs.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <CheckCircle2 size={32} className="text-green-400 mb-3" />
        <p className="text-sm font-medium text-slate-700">No recommendations</p>
        <p className="text-xs text-slate-400 mt-1">Everything looks great across all categories.</p>
      </div>
    );
  }

  const Group = ({ label, recs, headColor }: { label: string; recs: RichRec[]; headColor: string }) => {
    if (!recs.length) return null;
    return (
      <div>
        <h3 className={clsx('text-xs font-bold uppercase tracking-wide mb-2', headColor)}>
          {label} Priority — {recs.length}
        </h3>
        <div className="space-y-2 mb-6">
          {recs.map((rec, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="flex items-start justify-between gap-3 mb-1.5">
                <span className="text-sm font-semibold text-slate-900">{rec.title}</span>
                <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">
                  {rec.category}
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-2">{rec.action}</p>
              <p className="text-[11px] text-green-700 font-medium">💡 {rec.impact}</p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div>
      <Group label="High"   recs={high}   headColor="text-red-600" />
      <Group label="Medium" recs={medium} headColor="text-amber-600" />
      <Group label="Low"    recs={low}    headColor="text-blue-600" />
    </div>
  );
}

// ── Products Section ───────────────────────────────────────────────────────────

function ProductsSection({ analysis }: { analysis: BolAnalysis | null }) {
  if (!analysis) return <SyncPending />;

  const f = analysis.findings as {
    offers_count?: number;
    avg_title_score?: number;
    titles_in_range?: number;
    titles_short?: number;
    titles_missing?: number;
    price_set_pct?: number;
    forbidden_keyword_warning?: boolean;
  };

  const total = f.offers_count ?? 0;
  const inRange = f.titles_in_range ?? 0;
  const short   = f.titles_short    ?? 0;
  const missing = f.titles_missing  ?? 0;
  const inRangePct = total > 0 ? Math.round((inRange / total) * 100) : 0;

  return (
    <div className="space-y-4">
      {f.forbidden_keyword_warning && (
        <div className="flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertTriangle size={13} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-800">
            <strong>Sustainability keyword warning:</strong> One or more titles contain eco/sustainability claims
            that bol.com restricts (e.g. "Milieuvriendelijk", "Duurzaam").
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {/* Total offers */}
        <div className="p-4 bg-white border border-slate-200 rounded-xl col-span-3 sm:col-span-1">
          <p className="text-xs text-slate-500 mb-1">Total offers</p>
          <span className="text-3xl font-bold text-slate-800">{total}</span>
        </div>
        {/* Avg title score */}
        <div className={clsx('p-4 rounded-xl border', scoreBg(f.avg_title_score ?? null))}>
          <p className="text-xs text-slate-500 mb-1">Avg title score</p>
          <span className={clsx('text-3xl font-bold', scoreTextColor(f.avg_title_score ?? null))}>
            {f.avg_title_score ?? 0}
          </span>
          <span className="text-sm text-slate-400">/100</span>
        </div>
        {/* Price set */}
        <div className={clsx('p-4 rounded-xl border', (f.price_set_pct ?? 100) < 100 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200')}>
          <p className="text-xs text-slate-500 mb-1">Offers with price</p>
          <span className={clsx('text-3xl font-bold', (f.price_set_pct ?? 100) < 100 ? 'text-red-600' : 'text-green-600')}>
            {f.price_set_pct ?? 100}%
          </span>
        </div>
      </div>

      {/* Title quality breakdown */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">Title Quality Breakdown</h3>
          <p className="text-xs text-slate-400 mt-0.5">Optimal: 150–175 characters, starts with brand name</p>
        </div>
        <div className="divide-y divide-slate-100">
          {[
            { label: 'Optimal (150–175 chars)', count: inRange, pct: inRangePct, good: true },
            { label: 'Short (< 150 chars)',     count: short,   pct: total > 0 ? Math.round((short / total) * 100) : 0,   bad: short > 0 },
            { label: 'Missing / empty',         count: missing, pct: total > 0 ? Math.round((missing / total) * 100) : 0, bad: missing > 0 },
          ].map(row => (
            <div key={row.label} className="flex items-center gap-4 px-4 py-3">
              <span className="text-xs text-slate-600 flex-1">{row.label}</span>
              <div className="w-32 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div
                  className={clsx('h-full rounded-full', row.good ? 'bg-green-500' : row.bad ? 'bg-red-400' : 'bg-slate-300')}
                  style={{ width: `${row.pct}%` }}
                />
              </div>
              <span className={clsx('text-xs font-semibold w-10 text-right',
                row.good ? 'text-green-600' : row.bad && row.count > 0 ? 'text-red-600' : 'text-slate-400'
              )}>
                {row.count}
              </span>
              <span className="text-xs text-slate-400 w-8 text-right">{row.pct}%</span>
            </div>
          ))}
        </div>
      </div>

      <RecList recs={analysis.recommendations ?? []} />
    </div>
  );
}

// ── Inventory Section ──────────────────────────────────────────────────────────

function InventorySection({ analysis }: { analysis: BolAnalysis | null }) {
  if (!analysis) return <SyncPending />;

  const f = analysis.findings as {
    items_count?: number;
    fulfilment_model?: string;
    fbr_items?: number;
    fbb_items?: number;
    fbb_out_of_stock?: number;
    fbb_critical_low?: number;
    fbb_low_stock?: number;
    fbb_healthy?: number;
    avg_fbb_stock?: number;
    message?: string;
  };

  const isFbr = f.fulfilment_model === 'FBR';

  return (
    <div className="space-y-4">
      {/* Fulfilment model */}
      <div className="flex items-center gap-4 p-4 bg-white border border-slate-200 rounded-xl">
        <div className={clsx('px-3 py-1.5 rounded-lg text-sm font-bold',
          isFbr ? 'bg-slate-100 text-slate-700' :
          f.fulfilment_model === 'MIXED' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'
        )}>
          {f.fulfilment_model ?? '—'}
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-800">Fulfilment Model</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {isFbr ? 'Stock managed in own warehouse — bol.com does not track FBR inventory' : 'Fulfilled by Bol'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-slate-900">{f.items_count ?? 0}</p>
          <p className="text-xs text-slate-400">total SKUs</p>
        </div>
      </div>

      {isFbr ? (
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-600 leading-relaxed">
          ℹ️ As an FBR (Fulfilled by Retailer) seller, your stock is managed in your own warehouse.
          bol.com doesn't receive inventory updates, so no stock-level alerts are available.
          Consider migrating best-selling SKUs to FBB for faster delivery and Buy Box advantage.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Out of stock',   value: f.fbb_out_of_stock ?? 0, bad: (f.fbb_out_of_stock ?? 0) > 0 },
            { label: 'Critically low', value: f.fbb_critical_low ?? 0, warn: (f.fbb_critical_low ?? 0) > 0 },
            { label: 'Low stock',      value: f.fbb_low_stock ?? 0,    warn: (f.fbb_low_stock ?? 0) > 0 },
            { label: 'Healthy',        value: f.fbb_healthy ?? 0,      good: true },
          ].map(s => (
            <div key={s.label} className={clsx('p-4 rounded-xl border',
              s.bad  ? 'bg-red-50 border-red-200' :
              s.warn ? 'bg-amber-50 border-amber-200' :
              s.good ? 'bg-green-50 border-green-200' : 'bg-white border-slate-200'
            )}>
              <p className="text-xs text-slate-500 mb-1">{s.label}</p>
              <span className={clsx('text-2xl font-bold',
                s.bad  ? 'text-red-600' :
                s.warn ? 'text-amber-600' :
                s.good ? 'text-green-600' : 'text-slate-800'
              )}>{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {f.fulfilment_model === 'MIXED' && (
        <div className="grid grid-cols-2 gap-3">
          <div className="p-4 bg-white border border-slate-200 rounded-xl">
            <p className="text-xs text-slate-500 mb-1">FBR SKUs</p>
            <span className="text-2xl font-bold text-slate-700">{f.fbr_items ?? 0}</span>
          </div>
          <div className="p-4 bg-white border border-slate-200 rounded-xl">
            <p className="text-xs text-slate-500 mb-1">FBB SKUs</p>
            <span className="text-2xl font-bold text-orange-600">{f.fbb_items ?? 0}</span>
          </div>
        </div>
      )}

      <RecList recs={analysis.recommendations ?? []} />
    </div>
  );
}

// ── Orders Section ─────────────────────────────────────────────────────────────

function OrdersSection({ analysis }: { analysis: BolAnalysis | null }) {
  if (!analysis) return <SyncPending />;

  const f = analysis.findings as {
    orders_count?: number;
    cancellations?: number;
    cancel_rate_pct?: number;
    fbr_orders?: number;
    fbb_orders?: number;
    fbb_rate_pct?: number;
    message?: string;
  };

  if ((f.orders_count ?? 0) === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ShoppingCart size={32} className="text-slate-300 mb-3" />
        <p className="text-sm font-medium text-slate-600">No orders in the last 30 days</p>
        <p className="text-xs text-slate-400 mt-1">Order data will appear here once orders come in.</p>
      </div>
    );
  }

  const cancelRate = f.cancel_rate_pct ?? 0;
  const fbbRate    = f.fbb_rate_pct    ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs text-slate-500 mb-1">Total orders</p>
          <span className="text-3xl font-bold text-slate-800">{f.orders_count ?? 0}</span>
        </div>
        <div className={clsx('p-4 rounded-xl border',
          cancelRate > 5 ? 'bg-red-50 border-red-200' :
          cancelRate > 2 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'
        )}>
          <p className="text-xs text-slate-500 mb-1">Cancel rate</p>
          <span className={clsx('text-3xl font-bold',
            cancelRate > 5 ? 'text-red-600' : cancelRate > 2 ? 'text-amber-600' : 'text-green-600'
          )}>{cancelRate}%</span>
        </div>
        <div className={clsx('p-4 rounded-xl border',
          fbbRate >= 50 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
        )}>
          <p className="text-xs text-slate-500 mb-1">FBB rate</p>
          <span className={clsx('text-3xl font-bold',
            fbbRate >= 50 ? 'text-green-600' : 'text-amber-600'
          )}>{fbbRate}%</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs text-slate-500 mb-1">FBR orders</p>
          <span className="text-xl font-bold text-slate-700">{f.fbr_orders ?? 0}</span>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs text-slate-500 mb-1">FBB orders</p>
          <span className="text-xl font-bold text-orange-600">{f.fbb_orders ?? 0}</span>
        </div>
      </div>

      <RecList recs={analysis.recommendations ?? []} />
    </div>
  );
}

// ── Placeholder Section ────────────────────────────────────────────────────────

function PlaceholderSection({ title, description, steps }: {
  title: string;
  description: string;
  steps: string[];
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-8 text-center">
      <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center mb-4">
        <Clock size={20} className="text-slate-400" />
      </div>
      <h3 className="text-base font-semibold text-slate-800 mb-2">{title}</h3>
      <p className="text-sm text-slate-500 max-w-sm mb-6 leading-relaxed">{description}</p>
      {steps.length > 0 && (
        <div className="w-full max-w-xs text-left bg-slate-50 border border-slate-200 rounded-xl p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2.5">What will be included</p>
          <ul className="space-y-2">
            {steps.map((s, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-slate-500">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 flex-shrink-0" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────

const NAV_ITEMS: {
  id: NavSection;
  label: string;
  icon: React.ReactNode;
  soon?: boolean;
}[] = [
  { id: 'overview',        label: 'Health Scores',        icon: <LayoutDashboard size={14} /> },
  { id: 'recommendations', label: 'Recommendations',      icon: <Lightbulb size={14} /> },
  { id: 'products',        label: 'Products',             icon: <Package size={14} /> },
  { id: 'inventory',       label: 'Inventory',            icon: <Layers size={14} /> },
  { id: 'orders',          label: 'Orders',               icon: <ShoppingCart size={14} /> },
  { id: 'campaigns',       label: 'Campaign Performance', icon: <BarChart3 size={14} />, soon: true },
  { id: 'keywords',        label: 'Keyword Intelligence', icon: <Key size={14} />,       soon: true },
  { id: 'competitors',     label: 'Competitor Research',  icon: <Search size={14} />,    soon: true },
];

export default function BolDashboard() {
  const { clientId } = useParams<{ clientId: string }>();
  const [activeSection, setActiveSection] = useState<NavSection>('overview');
  const [summary, setSummary] = useState<BolCustomerAnalysisSummary | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    getBolSummaryForClient(clientId)
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [clientId]);

  const clientName = (summary?.customer as { clients?: { name?: string } })?.clients?.name ?? 'Client';
  const sellerName = summary?.customer?.seller_name ?? '';

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex-shrink-0 flex items-center gap-3">
        <Link
          to={`/clients/${clientId}`}
          className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft size={15} />
        </Link>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Link to={`/clients/${clientId}`} className="hover:text-slate-700 transition-colors">
            {clientName}
          </Link>
          <span>/</span>
          <div className="flex items-center gap-1.5 text-slate-900 font-medium">
            <div className="w-3 h-3 bg-orange-500 rounded-sm" />
            Bol.com
            {sellerName && (
              <span className="text-slate-400 font-normal text-xs">· {sellerName}</span>
            )}
          </div>
        </div>
        {summary?.last_sync_at && (
          <span className="ml-auto text-[11px] text-slate-400 flex items-center gap-1.5">
            <Clock size={11} /> Synced {relativeTime(summary.last_sync_at)}
          </span>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <div className="w-52 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-y-auto">
          {/* Seller score mini summary */}
          {!loading && summary && (
            <div className="p-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <CircleScore score={summary.overall_score} size="sm" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800 truncate">{sellerName}</p>
                  <p className={clsx('text-[10px] font-medium mt-0.5', scoreTextColor(summary.overall_score))}>
                    {scoreLabel(summary.overall_score)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Nav */}
          <nav className="flex-1 p-2 space-y-0.5">
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                onClick={() => !item.soon && setActiveSection(item.id)}
                disabled={item.soon}
                className={clsx(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left',
                  activeSection === item.id && !item.soon
                    ? 'bg-orange-50 text-orange-700'
                    : item.soon
                    ? 'text-slate-300 cursor-not-allowed'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                )}
              >
                {item.icon}
                <span className="flex-1">{item.label}</span>
                {item.soon && (
                  <span className="text-[9px] font-bold uppercase text-slate-300 bg-slate-100 px-1 py-0.5 rounded">
                    soon
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw size={18} className="animate-spin text-slate-400" />
            </div>
          ) : !summary ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ShoppingCart size={32} className="text-slate-300 mb-3" />
              <p className="text-sm font-medium text-slate-600">Not connected</p>
              <p className="text-xs text-slate-400 mt-1">No bol.com account linked to this client.</p>
            </div>
          ) : (
            <>
              <div className="mb-5">
                <h1 className="text-lg font-semibold text-slate-900">
                  {NAV_ITEMS.find(n => n.id === activeSection)?.label}
                </h1>
              </div>

              {activeSection === 'overview'        && <OverviewSection summary={summary} />}
              {activeSection === 'recommendations' && <RecommendationsSection summary={summary} />}
              {activeSection === 'products'        && <ProductsSection analysis={summary.content} />}
              {activeSection === 'inventory'       && <InventorySection analysis={summary.inventory} />}
              {activeSection === 'orders'          && <OrdersSection analysis={summary.orders} />}

              {activeSection === 'campaigns' && (
                <PlaceholderSection
                  title="Campaign Performance"
                  description="Connect Advertising API credentials to see ad spend, ROAS, impressions and conversion data for all bol.com campaigns."
                  steps={[
                    'Sponsored Products campaign stats',
                    'Ad group performance breakdown',
                    'Keyword click & conversion data',
                    'Budget utilisation and ROAS trends',
                  ]}
                />
              )}
              {activeSection === 'keywords' && (
                <PlaceholderSection
                  title="Keyword Intelligence"
                  description="Automated keyword research and performance tracking to optimise search visibility on bol.com."
                  steps={[
                    'Top search term discovery',
                    'Keyword ranking by category',
                    'Search volume estimates',
                    'Keyword gaps vs competitors',
                  ]}
                />
              )}
              {activeSection === 'competitors' && (
                <PlaceholderSection
                  title="Competitor Research"
                  description="Monitor competitor pricing, assortment and Buy Box win rates to stay ahead in your category."
                  steps={[
                    'Buy Box win rate tracking',
                    'Competitor price monitoring',
                    'Assortment gap analysis',
                    'Category ranking comparison',
                  ]}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
