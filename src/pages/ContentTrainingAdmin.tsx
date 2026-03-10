/**
 * Admin UI for Content Training Management
 * - Tab 1: Content Examples (good/bad titles/descriptions)
 * - Tab 2: Category Guidelines (focus areas, tone, USPs, templates)
 * - Tab 3: Test Prompt (preview what examples/guidelines would be injected)
 */
import { useState, useEffect } from 'react';
import {
  listContentExamples,
  createContentExample,
  updateContentExample,
  deleteContentExample,
  listCategoryGuidelines,
  updateCategoryGuidelines,
} from '../lib/admin-api';
import type { ContentExample, CategoryGuidelines } from '../types/admin';

type Tab = 'examples' | 'guidelines' | 'test';

export default function ContentTrainingAdmin() {
  const [activeTab, setActiveTab] = useState<Tab>('examples');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Content Training Management</h1>
          <p className="text-slate-300">
            Beheer content voorbeelden en categorie-specifieke richtlijnen voor AI content generatie
          </p>
        </header>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6 border-b border-slate-700">
          <button
            onClick={() => setActiveTab('examples')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'examples'
                ? 'text-purple-400 border-b-2 border-purple-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Content Examples
          </button>
          <button
            onClick={() => setActiveTab('guidelines')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'guidelines'
                ? 'text-purple-400 border-b-2 border-purple-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Category Guidelines
          </button>
          <button
            onClick={() => setActiveTab('test')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'test'
                ? 'text-purple-400 border-b-2 border-purple-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Test Prompt
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'examples' && <ExamplesTab />}
        {activeTab === 'guidelines' && <GuidelinesTab />}
        {activeTab === 'test' && <TestPromptTab />}
      </div>
    </div>
  );
}

// ── TAB 1: Content Examples ──────────────────────────────────────────────────

function ExamplesTab() {
  const [examples, setExamples] = useState<ContentExample[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    marketplace: 'bol' as 'bol' | 'amazon' | 'generic',
    category_slug: '',
    example_type: '' as '' | 'good_title' | 'bad_title' | 'good_description' | 'bad_description',
  });
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingExample, setEditingExample] = useState<ContentExample | null>(null);

  useEffect(() => {
    loadExamples();
  }, [filters]);

  async function loadExamples() {
    setLoading(true);
    try {
      const data = await listContentExamples({
        marketplace: filters.marketplace,
        category_slug: filters.category_slug || undefined,
        example_type: filters.example_type || undefined,
      });
      setExamples(data);
    } catch (err) {
      console.error('Failed to load examples:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Weet je zeker dat je dit voorbeeld wilt verwijderen?')) return;
    try {
      await deleteContentExample(id);
      await loadExamples();
    } catch (err) {
      console.error('Failed to delete:', err);
      alert('Verwijderen mislukt');
    }
  }

  function handleEdit(example: ContentExample) {
    setEditingExample(example);
  }

  async function handleSave(example: Partial<ContentExample>) {
    try {
      if (editingExample) {
        await updateContentExample(editingExample.id, {
          content: example.content,
          reason: example.reason,
          rating: example.rating,
        });
      } else {
        await createContentExample({
          marketplace: example.marketplace!,
          category_slug: example.category_slug || null,
          example_type: example.example_type!,
          language: example.language!,
          content: example.content!,
          reason: example.reason!,
          rating: example.rating!,
        });
      }
      setEditingExample(null);
      setShowAddModal(false);
      await loadExamples();
    } catch (err) {
      console.error('Failed to save:', err);
      alert('Opslaan mislukt');
    }
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-slate-800/50 rounded-lg p-4 flex gap-4 items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium mb-2">Marketplace</label>
          <select
            value={filters.marketplace}
            onChange={(e) => setFilters({ ...filters, marketplace: e.target.value as any })}
            className="w-full bg-slate-700 rounded px-3 py-2 text-white"
          >
            <option value="bol">Bol.com</option>
            <option value="amazon">Amazon</option>
            <option value="generic">Generic</option>
          </select>
        </div>

        <div className="flex-1">
          <label className="block text-sm font-medium mb-2">Category</label>
          <input
            type="text"
            value={filters.category_slug}
            onChange={(e) => setFilters({ ...filters, category_slug: e.target.value })}
            placeholder="bijv. sportlegging"
            className="w-full bg-slate-700 rounded px-3 py-2 text-white placeholder-slate-400"
          />
        </div>

        <div className="flex-1">
          <label className="block text-sm font-medium mb-2">Type</label>
          <select
            value={filters.example_type}
            onChange={(e) => setFilters({ ...filters, example_type: e.target.value as any })}
            className="w-full bg-slate-700 rounded px-3 py-2 text-white"
          >
            <option value="">Alles</option>
            <option value="good_title">Good Title</option>
            <option value="bad_title">Bad Title</option>
            <option value="good_description">Good Description</option>
            <option value="bad_description">Bad Description</option>
          </select>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded font-medium"
        >
          + Nieuw Voorbeeld
        </button>
      </div>

      {/* Examples Table */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">Laden...</div>
      ) : examples.length === 0 ? (
        <div className="text-center py-12 text-slate-400">Geen voorbeelden gevonden</div>
      ) : (
        <div className="bg-slate-800/50 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-700/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">Type</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Category</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Content</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Reason</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Rating</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Usage</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {examples.map((ex) => (
                <tr key={ex.id} className="hover:bg-slate-700/30">
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                        ex.example_type.startsWith('good')
                          ? 'bg-green-900/50 text-green-300'
                          : 'bg-red-900/50 text-red-300'
                      }`}
                    >
                      {ex.example_type.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">{ex.category_slug || '—'}</td>
                  <td className="px-4 py-3 text-sm max-w-xs truncate" title={ex.content}>
                    {ex.content}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-400 max-w-xs truncate" title={ex.reason}>
                    {ex.reason}
                  </td>
                  <td className="px-4 py-3">
                    <RatingStars rating={ex.rating} />
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-400">{ex.usage_count}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(ex)}
                        className="text-purple-400 hover:text-purple-300 text-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(ex.id)}
                        className="text-red-400 hover:text-red-300 text-sm"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Modal */}
      {(showAddModal || editingExample) && (
        <ExampleModal
          example={editingExample}
          onSave={handleSave}
          onClose={() => {
            setShowAddModal(false);
            setEditingExample(null);
          }}
        />
      )}
    </div>
  );
}

function RatingStars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <span key={star} className={star <= rating ? 'text-yellow-400' : 'text-slate-600'}>
          ★
        </span>
      ))}
    </div>
  );
}

function ExampleModal({
  example,
  onSave,
  onClose,
}: {
  example: ContentExample | null;
  onSave: (ex: Partial<ContentExample>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<ContentExample>>(
    example || {
      marketplace: 'bol',
      category_slug: '',
      example_type: 'good_title',
      language: 'nl',
      content: '',
      reason: '',
      rating: 5,
    }
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold mb-4">{example ? 'Edit Example' : 'Nieuw Voorbeeld'}</h2>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Marketplace</label>
              <select
                value={form.marketplace}
                onChange={(e) => setForm({ ...form, marketplace: e.target.value as any })}
                disabled={!!example}
                className="w-full bg-slate-700 rounded px-3 py-2 disabled:opacity-50"
              >
                <option value="bol">Bol.com</option>
                <option value="amazon">Amazon</option>
                <option value="generic">Generic</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Language</label>
              <select
                value={form.language}
                onChange={(e) => setForm({ ...form, language: e.target.value as any })}
                disabled={!!example}
                className="w-full bg-slate-700 rounded px-3 py-2 disabled:opacity-50"
              >
                <option value="nl">Nederlands</option>
                <option value="en">English</option>
                <option value="de">Deutsch</option>
                <option value="fr">Français</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Type</label>
              <select
                value={form.example_type}
                onChange={(e) => setForm({ ...form, example_type: e.target.value as any })}
                disabled={!!example}
                className="w-full bg-slate-700 rounded px-3 py-2 disabled:opacity-50"
              >
                <option value="good_title">Good Title</option>
                <option value="bad_title">Bad Title</option>
                <option value="good_description">Good Description</option>
                <option value="bad_description">Bad Description</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Category (optioneel)</label>
              <input
                type="text"
                value={form.category_slug || ''}
                onChange={(e) => setForm({ ...form, category_slug: e.target.value })}
                placeholder="bijv. sportlegging"
                disabled={!!example}
                className="w-full bg-slate-700 rounded px-3 py-2 disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Content</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={4}
              className="w-full bg-slate-700 rounded px-3 py-2"
              placeholder="De volledige titel of beschrijving..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Reason (waarom goed/slecht?)</label>
            <textarea
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              rows={3}
              className="w-full bg-slate-700 rounded px-3 py-2"
              placeholder="Uitleg waarom dit voorbeeld goed/slecht is..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Rating (1-5)</label>
            <input
              type="number"
              min={1}
              max={5}
              value={form.rating}
              onChange={(e) => setForm({ ...form, rating: parseInt(e.target.value) })}
              className="w-full bg-slate-700 rounded px-3 py-2"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={() => onSave(form)}
            disabled={!form.content || !form.reason}
            className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:cursor-not-allowed px-4 py-2 rounded font-medium"
          >
            Opslaan
          </button>
          <button
            onClick={onClose}
            className="flex-1 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded font-medium"
          >
            Annuleren
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TAB 2: Category Guidelines ───────────────────────────────────────────────

function GuidelinesTab() {
  const [guidelines, setGuidelines] = useState<CategoryGuidelines[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [editingGuideline, setEditingGuideline] = useState<CategoryGuidelines | null>(null);

  useEffect(() => {
    loadGuidelines();
  }, [selectedCustomer]);

  async function loadGuidelines() {
    setLoading(true);
    try {
      const data = await listCategoryGuidelines(selectedCustomer || undefined);
      setGuidelines(data);
    } catch (err) {
      console.error('Failed to load guidelines:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(guideline: CategoryGuidelines) {
    try {
      await updateCategoryGuidelines(guideline.id, {
        content_focus_areas: guideline.content_focus_areas,
        tone_guidelines: guideline.tone_guidelines,
        priority_usps: guideline.priority_usps,
        attribute_templates: guideline.attribute_templates,
      });
      setEditingGuideline(null);
      await loadGuidelines();
    } catch (err) {
      console.error('Failed to save:', err);
      alert('Opslaan mislukt');
    }
  }

  return (
    <div className="space-y-6">
      {/* Filter */}
      <div className="bg-slate-800/50 rounded-lg p-4">
        <label className="block text-sm font-medium mb-2">Filter by Customer (optioneel)</label>
        <input
          type="text"
          value={selectedCustomer}
          onChange={(e) => setSelectedCustomer(e.target.value)}
          placeholder="bol_customer_id"
          className="w-full max-w-md bg-slate-700 rounded px-3 py-2 text-white placeholder-slate-400"
        />
      </div>

      {/* Guidelines List */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">Laden...</div>
      ) : guidelines.length === 0 ? (
        <div className="text-center py-12 text-slate-400">Geen category guidelines gevonden</div>
      ) : (
        <div className="grid gap-4">
          {guidelines.map((g) => (
            <div key={g.id} className="bg-slate-800/50 rounded-lg p-4">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-xl font-bold">{g.category_slug}</h3>
                  {g.category_name && <p className="text-sm text-slate-400">{g.category_name}</p>}
                </div>
                <button
                  onClick={() => setEditingGuideline(g)}
                  className="bg-purple-600 hover:bg-purple-700 px-3 py-1 rounded text-sm"
                >
                  Edit
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-medium mb-1">Focus Areas:</p>
                  <p className="text-slate-300">
                    {g.content_focus_areas?.length > 0
                      ? g.content_focus_areas.join(', ')
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="font-medium mb-1">Priority USPs:</p>
                  <p className="text-slate-300">
                    {g.priority_usps?.length > 0 ? g.priority_usps.join(', ') : '—'}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="font-medium mb-1">Tone Guidelines:</p>
                  <p className="text-slate-300">{g.tone_guidelines || '—'}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editingGuideline && (
        <GuidelineModal
          guideline={editingGuideline}
          onSave={handleSave}
          onClose={() => setEditingGuideline(null)}
        />
      )}
    </div>
  );
}

function GuidelineModal({
  guideline,
  onSave,
  onClose,
}: {
  guideline: CategoryGuidelines;
  onSave: (g: CategoryGuidelines) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<CategoryGuidelines>({ ...guideline });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold mb-4">
          Edit Guidelines: {guideline.category_slug}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Content Focus Areas (komma-gescheiden)
            </label>
            <input
              type="text"
              value={form.content_focus_areas?.join(', ') || ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  content_focus_areas: e.target.value.split(',').map((s) => s.trim()),
                })
              }
              placeholder="bijv. kleur, maat, pasvorm, materiaal"
              className="w-full bg-slate-700 rounded px-3 py-2"
            />
            <p className="text-xs text-slate-400 mt-1">
              Fashion: kleur, maat, pasvorm | Electronics: processor, RAM, schermgrootte
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Tone Guidelines</label>
            <textarea
              value={form.tone_guidelines || ''}
              onChange={(e) => setForm({ ...form, tone_guidelines: e.target.value })}
              rows={3}
              placeholder="bijv. Benadruk comfort en prestaties. Gebruik actieve taal."
              className="w-full bg-slate-700 rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Priority USPs (komma-gescheiden)
            </label>
            <input
              type="text"
              value={form.priority_usps?.join(', ') || ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  priority_usps: e.target.value.split(',').map((s) => s.trim()),
                })
              }
              placeholder="bijv. ademend materiaal, perfecte pasvorm, duurzaam"
              className="w-full bg-slate-700 rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Attribute Templates (JSON)
            </label>
            <textarea
              value={JSON.stringify(form.attribute_templates || {}, null, 2)}
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  setForm({ ...form, attribute_templates: parsed });
                } catch (err) {
                  // Invalid JSON, ignore
                }
              }}
              rows={6}
              placeholder={`{\n  "Colour": "Verkrijgbaar in {value}",\n  "Size": "Maat {value}"\n}`}
              className="w-full bg-slate-700 rounded px-3 py-2 font-mono text-sm"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={() => onSave(form)}
            className="flex-1 bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded font-medium"
          >
            Opslaan
          </button>
          <button
            onClick={onClose}
            className="flex-1 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded font-medium"
          >
            Annuleren
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TAB 3: Test Prompt ───────────────────────────────────────────────────────

function TestPromptTab() {
  const [category, setCategory] = useState('sportlegging');
  const [examples, setExamples] = useState<ContentExample[]>([]);
  const [guidelines, setGuidelines] = useState<CategoryGuidelines | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleTest() {
    setLoading(true);
    try {
      // Fetch examples for category
      const examplesData = await listContentExamples({
        marketplace: 'bol',
        category_slug: category,
      });
      setExamples(examplesData);

      // Fetch guidelines for category
      const guidelinesData = await listCategoryGuidelines();
      const match = guidelinesData.find((g) => g.category_slug === category);
      setGuidelines(match || null);
    } catch (err) {
      console.error('Failed to test:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-slate-800/50 rounded-lg p-4">
        <label className="block text-sm font-medium mb-2">Test Category</label>
        <div className="flex gap-3">
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="bijv. sportlegging, laptops"
            className="flex-1 bg-slate-700 rounded px-3 py-2"
          />
          <button
            onClick={handleTest}
            disabled={loading}
            className="bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 px-6 py-2 rounded font-medium"
          >
            {loading ? 'Laden...' : 'Test'}
          </button>
        </div>
      </div>

      {examples.length > 0 && (
        <div className="bg-slate-800/50 rounded-lg p-6">
          <h3 className="text-xl font-bold mb-4">Examples die gebruikt zouden worden:</h3>
          <div className="space-y-4">
            {examples.map((ex) => (
              <div key={ex.id} className="border-l-4 border-purple-500 pl-4">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                      ex.example_type.startsWith('good')
                        ? 'bg-green-900/50 text-green-300'
                        : 'bg-red-900/50 text-red-300'
                    }`}
                  >
                    {ex.example_type.replace('_', ' ')}
                  </span>
                  <RatingStars rating={ex.rating} />
                </div>
                <p className="text-sm mb-1">&quot;{ex.content}&quot;</p>
                <p className="text-xs text-slate-400 italic">{ex.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {guidelines && (
        <div className="bg-slate-800/50 rounded-lg p-6">
          <h3 className="text-xl font-bold mb-4">Category Guidelines die gebruikt zouden worden:</h3>
          <div className="space-y-3">
            <div>
              <p className="font-medium text-sm text-slate-400">Focus Areas:</p>
              <p>{guidelines.content_focus_areas?.join(', ') || '—'}</p>
            </div>
            <div>
              <p className="font-medium text-sm text-slate-400">Tone Guidelines:</p>
              <p>{guidelines.tone_guidelines || '—'}</p>
            </div>
            <div>
              <p className="font-medium text-sm text-slate-400">Priority USPs:</p>
              <p>{guidelines.priority_usps?.join(', ') || '—'}</p>
            </div>
            {guidelines.attribute_templates &&
              Object.keys(guidelines.attribute_templates).length > 0 && (
                <div>
                  <p className="font-medium text-sm text-slate-400">Attribute Templates:</p>
                  <pre className="text-sm bg-slate-900/50 rounded p-2 mt-1 overflow-x-auto">
                    {JSON.stringify(guidelines.attribute_templates, null, 2)}
                  </pre>
                </div>
              )}
          </div>
        </div>
      )}

      {!loading && examples.length === 0 && !guidelines && (
        <div className="text-center py-12 text-slate-400">
          Klik op &quot;Test&quot; om te zien welke examples en guidelines gebruikt zouden worden voor deze categorie
        </div>
      )}
    </div>
  );
}
