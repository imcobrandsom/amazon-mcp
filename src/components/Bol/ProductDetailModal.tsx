/**
 * Product Detail Modal - Phase 2
 * Shows product details, keywords, content optimization proposals, and performance
 */
import React, { useState, useEffect } from 'react';
import type {
  BolProduct,
  BolProductAnalysisResponse,
  BolContentProposal,
  BolCompetitorCatalog,
} from '../../types/bol';
import {
  getBolProductAnalysis,
  generateBolContent,
  approveContentProposal,
  rejectContentProposal,
  pushContentToBol,
} from '../../lib/bol-api';

interface ProductDetailModalProps {
  product: BolProduct;
  customerId: string;
  onClose: () => void;
}

type TabType = 'overview' | 'keywords' | 'content' | 'performance';

export function ProductDetailModal({ product, customerId, onClose }: ProductDetailModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [analysis, setAnalysis] = useState<BolProductAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [proposal, setProposal] = useState<BolContentProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch product analysis on mount
  useEffect(() => {
    loadAnalysis();
  }, [product.ean, customerId]);

  async function loadAnalysis() {
    setLoading(true);
    setError(null);
    try {
      const data = await getBolProductAnalysis(customerId, product.ean);
      setAnalysis(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateContent() {
    setGenerating(true);
    setError(null);
    try {
      const result = await generateBolContent(customerId, product.ean, 'manual');
      setProposal(result.proposal);
      setActiveTab('content'); // Switch to content tab to show proposal
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleApprove() {
    if (!proposal) return;
    try {
      const result = await approveContentProposal(proposal.id, customerId);
      setProposal(result.proposal);
      alert(result.auto_pushed ? 'Content approved and pushed to Bol.com!' : 'Content approved!');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleReject(reason?: string) {
    if (!proposal) return;
    try {
      const result = await rejectContentProposal(proposal.id, customerId, reason);
      setProposal(result.proposal);
      alert('Proposal rejected');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handlePush() {
    if (!proposal) return;
    try {
      const result = await pushContentToBol(proposal.id, customerId);
      alert(`Content pushed to Bol.com! (Offer ID: ${result.offer_id})`);
      setProposal({ ...proposal, status: 'pushed', pushed_at: new Date().toISOString() });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const completeness = analysis?.completeness;
  const keywords = analysis?.keywords ?? [];
  const competitor = analysis?.competitor;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 mb-1">
              {product.title || product.ean}
            </h2>
            <div className="flex items-center gap-3 text-sm text-slate-600">
              <span>EAN: {product.ean}</span>
              {product.category && <span>• {product.category}</span>}
              {product.price && <span>• €{product.price.toFixed(2)}</span>}
              {completeness && completeness.overall_completeness_score !== null && (
                <span className="flex items-center gap-1.5">
                  • Completeness:
                  <span className={`font-medium ${
                    completeness.overall_completeness_score >= 80 ? 'text-green-600' :
                    completeness.overall_completeness_score >= 60 ? 'text-amber-600' :
                    'text-red-600'
                  }`}>
                    {completeness.overall_completeness_score}%
                  </span>
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 border-b border-slate-200">
          <div className="flex gap-6">
            {(['overview', 'keywords', 'content', 'performance'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-3 px-1 font-medium text-sm border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-slate-500">Loading analysis...</div>
            </div>
          ) : (
            <>
              {activeTab === 'overview' && (
                <OverviewTab
                  product={product}
                  completeness={completeness ?? null}
                  competitor={competitor ?? null}
                />
              )}

              {activeTab === 'keywords' && (
                <KeywordsTab keywords={keywords} />
              )}

              {activeTab === 'content' && (
                <ContentTab
                  product={product}
                  proposal={proposal}
                  generating={generating}
                  onGenerate={handleGenerateContent}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onPush={handlePush}
                />
              )}

              {activeTab === 'performance' && (
                <PerformanceTab product={product} customerId={customerId} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({
  product,
  completeness,
  competitor,
}: {
  product: BolProduct;
  completeness: BolProductAnalysisResponse['completeness'] | null;
  competitor: BolProductAnalysisResponse['competitor'] | null;
}) {
  return (
    <div className="space-y-6">
      {/* Completeness Score */}
      {completeness && (
        <div>
          <h3 className="font-semibold text-slate-900 mb-3">Content Completeness</h3>
          <div className="grid grid-cols-3 gap-4">
            <StatCard
              label="Overall Score"
              value={`${completeness.overall_completeness_score ?? 0}%`}
              color={
                (completeness.overall_completeness_score ?? 0) >= 80 ? 'green' :
                (completeness.overall_completeness_score ?? 0) >= 60 ? 'amber' : 'red'
              }
            />
            <StatCard
              label="Required Attributes"
              value={`${completeness.required_filled}/${completeness.required_total}`}
            />
            <StatCard
              label="Title Length"
              value={`${completeness.title_length} chars`}
              color={completeness.title_meets_min ? 'green' : 'red'}
            />
          </div>
        </div>
      )}

      {/* Product Attributes */}
      {product.catalogAttributes && (
        <div>
          <h3 className="font-semibold text-slate-900 mb-3">Catalog Attributes</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {Object.entries(product.catalogAttributes)
              .filter(([key]) => !key.startsWith('_'))
              .slice(0, 12)
              .map(([key, value]) => (
                <div key={key} className="flex items-start gap-2">
                  <span className="text-slate-600 font-medium min-w-[120px]">{key}:</span>
                  <span className="text-slate-900">{Array.isArray(value) ? value.join(', ') : String(value || '—')}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Competitor Info */}
      {competitor && (
        <div>
          <h3 className="font-semibold text-slate-900 mb-3">Competitive Position</h3>
          <div className="grid grid-cols-3 gap-4">
            <StatCard
              label="Our Price"
              value={competitor.our_price ? `€${competitor.our_price.toFixed(2)}` : '—'}
            />
            <StatCard
              label="Lowest Competing"
              value={competitor.lowest_competing_price ? `€${competitor.lowest_competing_price.toFixed(2)}` : '—'}
            />
            <StatCard
              label="Buy Box"
              value={competitor.buy_box_winner ? 'Yes' : 'No'}
              color={competitor.buy_box_winner ? 'green' : 'red'}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Keywords Tab ──────────────────────────────────────────────────────────────

function KeywordsTab({ keywords }: { keywords: BolProductAnalysisResponse['keywords'] }) {
  const highPriority = keywords.filter(kw => kw.priority >= 7);
  const missingFromTitle = keywords.filter(kw => !kw.in_title && kw.search_volume && kw.search_volume > 100);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-slate-900 mb-3">
          High Priority Keywords ({highPriority.length})
        </h3>
        <div className="space-y-2">
          {highPriority.slice(0, 10).map(kw => (
            <div key={kw.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-3">
                <span className="font-medium text-slate-900">{kw.keyword}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                  Priority {kw.priority}/10
                </span>
                {kw.in_title && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                    ✓ In Title
                  </span>
                )}
              </div>
              <div className="text-sm text-slate-600">
                {kw.search_volume ? `${kw.search_volume.toLocaleString()} searches/mo` : '—'}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-slate-900 mb-3 text-red-600">
          Missing from Title ({missingFromTitle.length})
        </h3>
        <div className="space-y-2">
          {missingFromTitle.slice(0, 5).map(kw => (
            <div key={kw.id} className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
              <span className="font-medium text-slate-900">{kw.keyword}</span>
              <span className="text-sm text-slate-600">
                {kw.search_volume?.toLocaleString()} searches/mo
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Content Tab ───────────────────────────────────────────────────────────────

function ContentTab({
  product,
  proposal,
  generating,
  onGenerate,
  onApprove,
  onReject,
  onPush,
}: {
  product: BolProduct;
  proposal: BolContentProposal | null;
  generating: boolean;
  onGenerate: () => void;
  onApprove: () => void;
  onReject: (reason?: string) => void;
  onPush: () => void;
}) {
  if (!proposal) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-slate-600 mb-4">No content proposal generated yet</p>
        <button
          onClick={onGenerate}
          disabled={generating}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          {generating ? 'Generating...' : 'Generate Optimized Content'}
        </button>
      </div>
    );
  }

  const changes = proposal.changes_summary;

  return (
    <div className="space-y-6">
      {/* Status + Actions */}
      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-700">Status:</span>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
            proposal.status === 'pending' ? 'bg-amber-100 text-amber-700' :
            proposal.status === 'approved' ? 'bg-green-100 text-green-700' :
            proposal.status === 'pushed' ? 'bg-blue-100 text-blue-700' :
            'bg-slate-100 text-slate-700'
          }`}>
            {proposal.status}
          </span>
          {proposal.score_after_estimate && (
            <span className="text-sm text-slate-600">
              Estimated improvement: +{(proposal.score_after_estimate - (proposal.score_before || 0)).toFixed(0)}%
            </span>
          )}
        </div>

        <div className="flex gap-2">
          {proposal.status === 'pending' && (
            <>
              <button
                onClick={onApprove}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Approve
              </button>
              <button
                onClick={() => onReject()}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Reject
              </button>
            </>
          )}
          {proposal.status === 'approved' && (
            <button
              onClick={onPush}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Push to Bol.com
            </button>
          )}
        </div>
      </div>

      {/* Changes Summary */}
      <div>
        <h3 className="font-semibold text-slate-900 mb-3">Changes Summary</h3>
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            label="Keywords Added"
            value={changes.keywords_added.length.toString()}
            color="green"
          />
          <StatCard
            label="Promoted to Title"
            value={changes.keywords_promoted_to_title.length.toString()}
            color="green"
          />
          <StatCard
            label="Search Volume Added"
            value={changes.search_volume_added.toLocaleString()}
          />
          <StatCard
            label="Title Length"
            value={`${changes.title_chars_before} → ${changes.title_chars_after}`}
          />
        </div>

        {changes.keywords_added.length > 0 && (
          <div className="mt-3 p-3 bg-green-50 rounded-lg">
            <p className="text-sm font-medium text-green-900 mb-1">Keywords Added:</p>
            <p className="text-sm text-green-700">{changes.keywords_added.join(', ')}</p>
          </div>
        )}
      </div>

      {/* Before / After Comparison */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h4 className="font-medium text-slate-700 mb-2">Current Title</h4>
          <div className="p-3 bg-slate-50 rounded-lg text-sm text-slate-900">
            {proposal.current_title || '(geen titel)'}
          </div>
        </div>
        <div>
          <h4 className="font-medium text-slate-700 mb-2">Proposed Title</h4>
          <div className="p-3 bg-blue-50 rounded-lg text-sm text-slate-900">
            {proposal.proposed_title}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <h4 className="font-medium text-slate-700 mb-2">Current Description</h4>
          <div className="p-3 bg-slate-50 rounded-lg text-sm text-slate-900 max-h-48 overflow-y-auto">
            {proposal.current_description ? (
              <div dangerouslySetInnerHTML={{ __html: proposal.current_description }} />
            ) : '(geen description)'}
          </div>
        </div>
        <div>
          <h4 className="font-medium text-slate-700 mb-2">Proposed Description</h4>
          <div className="p-3 bg-blue-50 rounded-lg text-sm text-slate-900 max-h-48 overflow-y-auto">
            <div dangerouslySetInnerHTML={{ __html: proposal.proposed_description }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Performance Tab ───────────────────────────────────────────────────────────

function PerformanceTab({ product, customerId }: { product: BolProduct; customerId: string }) {
  // TODO: Fetch performance snapshots from bol_content_performance_summary
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <p className="text-slate-600">Performance tracking will appear here after content is pushed</p>
      <p className="text-sm text-slate-500 mt-2">Snapshots: Before, 7d, 14d, 30d</p>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: 'green' | 'amber' | 'red';
}) {
  const colorClasses = color
    ? color === 'green'
      ? 'text-green-600 bg-green-50'
      : color === 'amber'
      ? 'text-amber-600 bg-amber-50'
      : 'text-red-600 bg-red-50'
    : 'text-slate-900 bg-slate-50';

  return (
    <div className={`p-4 rounded-lg ${colorClasses}`}>
      <div className="text-xs font-medium opacity-75 mb-1">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
