import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getBolCategoryInsights, getBolCompetitorCatalog, listBolCustomers } from '../lib/bol-api';
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
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';

// Helper function
const fmt = (n: number, decimals = 2) => n.toFixed(decimals);

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
        console.log('[BolCompetitorResearch] Fetching Bol customers for clientId:', clientId);
        const { customers } = await listBolCustomers();
        const customer = customers.find(c => c.client_id === clientId);
        if (customer) {
          console.log('[BolCompetitorResearch] Found bolCustomerId:', customer.id);
          setBolCustomerId(customer.id);
        } else {
          console.error('[BolCompetitorResearch] No Bol customer found for clientId:', clientId);
          setError('No Bol.com customer linked to this client');
          setLoading(false);
        }
      } catch (err) {
        console.error('[BolCompetitorResearch] Failed to fetch Bol customers:', err);
        setError('Failed to load customer data');
        setLoading(false);
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
        console.log('[BolCompetitorResearch] Fetching category insights for:', bolCustomerId);
        const { insights } = await getBolCategoryInsights(bolCustomerId);
        console.log('[BolCompetitorResearch] Raw insights response:', insights);

        const insightsArray = Array.isArray(insights) ? insights : insights ? [insights] : [];
        console.log('[BolCompetitorResearch] Parsed insights array:', insightsArray);
        setAllInsights(insightsArray);

        // Auto-select first category
        if (insightsArray.length > 0 && !selectedCategory) {
          setSelectedCategory(insightsArray[0].category_slug);
        }
      } catch (err) {
        console.error('[BolCompetitorResearch] Failed to load category insights:', err);
        setError(`Failed to load category insights: ${(err as Error).message}`);
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
        console.log('[BolCompetitorResearch] Fetching data for category:', selectedCategory);

        // Get category insights
        const { insights } = await getBolCategoryInsights(bolCustomerId, selectedCategory);
        console.log('[BolCompetitorResearch] Category insights:', insights);
        setCurrentInsights(insights as BolCategoryInsights);

        // Get competitor data
        const { competitors: comps } = await getBolCompetitorCatalog(
          bolCustomerId,
          selectedCategory,
          100
        );
        console.log('[BolCompetitorResearch] Competitors:', comps);
        setCompetitors(comps || []);
      } catch (err) {
        console.error('[BolCompetitorResearch] Failed to load competitors:', err);
        setError(`Failed to load competitor data: ${(err as Error).message}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [bolCustomerId, selectedCategory]);

  // Calculate aggregate stats
  const aggregateStats = useMemo(() => {
    if (allInsights.length === 0) return null;

    const totalCompetitors = allInsights.reduce((sum, cat) => sum + cat.competitor_count, 0);
    const totalYourProducts = allInsights.reduce((sum, cat) => sum + cat.your_product_count, 0);

    // Weighted average of content quality
    const totalWeightedQuality = allInsights.reduce(
      (sum, cat) => sum + (cat.content_quality_avg ?? 0) * cat.competitor_count,
      0
    );
    const avgContentQuality = totalCompetitors > 0
      ? Math.round(totalWeightedQuality / totalCompetitors)
      : 0;

    // Average competitor price (simple average across categories)
    const categoriesWithPrice = allInsights.filter(c => c.avg_competitor_price !== null);
    const avgCompPrice = categoriesWithPrice.length > 0
      ? categoriesWithPrice.reduce((sum, c) => sum + (c.avg_competitor_price ?? 0), 0) / categoriesWithPrice.length
      : null;

    return {
      totalCompetitors,
      totalYourProducts,
      avgContentQuality,
      avgCompPrice,
      categoryCount: allInsights.length,
    };
  }, [allInsights]);

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

  // Loading state
  if (loading && !bolCustomerId) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={18} className="animate-spin text-slate-400" />
          <span className="ml-3 text-slate-600">Loading customer data...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <button
          onClick={() => navigate(`/clients/${clientId}/bol`)}
          className="flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-6 font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center max-w-2xl mx-auto">
          <AlertTriangle size={48} className="text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-red-800 mb-2">Error Loading Competitor Research</h3>
          <p className="text-sm text-red-600 mb-4">{error}</p>
          <p className="text-xs text-red-500">
            Check the browser console for more details.
          </p>
        </div>
      </div>
    );
  }

  // Loading insights
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={18} className="animate-spin text-slate-400" />
          <span className="ml-3 text-slate-600">Loading competitor research...</span>
        </div>
      </div>
    );
  }

  // Empty state
  if (allInsights.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <button
          onClick={() => navigate(`/clients/${clientId}/bol`)}
          className="flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-6 font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center max-w-2xl mx-auto">
          <Search size={48} className="text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-800 mb-2">No Competitor Data Available</h3>
          <p className="text-sm text-slate-500 mb-6">
            Trigger a 'Competitor Research' sync from the dashboard to analyze your categories.
          </p>
          <div className="text-xs text-slate-400">
            The competitor analysis runs automatically after the extended sync, or can be triggered manually.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Competitor Research</h1>
          <p className="text-sm text-slate-500 mt-1">
            Category-level competitor analysis with content insights and trending keywords
          </p>
        </div>
        <button
          onClick={() => navigate(`/clients/${clientId}/bol`)}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-800 transition-colors font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
      </div>

      {/* Aggregate Stats */}
      {aggregateStats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-600 text-sm font-medium">Avg Category Price</span>
              <DollarSign className="w-4 h-4 text-green-500" />
            </div>
            <div className="text-2xl font-bold text-slate-800">
              {aggregateStats.avgCompPrice !== null ? `€${fmt(aggregateStats.avgCompPrice, 2)}` : 'N/A'}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Across all categories
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-600 text-sm font-medium">Total Competitors</span>
              <Package className="w-4 h-4 text-blue-500" />
            </div>
            <div className="text-2xl font-bold text-slate-800">
              {aggregateStats.totalCompetitors}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Your products: {aggregateStats.totalYourProducts}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-600 text-sm font-medium">Avg Content Quality</span>
              <Award className="w-4 h-4 text-purple-500" />
            </div>
            <div className="text-2xl font-bold text-slate-800">
              {aggregateStats.avgContentQuality}
              <span className="text-lg text-slate-400">/100</span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Competitor average
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-600 text-sm font-medium">Categories Analyzed</span>
              <TrendingUp className="w-4 h-4 text-orange-500" />
            </div>
            <div className="text-2xl font-bold text-slate-800">
              {aggregateStats.categoryCount}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              With competitor insights
            </div>
          </div>
        </div>
      )}

      {/* Category Overview Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">Category Overview</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Click a category to view detailed competitor analysis
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-4 py-2 text-left font-semibold text-slate-500">Category</th>
                <th className="px-4 py-2 text-center font-semibold text-slate-500">Your Products</th>
                <th className="px-4 py-2 text-center font-semibold text-slate-500">Competitors</th>
                <th className="px-4 py-2 text-right font-semibold text-slate-500">Avg Price</th>
                <th className="px-4 py-2 text-right font-semibold text-slate-500">Price Gap</th>
                <th className="px-4 py-2 text-center font-semibold text-slate-500">Content</th>
                <th className="px-4 py-2 text-left font-semibold text-slate-500">Top Keywords</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {allInsights.map((insight) => {
                const categoryName = insight.category_path
                  ? insight.category_path.split(' > ').pop() || insight.category_slug
                  : insight.category_slug;
                const priceGapColor = (insight.price_gap_percent ?? 0) >= 0 ? 'text-green-600' : 'text-red-600';
                const contentColor = (insight.content_quality_avg ?? 0) >= 70
                  ? 'bg-green-100 text-green-700'
                  : (insight.content_quality_avg ?? 0) >= 50
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-red-100 text-red-700';
                const topKeywords = (insight.trending_keywords || []).slice(0, 3);
                const isSelected = selectedCategory === insight.category_slug;

                return (
                  <tr
                    key={insight.id}
                    onClick={() => setSelectedCategory(insight.category_slug)}
                    className={`hover:bg-slate-50 cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50' : ''
                    }`}
                  >
                    <td className="px-4 py-2.5 text-slate-800 font-medium">{categoryName}</td>
                    <td className="px-4 py-2.5 text-center text-slate-600">{insight.your_product_count}</td>
                    <td className="px-4 py-2.5 text-center text-slate-600">{insight.competitor_count}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">
                      {insight.avg_competitor_price !== null ? `€${fmt(insight.avg_competitor_price, 2)}` : '—'}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-medium ${priceGapColor}`}>
                      {insight.price_gap_percent !== null
                        ? `${insight.price_gap_percent > 0 ? '+' : ''}${fmt(insight.price_gap_percent, 1)}%`
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {insight.content_quality_avg !== null ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${contentColor}`}>
                          {Math.round(insight.content_quality_avg)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {topKeywords.map((kw, ki) => (
                          <span
                            key={ki}
                            className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px]"
                          >
                            {kw.keyword}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected Category Details */}
      {currentInsights && (
        <>
          {/* Category Stats */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">
              {currentInsights.category_path || currentInsights.category_slug}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="border border-slate-200 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-1">Avg Competitor Price</div>
                <div className="text-xl font-bold text-slate-800">
                  {currentInsights.avg_competitor_price !== null
                    ? `€${fmt(currentInsights.avg_competitor_price, 2)}`
                    : 'N/A'}
                </div>
                {currentInsights.avg_your_price !== null && (
                  <div className="text-xs text-slate-500 mt-1">
                    Your avg: €{fmt(currentInsights.avg_your_price, 2)}
                  </div>
                )}
              </div>

              <div className="border border-slate-200 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-1">Competitors</div>
                <div className="text-xl font-bold text-slate-800">{currentInsights.competitor_count}</div>
                <div className="text-xs text-slate-500 mt-1">
                  Your products: {currentInsights.your_product_count}
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-1">Avg Content Quality</div>
                <div className="text-xl font-bold text-slate-800">
                  {currentInsights.content_quality_avg !== null
                    ? `${Math.round(currentInsights.content_quality_avg)}/100`
                    : 'N/A'}
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-1">Total Products</div>
                <div className="text-xl font-bold text-slate-800">{currentInsights.total_products}</div>
                <div className="text-xs text-slate-500 mt-1">in this category</div>
              </div>
            </div>
          </div>

          {/* Trending Keywords */}
          {currentInsights.trending_keywords && currentInsights.trending_keywords.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Trending Keywords</h3>
              <div className="flex flex-wrap gap-2">
                {currentInsights.trending_keywords.slice(0, 20).map((kw, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 text-slate-700 text-sm rounded-lg border border-slate-200"
                  >
                    <span className="font-medium">{kw.keyword}</span>
                    <span className="text-slate-400 text-xs">({kw.frequency}×)</span>
                    {kw.search_volume != null && (
                      <span className="bg-blue-500 text-white rounded px-1.5 py-0.5 text-xs font-medium">
                        {kw.search_volume.toLocaleString('nl-NL')}/mnd
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trending USPs */}
          {currentInsights.trending_usps && currentInsights.trending_usps.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Trending USPs</h3>
              <div className="flex flex-wrap gap-2">
                {currentInsights.trending_usps.slice(0, 12).map((usp, i) => (
                  <span
                    key={i}
                    className="px-3 py-1.5 bg-purple-50 text-purple-700 text-sm rounded-lg border border-purple-200"
                  >
                    {usp.usp} <span className="text-purple-400">({usp.frequency})</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Competitor Products Table */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-800">Competitor Products</h3>

              <div className="flex items-center gap-4">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search products..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-9 pr-3 py-2 bg-white text-slate-700 rounded text-sm border border-slate-300 focus:border-blue-500 focus:outline-none w-64"
                  />
                </div>

                {/* Page Size */}
                <select
                  value={pageSize}
                  onChange={e => setPageSize(Number(e.target.value) as 25 | 50 | 100)}
                  className="bg-white text-slate-700 rounded px-3 py-2 text-sm border border-slate-300 focus:border-blue-500 focus:outline-none"
                >
                  <option value={25}>25 per page</option>
                  <option value={50}>50 per page</option>
                  <option value={100}>100 per page</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold text-slate-500">EAN</th>
                    <th
                      className="text-left px-4 py-2 font-semibold text-slate-500 cursor-pointer hover:text-slate-700"
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
                    <th className="text-left px-4 py-2 font-semibold text-slate-500">Brand</th>
                    <th
                      className="text-right px-4 py-2 font-semibold text-slate-500 cursor-pointer hover:text-slate-700"
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
                    <th className="text-center px-4 py-2 font-semibold text-slate-500">Title Score</th>
                    <th className="text-center px-4 py-2 font-semibold text-slate-500">Desc Score</th>
                    <th className="text-left px-4 py-2 font-semibold text-slate-500">Keywords</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paged.map(comp => (
                    <tr key={comp.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2.5 text-xs font-mono text-slate-500">
                        {comp.competitor_ean}
                      </td>
                      <td className="px-4 py-2.5 max-w-xs">
                        <div className="truncate text-slate-700" title={comp.title || ''}>
                          {comp.title || <span className="text-slate-400 italic">No title</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {comp.brand || <span className="text-slate-400 italic">N/A</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-700">
                        {comp.list_price != null ? (
                          `€${fmt(comp.list_price, 2)}`
                        ) : (
                          <span className="text-slate-400 italic">N/A</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {(comp.analysis?.title_score ?? null) != null ? (
                          <span
                            className={
                              (comp.analysis?.title_score ?? 0) >= 70
                                ? 'text-green-600 font-semibold'
                                : (comp.analysis?.title_score ?? 0) >= 50
                                ? 'text-amber-600 font-semibold'
                                : 'text-red-600 font-semibold'
                            }
                          >
                            {comp.analysis?.title_score ?? 0}
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {(comp.analysis?.description_score ?? null) != null ? (
                          <span
                            className={
                              (comp.analysis?.description_score ?? 0) >= 70
                                ? 'text-green-600 font-semibold'
                                : (comp.analysis?.description_score ?? 0) >= 50
                                ? 'text-amber-600 font-semibold'
                                : 'text-red-600 font-semibold'
                            }
                          >
                            {comp.analysis?.description_score ?? 0}
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">
                        <div className="max-w-xs truncate">
                          {(comp.analysis?.extracted_keywords ?? []).slice(0, 4).join(', ') || (
                            <span className="italic text-slate-400">No keywords</span>
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
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
                <div className="text-sm text-slate-500">
                  Page {page + 1} of {totalPages} ({sorted.length} products)
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="p-2 bg-white border border-slate-200 rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4 text-slate-600" />
                  </button>
                  <button
                    onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                    disabled={page >= totalPages - 1}
                    className="p-2 bg-white border border-slate-200 rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4 text-slate-600" />
                  </button>
                </div>
              </div>
            )}

            {paged.length === 0 && (
              <div className="text-center py-8 text-slate-500">
                {search ? `No competitors found matching "${search}"` : 'No competitor data available'}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
