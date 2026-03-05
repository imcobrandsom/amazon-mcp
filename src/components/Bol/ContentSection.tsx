import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  Upload,
  Pencil,
  Sparkles,
  X,
  Check,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronLeft,
  ChevronRight,
  Bell,
} from 'lucide-react';
import {
  getBolContentProposals,
  generateBolContent,
  updateContentProposalStatus,
  pushContentToBol,
  getClientBrief,
  saveClientBrief,
  getContentTrends,
  uploadContentBase,
  getBolProducts,
} from '../../lib/bol-api';
import type {
  BolContentProposal,
  BolContentTrend,
  BolProduct,
} from '../../types/bol';
import clsx from 'clsx';

interface ContentSectionProps {
  bolCustomerId: string;
  clientId: string;
}

type FilterType = 'all' | 'no_basis' | 'score_low' | 'has_proposal' | 'approved';
type SortKey = 'score' | 'ean' | 'proposal_date';

function scoreTextColor(score: number | null): string {
  if (score === null) return 'text-slate-400';
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-amber-600';
  return 'text-red-600';
}

function scoreBadgeClass(score: number | null): string {
  if (score === null) return 'bg-slate-50 text-slate-400 border-slate-200';
  if (score >= 80) return 'bg-green-50 text-green-600 border-green-200';
  if (score >= 60) return 'bg-amber-50 text-amber-600 border-amber-200';
  return 'bg-red-50 text-red-600 border-red-200';
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'pending':  return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'approved': return 'bg-green-50 text-green-700 border-green-200';
    case 'pushed':   return 'bg-teal-50 text-teal-700 border-teal-200';
    case 'rejected': return 'bg-slate-50 text-slate-500 border-slate-200';
    default:         return 'bg-slate-50 text-slate-400 border-slate-200';
  }
}

function statusLabel(status: string | null): string {
  if (!status) return 'Geen voorstel';
  return {
    pending: 'In afwachting',
    approved: 'Goedgekeurd',
    pushed: 'Gepubliceerd',
    rejected: 'Afgewezen',
  }[status] ?? status;
}

export default function ContentSection({
  bolCustomerId,
  clientId,
}: ContentSectionProps) {
  const [products, setProducts] = useState<BolProduct[]>([]);
  const [proposals, setProposals] = useState<BolContentProposal[]>([]);
  const [basisCoverage, setBasisCoverage] = useState<Record<string, boolean>>({});
  const [trends, setTrends] = useState<BolContentTrend[]>([]);
  const [brief, setBrief] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<Set<string>>(new Set());

  // UI state
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(25);
  const [page, setPage] = useState(0);

  // Modals
  const [showBriefModal, setShowBriefModal] = useState(false);
  const [drawerProposal, setDrawerProposal] = useState<BolContentProposal | null>(null);
  const [showUploadInput, setShowUploadInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload progress state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const uploadAbortRef = useRef<boolean>(false);

  useEffect(() => {
    setPage(0);
  }, [search, filter, sortKey, sortDir, pageSize]);

  useEffect(() => {
    loadData();
  }, [bolCustomerId]);

  async function loadData() {
    setLoading(true);
    try {
      const [productsRes, proposalsRes, trendsRes, briefRes] = await Promise.all([
        getBolProducts(bolCustomerId),
        getBolContentProposals(bolCustomerId),
        getContentTrends(bolCustomerId),
        getClientBrief(bolCustomerId),
      ]);
      setProducts(productsRes.products ?? []);
      setProposals(proposalsRes.proposals ?? []);
      setBasisCoverage(proposalsRes.basis_coverage ?? {});
      setTrends(trendsRes.trends ?? []);
      setBrief(briefRes.brief_text ?? '');
    } catch (error) {
      console.error('Failed to load content data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(file: File | null) {
    if (!file) return;

    setUploading(true);
    setUploadProgress(0);
    uploadAbortRef.current = false;

    try {
      // Simulate progress while uploading
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (uploadAbortRef.current) return prev;
          if (prev >= 90) return prev; // Cap at 90% until complete
          return prev + 10;
        });
      }, 200);

      const result = await uploadContentBase(bolCustomerId, file);

      clearInterval(progressInterval);

      if (!uploadAbortRef.current) {
        setUploadProgress(100);
        alert(`Upload geslaagd: ${result.uploaded} producten geüpload`);
        await loadData();
        setShowUploadInput(false);

        // Reset after a delay
        setTimeout(() => {
          if (!uploadAbortRef.current) {
            setUploading(false);
            setUploadProgress(0);
          }
        }, 1000);
      }
    } catch (error: any) {
      if (!uploadAbortRef.current) {
        alert(`Upload mislukt: ${error.message}`);
        setUploading(false);
        setUploadProgress(0);
      }
    }
  }

  // Clean up on unmount - but don't abort the upload
  useEffect(() => {
    return () => {
      uploadAbortRef.current = true;
    };
  }, []);

  async function handleSaveBrief(text: string) {
    try {
      await saveClientBrief(bolCustomerId, text);
      setBrief(text);
      setShowBriefModal(false);
      alert('Klantbriefing opgeslagen');
    } catch (error: any) {
      alert(`Opslaan mislukt: ${error.message}`);
    }
  }

  async function handleGenerate(eans: string[], triggerReason: 'manual' | 'keyword_trend' = 'manual') {
    const newGenerating = new Set(generating);
    eans.forEach(ean => newGenerating.add(ean));
    setGenerating(newGenerating);

    try {
      const result = await generateBolContent(bolCustomerId, eans, triggerReason);
      alert(`Gegenereerd: ${result.generated.length} producten\nOvergeslagen: ${result.skipped.length}`);
      await loadData();
    } catch (error: any) {
      alert(`Genereren mislukt: ${error.message}`);
    } finally {
      const updatedGenerating = new Set(generating);
      eans.forEach(ean => updatedGenerating.delete(ean));
      setGenerating(updatedGenerating);
    }
  }

  async function handleApprove(proposalId: string) {
    try {
      await updateContentProposalStatus(proposalId, 'approve');
      await loadData();
      if (drawerProposal?.id === proposalId) {
        const updated = proposals.find(p => p.id === proposalId);
        if (updated) setDrawerProposal(updated);
      }
    } catch (error: any) {
      alert(`Goedkeuren mislukt: ${error.message}`);
    }
  }

  async function handleReject(proposalId: string) {
    try {
      await updateContentProposalStatus(proposalId, 'reject');
      await loadData();
      setDrawerProposal(null);
    } catch (error: any) {
      alert(`Afkeuren mislukt: ${error.message}`);
    }
  }

  async function handlePush(proposalId: string) {
    try {
      const result = await pushContentToBol(proposalId);
      alert(result.message);
      await loadData();
    } catch (error: any) {
      alert(`Push mislukt: ${error.message}`);
    }
  }

  // Build enriched content items from products + proposals
  const contentItems = useMemo(() => {
    return products.map(p => {
      const latestProposal = proposals.find(pr => pr.ean === p.ean);
      const hasBasis = basisCoverage[p.ean] ?? false;
      return {
        ean: p.ean,
        title: p.title,
        description: p.description,
        content_score: 60, // Placeholder — should come from analysis if available
        has_basis_content: hasBasis,
        latest_proposal: latestProposal ?? null,
      };
    });
  }, [products, proposals, basisCoverage]);

  // Filter
  const filtered = useMemo(() => {
    let items = contentItems;

    if (search) {
      const lc = search.toLowerCase();
      items = items.filter(it =>
        it.ean.toLowerCase().includes(lc) || it.title?.toLowerCase().includes(lc)
      );
    }

    if (filter === 'no_basis') items = items.filter(it => !it.has_basis_content);
    if (filter === 'score_low') items = items.filter(it => (it.content_score ?? 0) < 60);
    if (filter === 'has_proposal') items = items.filter(it => !!it.latest_proposal);
    if (filter === 'approved') items = items.filter(it => it.latest_proposal?.status === 'approved');

    return items;
  }, [contentItems, search, filter]);

  // Sort
  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let valA: any, valB: any;
      if (sortKey === 'score') {
        valA = a.content_score ?? 0;
        valB = b.content_score ?? 0;
      } else if (sortKey === 'ean') {
        valA = a.ean;
        valB = b.ean;
      } else {
        valA = a.latest_proposal?.generated_at ?? '';
        valB = b.latest_proposal?.generated_at ?? '';
      }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  // Paginate
  const totalPages = Math.ceil(sorted.length / pageSize);
  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize);

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-slate-400">Laden...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Upload progress bar */}
      {uploading && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Upload size={16} className="text-blue-600 animate-pulse" />
              <span className="text-sm font-medium text-blue-900">
                Basis content uploaden...
              </span>
            </div>
            <span className="text-sm font-semibold text-blue-700">
              {uploadProgress}%
            </span>
          </div>
          <div className="w-full bg-blue-100 rounded-full h-2 overflow-hidden">
            <div
              className="bg-blue-600 h-full transition-all duration-300 ease-out"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="text-xs text-blue-600 mt-2">
            De upload blijft doorlopen als je naar een andere pagina navigeert
          </p>
        </div>
      )}

      {/* Trend notifications */}
      {trends.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Bell size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-900">
                {trends.length} nieuwe content kans{trends.length > 1 ? 'en' : ''} gedetecteerd
              </p>
              {trends.slice(0, 3).map(trend => (
                <p key={trend.id} className="text-xs text-amber-700 mt-1">
                  • Keyword "{trend.keyword}" +{trend.volume_change_pct}% zoekvolume
                  — {trend.affected_eans.length} product(en) betrokken
                </p>
              ))}
            </div>
            <button
              onClick={() => {
                const affectedEans = trends.flatMap(t => t.affected_eans);
                handleGenerate([...new Set(affectedEans)], 'keyword_trend');
              }}
              className="text-xs bg-amber-500 text-white px-3 py-1.5 rounded-md hover:bg-amber-600 transition-colors flex-shrink-0"
            >
              Genereer nu content
            </button>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className={clsx(
            "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors",
            uploading
              ? "bg-blue-300 text-white cursor-not-allowed"
              : "bg-blue-600 text-white hover:bg-blue-700"
          )}
        >
          <Upload size={16} className={uploading ? "animate-pulse" : ""} />
          {uploading ? "Uploaden..." : "Upload basiscontent Excel"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={e => handleUpload(e.target.files?.[0] ?? null)}
        />

        <button
          onClick={() => setShowBriefModal(true)}
          className="flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
        >
          <Pencil size={16} />
          Klantbriefing bewerken
        </button>

        <button
          onClick={() => {
            const lowScore = contentItems.filter(it => (it.content_score ?? 0) < 60 && it.has_basis_content);
            if (lowScore.length === 0) {
              alert('Geen producten met score < 60 en basiscontent gevonden');
              return;
            }
            const confirmed = confirm(`Content genereren voor ${lowScore.length} producten met score < 60? Dit kan enkele minuten duren.`);
            if (confirmed) {
              handleGenerate(lowScore.map(it => it.ean));
            }
          }}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors"
        >
          <Sparkles size={16} />
          Genereer alles (score&lt;60)
        </button>
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Zoek op EAN of titel..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={filter}
          onChange={e => setFilter(e.target.value as FilterType)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">Alle producten</option>
          <option value="no_basis">Ontbreekt basis</option>
          <option value="score_low">Score &lt; 60</option>
          <option value="has_proposal">Heeft voorstel</option>
          <option value="approved">Goedgekeurd</option>
        </select>
        <select
          value={sortKey}
          onChange={e => setSortKey(e.target.value as SortKey)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="score">Sorteer op score</option>
          <option value="ean">Sorteer op EAN</option>
          <option value="proposal_date">Sorteer op voorstel datum</option>
        </select>
        <button
          onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50 transition-colors"
        >
          {sortDir === 'asc' ? '↑' : '↓'}
        </button>
      </div>

      {/* Content Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">EAN</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Huidige titel</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase">Score</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase">Basis</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase">Laatste voorstel</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase">Acties</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {paged.map(item => (
                <tr key={item.ean} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{item.ean}</td>
                  <td className="px-4 py-3 text-xs text-slate-600 max-w-xs truncate">
                    {item.title ? (
                      <span>{item.title.substring(0, 60)}{item.title.length > 60 ? '...' : ''}</span>
                    ) : (
                      <span className="text-slate-400 italic">Geen titel</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={clsx('inline-block px-2 py-1 text-xs font-medium rounded border', scoreBadgeClass(item.content_score))}>
                      {item.content_score ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {item.has_basis_content ? (
                      <span className="text-green-600 text-xs font-medium">✓ Beschikbaar</span>
                    ) : (
                      <span className="text-amber-600 text-xs font-medium" title="Upload basiscontent om content te kunnen genereren">⚠ Ontbreekt</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-slate-500">
                    {item.latest_proposal ? new Date(item.latest_proposal.generated_at).toLocaleDateString('nl-NL') : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={clsx('inline-block px-2 py-1 text-xs font-medium rounded border', statusBadgeClass(item.latest_proposal?.status ?? ''))}>
                      {statusLabel(item.latest_proposal?.status ?? null)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      {!item.has_basis_content && (
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Upload basis
                        </button>
                      )}
                      {item.has_basis_content && !item.latest_proposal && !generating.has(item.ean) && (
                        <button
                          onClick={() => handleGenerate([item.ean])}
                          className="flex items-center gap-1 px-2 py-1 bg-purple-600 text-white text-xs rounded hover:bg-purple-700 transition-colors"
                        >
                          <Sparkles size={12} />
                          Genereer
                        </button>
                      )}
                      {generating.has(item.ean) && (
                        <span className="text-xs text-slate-400 italic">Bezig...</span>
                      )}
                      {item.latest_proposal && (
                        <button
                          onClick={() => setDrawerProposal(item.latest_proposal)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Bekijken
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span>Toon</span>
            <select
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value) as 25 | 50 | 100)}
              className="px-2 py-1 border border-slate-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span>van {sorted.length} producten</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs text-slate-600">
              Pagina {page + 1} van {totalPages || 1}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Brief Modal */}
      {showBriefModal && (
        <BriefModal
          brief={brief}
          onSave={handleSaveBrief}
          onClose={() => setShowBriefModal(false)}
        />
      )}

      {/* Proposal Drawer */}
      {drawerProposal && (
        <ProposalDrawer
          proposal={drawerProposal}
          onApprove={handleApprove}
          onReject={handleReject}
          onPush={handlePush}
          onClose={() => setDrawerProposal(null)}
        />
      )}
    </div>
  );
}

// ── Brief Modal ────────────────────────────────────────────────────────────────

function BriefModal({
  brief,
  onSave,
  onClose,
}: {
  brief: string;
  onSave: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(brief);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Klantbriefing</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <p className="text-xs text-slate-500 mb-3">
            Richtlijnen voor tone of voice, merkuitzonderingen en content-regels.<br />
            Voorbeeld:<br />
            - Schrijf zakelijk maar toegankelijk, geen superlatieven<br />
            - Nooit vergelijken met specifieke concurrenten<br />
            - Productlijn "Pro Series" altijd hoofdletters<br />
            - Doelgroep: recreatieve sporters 25-45 jaar
          </p>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            className="w-full h-64 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder="Voer hier de klantbriefing in..."
          />
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
          >
            Annuleren
          </button>
          <button
            onClick={() => onSave(text)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Opslaan
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Proposal Drawer ────────────────────────────────────────────────────────────

function ProposalDrawer({
  proposal,
  onApprove,
  onReject,
  onPush,
  onClose,
}: {
  proposal: BolContentProposal;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onPush: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black bg-opacity-20">
      <div className="bg-white h-full w-full max-w-2xl shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-semibold text-slate-900">EAN {proposal.ean}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Current content */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Huidige content</h3>
            <div className="space-y-2">
              <div>
                <span className="text-xs text-slate-500">Titel:</span>
                <p className={clsx('text-sm mt-1', (proposal.score_before ?? 0) < 60 ? 'text-red-600' : 'text-slate-700')}>
                  {proposal.current_title || '(leeg)'}
                </p>
              </div>
              {proposal.score_before !== null && (
                <div>
                  <span className="text-xs text-slate-500">Score:</span>
                  <span className={clsx('ml-2 inline-block px-2 py-1 text-xs font-medium rounded border', scoreBadgeClass(proposal.score_before))}>
                    {proposal.score_before}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Proposal */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Voorstel</h3>
            <div className="space-y-2">
              <div>
                <span className="text-xs text-slate-500">Gegenereerd:</span>
                <span className="ml-2 text-sm text-slate-700">{new Date(proposal.generated_at).toLocaleString('nl-NL')}</span>
              </div>
              <div>
                <span className="text-xs text-slate-500">Reden:</span>
                <span className="ml-2 text-xs text-slate-600">{proposal.trigger_reason}</span>
              </div>
              <div>
                <span className="text-xs text-slate-500">Titel:</span>
                <p className="text-sm text-green-600 font-medium mt-1">{proposal.proposed_title}</p>
                <span className="text-xs text-slate-400">{proposal.proposed_title.length} tekens</span>
              </div>
              <div>
                <span className="text-xs text-slate-500">Omschrijving:</span>
                {proposal.proposed_description_parts ? (
                  <div className="mt-1 space-y-2 text-sm text-slate-700">
                    <div>
                      <span className="text-xs text-slate-400">Intro:</span>
                      <p className="mt-0.5">{proposal.proposed_description_parts.intro}</p>
                    </div>
                    <div>
                      <span className="text-xs text-slate-400">USPs:</span>
                      <ul className="mt-0.5 space-y-1">
                        {proposal.proposed_description_parts.usps.map((usp, i) => (
                          <li key={i}>{usp}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <span className="text-xs text-slate-400">Lang:</span>
                      <p className="mt-0.5">{proposal.proposed_description_parts.long}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap">{proposal.proposed_description}</p>
                )}
              </div>
            </div>
          </div>

          {/* Changes */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Wijzigingen</h3>
            <div className="space-y-1 text-xs text-slate-600">
              {proposal.changes_summary.keywords_added.length > 0 && (
                <p>Keywords toegevoegd: {proposal.changes_summary.keywords_added.map(k => <span key={k} className="inline-block bg-green-100 text-green-700 px-1.5 py-0.5 rounded mr-1">{k}</span>)}</p>
              )}
              {proposal.changes_summary.keywords_promoted_to_title.length > 0 && (
                <p>Naar titel gepromoot: {proposal.changes_summary.keywords_promoted_to_title.map(k => <span key={k} className="inline-block bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded mr-1">{k}</span>)}</p>
              )}
              <p>
                Titellengte: {proposal.changes_summary.title_chars_before} → {proposal.changes_summary.title_chars_after} tekens
                {proposal.changes_summary.title_chars_after >= 150 && proposal.changes_summary.title_chars_after <= 175 && (
                  <span className="ml-1 text-green-600">✓</span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => onReject(proposal.id)}
            className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
          >
            Afkeuren
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onApprove(proposal.id)}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
            >
              Goedkeuren
            </button>
            {proposal.status === 'approved' && (
              <button
                onClick={() => onPush(proposal.id)}
                className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
              >
                Push naar Bol →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
