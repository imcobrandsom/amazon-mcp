import React, { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type { AgentMemory } from '../../types';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import clsx from 'clsx';

interface Props {
  clientId: string;
  memory: AgentMemory[];
  onClose: () => void;
  onRefresh: () => void;
}

const MEMORY_TYPES: AgentMemory['memory_type'][] = [
  'goal',
  'rule',
  'decision',
  'note',
];

const TYPE_COLORS: Record<AgentMemory['memory_type'], string> = {
  goal: 'bg-blue-100 text-blue-700',
  rule: 'bg-purple-100 text-purple-700',
  decision: 'bg-amber-100 text-amber-700',
  note: 'bg-slate-100 text-slate-600',
};

export default function MemoryPanel({
  clientId,
  memory,
  onClose,
  onRefresh,
}: Props) {
  const { user } = useAuth();
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState<AgentMemory['memory_type']>('goal');
  const [newContent, setNewContent] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim() || !user) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('agent_memory').insert({
        client_id: clientId,
        memory_type: newType,
        content: newContent.trim(),
        created_by: user.id,
        is_active: true,
      });
      if (error) throw error;
      setNewContent('');
      setAdding(false);
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add memory');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from('agent_memory')
      .update({ is_active: false })
      .eq('id', id);
    if (!error) onRefresh();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-end z-50">
      <div className="bg-white w-96 h-full flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Agent Memory
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {memory.length} active item{memory.length !== 1 ? 's' : ''}{' '}
              injected into every conversation
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {memory.length === 0 && !adding && (
            <p className="text-center text-xs text-slate-400 py-8">
              No memory items yet. Add goals, rules, or notes to guide the agent.
            </p>
          )}
          {memory.map((item) => (
            <div
              key={item.id}
              className="bg-slate-50 rounded-lg p-3 flex items-start gap-2 group"
            >
              <span
                className={clsx(
                  'text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase flex-shrink-0 mt-0.5',
                  TYPE_COLORS[item.memory_type]
                )}
              >
                {item.memory_type}
              </span>
              <p className="text-xs text-slate-700 flex-1 leading-relaxed">
                {item.content}
              </p>
              <button
                onClick={() => handleDelete(item.id)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all flex-shrink-0"
                title="Deactivate memory item"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        {/* Add form */}
        <div className="border-t border-slate-200 p-4">
          {adding ? (
            <form onSubmit={handleAdd} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Type
                </label>
                <div className="flex gap-1.5 flex-wrap">
                  {MEMORY_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setNewType(t)}
                      className={clsx(
                        'text-[10px] font-semibold px-2 py-1 rounded uppercase transition-colors',
                        newType === t
                          ? TYPE_COLORS[t]
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Content
                </label>
                <textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-400"
                  rows={3}
                  placeholder={
                    newType === 'goal'
                      ? 'e.g. Maintain ROAS above 4.0 across all campaigns'
                      : newType === 'rule'
                      ? 'e.g. Never pause the top 10 revenue-generating keywords'
                      : newType === 'decision'
                      ? 'e.g. Excluded brand terms from auto campaigns in June 2025'
                      : 'Free text note…'
                  }
                  autoFocus
                  required
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setNewContent('');
                  }}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !newContent.trim()}
                  className="px-3 py-1.5 text-xs bg-brand-500 hover:bg-brand-600 text-white rounded-md font-medium disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving…' : 'Add Memory'}
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 hover:text-slate-700 hover:border-slate-400 transition-colors"
            >
              <Plus size={13} />
              Add memory item
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
