/**
 * Prompt Editor - Admin interface for managing content generation prompts
 * Allows creating, editing, and testing prompt versions
 */
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Play,
  Trash2,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Copy,
  Sparkles,
} from 'lucide-react';
import {
  listPromptVersions,
  createPromptVersion,
  updatePromptVersion,
  deletePromptVersion,
  activatePromptVersion,
  generateBolContent,
  type BolPromptVersion,
} from '../lib/bol-api';
import clsx from 'clsx';

export default function PromptEditor() {
  const { customerId } = useParams<{ customerId: string }>();
  const [versions, setVersions] = useState<BolPromptVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<BolPromptVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEan, setTestEan] = useState('');
  const [testResult, setTestResult] = useState<any>(null);

  // Form state
  const [versionName, setVersionName] = useState('');
  const [systemInstructions, setSystemInstructions] = useState('');
  const [titleMinLength, setTitleMinLength] = useState(50);
  const [titleMaxLength, setTitleMaxLength] = useState(150);
  const [descMinLength, setDescMinLength] = useState(250);
  const [descMaxLength, setDescMaxLength] = useState(2000);
  const [minUsps, setMinUsps] = useState(3);
  const [maxUsps, setMaxUsps] = useState(5);

  useEffect(() => {
    if (customerId) {
      loadVersions();
    }
  }, [customerId]);

  async function loadVersions() {
    setLoading(true);
    try {
      const { versions: data } = await listPromptVersions(customerId!);
      setVersions(data);

      // Auto-select active version
      const active = data.find(v => v.is_active);
      if (active) {
        selectVersion(active);
      }
    } catch (err) {
      console.error('Failed to load versions:', err);
    } finally {
      setLoading(false);
    }
  }

  function selectVersion(version: BolPromptVersion) {
    setSelectedVersion(version);
    setVersionName(version.version_name || `v${version.version_number}`);
    setSystemInstructions(version.system_instructions);
    setTitleMinLength(version.title_rules.min_length || 50);
    setTitleMaxLength(version.title_rules.max_length || 150);
    setDescMinLength(version.description_rules.min_length || 250);
    setDescMaxLength(version.description_rules.max_length || 2000);
    setMinUsps(version.description_rules.usp_count?.min || 3);
    setMaxUsps(version.description_rules.usp_count?.max || 5);
  }

  function clearForm() {
    setSelectedVersion(null);
    setVersionName('');
    setSystemInstructions('Je bent een SEO expert gespecialiseerd in Bol.com productcontent. Genereer Nederlandse content die converteert en goed rankt.');
    setTitleMinLength(50);
    setTitleMaxLength(150);
    setDescMinLength(250);
    setDescMaxLength(2000);
    setMinUsps(3);
    setMaxUsps(5);
  }

  async function handleSave() {
    if (!customerId || !systemInstructions) return;

    setSaving(true);
    try {
      if (selectedVersion) {
        // Update existing version
        await updatePromptVersion(selectedVersion.id, {
          version_name: versionName,
          system_instructions: systemInstructions,
          title_rules: {
            min_length: titleMinLength,
            max_length: titleMaxLength,
            required_elements: ['brand', 'product_type'],
            keyword_count: { min: 2, max: 5 },
          },
          description_rules: {
            min_length: descMinLength,
            max_length: descMaxLength,
            required_sections: ['intro', 'usps', 'details'],
            usp_count: { min: minUsps, max: maxUsps },
          },
        } as any);
      } else {
        // Create new version
        await createPromptVersion(customerId, versionName || 'New Version', systemInstructions, {
          titleRules: {
            min_length: titleMinLength,
            max_length: titleMaxLength,
            required_elements: ['brand', 'product_type'],
            keyword_count: { min: 2, max: 5 },
          },
          descriptionRules: {
            min_length: descMinLength,
            max_length: descMaxLength,
            required_sections: ['intro', 'usps', 'details'],
            usp_count: { min: minUsps, max: maxUsps },
          },
        });
      }

      await loadVersions();
      alert(selectedVersion ? 'Versie bijgewerkt!' : 'Nieuwe versie aangemaakt!');
    } catch (err: any) {
      alert('Fout bij opslaan: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate(versionId: string) {
    if (!confirm('Deze versie activeren? Andere versies worden ge-deactiveerd.')) return;

    try {
      await activatePromptVersion(versionId);
      await loadVersions();
      alert('Versie geactiveerd!');
    } catch (err: any) {
      alert('Fout bij activeren: ' + err.message);
    }
  }

  async function handleDelete(versionId: string) {
    if (!confirm('Versie verwijderen? Dit kan niet ongedaan gemaakt worden.')) return;

    try {
      await deletePromptVersion(versionId);
      await loadVersions();
      if (selectedVersion?.id === versionId) {
        clearForm();
      }
      alert('Versie verwijderd!');
    } catch (err: any) {
      alert('Fout bij verwijderen: ' + err.message);
    }
  }

  async function handleTest() {
    if (!customerId || !testEan) return;

    setTesting(true);
    setTestResult(null);

    try {
      // First save current form as temp version if editing
      if (selectedVersion) {
        await handleSave();
      }

      // Generate content using current active version
      const result = await generateBolContent(customerId, testEan, 'manual');
      setTestResult(result);
    } catch (err: any) {
      alert('Test fout: ' + err.message);
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16">Laden...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link
                to={`/bol/${customerId}`}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <ArrowLeft size={20} />
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Prompt Editor</h1>
                <p className="text-sm text-slate-600">
                  Beheer en test content generatie prompts
                </p>
              </div>
            </div>
            <button
              onClick={clearForm}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Sparkles size={16} />
              Nieuwe Versie
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Version List */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h2 className="font-semibold text-slate-900 mb-3">Versies</h2>

              <div className="space-y-2">
                {versions.map((version) => (
                  <div
                    key={version.id}
                    className={clsx(
                      'p-3 rounded-lg border cursor-pointer transition-all',
                      selectedVersion?.id === version.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-slate-200 hover:border-slate-300'
                    )}
                    onClick={() => selectVersion(version)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900">
                          {version.version_name || `v${version.version_number}`}
                        </span>
                        {version.is_active && (
                          <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                            Actief
                          </span>
                        )}
                      </div>
                      {!version.is_active && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(version.id);
                          }}
                          className="p-1 hover:bg-red-50 rounded"
                        >
                          <Trash2 size={14} className="text-red-600" />
                        </button>
                      )}
                    </div>

                    <div className="text-xs text-slate-600 space-y-1">
                      <div className="flex items-center justify-between">
                        <span>Generaties:</span>
                        <span className="font-medium">
                          {version.performance_metrics.total_generations}
                        </span>
                      </div>
                      {version.performance_metrics.avg_title_length && (
                        <div className="flex items-center justify-between">
                          <span>Gem. titel:</span>
                          <span className="font-medium">
                            {Math.round(version.performance_metrics.avg_title_length)} chars
                          </span>
                        </div>
                      )}
                    </div>

                    {!version.is_active && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleActivate(version.id);
                        }}
                        className="mt-2 w-full px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition-colors"
                      >
                        Activeer
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Editor */}
          <div className="lg:col-span-2 space-y-6">
            {/* Form */}
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <h2 className="font-semibold text-slate-900 mb-4">
                {selectedVersion ? 'Versie Bewerken' : 'Nieuwe Versie'}
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Versie Naam
                  </label>
                  <input
                    type="text"
                    value={versionName}
                    onChange={(e) => setVersionName(e.target.value)}
                    placeholder="bijv. v2-kortere-titels"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    System Instructions
                  </label>
                  <textarea
                    value={systemInstructions}
                    onChange={(e) => setSystemInstructions(e.target.value)}
                    rows={6}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                    placeholder="Je bent een SEO expert..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Titel Min/Max Length
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={titleMinLength}
                        onChange={(e) => setTitleMinLength(parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                      />
                      <input
                        type="number"
                        value={titleMaxLength}
                        onChange={(e) => setTitleMaxLength(parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Beschrijving Min/Max Length
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={descMinLength}
                        onChange={(e) => setDescMinLength(parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                      />
                      <input
                        type="number"
                        value={descMaxLength}
                        onChange={(e) => setDescMaxLength(parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Aantal USPs (Min/Max)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={minUsps}
                        onChange={(e) => setMinUsps(parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                      />
                      <input
                        type="number"
                        value={maxUsps}
                        onChange={(e) => setMaxUsps(parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 pt-4">
                  <button
                    onClick={handleSave}
                    disabled={saving || !systemInstructions}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Save size={16} />
                    {saving ? 'Opslaan...' : 'Opslaan'}
                  </button>

                  {selectedVersion && !selectedVersion.is_active && (
                    <button
                      onClick={() => handleActivate(selectedVersion.id)}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                      <CheckCircle2 size={16} />
                      Activeer Deze Versie
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Test Panel */}
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <h2 className="font-semibold text-slate-900 mb-4">Test Prompt</h2>

              <div className="space-y-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={testEan}
                    onChange={(e) => setTestEan(e.target.value)}
                    placeholder="EAN code (bijv. 8720246504583)"
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg"
                  />
                  <button
                    onClick={handleTest}
                    disabled={testing || !testEan}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                  >
                    <Play size={16} />
                    {testing ? 'Testen...' : 'Test'}
                  </button>
                </div>

                {testResult && (
                  <div className="border border-slate-200 rounded-lg p-4 space-y-3">
                    <div>
                      <div className="text-xs font-medium text-slate-600 mb-1">Gegenereerde Titel:</div>
                      <div className="text-sm text-slate-900">{testResult.proposal.proposed_title}</div>
                      <div className="text-xs text-slate-500 mt-1">
                        {testResult.proposal.proposed_title.length} karakters
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-medium text-slate-600 mb-1">Beschrijving Preview:</div>
                      <div className="text-sm text-slate-900 line-clamp-3">
                        {testResult.proposal.proposed_description.replace(/<[^>]*>/g, '')}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {testResult.proposal.proposed_description.length} karakters
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-medium text-slate-600 mb-1">Keywords Toegevoegd:</div>
                      <div className="text-sm text-slate-900">
                        {testResult.proposal.changes_summary.keywords_added.join(', ') || 'Geen'}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-green-600">
                      <CheckCircle2 size={14} />
                      Geschatte score verbetering: +{testResult.estimated_improvement_pct}%
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
