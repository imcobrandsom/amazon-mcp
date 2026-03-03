import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Search, BookOpen, ChevronDown, ChevronRight, X } from 'lucide-react';
import clsx from 'clsx';
import type { AcademyArticle, AcademyCategoryGroup } from '../types/academy';

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildCategoryGroups(articles: AcademyArticle[]): AcademyCategoryGroup[] {
  const map = new Map<string, Map<string, AcademyArticle[]>>();

  for (const article of articles) {
    const cat = article.category || 'Overig';
    const sub = article.subcategory || '';
    if (!map.has(cat)) map.set(cat, new Map());
    const subMap = map.get(cat)!;
    if (!subMap.has(sub)) subMap.set(sub, []);
    subMap.get(sub)!.push(article);
  }

  const groups: AcademyCategoryGroup[] = [];
  for (const [category, subMap] of map.entries()) {
    const subcategories = Array.from(subMap.entries()).map(([subcategory, arts]) => ({
      subcategory,
      articles: arts.sort((a, b) => a.title.localeCompare(b.title)),
    }));
    subcategories.sort((a, b) => a.subcategory.localeCompare(b.subcategory));
    groups.push({
      category,
      subcategories,
      totalCount: subcategories.reduce((n, s) => n + s.articles.length, 0),
    });
  }

  return groups.sort((a, b) => a.category.localeCompare(b.category));
}

function highlight(text: string, query: string): string {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(
    new RegExp(`(${escaped})`, 'gi'),
    '<mark class="bg-yellow-200 rounded-sm px-0.5">$1</mark>'
  );
}

// ─── Article view ────────────────────────────────────────────────────────────

function ArticleView({
  article,
  searchQuery,
}: {
  article: AcademyArticle;
  searchQuery: string;
}) {
  const highlightedTitle = useMemo(
    () => highlight(article.title, searchQuery),
    [article.title, searchQuery]
  );

  return (
    <article className="max-w-3xl mx-auto px-8 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-6">
        <Link to="/academy" className="hover:text-slate-600 transition-colors">
          Academy
        </Link>
        <ChevronRight size={11} />
        {article.category && (
          <>
            <span className="text-slate-400">{article.category}</span>
            <ChevronRight size={11} />
          </>
        )}
        {article.subcategory && (
          <>
            <span className="text-slate-400">{article.subcategory}</span>
            <ChevronRight size={11} />
          </>
        )}
        <span className="text-slate-600 font-medium truncate max-w-[200px]">
          {article.title}
        </span>
      </div>

      {/* Title */}
      <h1
        className="text-2xl font-semibold text-slate-900 mb-2 leading-snug"
        dangerouslySetInnerHTML={{ __html: highlightedTitle }}
      />
      {article.subtitle && (
        <p className="text-base text-slate-500 mb-6">{article.subtitle}</p>
      )}

      {/* Meta */}
      <div className="flex items-center gap-4 mb-8 pb-6 border-b border-slate-100 text-xs text-slate-400">
        {article.lastModified && (
          <span>Bijgewerkt: {article.lastModified}</span>
        )}
        {article.keywords && (
          <span className="truncate max-w-xs" title={article.keywords}>
            Tags: {article.keywords}
          </span>
        )}
      </div>

      {/* Body — HTML from HubSpot */}
      <div
        className="prose prose-slate prose-sm max-w-none
          prose-headings:font-semibold prose-headings:text-slate-800
          prose-a:text-brand-600 prose-a:no-underline hover:prose-a:underline
          prose-img:rounded-lg prose-img:shadow-sm prose-img:max-w-full
          prose-ul:pl-5 prose-ol:pl-5
          [&_iframe]:max-w-full [&_iframe]:rounded-lg [&_iframe]:shadow-sm"
        dangerouslySetInnerHTML={{ __html: article.body }}
      />
    </article>
  );
}

// ─── Category list ───────────────────────────────────────────────────────────

function ArticleListItem({
  article,
  isActive,
  searchQuery,
  onClick,
}: {
  article: AcademyArticle;
  isActive: boolean;
  searchQuery: string;
  onClick: () => void;
}) {
  const highlightedTitle = useMemo(
    () => highlight(article.title, searchQuery),
    [article.title, searchQuery]
  );

  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full text-left px-4 py-3 border-b border-slate-100 transition-colors',
        isActive
          ? 'bg-brand-50 border-l-2 border-l-brand-500'
          : 'hover:bg-slate-50'
      )}
    >
      <p
        className="text-sm font-medium text-slate-800 leading-snug"
        dangerouslySetInnerHTML={{ __html: highlightedTitle }}
      />
      {article.subcategory && (
        <p className="text-xs text-slate-400 mt-0.5">{article.subcategory}</p>
      )}
    </button>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({
  groups,
  activeCategory,
  onSelectCategory,
  articleCount,
}: {
  groups: AcademyCategoryGroup[];
  activeCategory: string | null;
  onSelectCategory: (cat: string | null) => void;
  articleCount: number;
}) {
  const [openCats, setOpenCats] = useState<Set<string>>(
    () => new Set(activeCategory ? [activeCategory] : [])
  );

  const toggle = (cat: string) => {
    setOpenCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
    onSelectCategory(cat);
  };

  useEffect(() => {
    if (activeCategory) {
      setOpenCats(prev => new Set([...prev, activeCategory]));
    }
  }, [activeCategory]);

  return (
    <div className="h-full overflow-y-auto">
      {/* All articles */}
      <button
        onClick={() => onSelectCategory(null)}
        className={clsx(
          'w-full flex items-center justify-between px-4 py-3 text-sm border-b border-slate-200 transition-colors',
          activeCategory === null
            ? 'bg-brand-50 text-brand-700 font-medium'
            : 'text-slate-600 hover:bg-slate-50'
        )}
      >
        <span className="flex items-center gap-2">
          <BookOpen size={14} />
          Alle artikelen
        </span>
        <span className="text-xs bg-slate-200 text-slate-600 rounded-full px-2 py-0.5">
          {articleCount}
        </span>
      </button>

      {/* Categories */}
      {groups.map(group => (
        <div key={group.category}>
          <button
            onClick={() => toggle(group.category)}
            className={clsx(
              'w-full flex items-center justify-between px-4 py-2.5 text-sm border-b border-slate-100 transition-colors',
              activeCategory === group.category
                ? 'bg-brand-50 text-brand-700 font-semibold'
                : 'text-slate-700 hover:bg-slate-50 font-medium'
            )}
          >
            <span className="text-left leading-snug">{group.category}</span>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-xs text-slate-400">{group.totalCount}</span>
              <ChevronDown
                size={13}
                className={clsx(
                  'text-slate-400 transition-transform duration-150',
                  openCats.has(group.category) && 'rotate-180'
                )}
              />
            </div>
          </button>

          {openCats.has(group.category) && (
            <div className="bg-slate-50">
              {group.subcategories.map(sub => (
                <div key={sub.subcategory}>
                  {sub.subcategory && (
                    <p className="px-5 pt-2 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      {sub.subcategory}
                    </p>
                  )}
                  {sub.articles.slice(0, 8).map(article => (
                    <Link
                      key={article.slug}
                      to={`/academy/${article.slug}`}
                      className={clsx(
                        'block px-5 py-1.5 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors truncate'
                      )}
                    >
                      {article.title}
                    </Link>
                  ))}
                  {sub.articles.length > 8 && (
                    <button
                      onClick={() => onSelectCategory(group.category)}
                      className="block px-5 py-1 text-xs text-brand-600 hover:text-brand-800"
                    >
                      +{sub.articles.length - 8} meer…
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AcademyPage() {
  const { '*': slugParam } = useParams<{ '*': string }>();
  const navigate = useNavigate();

  const [articles, setArticles] = useState<AcademyArticle[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/academy-articles.json')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<AcademyArticle[]>;
      })
      .then(setArticles)
      .catch(err => setLoadError(err.message));
  }, []);

  // ── Derived state ──────────────────────────────────────────────────────────
  const groups = useMemo(() => buildCategoryGroups(articles), [articles]);

  const activeArticle = useMemo(
    () => (slugParam ? articles.find(a => a.slug === slugParam) ?? null : null),
    [slugParam, articles]
  );

  const filteredArticles = useMemo(() => {
    let list = articles;
    if (activeCategory) {
      list = list.filter(a => a.category === activeCategory);
    }
    if (search.trim().length >= 2) {
      const q = search.toLowerCase();
      list = list.filter(
        a =>
          a.title.toLowerCase().includes(q) ||
          a.body.toLowerCase().includes(q) ||
          a.keywords.toLowerCase().includes(q) ||
          a.subcategory.toLowerCase().includes(q)
      );
    }
    return list;
  }, [articles, activeCategory, search]);

  // When slug changes, set active category in sidebar
  useEffect(() => {
    if (activeArticle) {
      setActiveCategory(activeArticle.category || null);
    }
  }, [activeArticle]);

  const handleSelectCategory = useCallback((cat: string | null) => {
    setActiveCategory(cat);
    if (!slugParam) return; // stay on list view
    // Navigate back to list when changing category
    navigate('/academy');
  }, [slugParam, navigate]);

  // ── Loading / error states ────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-slate-500 text-sm">
            Kon artikelen niet laden: {loadError}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Controleer of <code>public/academy-articles.json</code> bestaat.
          </p>
        </div>
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Artikelen laden…
        </div>
      </div>
    );
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-slate-200 bg-white flex flex-col overflow-hidden">
        {/* Header + search */}
        <div className="px-4 py-4 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={16} className="text-brand-600" />
            <h1 className="text-sm font-semibold text-slate-800">Academy</h1>
            <span className="ml-auto text-xs text-slate-400">
              {articles.length} artikelen
            </span>
          </div>
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Zoeken…"
              className="w-full pl-8 pr-7 py-1.5 text-xs border border-slate-200 rounded-md
                focus:outline-none focus:ring-1 focus:ring-brand-400 focus:border-brand-400
                placeholder:text-slate-400 bg-slate-50"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Nav tree (hidden during search) */}
        {!search && (
          <div className="flex-1 overflow-hidden">
            <Sidebar
              groups={groups}
              activeCategory={activeCategory}
              onSelectCategory={handleSelectCategory}
              articleCount={articles.length}
            />
          </div>
        )}

        {/* Search results count */}
        {search && (
          <p className="px-4 py-2 text-xs text-slate-500 border-b border-slate-100 flex-shrink-0">
            {filteredArticles.length} resultaten voor &ldquo;{search}&rdquo;
          </p>
        )}
      </aside>

      {/* Main content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Article list (shown when no article is open, or when searching) */}
        {(!activeArticle || search) && (
          <div
            className={clsx(
              'overflow-y-auto border-r border-slate-200 bg-white',
              activeArticle ? 'w-72 flex-shrink-0' : 'flex-1'
            )}
          >
            {/* List header */}
            <div className="px-4 py-3 border-b border-slate-100 sticky top-0 bg-white z-10">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                {search
                  ? `Zoekresultaten (${filteredArticles.length})`
                  : activeCategory
                  ? `${activeCategory} (${filteredArticles.length})`
                  : `Alle artikelen (${filteredArticles.length})`}
              </p>
            </div>

            {filteredArticles.length === 0 ? (
              <p className="px-4 py-8 text-sm text-slate-400 text-center">
                Geen artikelen gevonden.
              </p>
            ) : (
              filteredArticles.map(article => (
                <ArticleListItem
                  key={article.slug}
                  article={article}
                  isActive={activeArticle?.slug === article.slug}
                  searchQuery={search}
                  onClick={() => {
                    navigate(`/academy/${article.slug}`);
                    setSearch('');
                  }}
                />
              ))
            )}
          </div>
        )}

        {/* Article detail */}
        {activeArticle && !search ? (
          <div className="flex-1 overflow-y-auto bg-white">
            <ArticleView article={activeArticle} searchQuery={search} />
          </div>
        ) : !activeArticle && !search ? null : null}

        {/* 404 for unknown slug */}
        {slugParam && !activeArticle && articles.length > 0 && !search && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-slate-500 text-sm mb-1">Artikel niet gevonden</p>
              <p className="text-xs text-slate-400 font-mono">/academy/{slugParam}</p>
              <Link
                to="/academy"
                className="mt-4 inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800"
              >
                ← Terug naar overzicht
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
