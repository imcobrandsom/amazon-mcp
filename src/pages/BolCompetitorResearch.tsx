import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getBolCategoryInsights, getBolCompetitorCatalog, getBolSummaryForClient, listBolCustomers } from '../lib/bol-api';
import type { BolCategoryInsights, BolCompetitorCatalog } from '../types/bol';
import {
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Package,
  DollarSign,
  Award,
  Search,
  ArrowLeft,
} from 'lucide-react';

export default function BolCompetitorResearch() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();

  const [bolCustomerId, setBolCustomerId] = useState<string>('');
  const [allInsights, setAllInsights] = useState<BolCategoryInsights[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [currentInsights, setCurrentInsights] = useState<BolCategoryInsights | null>(null);
  const [competitors, setCompetitors] = useState<BolCompetitorCatalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<keyof BolCompetitorCatalog>('list_price');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Pagination
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(25);
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [search, sortKey, sortDir, pageSize]);

  // First: Get bolCustomerId from clientId
  useEffect(() => {
    if (!clientId) return;

    (async () => {
      try {
        const { customers } = await listBolCustomers();
        const customer = customers.find(c => c.client_id === clientId);
        if (customer) {
          setBolCustomerId(customer.id);
        } else {
          setError('No Bol.com customer linked to this client');
        }
      } catch (err) {
        console.error('Failed to fetch Bol customers:', err);
        setError('Failed to load customer data');
      }
    })();
  }, [clientId]);

  // Fetch all categories on mount
  useEffect(() => {
    if (!bolCustomerId) return;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { insights } = await getBolCategoryInsights(bolCustomerId);
        const insightsArray = Array.isArray(insights) ? insights : insights ? [insights] : [];
        setAllInsights(insightsArray);

        // Auto-select first category
        if (insightsArray.length > 0 && !selectedCategory) {
          setSelectedCategory(insightsArray[0].category_slug);
        }
      } catch (err) {
        console.error('Failed to load category insights:', err);
        setError('Failed to load category insights');
      } finally {
        setLoading(false);
      }
    })();
  }, [bolCustomerId]);

  // Fetch competitors when category changes
  useEffect(() => {
    if (!bolCustomerId || !selectedCategory) return;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Get category insights
        const { insights } = await getBolCategoryInsights(bolCustomerId, selectedCategory);
        setCurrentInsights(insights as BolCategoryInsights);

        // Get competitor data
        const { competitors: comps } = await getBolCompetitorCatalog(
          bolCustomerId,
          selectedCategory,
          100
        );
        setCompetitors(comps);
      } catch (err) {
        console.error('Failed to load competitors:', err);
        setError('Failed to load competitor data');
      } finally {
        setLoading(false);
      }
    })();
  }, [bolCustomerId, selectedCategory]);

  // Filter & sort
  const sorted = useMemo(() => {
    let filtered = competitors;

    if (search) {
      const lower = search.toLowerCase();
      filtered = filtered.filter(
        c =>
          c.title?.toLowerCase().includes(lower) ||
          c.brand?.toLowerCase().includes(lower) ||
          c.competitor_ean.includes(lower)
      );
    }

    return filtered.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];

      if (aVal == null) return 1;
      if (bVal == null) return -1;

      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [competitors, search, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / pageSize);
  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize);

  if (loading && !bolCustomerId) {
    return (
      <div className="min-h-screen bg-gray-900 p-8">
        <div className="text-gray-400">Loading customer data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 p-8">
        <button
          onClick={() => navigate(`/clients/${clientId}/bol`)}
          className="flex items-center gap-2 text-blue-400 hover:text-blue-300 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-8 text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <p className="text-red-500 text-sm">
            Check the browser console for more details.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 p-8">
        <div className="text-gray-400">Loading competitor research...</div>
      </div>
    );
  }

  if (allInsights.length === 0) {
    return (
      <div className="min-h-screen bg-gray-900 p-8">
        <button
          onClick={() => navigate(`/clients/${clientId}/bol`)}
          className="flex items-center gap-2 text-blue-400 hover:text-blue-300 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
        <div className="bg-gray-800 rounded-lg p-8 text-center">
          <p className="text-gray-400 mb-4">
            No competitor data available yet. Run a sync to collect data.
          </p>
          <p className="text-gray-500 text-sm">
            The competitor analysis runs automatically 30 minutes after the extended sync.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Competitor Research</h1>
        <button
          onClick={() => navigate(`/clients/${clientId}/bol`)}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
      </div>

      {/* Category Selector */}
      <div className="bg-gray-800 rounded-lg p-4">
        <label className="block text-sm text-gray-400 mb-2 font-medium">
          Select Category
        </label>
        <select
          value={selectedCategory || ''}
          onChange={e => setSelectedCategory(e.target.value)}
          className="w-full bg-gray-700 text-white rounded px-4 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none"
        >
          {allInsights.map(ins => (
            <option key={ins.category_slug} value={ins.category_slug}>
              {ins.category_path} ({ins.competitor_count} competitors)
            </option>
          ))}
        </select>
      </div>

      {currentInsights && (
        <>
          {/* Stat Tiles */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-400 text-sm font-medium">Avg Category Price</span>
                <DollarSign className="w-4 h-4 text-green-400" />
              </div>
              <div className="text-2xl font-bold text-white">
                €{currentInsights.avg_competitor_price?.toFixed(2) || 'N/A'}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Your avg: €{currentInsights.avg_your_price?.toFixed(2) || 'N/A'}
                {currentInsights.price_gap_percent != null && (
                  <span
                    className={
                      currentInsights.price_gap_percent > 0
                        ? 'text-red-400 ml-1'
                        : 'text-green-400 ml-1'
                    }
                  >
                    ({currentInsights.price_gap_percent > 0 ? '+' : ''}
                    {currentInsights.price_gap_percent.toFixed(1)}%)
                  </span>
                )}
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-400 text-sm font-medium">Competitors</span>
                <Package className="w-4 h-4 text-blue-400" />
              </div>
              <div className="text-2xl font-bold text-white">
                {currentInsights.competitor_count}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Your products: {currentInsights.your_product_count}
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-400 text-sm font-medium">Avg Content Quality</span>
                <Award className="w-4 h-4 text-purple-400" />
              </div>
              <div className="text-2xl font-bold text-white">
                {currentInsights.content_quality_avg?.toFixed(0) || 'N/A'}
                {currentInsights.content_quality_avg != null && (
                  <span className="text-lg text-gray-400">/100</span>
                )}
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-400 text-sm font-medium">Total Products</span>
                <TrendingUp className="w-4 h-4 text-orange-400" />
              </div>
              <div className="text-2xl font-bold text-white">
                {currentInsights.total_products}
              </div>
              <div className="text-xs text-gray-500 mt-1">in this category</div>
            </div>
          </div>

          {/* Trending Keywords Section */}
          {currentInsights.trending_keywords && currentInsights.trending_keywords.length > 0 && (
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-white mb-3">
                Trending Keywords in Category
              </h3>
              <div className="flex flex-wrap gap-2">
                {currentInsights.trending_keywords.slice(0, 20).map((kw, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-1 bg-gray-700 text-white text-sm rounded-full hover:bg-gray-600 transition-colors"
                  >
                    <span>{kw.keyword}</span>
                    <span className="text-gray-400 font-mono">({kw.frequency}×)</span>
                    {kw.search_volume != null && (
                      <span className="bg-blue-600 text-white rounded px-1.5 py-0.5 text-xs font-medium">
                        {kw.search_volume.toLocaleString('nl-NL')}/mnd
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trending USPs Section */}
          {currentInsights.trending_usps && currentInsights.trending_usps.length > 0 && (
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-white mb-3">
                Trending USPs in Category
              </h3>
              <div className="flex flex-wrap gap-2">
                {currentInsights.trending_usps.slice(0, 12).map((usp, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 bg-purple-900/30 text-purple-300 text-sm rounded-full border border-purple-700 hover:bg-purple-900/50 transition-colors"
                  >
                    {usp.usp}{' '}
                    <span className="text-purple-400 font-mono">({usp.frequency})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Competitors Table */}
      <div className="bg-gray-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Competitor Products</h3>

          <div className="flex items-center gap-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search products..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 pr-3 py-2 bg-gray-700 text-white rounded text-sm border border-gray-600 focus:border-blue-500 focus:outline-none w-64"
              />
            </div>

            {/* Page Size */}
            <select
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value) as 25 | 50 | 100)}
              className="bg-gray-700 text-white rounded px-3 py-2 text-sm border border-gray-600 focus:border-blue-500 focus:outline-none"
            >
              <option value={25}>25 per page</option>
              <option value={50}>50 per page</option>
              <option value={100}>100 per page</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-gray-400 border-b border-gray-700">
              <tr>
                <th className="text-left p-2">EAN</th>
                <th
                  className="text-left p-2 cursor-pointer hover:text-white"
                  onClick={() => {
                    if (sortKey === 'title') setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
                    else {
                      setSortKey('title');
                      setSortDir('asc');
                    }
                  }}
                >
                  Title {sortKey === 'title' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="text-left p-2">Brand</th>
                <th
                  className="text-right p-2 cursor-pointer hover:text-white"
                  onClick={() => {
                    if (sortKey === 'list_price') setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
                    else {
                      setSortKey('list_price');
                      setSortDir('asc');
                    }
                  }}
                >
                  Price {sortKey === 'list_price' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="text-center p-2">Title Score</th>
                <th className="text-center p-2">Desc Score</th>
                <th className="text-left p-2">Keywords</th>
              </tr>
            </thead>
            <tbody className="text-white">
              {paged.map(comp => (
                <tr
                  key={comp.id}
                  className="border-b border-gray-700 hover:bg-gray-700/50 transition-colors"
                >
                  <td className="p-2 text-xs font-mono text-gray-400">
                    {comp.competitor_ean}
                  </td>
                  <td className="p-2 max-w-xs">
                    <div className="truncate" title={comp.title || ''}>
                      {comp.title || <span className="text-gray-500 italic">No title</span>}
                    </div>
                  </td>
                  <td className="p-2">
                    {comp.brand || <span className="text-gray-500 italic">N/A</span>}
                  </td>
                  <td className="p-2 text-right font-mono">
                    {comp.list_price != null ? (
                      `€${comp.list_price.toFixed(2)}`
                    ) : (
                      <span className="text-gray-500 italic">N/A</span>
                    )}
                  </td>
                  <td className="p-2 text-center">
                    {(comp.analysis?.title_score ?? null) != null ? (
                      <span
                        className={
                          (comp.analysis?.title_score ?? 0) >= 70
                            ? 'text-green-400 font-semibold'
                            : (comp.analysis?.title_score ?? 0) >= 50
                            ? 'text-yellow-400 font-semibold'
                            : 'text-red-400 font-semibold'
                        }
                      >
                        {comp.analysis?.title_score ?? 0}
                      </span>
                    ) : (
                      <span className="text-gray-500">-</span>
                    )}
                  </td>
                  <td className="p-2 text-center">
                    {(comp.analysis?.description_score ?? null) != null ? (
                      <span
                        className={
                          (comp.analysis?.description_score ?? 0) >= 70
                            ? 'text-green-400 font-semibold'
                            : (comp.analysis?.description_score ?? 0) >= 50
                            ? 'text-yellow-400 font-semibold'
                            : 'text-red-400 font-semibold'
                        }
                      >
                        {comp.analysis?.description_score ?? 0}
                      </span>
                    ) : (
                      <span className="text-gray-500">-</span>
                    )}
                  </td>
                  <td className="p-2 text-xs text-gray-400">
                    <div className="max-w-xs truncate">
                      {(comp.analysis?.extracted_keywords ?? []).slice(0, 4).join(', ') || (
                        <span className="italic">No keywords</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-700">
            <div className="text-sm text-gray-400">
              Page {page + 1} of {totalPages} ({sorted.length} products)
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="p-2 bg-gray-700 rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-600 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                className="p-2 bg-gray-700 rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-600 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {paged.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            {search ? `No competitors found matching "${search}"` : 'No competitor data available'}
          </div>
        )}
      </div>
    </div>
  );
}
