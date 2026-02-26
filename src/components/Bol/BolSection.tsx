import React, { useEffect, useState } from 'react';
import { Package, ShoppingCart, FileText, RefreshCw } from 'lucide-react';
import { getBolSummaryForClient } from '../../lib/bol-api';
import type { BolCustomerAnalysisSummary, BolAnalysis, BolRecommendation } from '../../types/bol';

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function scoreColor(score: number | null): string {
  if (score === null) return '#94a3b8';
  if (score >= 80) return '#16a34a';
  if (score >= 60) return '#d97706';
  return '#dc2626';
}

function scoreBadgeClass(score: number | null): string {
  if (score === null) return 'bg-slate-100 text-slate-400 border-slate-200';
  if (score >= 80) return 'bg-green-50 text-green-700 border-green-200';
  if (score >= 60) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

// ── Circular score gauge ──────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number | null }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const dash = ((score ?? 0) / 100) * circ;
  const color = scoreColor(score);

  return (
    <div className="relative flex items-center justify-center w-16 h-16 flex-shrink-0">
      <svg width="64" height="64" className="absolute inset-0 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#e2e8f0" strokeWidth="5" />
        <circle
          cx="32" cy="32" r={r} fill="none"
          stroke={color}
          strokeWidth="5"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="relative flex flex-col items-center leading-none">
        <span className="text-lg font-bold" style={{ color }}>
          {score ?? '—'}
        </span>
      </div>
    </div>
  );
}

// ── Category card ─────────────────────────────────────────────────────────────

function CategoryCard({
  icon,
  title,
  analysis,
}: {
  icon: React.ReactNode;
  title: string;
  analysis: BolAnalysis | null;
}) {
  if (!analysis) {
    return (
      <div className="border border-slate-200 rounded-lg p-3">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-slate-400">{icon}</span>
          <span className="text-xs font-medium text-slate-600">{title}</span>
        </div>
        <p className="text-[11px] text-slate-400">No data yet — sync pending</p>
      </div>
    );
  }

  const topRecs: BolRecommendation[] = (analysis.recommendations ?? []).slice(0, 3);

  return (
    <div className={`border rounded-lg p-3 ${scoreBadgeClass(analysis.score)}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="opacity-60">{icon}</span>
          <span className="text-xs font-medium text-slate-700">{title}</span>
        </div>
        <span className="text-sm font-bold" style={{ color: scoreColor(analysis.score) }}>
          {analysis.score}
        </span>
      </div>

      {topRecs.length > 0 ? (
        <ul className="space-y-1">
          {topRecs.map((rec, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className="text-slate-400 mt-0.5 shrink-0 text-[10px]">▸</span>
              <span className="text-[11px] text-slate-600 leading-tight">{rec.title}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-green-600 font-medium">✓ All good</p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BolSection({ clientId }: { clientId: string }) {
  const [summary, setSummary] = useState<BolCustomerAnalysisSummary | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getBolSummaryForClient(clientId)
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [clientId]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200 overflow-hidden">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <RefreshCw size={16} className="text-slate-400 animate-spin" />
        </div>
      </div>
    );
  }

  // ── Not connected ──
  if (!summary) {
    return (
      <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200 overflow-hidden">
        <Header />
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-5 text-center">
          <div className="w-8 h-8 rounded-lg bg-orange-50 border border-orange-100 flex items-center justify-center">
            <ShoppingCart size={15} className="text-orange-400" />
          </div>
          <p className="text-sm font-medium text-slate-700">Not connected</p>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Link a bol.com seller account to this client to see performance data here.
          </p>
        </div>
      </div>
    );
  }

  const lastSync = summary.last_sync_at ? relativeTime(summary.last_sync_at) : 'Never synced';

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-orange-500 rounded-sm flex-shrink-0" />
          <span className="text-sm font-semibold text-slate-900">Bol.com</span>
          <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-medium truncate max-w-[120px]">
            {summary.customer.seller_name}
          </span>
        </div>
        <span className="text-[10px] text-slate-400 flex-shrink-0">{lastSync}</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Overall score */}
        <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
          <ScoreGauge score={summary.overall_score} />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-800">Overall Score</p>
            <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
              Content, inventory &amp; order performance combined.
            </p>
            {summary.overall_score !== null && (
              <span className={`inline-block mt-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${scoreBadgeClass(summary.overall_score)}`}>
                {summary.overall_score >= 80 ? 'Healthy' : summary.overall_score >= 60 ? 'Needs attention' : 'Action required'}
              </span>
            )}
          </div>
        </div>

        {/* Category cards */}
        <CategoryCard
          icon={<FileText size={12} />}
          title="Content"
          analysis={summary.content}
        />
        <CategoryCard
          icon={<Package size={12} />}
          title="Inventory"
          analysis={summary.inventory}
        />
        <CategoryCard
          icon={<ShoppingCart size={12} />}
          title="Orders"
          analysis={summary.orders}
        />
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 flex-shrink-0">
      <div className="w-3 h-3 bg-orange-500 rounded-sm" />
      <span className="text-sm font-semibold text-slate-900">Bol.com</span>
    </div>
  );
}
