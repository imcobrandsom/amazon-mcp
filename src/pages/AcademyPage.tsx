import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Search, BookOpen, ChevronDown, ChevronRight, X, Edit2, Trash2, Plus, Save } from 'lucide-react';
import clsx from 'clsx';
import type { AcademyArticle, AcademyCategoryGroup } from '../types/academy';
import { fetchAcademyArticles, updateAcademyArticle, deleteAcademyArticle, createAcademyArticle } from '../lib/academy-api';
import { useAuth } from '../contexts/AuthContext';

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

// ─── Edit Modal ──────────────────────────────────────────────────────────────

function EditModal({
  article,
  onSave,
  onCancel,
}: {
  article: AcademyArticle | null;
  onSave: (updated: Partial<AcademyArticle>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(article?.title || '');
  const [subtitle, setSubtitle] = useState(article?.subtitle || '');
  const [slug, setSlug] = useState(article?.slug || '');
  const [category, setCategory] = useState(article?.category || '');
  const [subcategory, setSubcategory] = useState(article?.subcategory || '');
  const [keywords, setKeywords] = useState(article?.keywords || '');
  const [body, setBody] = useState(article?.body || '');
  const [isPublished, setIsPublished] = useState(article?.is_published ?? true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      title,
      subtitle: subtitle || null,
      slug,
      category,
      subcategory: subcategory || null,
      keywords: keywords || null,
      body,
      is_published: isPublished,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">
            {article ? 'Artikel bewerken' : 'Nieuw artikel'}
          </h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Titel *
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Ondertitel
              </label>
              <input
                type="text"
                value={subtitle}
                onChange={e => setSubtitle(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Slug * <span className="text-slate-400">(e.g. category/subcategory/title)</span>
              </label>
              <input
                type="text"
                value={slug}
                onChange={e => setSlug(e.target.value)}
                required
                pattern="^[a-z0-9\-/]+$"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Categorie *
              </label>
              <input
                type="text"
                value={category}
                onChange={e => setCategory(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Subcategorie
              </label>
              <input
                type="text"
                value={subcategory}
                onChange={e => setSubcategory(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Keywords <span className="text-slate-400">(comma separated)</span>
              </label>
              <input
                type="text"
                value={keywords}
                onChange={e => setKeywords(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Body (HTML) *
              </label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                required
                rows={12}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-400 font-mono"
              />
            </div>

            <div className="col-span-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isPublished}
                  onChange={e => setIsPublished(e.target.checked)}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                />
                <span className="text-sm text-slate-700">Gepubliceerd</span>
              </label>
            </div>
          </div>
        </form>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
          >
            Annuleren
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-sm bg-brand-600 text-white rounded-md hover:bg-brand-700 transition-colors flex items-center gap-1.5"
          >
            <Save size={14} />
            Opslaan
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Article view ────────────────────────────────────────────────────────────

function ArticleView({
  article,
  searchQuery,
  isAdmin,
  onEdit,
  onDelete,
}: {
  article: AcademyArticle;
  searchQuery: string;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
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

      {/* Admin controls */}
      {isAdmin && (
        <div className="flex items-center gap-2 mb-4 pb-4 border-b border-slate-200">
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-brand-50 text-brand-700 rounded-md hover:bg-brand-100 transition-colors"
          >
            <Edit2 size={12} />
            Bewerken
          </button>
          <button
            onClick={onDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-50 text-red-700 rounded-md hover:bg-red-100 transition-colors"
          >
            <Trash2 size={12} />
            Verwijderen
          </button>
          {!article.is_published && (
            <span className="ml-auto px-2 py-0.5 text-xs bg-orange-100 text-orange-700 rounded-full">
              Niet gepubliceerd
            </span>
          )}
        </div>
      )}

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
        {article.last_modified_date && (
          <span>Bijgewerkt: {new Date(article.last_modified_date).toLocaleDateString('nl-NL')}</span>
        )}
        {article.keywords && (
          <span className="truncate max-w-xs" title={article.keywords}>
            Tags: {article.keywords}
          </span>
        )}
      </div>

      {/* Body — HTML */}
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

// ─── Article list item ───────────────────────────────────────────────────────

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
      {!article.is_published && (
        <span className="inline-block mt-1 px-1.5 py-0.5 text-[10px] bg-orange-100 text-orange-700 rounded">
          Concept
        </span>
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
  const { role } = useAuth();
  const isAdmin = role === 'admin';

  const [articles, setArticles] = useState<AcademyArticle[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [editingArticle, setEditingArticle] = useState<AcademyArticle | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchAcademyArticles()
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
          (a.keywords && a.keywords.toLowerCase().includes(q)) ||
          (a.subcategory && a.subcategory.toLowerCase().includes(q))
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
    if (!slugParam) return;
    navigate('/academy');
  }, [slugParam, navigate]);

  // ── Admin actions ──────────────────────────────────────────────────────────
  const handleEdit = (article: AcademyArticle) => {
    // Check if we're in JSON mode (fake ID)
    if (article.id.startsWith('json-')) {
      alert('Database is nog niet actief. Run eerst de migratie en seed script. Zie ACADEMY_ADMIN.md voor instructies.');
      return;
    }

    setEditingArticle(article);
    setShowEditModal(true);
  };

  const handleCreate = () => {
    // Check if we have any real articles (not JSON fallback)
    if (articles.length > 0 && articles[0].id.startsWith('json-')) {
      alert('Database is nog niet actief. Run eerst de migratie en seed script. Zie ACADEMY_ADMIN.md voor instructies.');
      return;
    }

    setEditingArticle(null);
    setShowEditModal(true);
  };

  const handleSave = async (updates: Partial<AcademyArticle>) => {
    try {
      if (editingArticle) {
        const updated = await updateAcademyArticle(editingArticle.id, updates);
        setArticles(prev => prev.map(a => a.id === updated.id ? updated : a));
      } else {
        const created = await createAcademyArticle(updates as any);
        setArticles(prev => [...prev, created]);
      }
      setShowEditModal(false);
      setEditingArticle(null);
    } catch (err: any) {
      alert(`Fout bij opslaan: ${err.message}`);
    }
  };

  const handleDelete = async (article: AcademyArticle) => {
    // Check if we're in JSON mode (fake ID)
    if (article.id.startsWith('json-')) {
      alert('Database is nog niet actief. Run eerst de migratie en seed script. Zie ACADEMY_ADMIN.md voor instructies.');
      return;
    }

    if (!confirm(`Weet je zeker dat je "${article.title}" wilt verwijderen?`)) return;

    try {
      await deleteAcademyArticle(article.id);
      setArticles(prev => prev.filter(a => a.id !== article.id));
      navigate('/academy');
    } catch (err: any) {
      alert(`Fout bij verwijderen: ${err.message}`);
    }
  };

  // ── Loading / error states ────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-slate-500 text-sm">
            Kon artikelen niet laden: {loadError}
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
      {/* Edit modal */}
      {showEditModal && (
        <EditModal
          article={editingArticle}
          onSave={handleSave}
          onCancel={() => {
            setShowEditModal(false);
            setEditingArticle(null);
          }}
        />
      )}

      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-slate-200 bg-white flex flex-col overflow-hidden">
        {/* Header + search */}
        <div className="px-4 py-4 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={16} className="text-brand-600" />
            <h1 className="text-sm font-semibold text-slate-800">Academy</h1>
            <span className="ml-auto text-xs text-slate-400">
              {articles.length}
            </span>
            {isAdmin && (
              <button
                onClick={handleCreate}
                className="text-brand-600 hover:text-brand-800"
                title="Nieuw artikel"
              >
                <Plus size={16} />
              </button>
            )}
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
            {filteredArticles.length} resultaten
          </p>
        )}
      </aside>

      {/* Main content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Admin setup warning banner */}
        {isAdmin && articles.length > 0 && articles[0].id.startsWith('json-') && (
          <div className="bg-orange-50 border-b border-orange-200 px-4 py-3 flex-shrink-0">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-medium text-orange-900">Database setup vereist voor admin functies</p>
                <p className="text-xs text-orange-700 mt-1">
                  Bewerken/verwijderen zijn uitgeschakeld. Run de migratie en seed script.
                  <a href="https://github.com/imcobrandsom/amazon-mcp/blob/main/ACADEMY_ADMIN.md" target="_blank" rel="noopener noreferrer" className="underline ml-1">
                    Zie documentatie →
                  </a>
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-hidden flex">
        {/* Article list */}
        {(!activeArticle || search) && (
          <div
            className={clsx(
              'overflow-y-auto border-r border-slate-200 bg-white',
              activeArticle ? 'w-72 flex-shrink-0' : 'flex-1'
            )}
          >
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
                  key={article.id}
                  article={article}
                  isActive={activeArticle?.id === article.id}
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
            <ArticleView
              article={activeArticle}
              searchQuery={search}
              isAdmin={isAdmin}
              onEdit={() => handleEdit(activeArticle)}
              onDelete={() => handleDelete(activeArticle)}
            />
          </div>
        ) : null}

        {/* 404 */}
        {slugParam && !activeArticle && articles.length > 0 && !search && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-slate-500 text-sm mb-1">Artikel niet gevonden</p>
              <p className="text-xs text-slate-400 font-mono">/academy/{slugParam}</p>
              <Link
                to="/academy"
                className="mt-4 inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800"
              >
                ← Terug
              </Link>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
