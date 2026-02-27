import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
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
  TrendingUp,
  TrendingDown,
  Minus,
  Sparkles,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  getBolSummaryForClient,
  getBolCompetitorsForClient,
  getBolKeywordsForClient,
  getBolProducts,
  updateProductMetadata,
  getBolCampaignsForClient,
  getBolCampaignChart,
  triggerSync,
  type BolSyncType,
} from '../lib/bol-api';
import type {
  BolCustomerAnalysisSummary,
  BolAnalysis,
  BolRecommendation,
  BolCompetitorSnapshot,
  BolKeywordRanking,
  BolProduct,
  BolCampaignPerformance,
  BolKeywordPerformance,
  BolCampaignChartPoint,
} from '../types/bol';
import clsx from 'clsx';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ComposedChart,
  Legend,
} from 'recharts';

// ── Types ──────────────────────────────────────────────────────────────────────

type NavSection =
  | 'overview'
  | 'recommendations'
  | 'products'
  | 'inventory'
  | 'orders'
  | 'campaigns'
  | 'keywords'
  | 'competitors'
  | 'returns';

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

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString('nl-NL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// ── Shared mini components ─────────────────────────────────────────────────────

function CircleScore({ score, size = 'sm' }: { score: number | null; size?: 'sm' | 'lg' }) {
  const dim  = size === 'lg' ? 72 : 52;
  const r    = size === 'lg' ? 29 : 21;
  const sw   = size === 'lg' ? 6  : 4;
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

function SyncPending({ section }: { section?: string } = {}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <RefreshCw size={24} className="text-slate-300 mb-3" />
      <p className="text-sm font-medium text-slate-500">
        No {section ? `${section} ` : ''}data yet
      </p>
      <p className="text-xs text-slate-400 mt-1">Run Phase 1 in the sync panel below to import from bol.com.</p>
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

/** A simple stat tile for section headers */
function StatTile({
  label, value, sub, color = 'default',
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: 'default' | 'green' | 'amber' | 'red' | 'blue';
}) {
  const valueColor = {
    default: 'text-slate-800',
    green:   'text-green-600',
    amber:   'text-amber-600',
    red:     'text-red-600',
    blue:    'text-blue-600',
  }[color];
  const bg = {
    default: 'bg-white border-slate-200',
    green:   'bg-green-50 border-green-200',
    amber:   'bg-amber-50 border-amber-200',
    red:     'bg-red-50 border-red-200',
    blue:    'bg-blue-50 border-blue-200',
  }[color];
  return (
    <div className={clsx('p-4 rounded-xl border', bg)}>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <span className={clsx('text-3xl font-bold', valueColor)}>{value}</span>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Overview Section ───────────────────────────────────────────────────────────

function OverviewSection({ summary }: { summary: BolCustomerAnalysisSummary }) {
  const categories = [
    { label: 'Content Quality',   analysis: summary.content,     description: 'Title completeness, pricing & keyword compliance' },
    { label: 'Inventory Health',  analysis: summary.inventory,   description: 'Stock levels and fulfilment model' },
    { label: 'Order Performance', analysis: summary.orders,      description: 'Cancellation rate and fulfilment quality' },
    { label: 'Ad Performance',    analysis: summary.advertising, description: 'ROAS, budget utilisation and campaign health' },
  ] as const;

  // Official bol.com KPI indicators
  const perfFindings = summary.performance?.findings as {
    indicators?: Array<{ name: string; status: string; score: number | null; norm: number | null }>;
  } | null;
  const kpiIndicators = perfFindings?.indicators ?? [];

  const kpiLabel: Record<string, string> = {
    CANCELLATION_RATE: 'Cancellation Rate',
    FULFILMENT_RATE:   'Fulfilment Rate',
    REVIEW_SCORE:      'Review Score',
  };

  const kpiStatusColor = (status: string) => {
    if (status === 'GOOD')             return 'bg-green-50 text-green-700 border-green-200';
    if (status === 'NEEDS_IMPROVEMENT') return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-red-50 text-red-700 border-red-200';
  };
  const kpiStatusIcon = (status: string) => {
    if (status === 'GOOD')             return <CheckCircle2 size={11} className="text-green-500" />;
    if (status === 'NEEDS_IMPROVEMENT') return <AlertTriangle size={11} className="text-amber-500" />;
    return <XCircle size={11} className="text-red-500" />;
  };

  return (
    <div className="space-y-5">
      {/* Overall score card */}
      <div className="flex items-center gap-5 p-5 bg-white border border-slate-200 rounded-xl">
        <CircleScore score={summary.overall_score} size="lg" />
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-slate-900">Overall Health Score</h2>
          <p className="text-sm text-slate-500 mt-0.5">Weighted across content, inventory, orders, advertising, returns & performance.</p>
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
      <div className="grid grid-cols-4 gap-4">
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

      {/* Official bol.com KPIs */}
      {kpiIndicators.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-800">Official bol.com KPIs</h3>
            <p className="text-xs text-slate-400 mt-0.5">Status as reported by the bol.com Retailer API</p>
          </div>
          <div className="flex divide-x divide-slate-100">
            {kpiIndicators.map(ind => (
              <div key={ind.name} className="flex-1 p-4">
                <p className="text-xs text-slate-500 mb-2">{kpiLabel[ind.name] ?? ind.name}</p>
                <div className="flex items-center gap-2 mb-1.5">
                  {kpiStatusIcon(ind.status)}
                  <span className={clsx('text-xs font-bold px-2 py-0.5 rounded border', kpiStatusColor(ind.status))}>
                    {ind.status.replace(/_/g, ' ')}
                  </span>
                </div>
                {ind.score !== null && (
                  <p className="text-xs text-slate-400">Score: <span className="font-semibold text-slate-600">{ind.score}</span>
                    {ind.norm !== null && <span className="text-slate-300"> / norm {ind.norm}</span>}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Recommendations Section ────────────────────────────────────────────────────

function RecommendationsSection({ summary }: { summary: BolCustomerAnalysisSummary }) {
  type RichRec = BolRecommendation & { category: string };
  const allRecs: RichRec[] = [
    ...(summary.content?.recommendations     ?? []).map(r => ({ ...r, category: 'Content' })),
    ...(summary.inventory?.recommendations   ?? []).map(r => ({ ...r, category: 'Inventory' })),
    ...(summary.orders?.recommendations      ?? []).map(r => ({ ...r, category: 'Orders' })),
    ...(summary.advertising?.recommendations ?? []).map(r => ({ ...r, category: 'Ads' })),
    ...(summary.returns?.recommendations     ?? []).map(r => ({ ...r, category: 'Returns' })),
    ...(summary.performance?.recommendations ?? []).map(r => ({ ...r, category: 'KPIs' })),
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

type SortKey = 'title' | 'ean' | 'regularStock' | 'price' | null;
type SortDir = 'asc' | 'desc';

function ProductsSection({
  analysis,
  bolCustomerId,
}: {
  analysis: BolAnalysis | null;
  bolCustomerId: string;
}) {
  const [products, setProducts]     = useState<BolProduct[] | null>(null);
  const [prodError, setProdError]   = useState<string | null>(null);
  const [search, setSearch]         = useState('');
  const [sortKey, setSortKey]       = useState<SortKey>('regularStock');
  const [sortDir, setSortDir]       = useState<SortDir>('asc');
  const [pageSize, setPageSize]     = useState<25 | 50 | 100>(25);
  const [page, setPage]             = useState(0);
  const [selectedFulfillment, setSelectedFulfillment] = useState<('FBB' | 'FBR')[]>([]);
  const [showEOL, setShowEOL]       = useState<'all' | 'active' | 'eol'>('active');

  useEffect(() => {
    if (!bolCustomerId) return;
    getBolProducts(bolCustomerId)
      .then(r => setProducts(r.products))
      .catch(e => setProdError(e.message ?? 'Failed to load products'));
  }, [bolCustomerId]);

  // Reset to page 0 when search / sort / pageSize changes
  useEffect(() => { setPage(0); }, [search, sortKey, sortDir, pageSize]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const handleToggleEOL = async (ean: string, currentEOL: boolean) => {
    if (!bolCustomerId) return;

    try {
      await updateProductMetadata(bolCustomerId, ean, !currentEOL);

      // Optimistically update local state
      setProducts(prev => prev?.map(p =>
        p.ean === ean ? { ...p, eol: !currentEOL } : p
      ) ?? null);
    } catch (err) {
      console.error('Failed to toggle EOL:', err);
      // Optionally show error toast
    }
  };

  const filtered = (products ?? []).filter(p => {
    // Search filter
    if (search) {
      const q = search.toLowerCase();
      const matchesSearch = (p.title ?? '').toLowerCase().includes(q) || p.ean.includes(q);
      if (!matchesSearch) return false;
    }

    // Fulfillment type filter
    if (selectedFulfillment.length > 0) {
      if (!p.fulfilmentType || !selectedFulfillment.includes(p.fulfilmentType)) {
        return false;
      }
    }

    // EOL filter
    if (showEOL === 'active' && p.eol) return false;
    if (showEOL === 'eol' && !p.eol) return false;

    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (!sortKey) return 0;
    let va: string | number | null;
    let vb: string | number | null;
    if (sortKey === 'title')        { va = a.title ?? ''; vb = b.title ?? ''; }
    else if (sortKey === 'ean')     { va = a.ean;         vb = b.ean; }
    else if (sortKey === 'price')   { va = a.price ?? -1; vb = b.price ?? -1; }
    else                            { va = a.regularStock; vb = b.regularStock; }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const totalPages = Math.ceil(sorted.length / pageSize);
  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize);

  // ── aggregate stats from analysis findings ──
  const f = (analysis?.findings ?? {}) as {
    offers_count?: number;
    avg_title_score?: number;
    titles_in_range?: number;
    titles_short?: number;
    titles_missing?: number;
    price_set_pct?: number;
    forbidden_keyword_warning?: boolean;
    total_visits?: number;
    total_impressions?: number;
    avg_buy_box_pct?: number;
    per_offer_insights?: Array<{
      offerId: string;
      title?: string;
      visits: number;
      impressions: number;
      buyBoxPct: number;
    }>;
  };

  // ── title quality computed from actual products (inventory data has titles; CSV export may not) ──
  const titleStats = useMemo(() => {
    const ps = products ?? [];
    const total   = ps.length;
    const optimal = ps.filter(p => p.title && p.title.length >= 150 && p.title.length <= 175).length;
    const tooLong = ps.filter(p => p.title && p.title.length > 175).length;
    const short   = ps.filter(p => p.title && p.title.length > 0 && p.title.length < 150).length;
    const missing = ps.filter(p => !p.title || p.title.trim().length === 0).length;
    return { total, optimal, tooLong, short, missing };
  }, [products]);

  // ── price stats computed from products (listings JSON has prices; CSV export may not) ──
  const priceStats = useMemo(() => {
    const ps = products ?? [];
    const total     = ps.length;
    const withPrice = ps.filter(p => p.price !== null && p.price > 0).length;
    const pct       = total > 0 ? Math.round((withPrice / total) * 100) : 100;
    return { withPrice, pct };
  }, [products]);

  // ── suppress stale price recommendation when products data confirms prices are set ──
  const filteredRecs = useMemo(() => {
    const recs = analysis?.recommendations ?? [];
    if (products && priceStats.pct >= 95) {
      return recs.filter(r => !r.action.includes('have no price set'));
    }
    return recs;
  }, [analysis?.recommendations, products, priceStats.pct]);

  const hasInsights    = (f.per_offer_insights?.length ?? 0) > 0;
  const sortedInsights = [...(f.per_offer_insights ?? [])].sort((a, b) => b.visits - a.visits);

  const buyBoxColor = (pct: number) =>
    pct >= 80 ? 'text-green-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600';

  const SortArrow = ({ col }: { col: SortKey }) =>
    sortKey !== col ? null : (
      <span className="ml-0.5 text-slate-400">{sortDir === 'asc' ? '↑' : '↓'}</span>
    );

  if (!analysis) return <SyncPending section="content" />;

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

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Total products" value={products ? titleStats.total : (f.offers_count ?? 0)} />
        <StatTile
          label="Avg title score"
          value={`${f.avg_title_score ?? 0}`}
          sub="out of 100"
          color={!f.avg_title_score ? 'default' : f.avg_title_score >= 80 ? 'green' : f.avg_title_score >= 60 ? 'amber' : 'red'}
        />
        <StatTile
          label="Offers with price"
          value={products ? `${priceStats.pct}%` : `${f.price_set_pct ?? 100}%`}
          color={products
            ? (priceStats.pct < 100 ? 'amber' : 'green')
            : ((f.price_set_pct ?? 100) < 100 ? 'red' : 'green')}
        />
      </div>

      {/* Offer insights stats row (only shown after at least one extended sync) */}
      {hasInsights && (
        <div className="grid grid-cols-3 gap-3">
          <StatTile
            label="Total visits (30d)"
            value={fmt(f.total_visits ?? 0)}
            color="blue"
          />
          <StatTile
            label="Total impressions (30d)"
            value={fmt(f.total_impressions ?? 0)}
            color="blue"
          />
          <StatTile
            label="Avg buy box %"
            value={`${f.avg_buy_box_pct ?? 0}%`}
            color={!f.avg_buy_box_pct ? 'default' : f.avg_buy_box_pct >= 80 ? 'green' : f.avg_buy_box_pct >= 50 ? 'amber' : 'red'}
          />
        </div>
      )}

      {/* Title quality breakdown — sourced from inventory products (accurate for FBB sellers) */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">Title Quality Breakdown</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Optimal: 150–175 characters · {products ? titleStats.total : '…'} products
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {products === null ? (
            [1, 2, 3, 4].map(i => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 animate-pulse">
                <div className="h-3 bg-slate-100 rounded flex-1" />
                <div className="w-32 h-1.5 bg-slate-100 rounded-full" />
                <div className="w-10 h-3 bg-slate-100 rounded" />
              </div>
            ))
          ) : (
            [
              { label: 'Optimal (150–175 chars)', count: titleStats.optimal, good: true,                    bad: false },
              { label: 'Too long (> 175 chars)',  count: titleStats.tooLong, good: false, bad: titleStats.tooLong > 0 },
              { label: 'Short (< 150 chars)',     count: titleStats.short,   good: false, bad: titleStats.short > 0   },
              { label: 'Missing / empty',         count: titleStats.missing, good: false, bad: titleStats.missing > 0 },
            ].map(row => {
              const pct = titleStats.total > 0 ? Math.round((row.count / titleStats.total) * 100) : 0;
              return (
                <div key={row.label} className="flex items-center gap-4 px-4 py-3">
                  <span className="text-xs text-slate-600 flex-1">{row.label}</span>
                  <div className="w-32 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={clsx('h-full rounded-full', row.good ? 'bg-green-500' : row.bad ? 'bg-red-400' : 'bg-slate-300')}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className={clsx('text-xs font-semibold w-10 text-right',
                    row.good ? 'text-green-600' : row.bad && row.count > 0 ? 'text-red-600' : 'text-slate-400'
                  )}>
                    {row.count}
                  </span>
                  <span className="text-xs text-slate-400 w-8 text-right">{pct}%</span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Description quality section — only shown when catalog analysis is available (future feature) */}

      {/* Offer insights table */}
      {hasInsights && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-800">Offer Insights</h3>
            <p className="text-xs text-slate-400 mt-0.5">Sorted by visits (last 30 days)</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-2 text-left font-semibold text-slate-500">Title</th>
                  <th className="px-4 py-2 text-right font-semibold text-slate-500">Visits</th>
                  <th className="px-4 py-2 text-right font-semibold text-slate-500">Impressions</th>
                  <th className="px-4 py-2 text-right font-semibold text-slate-500">Buy Box %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedInsights.slice(0, 20).map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-700 max-w-xs">
                      <span className="block truncate" title={row.title ?? row.offerId}>
                        {row.title ? row.title.slice(0, 55) + (row.title.length > 55 ? '…' : '') : row.offerId}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600 font-medium">{fmt(row.visits)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{fmt(row.impressions)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={clsx('font-bold', buyBoxColor(row.buyBoxPct))}>
                        {row.buyBoxPct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* All products table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">All products</h3>
              <p className="text-xs text-slate-400 mt-0.5">From latest inventory + listings sync</p>
            </div>
            <div className="flex items-center gap-2">
              {/* Per-page selector */}
              <div className="flex items-center gap-1">
                {([25, 50, 100] as const).map(n => (
                  <button
                    key={n}
                    onClick={() => setPageSize(n)}
                    className={clsx('px-2 py-1 rounded border text-[11px] leading-none',
                      pageSize === n
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-slate-200 text-slate-500 hover:border-slate-400'
                    )}
                  >{n}</button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Search title or EAN…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 w-52 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
          </div>

          {/* Filters row */}
          <div className="flex items-center gap-4">
            {/* Fulfillment type filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-medium">Fulfillment:</span>
              <button
                onClick={() => setSelectedFulfillment(prev =>
                  prev.includes('FBB') ? prev.filter(f => f !== 'FBB') : [...prev, 'FBB']
                )}
                className={clsx('px-2 py-1 rounded border text-[11px] leading-none font-medium transition-colors',
                  selectedFulfillment.includes('FBB')
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-slate-200 text-slate-500 hover:border-slate-400'
                )}
              >FBB</button>
              <button
                onClick={() => setSelectedFulfillment(prev =>
                  prev.includes('FBR') ? prev.filter(f => f !== 'FBR') : [...prev, 'FBR']
                )}
                className={clsx('px-2 py-1 rounded border text-[11px] leading-none font-medium transition-colors',
                  selectedFulfillment.includes('FBR')
                    ? 'bg-slate-700 text-white border-slate-700'
                    : 'border-slate-200 text-slate-500 hover:border-slate-400'
                )}
              >FBR</button>
            </div>

            {/* EOL status filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-medium">Status:</span>
              {(['all', 'active', 'eol'] as const).map(status => (
                <button
                  key={status}
                  onClick={() => setShowEOL(status)}
                  className={clsx('px-2 py-1 rounded border text-[11px] leading-none font-medium transition-colors capitalize',
                    showEOL === status
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-slate-200 text-slate-500 hover:border-slate-400'
                  )}
                >{status}</button>
              ))}
            </div>
          </div>
        </div>

        {prodError && (
          <p className="px-4 py-3 text-xs text-red-600">{prodError}</p>
        )}

        {!products && !prodError && (
          <p className="px-4 py-4 text-xs text-slate-400">Loading products…</p>
        )}

        {products && products.length === 0 && (
          <p className="px-4 py-4 text-xs text-slate-400">
            No products found. Run a sync to populate this list.
          </p>
        )}

        {paged.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th
                    className="px-4 py-2 text-left font-semibold text-slate-500 cursor-pointer select-none hover:text-slate-700"
                    onClick={() => handleSort('title')}
                  >
                    Title <SortArrow col="title" />
                  </th>
                  <th
                    className="px-4 py-2 text-left font-semibold text-slate-500 cursor-pointer select-none hover:text-slate-700"
                    onClick={() => handleSort('ean')}
                  >
                    EAN <SortArrow col="ean" />
                  </th>
                  <th className="px-4 py-2 text-left font-semibold text-slate-500">bSKU</th>
                  <th className="px-4 py-2 text-center font-semibold text-slate-500">Type</th>
                  <th
                    className="px-4 py-2 text-right font-semibold text-slate-500 cursor-pointer select-none hover:text-slate-700"
                    onClick={() => handleSort('price')}
                  >
                    Price <SortArrow col="price" />
                  </th>
                  <th
                    className="px-4 py-2 text-right font-semibold text-slate-500 cursor-pointer select-none hover:text-slate-700"
                    onClick={() => handleSort('regularStock')}
                  >
                    Stock <SortArrow col="regularStock" />
                  </th>
                  <th className="px-4 py-2 text-center font-semibold text-slate-500">Hold</th>
                  <th className="px-4 py-2 text-center font-semibold text-slate-500">EOL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paged.map((p, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-700 max-w-xs">
                      <span className="block truncate" title={p.title ?? undefined}>
                        {p.title ? p.title.slice(0, 60) + (p.title.length > 60 ? '…' : '') : <span className="text-slate-400 italic">—</span>}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500 font-mono">{p.ean}</td>
                    <td className="px-4 py-2.5 text-slate-500">{p.bsku ?? '—'}</td>
                    <td className="px-4 py-2.5 text-center">
                      {p.fulfilmentType ? (
                        <span className={clsx(
                          'inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold',
                          p.fulfilmentType === 'FBB'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-slate-100 text-slate-600'
                        )}>
                          {p.fulfilmentType}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-700 font-medium">
                      {p.price != null ? `€ ${p.price.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={clsx(
                        'font-semibold',
                        p.regularStock === 0 ? 'text-red-600' : p.regularStock <= 3 ? 'text-amber-600' : 'text-slate-700'
                      )}>
                        {p.regularStock}
                      </span>
                      {p.gradedStock > 0 && (
                        <span className="text-slate-400 ml-1">(+{p.gradedStock})</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {p.onHold ? (
                        <span className="inline-block w-2 h-2 rounded-full bg-red-500" title="On hold by retailer" />
                      ) : null}
                    </td>
                    <td
                      className="px-4 py-2.5 text-center cursor-pointer hover:bg-slate-50"
                      onClick={() => handleToggleEOL(p.ean, p.eol)}
                      title="Click to toggle EOL status"
                    >
                      {p.eol ? (
                        <span className="inline-block w-2 h-2 rounded-full bg-red-500" title="End of Life" />
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination footer */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2 border-t border-slate-100 text-xs text-slate-500">
                <span>
                  Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sorted.length)} of {sorted.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span>{page + 1}/{totalPages}</span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page === totalPages - 1}
                    className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {products && sorted.length === 0 && search && (
          <p className="px-4 py-3 text-xs text-slate-400">No products match "{search}"</p>
        )}
      </div>

      <RecList recs={filteredRecs} />
    </div>
  );
}

// ── Inventory Section ──────────────────────────────────────────────────────────

function InventorySection({ analysis }: { analysis: BolAnalysis | null }) {
  if (!analysis) return <SyncPending section="inventory" />;

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
  if (!analysis) return <SyncPending section="orders" />;

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

// ── Campaign Section ───────────────────────────────────────────────────────────

type ChartDays   = 7 | 14 | 30 | 90;
type ChartMetric = 'spend' | 'revenue' | 'roas' | 'acos' | 'tacos' | 'ctr_pct' | 'conversions';

function CampaignSection({
  analysis,
  bolCustomerId,
}: {
  analysis: BolAnalysis | null;
  bolCustomerId: string;
}) {
  const [campData, setCampData] = useState<{
    campaigns: BolCampaignPerformance[];
    keywords: BolKeywordPerformance[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  // Pagination — campaigns table
  const [campPage, setCampPage]         = useState(0);
  const [campPageSize, setCampPageSize] = useState<25 | 50 | 100>(25);
  useEffect(() => { setCampPage(0); }, [campPageSize]);

  // Pagination — keywords table
  const [kwPage, setKwPage]         = useState(0);
  const [kwPageSize, setKwPageSize] = useState<25 | 50 | 100>(25);
  useEffect(() => { setKwPage(0); }, [kwPageSize]);

  // Chart state
  const [chartDays, setChartDays]         = useState<ChartDays>(30);
  const [selectedMetrics, setSelectedMetrics] = useState<ChartMetric[]>(['spend', 'roas']);
  const [chartData, setChartData]         = useState<BolCampaignChartPoint[] | null>(null);
  const [chartLoading, setChartLoading]   = useState(false);
  const [dateRangeStart, setDateRangeStart] = useState<Date | null>(new Date(Date.now() - 30 * 86400000));
  const [dateRangeEnd, setDateRangeEnd]   = useState<Date | null>(new Date());

  // Campaign filters
  const [campStateFilter, setCampStateFilter] = useState<string[]>([]);
  const [campTypeFilter, setCampTypeFilter] = useState<string[]>([]);
  const [campAcosMin, setCampAcosMin] = useState<number | null>(null);
  const [campAcosMax, setCampAcosMax] = useState<number | null>(null);
  const [campRoasMin, setCampRoasMin] = useState<number | null>(null);
  const [campMinSpend, setCampMinSpend] = useState<number | null>(null);
  const [campHasClicks, setCampHasClicks] = useState<boolean | null>(null);

  // Keyword filters
  const [kwMatchTypeFilter, setKwMatchTypeFilter] = useState<string[]>([]);
  const [kwStateFilter, setKwStateFilter] = useState<string[]>([]);
  const [kwAcosMax, setKwAcosMax] = useState<number | null>(null);
  const [kwMinSpend, setKwMinSpend] = useState<number | null>(null);
  const [kwHasConversions, setKwHasConversions] = useState<boolean | null>(null);

  useEffect(() => {
    if (!bolCustomerId) return;
    setLoading(true);
    getBolCampaignsForClient(bolCustomerId)
      .then(r => setCampData({ campaigns: r.campaigns, keywords: r.keywords }))
      .catch(() => setCampData({ campaigns: [], keywords: [] }))
      .finally(() => setLoading(false));
  }, [bolCustomerId]);

  useEffect(() => {
    if (!bolCustomerId) return;
    setChartLoading(true);
    getBolCampaignChart(bolCustomerId, chartDays)
      .then(r => setChartData(r.points))
      .catch(() => setChartData([]))
      .finally(() => setChartLoading(false));
  }, [bolCustomerId, chartDays]);

  // ── Aggregate metrics computed from live campData (accurate vs stale analysis.findings) ──
  const campMetrics = useMemo(() => {
    const cs = campData?.campaigns ?? [];
    const spend       = cs.reduce((s, c) => s + (c.spend       ?? 0), 0);
    const revenue     = cs.reduce((s, c) => s + (c.revenue     ?? 0), 0);
    const impressions = cs.reduce((s, c) => s + (c.impressions ?? 0), 0);
    const clicks      = cs.reduce((s, c) => s + (c.clicks      ?? 0), 0);
    const conversions = cs.reduce((s, c) => s + (c.conversions ?? 0), 0);
    const roas    = spend > 0 ? revenue / spend : 0;
    const ctrPct  = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cvrPct  = clicks > 0 ? (conversions / clicks) * 100 : 0;
    return { spend, revenue, clicks, conversions, roas, ctrPct, cvrPct };
  }, [campData]);

  const roasColor = campMetrics.roas >= 5 ? 'green' : campMetrics.roas >= 3 ? 'amber' : 'red';

  if (!analysis) return <SyncPending section="campaign" />;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <RefreshCw size={18} className="animate-spin mr-2" />
        <span className="text-sm">Loading campaign data…</span>
      </div>
    );
  }

  const acosColor = (v: number | null) =>
    v == null ? 'text-slate-400' : v <= 20 ? 'text-green-600' : v <= 40 ? 'text-amber-600' : 'text-red-600';

  // Filtered + sorted + paginated campaigns
  const filteredCamps = (campData?.campaigns ?? []).filter(c => {
    // State filter
    if (campStateFilter.length > 0 && !campStateFilter.includes(c.state ?? '')) return false;
    // Type filter
    if (campTypeFilter.length > 0 && !campTypeFilter.includes(c.campaign_type ?? '')) return false;
    // ACOS range filter
    if (campAcosMin !== null && (c.acos === null || c.acos < campAcosMin)) return false;
    if (campAcosMax !== null && (c.acos === null || c.acos > campAcosMax)) return false;
    // ROAS threshold
    if (campRoasMin !== null && (c.roas === null || c.roas < campRoasMin)) return false;
    // Minimum spend
    if (campMinSpend !== null && (c.spend === null || c.spend < campMinSpend)) return false;
    // Has clicks filter
    if (campHasClicks === true && (c.clicks === null || c.clicks === 0)) return false;
    if (campHasClicks === false && (c.clicks ?? 0) > 0) return false;
    return true;
  });
  const sortedCamps   = [...filteredCamps].sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
  const campTotalPages = Math.ceil(sortedCamps.length / campPageSize);
  const pagedCamps    = sortedCamps.slice(campPage * campPageSize, (campPage + 1) * campPageSize);

  // Filtered + sorted + paginated keywords
  const filteredKws = (campData?.keywords ?? []).filter(k => {
    // Match type filter
    if (kwMatchTypeFilter.length > 0 && !kwMatchTypeFilter.includes(k.match_type ?? '')) return false;
    // State filter
    if (kwStateFilter.length > 0 && !kwStateFilter.includes(k.state ?? '')) return false;
    // ACOS max threshold
    if (kwAcosMax !== null && (k.acos === null || k.acos > kwAcosMax)) return false;
    // Min spend
    if (kwMinSpend !== null && (k.spend === null || k.spend < kwMinSpend)) return false;
    // Has conversions
    if (kwHasConversions === true && (k.conversions === null || k.conversions === 0)) return false;
    if (kwHasConversions === false && (k.conversions ?? 0) > 0) return false;
    return true;
  });
  const sortedKws   = [...filteredKws].sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
  const kwTotalPages = Math.ceil(sortedKws.length / kwPageSize);
  const pagedKws    = sortedKws.slice(kwPage * kwPageSize, (kwPage + 1) * kwPageSize);

  const metricConfig: Record<ChartMetric, { label: string; axis: 'left' | 'right'; color: string; format: (v: number) => string }> = {
    spend:       { label: 'Spend',       axis: 'left',  color: '#3b82f6', format: (v) => `€${v.toFixed(2)}` },
    revenue:     { label: 'Revenue',     axis: 'left',  color: '#10b981', format: (v) => `€${v.toFixed(2)}` },
    roas:        { label: 'ROAS',        axis: 'right', color: '#8b5cf6', format: (v) => `${v.toFixed(2)}×` },
    acos:        { label: 'ACOS',        axis: 'right', color: '#f59e0b', format: (v) => `${v.toFixed(1)}%` },
    tacos:       { label: 'TACOS',       axis: 'right', color: '#ef4444', format: (v) => `${v.toFixed(1)}%` },
    ctr_pct:     { label: 'CTR',         axis: 'right', color: '#06b6d4', format: (v) => `${v.toFixed(2)}%` },
    conversions: { label: 'Conversions', axis: 'right', color: '#ec4899', format: (v) => v.toFixed(0) },
  };

  return (
    <div className="space-y-4">
      {/* Stats row — computed from live campData */}
      <div className="grid grid-cols-4 gap-3">
        <StatTile
          label="Total ad spend"
          value={`€${fmt(campMetrics.spend, 2)}`}
          sub="all active campaigns"
        />
        <StatTile
          label="ROAS"
          value={`${fmt(campMetrics.roas, 2)}×`}
          sub="revenue per €1 spent"
          color={roasColor}
        />
        <StatTile
          label="CTR"
          value={`${fmt(campMetrics.ctrPct, 2)}%`}
          sub={`${fmt(campMetrics.clicks)} clicks`}
          color={campMetrics.ctrPct > 0.5 ? 'green' : 'amber'}
        />
        <StatTile
          label="Conversions"
          value={fmt(campMetrics.conversions)}
          sub={`${fmt(campMetrics.cvrPct, 1)}% conv. rate`}
        />
      </div>

      {/* Performance chart */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Advertising Performance</h3>
            <p className="text-xs text-slate-400 mt-0.5">Daily totals across all campaigns</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Metric selector - multi-select */}
            <div className="flex items-center gap-1 flex-wrap">
              {Object.entries(metricConfig).map(([key, config]) => {
                const metric = key as ChartMetric;
                const isSelected = selectedMetrics.includes(metric);
                return (
                  <button
                    key={metric}
                    onClick={() => setSelectedMetrics(prev =>
                      prev.includes(metric) ? prev.filter(m => m !== metric) : [...prev, metric]
                    )}
                    className={clsx('px-2 py-1 rounded border text-[11px] leading-none font-medium',
                      isSelected
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-slate-200 text-slate-500 hover:border-slate-400'
                    )}
                  >
                    {config.label}
                  </button>
                );
              })}
            </div>
            {/* Date range - quick presets */}
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-500 font-medium mr-1">Quick:</span>
              {[7, 14, 30, 90].map(days => (
                <button
                  key={days}
                  onClick={() => {
                    setDateRangeEnd(new Date());
                    setDateRangeStart(new Date(Date.now() - days * 86400000));
                    setChartDays(days as ChartDays);
                  }}
                  className="px-2 py-1 rounded border text-[11px] border-slate-200 text-slate-500 hover:border-slate-400"
                >
                  {days}d
                </button>
              ))}
            </div>
            {/* Custom date picker */}
            <div className="flex items-center gap-2">
              <DatePicker
                selected={dateRangeStart}
                onChange={(date: Date | null) => setDateRangeStart(date)}
                selectsStart
                startDate={dateRangeStart ?? undefined}
                endDate={dateRangeEnd ?? undefined}
                maxDate={new Date()}
                dateFormat="MMM dd, yyyy"
                className="text-xs border border-slate-200 rounded px-2 py-1 w-32"
                placeholderText="Start date"
              />
              <span className="text-xs text-slate-400">to</span>
              <DatePicker
                selected={dateRangeEnd}
                onChange={(date: Date | null) => setDateRangeEnd(date)}
                selectsEnd
                startDate={dateRangeStart ?? undefined}
                endDate={dateRangeEnd ?? undefined}
                minDate={dateRangeStart ?? undefined}
                maxDate={new Date()}
                dateFormat="MMM dd, yyyy"
                className="text-xs border border-slate-200 rounded px-2 py-1 w-32"
                placeholderText="End date"
              />
            </div>
          </div>
        </div>
        <div className="px-4 py-4">
          {chartLoading ? (
            <div className="h-48 flex items-center justify-center">
              <RefreshCw size={16} className="animate-spin text-slate-400" />
            </div>
          ) : !chartData || chartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center">
              <p className="text-xs text-slate-400">No chart data yet — run an advertising sync first.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 48, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickFormatter={(v) => new Date(v).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}
                />
                {/* Left Y-axis for currency (spend, revenue) */}
                {selectedMetrics.some(m => metricConfig[m].axis === 'left') && (
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickFormatter={(v) => `€${v}`}
                  />
                )}
                {/* Right Y-axis for percentages/counts */}
                {selectedMetrics.some(m => metricConfig[m].axis === 'right') && (
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                  />
                )}
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  labelFormatter={(v) => new Date(v).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: 'numeric' })}
                  formatter={(value: number | undefined, name: string | undefined) => {
                    if (value === undefined || name === undefined) return ['—', name ?? ''];
                    const metric = name as ChartMetric;
                    return [metricConfig[metric].format(value), metricConfig[metric].label];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {/* Render selected metrics */}
                {selectedMetrics.map(metric => (
                  <Area
                    key={metric}
                    yAxisId={metricConfig[metric].axis}
                    type="monotone"
                    dataKey={metric}
                    name={metric}
                    stroke={metricConfig[metric].color}
                    fill={metricConfig[metric].color}
                    fillOpacity={0.1}
                    strokeWidth={2}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Per-campaign breakdown — from bol_campaign_performance */}
      {sortedCamps.length === 0 ? (
        <SyncPending section="campaign" />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Campaign Breakdown</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Sorted by spend · Amber = budget &gt;95% used · ACOS = ad cost of sales
              </p>
            </div>
            <div className="flex items-center gap-1">
              {([25, 50, 100] as const).map(n => (
                <button
                  key={n}
                  onClick={() => setCampPageSize(n)}
                  className={clsx('px-2 py-1 rounded border text-[11px] leading-none',
                    campPageSize === n
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-slate-200 text-slate-500 hover:border-slate-400'
                  )}
                >{n}</button>
              ))}
            </div>
          </div>

          {/* Campaign Filters */}
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 space-y-2">
            <div className="flex items-center gap-4 flex-wrap">
              {/* State filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium">State:</span>
                {(['ENABLED', 'PAUSED', 'ARCHIVED'] as const).map(state => (
                  <button
                    key={state}
                    onClick={() => setCampStateFilter(prev =>
                      prev.includes(state) ? prev.filter(s => s !== state) : [...prev, state]
                    )}
                    className={clsx('px-2 py-1 rounded border text-[11px] leading-none font-medium',
                      campStateFilter.includes(state)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-slate-200 text-slate-500 hover:border-slate-400'
                    )}
                  >{state}</button>
                ))}
              </div>

              {/* Type filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium">Type:</span>
                {(['MANUAL', 'AUTOMATIC'] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => setCampTypeFilter(prev =>
                      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
                    )}
                    className={clsx('px-2 py-1 rounded border text-[11px] leading-none font-medium',
                      campTypeFilter.includes(type)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-slate-200 text-slate-500 hover:border-slate-400'
                    )}
                  >{type}</button>
                ))}
              </div>

              {/* Has clicks filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium">Clicks:</span>
                <button
                  onClick={() => setCampHasClicks(prev => prev === true ? null : true)}
                  className={clsx('px-2 py-1 rounded border text-[11px] leading-none font-medium',
                    campHasClicks === true
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-slate-200 text-slate-500 hover:border-slate-400'
                  )}
                >With Clicks</button>
                <button
                  onClick={() => setCampHasClicks(prev => prev === false ? null : false)}
                  className={clsx('px-2 py-1 rounded border text-[11px] leading-none font-medium',
                    campHasClicks === false
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-slate-200 text-slate-500 hover:border-slate-400'
                  )}
                >No Clicks</button>
              </div>
            </div>

            {/* Numeric filters */}
            <div className="flex items-center gap-4 flex-wrap">
              {/* ACOS range */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium">ACOS:</span>
                <input
                  type="number"
                  placeholder="Min %"
                  value={campAcosMin ?? ''}
                  onChange={e => setCampAcosMin(e.target.value ? parseFloat(e.target.value) : null)}
                  className="w-20 text-xs border border-slate-200 rounded px-2 py-1"
                />
                <span className="text-xs text-slate-400">to</span>
                <input
                  type="number"
                  placeholder="Max %"
                  value={campAcosMax ?? ''}
                  onChange={e => setCampAcosMax(e.target.value ? parseFloat(e.target.value) : null)}
                  className="w-20 text-xs border border-slate-200 rounded px-2 py-1"
                />
              </div>

              {/* Min ROAS */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium">Min ROAS:</span>
                <input
                  type="number"
                  placeholder="e.g. 3"
                  step="0.1"
                  value={campRoasMin ?? ''}
                  onChange={e => setCampRoasMin(e.target.value ? parseFloat(e.target.value) : null)}
                  className="w-20 text-xs border border-slate-200 rounded px-2 py-1"
                />
              </div>

              {/* Min spend */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium">Min Spend:</span>
                <input
                  type="number"
                  placeholder="€"
                  value={campMinSpend ?? ''}
                  onChange={e => setCampMinSpend(e.target.value ? parseFloat(e.target.value) : null)}
                  className="w-20 text-xs border border-slate-200 rounded px-2 py-1"
                />
              </div>

              {/* Clear filters */}
              {(campStateFilter.length > 0 || campTypeFilter.length > 0 || campAcosMin !== null || campAcosMax !== null || campRoasMin !== null || campMinSpend !== null || campHasClicks !== null) && (
                <button
                  onClick={() => {
                    setCampStateFilter([]);
                    setCampTypeFilter([]);
                    setCampAcosMin(null);
                    setCampAcosMax(null);
                    setCampRoasMin(null);
                    setCampMinSpend(null);
                    setCampHasClicks(null);
                  }}
                  className="px-2 py-1 rounded border border-red-200 text-[11px] text-red-600 hover:bg-red-50"
                >Clear All</button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-2 text-left font-semibold text-slate-500">Campaign</th>
                  <th className="px-4 py-2 text-center font-semibold text-slate-500">Type</th>
                  <th className="px-4 py-2 text-center font-semibold text-slate-500">State</th>
                  <th className="px-4 py-2 text-right font-semibold text-slate-500">Spend</th>
                  <th className="px-4 py-2 text-right font-semibold text-slate-500">Impr.</th>
                  <th className="px-4 py-2 text-right font-semibold text-slate-500">Clicks</th>
                  <th className="px-4 py-2 text-right font-semibold text-slate-500">ROAS</th>
                  <th className="px-4 py-2 text-right font-semibold text-slate-500">ACOS</th>
                  <th className="px-4 py-2 text-left font-semibold text-slate-500 w-32">Budget</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedCamps.map((c, i) => {
                  const budgetUtil = c.budget && c.spend != null
                    ? (c.spend / c.budget) * 100
                    : 0;
                  const capping = budgetUtil > 95;
                  const rVal = c.roas ?? 0;
                  return (
                    <tr key={i} className={clsx('hover:bg-slate-50', capping && 'bg-amber-50/40')}>
                      <td className="px-4 py-2.5 text-slate-700 max-w-xs">
                        <span className="block truncate" title={c.campaign_name ?? undefined}>
                          {c.campaign_name ?? c.campaign_id}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {c.campaign_type ? (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600">
                            {c.campaign_type === 'AUTOMATIC' ? 'AUTO' : c.campaign_type}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={clsx(
                          'inline-block w-2 h-2 rounded-full',
                          c.state === 'ENABLED' ? 'bg-green-500' : c.state === 'PAUSED' ? 'bg-amber-400' : 'bg-slate-300'
                        )} title={c.state ?? undefined} />
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-slate-800">
                        €{fmt(c.spend ?? 0, 2)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-600">{fmt(c.impressions ?? 0)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">{fmt(c.clicks ?? 0)}</td>
                      <td className={clsx('px-4 py-2.5 text-right font-bold',
                        rVal >= 5 ? 'text-green-600' : rVal >= 3 ? 'text-amber-600' : 'text-red-600'
                      )}>
                        {fmt(rVal, 2)}×
                      </td>
                      <td className={clsx('px-4 py-2.5 text-right font-semibold', acosColor(c.acos))}>
                        {c.acos != null ? `${fmt(c.acos, 1)}%` : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                            <div
                              className={clsx('h-full rounded-full transition-all',
                                capping ? 'bg-amber-400' : 'bg-blue-400'
                              )}
                              style={{ width: `${Math.min(budgetUtil, 100)}%` }}
                            />
                          </div>
                          <span className={clsx('text-[10px] font-semibold w-8 text-right',
                            capping ? 'text-amber-600' : 'text-slate-500'
                          )}>
                            {Math.round(budgetUtil)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {campTotalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2 border-t border-slate-100 text-xs text-slate-500">
                <span>
                  Showing {campPage * campPageSize + 1}–{Math.min((campPage + 1) * campPageSize, sortedCamps.length)} of {sortedCamps.length}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setCampPage(p => Math.max(0, p - 1))} disabled={campPage === 0}
                    className="p-1 rounded hover:bg-slate-100 disabled:opacity-30">
                    <ChevronLeft size={14} />
                  </button>
                  <span>{campPage + 1}/{campTotalPages}</span>
                  <button onClick={() => setCampPage(p => Math.min(campTotalPages - 1, p + 1))} disabled={campPage === campTotalPages - 1}
                    className="p-1 rounded hover:bg-slate-100 disabled:opacity-30">
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Keyword performance — from bol_keyword_performance */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Keyword Performance</h3>
            <p className="text-xs text-slate-400 mt-0.5">Sorted by spend · ACOS: green ≤20%, amber ≤40%, red &gt;40%</p>
          </div>
          <div className="flex items-center gap-1">
            {([25, 50, 100] as const).map(n => (
              <button
                key={n}
                onClick={() => setKwPageSize(n)}
                className={clsx('px-2 py-1 rounded border text-[11px] leading-none',
                  kwPageSize === n
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-slate-200 text-slate-500 hover:border-slate-400'
                )}
              >{n}</button>
            ))}
          </div>
        </div>

        {/* Keyword Filters */}
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 space-y-2">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Match type filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-medium">Match Type:</span>
              {(['EXACT', 'PHRASE'] as const).map(matchType => (
                <button
                  key={matchType}
                  onClick={() => setKwMatchTypeFilter(prev =>
                    prev.includes(matchType) ? prev.filter(m => m !== matchType) : [...prev, matchType]
                  )}
                  className={clsx('px-2 py-1 rounded border text-[11px] leading-none font-medium',
                    kwMatchTypeFilter.includes(matchType)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-slate-200 text-slate-500 hover:border-slate-400'
                  )}
                >{matchType}</button>
              ))}
            </div>

            {/* State filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-medium">State:</span>
              {(['ENABLED', 'PAUSED'] as const).map(state => (
                <button
                  key={state}
                  onClick={() => setKwStateFilter(prev =>
                    prev.includes(state) ? prev.filter(s => s !== state) : [...prev, state]
                  )}
                  className={clsx('px-2 py-1 rounded border text-[11px] leading-none font-medium',
                    kwStateFilter.includes(state)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-slate-200 text-slate-500 hover:border-slate-400'
                  )}
                >{state}</button>
              ))}
            </div>

            {/* Has conversions filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-medium">Conversions:</span>
              <button
                onClick={() => setKwHasConversions(prev => prev === true ? null : true)}
                className={clsx('px-2 py-1 rounded border text-[11px] leading-none font-medium',
                  kwHasConversions === true
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-slate-200 text-slate-500 hover:border-slate-400'
                )}
              >With Conv.</button>
              <button
                onClick={() => setKwHasConversions(prev => prev === false ? null : false)}
                className={clsx('px-2 py-1 rounded border text-[11px] leading-none font-medium',
                  kwHasConversions === false
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-slate-200 text-slate-500 hover:border-slate-400'
                )}
              >No Conv.</button>
            </div>
          </div>

          {/* Numeric filters */}
          <div className="flex items-center gap-4 flex-wrap">
            {/* Max ACOS */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-medium">Max ACOS:</span>
              <input
                type="number"
                placeholder="e.g. 25"
                value={kwAcosMax ?? ''}
                onChange={e => setKwAcosMax(e.target.value ? parseFloat(e.target.value) : null)}
                className="w-20 text-xs border border-slate-200 rounded px-2 py-1"
              />
              <span className="text-xs text-slate-400">%</span>
            </div>

            {/* Min spend */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-medium">Min Spend:</span>
              <input
                type="number"
                placeholder="€"
                value={kwMinSpend ?? ''}
                onChange={e => setKwMinSpend(e.target.value ? parseFloat(e.target.value) : null)}
                className="w-20 text-xs border border-slate-200 rounded px-2 py-1"
              />
            </div>

            {/* Clear filters */}
            {(kwMatchTypeFilter.length > 0 || kwStateFilter.length > 0 || kwAcosMax !== null || kwMinSpend !== null || kwHasConversions !== null) && (
              <button
                onClick={() => {
                  setKwMatchTypeFilter([]);
                  setKwStateFilter([]);
                  setKwAcosMax(null);
                  setKwMinSpend(null);
                  setKwHasConversions(null);
                }}
                className="px-2 py-1 rounded border border-red-200 text-[11px] text-red-600 hover:bg-red-50"
              >Clear All</button>
            )}
          </div>
        </div>

        {sortedKws.length === 0 ? (
          <p className="px-4 py-4 text-xs text-slate-400">
            No keyword data yet. Run a sync with advertising credentials to populate.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-2 text-left font-semibold text-slate-500">Keyword</th>
                  <th className="px-4 py-2 text-center font-semibold text-slate-500">Match</th>
                  <th className="px-4 py-2 text-right font-semibold text-slate-500">Bid</th>
                  <th className="px-4 py-2 text-right font-semibold text-slate-500">Spend</th>
                  <th className="px-4 py-2 text-right font-semibold text-slate-500">Clicks</th>
                  <th className="px-4 py-2 text-right font-semibold text-slate-500">ACOS</th>
                  <th className="px-4 py-2 text-right font-semibold text-slate-500">Conv.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedKws.map((k, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-700">
                      {k.keyword_text ?? <span className="text-slate-400 italic">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {k.match_type ? (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600">
                          {k.match_type}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600">
                      {k.bid != null ? `€${fmt(k.bid, 2)}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-800">
                      {k.spend != null ? `€${fmt(k.spend, 2)}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{fmt(k.clicks ?? 0)}</td>
                    <td className={clsx('px-4 py-2.5 text-right font-semibold', acosColor(k.acos))}>
                      {k.acos != null ? `${fmt(k.acos, 1)}%` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{k.conversions ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {kwTotalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2 border-t border-slate-100 text-xs text-slate-500">
                <span>
                  Showing {kwPage * kwPageSize + 1}–{Math.min((kwPage + 1) * kwPageSize, sortedKws.length)} of {sortedKws.length}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setKwPage(p => Math.max(0, p - 1))} disabled={kwPage === 0}
                    className="p-1 rounded hover:bg-slate-100 disabled:opacity-30">
                    <ChevronLeft size={14} />
                  </button>
                  <span>{kwPage + 1}/{kwTotalPages}</span>
                  <button onClick={() => setKwPage(p => Math.min(kwTotalPages - 1, p + 1))} disabled={kwPage === kwTotalPages - 1}
                    className="p-1 rounded hover:bg-slate-100 disabled:opacity-30">
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <RecList recs={analysis.recommendations ?? []} />
    </div>
  );
}

// ── Competitor Section ─────────────────────────────────────────────────────────

function CompetitorSection({ bolCustomerId }: { bolCustomerId: string }) {
  const [competitors, setCompetitors] = useState<BolCompetitorSnapshot[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 15;

  useEffect(() => {
    setLoading(true);
    getBolCompetitorsForClient(bolCustomerId)
      .then(r => setCompetitors(r.competitors))
      .catch(() => setCompetitors([]))
      .finally(() => setLoading(false));
  }, [bolCustomerId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw size={18} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (!competitors?.length) return <SyncPending section="competitor" />;

  const buyBoxWins = competitors.filter(c => c.buy_box_winner).length;
  const winRate    = Math.round((buyBoxWins / competitors.length) * 100);
  const avgComps   = Math.round(competitors.reduce((sum, c) => sum + (c.competitor_count ?? 0), 0) / competitors.length);

  // Sort: losers first, then by price gap
  const sorted = [...competitors].sort((a, b) => {
    if (a.buy_box_winner && !b.buy_box_winner) return 1;
    if (!a.buy_box_winner && b.buy_box_winner) return -1;
    const gapA = a.our_price && a.lowest_competing_price ? a.our_price - a.lowest_competing_price : 0;
    const gapB = b.our_price && b.lowest_competing_price ? b.our_price - b.lowest_competing_price : 0;
    return gapB - gapA;
  });

  const paginated = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile
          label="Buy box win rate"
          value={`${winRate}%`}
          sub={`${buyBoxWins} of ${competitors.length} products`}
          color={winRate >= 70 ? 'green' : winRate >= 40 ? 'amber' : 'red'}
        />
        <StatTile label="Products tracked" value={competitors.length} />
        <StatTile label="Avg competitors" value={avgComps} sub="per product" />
      </div>

      {/* Competitor table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Competitor Overview</h3>
            <p className="text-xs text-slate-400 mt-0.5">Losers shown first · Red = competitor lower than us</p>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-30">
                <ChevronLeft size={14} />
              </button>
              <span>{page + 1}/{totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-30">
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-4 py-2 text-left font-semibold text-slate-500">EAN</th>
                <th className="px-4 py-2 text-center font-semibold text-slate-500">Buy Box</th>
                <th className="px-4 py-2 text-right font-semibold text-slate-500">Our Price</th>
                <th className="px-4 py-2 text-right font-semibold text-slate-500">Lowest</th>
                <th className="px-4 py-2 text-right font-semibold text-slate-500">Competitors</th>
                <th className="px-4 py-2 text-right font-semibold text-slate-500">Rating</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginated.map((c, i) => {
                const cheaper = c.lowest_competing_price !== null && c.our_price !== null &&
                  c.lowest_competing_price < c.our_price;
                return (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-slate-600">{c.ean}</td>
                    <td className="px-4 py-2.5 text-center">
                      {c.buy_box_winner
                        ? <CheckCircle2 size={14} className="text-green-500 inline" />
                        : <XCircle size={14} className="text-red-400 inline" />}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600">
                      {c.our_price !== null ? `€${fmt(c.our_price, 2)}` : '—'}
                    </td>
                    <td className={clsx('px-4 py-2.5 text-right font-medium flex items-center justify-end gap-1',
                      cheaper ? 'text-red-600' : 'text-slate-600'
                    )}>
                      {c.lowest_competing_price !== null ? `€${fmt(c.lowest_competing_price, 2)}` : '—'}
                      {cheaper && <TrendingDown size={11} className="text-red-500" />}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{c.competitor_count ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">
                      {c.rating_score !== null
                        ? <span>{c.rating_score} <span className="text-slate-400">({c.rating_count})</span></span>
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Keywords Section ───────────────────────────────────────────────────────────

function KeywordsSection({ bolCustomerId }: { bolCustomerId: string }) {
  const [rankings, setRankings] = useState<BolKeywordRanking[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getBolKeywordsForClient(bolCustomerId)
      .then(r => setRankings(r.rankings))
      .catch(() => setRankings([]))
      .finally(() => setLoading(false));
  }, [bolCustomerId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw size={18} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (!rankings?.length) return <SyncPending section="keyword" />;

  const searchRankings = rankings.filter(r => r.search_type === 'SEARCH');
  const browseRankings = rankings.filter(r => r.search_type === 'BROWSE');

  const avgSearch = searchRankings.length > 0
    ? Math.round(searchRankings.reduce((s, r) => s + (r.current_rank ?? 0), 0) / searchRankings.length)
    : null;
  const avgBrowse = browseRankings.length > 0
    ? Math.round(browseRankings.reduce((s, r) => s + (r.current_rank ?? 0), 0) / browseRankings.length)
    : null;

  // Build combined rows by EAN
  const byEan = new Map<string, { search?: BolKeywordRanking; browse?: BolKeywordRanking }>();
  for (const r of rankings) {
    if (!byEan.has(r.ean)) byEan.set(r.ean, {});
    if (r.search_type === 'SEARCH') byEan.get(r.ean)!.search = r;
    else byEan.get(r.ean)!.browse = r;
  }

  const rows = Array.from(byEan.entries()).sort((a, b) => {
    const ra = a[1].search?.current_rank ?? 9999;
    const rb = b[1].search?.current_rank ?? 9999;
    return ra - rb;
  });

  const TrendIcon = ({ trend }: { trend?: string }) => {
    if (trend === 'up')   return <TrendingUp size={12} className="text-green-500" />;
    if (trend === 'down') return <TrendingDown size={12} className="text-red-500" />;
    if (trend === 'new')  return <Sparkles size={12} className="text-blue-500" />;
    return <Minus size={12} className="text-slate-400" />;
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Ranked products" value={byEan.size} />
        <StatTile
          label="Avg search rank"
          value={avgSearch ?? '—'}
          sub="lower = better"
          color={avgSearch !== null ? (avgSearch <= 20 ? 'green' : avgSearch <= 50 ? 'amber' : 'red') : 'default'}
        />
        <StatTile
          label="Avg browse rank"
          value={avgBrowse ?? '—'}
          sub="lower = better"
          color={avgBrowse !== null ? (avgBrowse <= 20 ? 'green' : avgBrowse <= 50 ? 'amber' : 'red') : 'default'}
        />
      </div>

      {/* Rankings table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">Product Rankings</h3>
          <p className="text-xs text-slate-400 mt-0.5">Sorted by search rank (best first) · Lower number = better position</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-4 py-2 text-left font-semibold text-slate-500">EAN</th>
                <th className="px-4 py-2 text-right font-semibold text-slate-500">Search Rank</th>
                <th className="px-4 py-2 text-center font-semibold text-slate-500">Trend</th>
                <th className="px-4 py-2 text-right font-semibold text-slate-500">Browse Rank</th>
                <th className="px-4 py-2 text-right font-semibold text-slate-500">Impressions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(([ean, data], i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono text-slate-600">{ean}</td>
                  <td className="px-4 py-2.5 text-right">
                    {data.search?.current_rank !== null && data.search?.current_rank !== undefined
                      ? <span className={clsx('font-bold',
                          data.search.current_rank <= 20 ? 'text-green-600' :
                          data.search.current_rank <= 50 ? 'text-amber-600' : 'text-slate-600'
                        )}>#{data.search.current_rank}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5 flex justify-center">
                    <TrendIcon trend={data.search?.trend} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {data.browse?.current_rank !== null && data.browse?.current_rank !== undefined
                      ? <span className="text-slate-600 font-medium">#{data.browse.current_rank}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-600">
                    {data.search?.current_impressions != null
                      ? fmt(data.search.current_impressions)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Returns Section ────────────────────────────────────────────────────────────

function ReturnsSection({ analysis }: { analysis: BolAnalysis | null }) {
  if (!analysis) return <SyncPending section="returns" />;

  const f = analysis.findings as {
    open_count?: number;
    handled_count?: number;
    total_count?: number;
    top_reasons?: Array<{ reason: string; count: number }>;
  };

  const open    = f.open_count    ?? 0;
  const handled = f.handled_count ?? 0;
  const total   = f.total_count   ?? (open + handled);
  const topReason = f.top_reasons?.[0]?.reason ?? '—';
  const maxReason = Math.max(...(f.top_reasons?.map(r => r.count) ?? [1]));

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile
          label="Open returns"
          value={open}
          sub="awaiting processing"
          color={open > 50 ? 'red' : open > 20 ? 'amber' : 'green'}
        />
        <StatTile label="Total processed" value={handled} sub="last period" />
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs text-slate-500 mb-1">Top return reason</p>
          <span className="text-sm font-semibold text-slate-800 leading-snug block">{topReason}</span>
        </div>
      </div>

      {/* Return reasons bar chart */}
      {(f.top_reasons?.length ?? 0) > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-800">Top Return Reasons</h3>
          </div>
          <div className="p-4 space-y-3">
            {f.top_reasons!.map((reason, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs text-slate-600 w-48 truncate flex-shrink-0" title={reason.reason}>
                  {reason.reason}
                </span>
                <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-orange-400 transition-all"
                    style={{ width: `${Math.round((reason.count / maxReason) * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-semibold text-slate-600 w-8 text-right">{reason.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <RecList recs={analysis.recommendations ?? []} />
    </div>
  );
}

// ── Sync Panel ─────────────────────────────────────────────────────────────────

type PhaseStatus = 'idle' | 'running' | 'success' | 'error' | 'pending';
interface PhaseState { status: PhaseStatus; message: string }

function SyncPanel({ bolCustomerId }: { bolCustomerId: string }) {
  const [phases, setPhases] = useState<Record<BolSyncType, PhaseState>>({
    main:     { status: 'idle', message: '' },
    complete: { status: 'idle', message: '' },
    extended: { status: 'idle', message: '' },
  });
  const [runningAll, setRunningAll] = useState(false);

  const setPhase = (phase: BolSyncType, state: PhaseState) =>
    setPhases(prev => ({ ...prev, [phase]: state }));

  const runPhase = async (phase: BolSyncType): Promise<PhaseStatus> => {
    setPhase(phase, { status: 'running', message: '' });
    try {
      const result = await triggerSync(bolCustomerId, phase);
      let finalStatus: PhaseStatus = 'success';
      let message = '';

      if (phase === 'main') {
        const parts: string[] = [];
        const inv = result.inventory;
        const ord = result.orders;
        const ads = result.advertising;
        const ret = result.returns;
        const exp = result.offers_export;
        const prf = result.performance;

        if (inv?.status === 'ok')        parts.push(`✅ Inv (${inv.items ?? 0})`);
        else if (inv?.status === 'failed') parts.push(`❌ Inv`);

        if (ord?.status === 'ok')        parts.push(`✅ Orders (${ord.count ?? 0})`);
        else if (ord?.status === 'failed') parts.push(`❌ Orders`);

        if (ret?.status === 'ok')        parts.push(`✅ Returns`);
        else if (ret?.status === 'failed') parts.push(`❌ Returns`);

        if (ads?.status === 'ok')           parts.push(`✅ Ads`);
        else if (ads?.status === 'skipped') parts.push(`⚠️ Ads (no creds)`);
        else if (ads?.status === 'failed')  parts.push(`❌ Ads: ${ads.error ?? 'failed'}`);

        if (prf?.status === 'ok')         parts.push(`✅ Perf`);
        else if (prf?.status === 'no_data') parts.push(`⚠️ Perf (no data this week)`);

        if (exp?.status === 'job_submitted') parts.push(`⏳ Content export queued → run Phase 2`);
        else if (exp?.status === 'failed')   parts.push(`❌ Content export failed`);

        message = parts.join('\n') || 'Done';
        if (parts.some(p => p.startsWith('❌'))) finalStatus = 'error';
      } else if (phase === 'complete') {
        const sp = result.still_pending ?? 0;
        const c  = result.completed ?? 0;
        if (sp > 0) {
          finalStatus = 'pending';
          message = `${c} done · ${sp} still waiting`;
        } else if (c === 0 && (result.checked ?? 0) === 0) {
          message = 'No pending jobs';
        } else {
          message = `${c} export${c !== 1 ? 's' : ''} processed`;
        }
      } else {
        // extended
        const d = result.detail ?? {};
        message = [d.competitors, d.rankings, d.catalog].filter(Boolean).join(' · ') || 'Done';
        if (result.message) { finalStatus = 'pending'; message = result.message; }
      }

      setPhase(phase, { status: finalStatus, message });
      return finalStatus;
    } catch (e) {
      const msg = (e as Error).message;
      setPhase(phase, { status: 'error', message: msg });
      return 'error';
    }
  };

  const runAll = async () => {
    setRunningAll(true);
    try {
      await runPhase('main');
      // Brief wait — bol.com takes a few seconds to queue the export
      await new Promise<void>(r => setTimeout(r, 8000));
      const firstCompleteStatus = await runPhase('complete');
      if (firstCompleteStatus === 'pending') {
        // Export not ready yet — wait 40 s and try once more
        await new Promise<void>(r => setTimeout(r, 40000));
        await runPhase('complete');
      }
      await runPhase('extended');
    } finally {
      setRunningAll(false);
    }
  };

  const PHASES: Array<{ id: BolSyncType; label: string; sub: string }> = [
    { id: 'main',     label: '1. Main Sync',     sub: 'Inventory · Orders · Ads' },
    { id: 'complete', label: '2. Process Offers', sub: 'CSV download + analysis' },
    { id: 'extended', label: '3. Extended Data',  sub: 'Competitors · Keywords'  },
  ];

  const isAnyRunning = Object.values(phases).some(p => p.status === 'running') || runningAll;

  const phaseIcon = (s: PhaseStatus, isRunning: boolean) => {
    if (isRunning) return <RefreshCw size={11} className="animate-spin flex-shrink-0 mt-0.5" />;
    if (s === 'success') return <CheckCircle2 size={11} className="flex-shrink-0 mt-0.5" />;
    if (s === 'error')   return <XCircle      size={11} className="flex-shrink-0 mt-0.5" />;
    if (s === 'pending') return <Clock        size={11} className="flex-shrink-0 mt-0.5" />;
    return <div className="w-2.5 h-2.5 rounded-full border border-current flex-shrink-0 mt-0.5" />;
  };

  const phaseClass = (s: PhaseStatus, isRunning: boolean) => clsx(
    'w-full flex items-start gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors disabled:cursor-not-allowed',
    isRunning          ? 'bg-blue-50 text-blue-700' :
    s === 'success'    ? 'bg-green-50 text-green-700' :
    s === 'error'      ? 'bg-red-50 text-red-600' :
    s === 'pending'    ? 'bg-amber-50 text-amber-700' :
    'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  );

  return (
    <div className="p-3 border-t border-slate-100 flex-shrink-0">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2 px-0.5">
        Data Sync
      </p>
      <div className="space-y-1">
        {PHASES.map(({ id, label, sub }) => {
          const ph = phases[id];
          const running = ph.status === 'running';
          return (
            <button
              key={id}
              onClick={() => !isAnyRunning && runPhase(id)}
              disabled={isAnyRunning}
              className={phaseClass(ph.status, running)}
            >
              {phaseIcon(ph.status, running)}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold leading-tight truncate">{label}</p>
                <p className="text-[10px] leading-tight mt-0.5 whitespace-pre-wrap opacity-70">
                  {ph.message || sub}
                </p>
              </div>
            </button>
          );
        })}
      </div>
      <button
        onClick={runAll}
        disabled={isAnyRunning}
        className={clsx(
          'mt-2 w-full py-1.5 px-3 rounded-lg text-[11px] font-semibold transition-colors',
          isAnyRunning
            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
            : 'bg-orange-500 text-white hover:bg-orange-600',
        )}
      >
        {runningAll
          ? <span className="flex items-center justify-center gap-1.5">
              <RefreshCw size={10} className="animate-spin" /> Running…
            </span>
          : '▶ Run All'
        }
      </button>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────

const NAV_ITEMS: {
  id: NavSection;
  label: string;
  icon: React.ReactNode;
}[] = [
  { id: 'overview',        label: 'Health Scores',        icon: <LayoutDashboard size={14} /> },
  { id: 'recommendations', label: 'Recommendations',      icon: <Lightbulb size={14} /> },
  { id: 'products',        label: 'Products',             icon: <Package size={14} /> },
  { id: 'inventory',       label: 'Inventory',            icon: <Layers size={14} /> },
  { id: 'orders',          label: 'Orders',               icon: <ShoppingCart size={14} /> },
  { id: 'campaigns',       label: 'Campaign Performance', icon: <BarChart3 size={14} /> },
  { id: 'returns',         label: 'Returns',              icon: <RotateCcw size={14} /> },
  { id: 'keywords',        label: 'Keyword Intelligence', icon: <Key size={14} /> },
  { id: 'competitors',     label: 'Competitor Research',  icon: <Search size={14} /> },
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
      .catch((err) => {
        console.error('[BolDashboard] getBolSummaryForClient failed:', err);
        setSummary(null);
      })
      .finally(() => setLoading(false));
  }, [clientId]);

  const clientName = (summary?.customer as { clients?: { name?: string } })?.clients?.name ?? 'Client';
  const sellerName = summary?.customer?.seller_name ?? '';
  const bolCustomerId = summary?.customer?.id ?? '';

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
                onClick={() => setActiveSection(item.id)}
                className={clsx(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left',
                  activeSection === item.id
                    ? 'bg-orange-50 text-orange-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                )}
              >
                {item.icon}
                <span className="flex-1">{item.label}</span>
              </button>
            ))}
          </nav>

          {/* Sync Panel */}
          {!loading && summary && bolCustomerId && (
            <SyncPanel bolCustomerId={bolCustomerId} />
          )}
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
              {activeSection === 'products'        && <ProductsSection analysis={summary.content} bolCustomerId={bolCustomerId} />}
              {activeSection === 'inventory'       && <InventorySection analysis={summary.inventory} />}
              {activeSection === 'orders'          && <OrdersSection analysis={summary.orders} />}
              {activeSection === 'campaigns'       && <CampaignSection analysis={summary.advertising} bolCustomerId={bolCustomerId} />}
              {activeSection === 'returns'         && <ReturnsSection analysis={summary.returns} />}
              {activeSection === 'competitors'     && bolCustomerId && (
                <CompetitorSection bolCustomerId={bolCustomerId} />
              )}
              {activeSection === 'keywords'        && bolCustomerId && (
                <KeywordsSection bolCustomerId={bolCustomerId} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
