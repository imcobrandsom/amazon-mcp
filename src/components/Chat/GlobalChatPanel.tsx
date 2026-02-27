import React, { useState, useRef, useEffect } from 'react';
import { Send, X, RefreshCcw, Bot, Plus, Check, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { LocalMessage } from '../../types';
import MessageBubble from './MessageBubble';
import { sendGlobalChatMessage } from '../../lib/api';
import { supabase } from '../../lib/supabase';

const SUGGESTED = [
  'Which client has the highest ROAS this week?',
  'Compare NL campaigns across all clients',
  'Show underperforming campaigns portfolio-wide',
];

interface SuggestedMarket {
  country_code: string;
  profile_id: string;
  currency: string;
  selected: boolean;
}

interface SuggestClientData {
  clientName: string;
  accountId?: string;
  markets: SuggestedMarket[];
}

interface Props {
  onClose: () => void;
  // Bol.com-specific props
  bolCustomerId?: string;
  bolFilters?: {
    dateRange?: { from: string; to: string };
    campaignState?: string;
  };
}

// ── Quick Add Client Card ──────────────────────────────────────────────────────

function QuickAddClientCard({
  data,
  onCreated,
}: {
  data: SuggestClientData;
  onCreated: (clientId: string, clientName: string) => void;
}) {
  const [name, setName] = useState(data.clientName);
  const [markets, setMarkets] = useState<SuggestedMarket[]>(data.markets);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null); // client id after creation

  const toggleMarket = (idx: number) => {
    setMarkets((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, selected: !m.selected } : m))
    );
  };

  const handleCreate = async () => {
    const selected = markets.filter((m) => m.selected);
    if (!name.trim() || selected.length === 0) return;
    setSaving(true);
    try {
      // 1. Insert client
      const { data: clientRow, error: clientErr } = await supabase
        .from('clients')
        .insert({ name: name.trim() })
        .select()
        .single();
      if (clientErr) throw clientErr;

      // 2. Insert markets
      const marketRows = selected.map((m) => ({
        client_id: clientRow.id,
        country_code: m.country_code.toUpperCase(),
        amazon_advertiser_profile_id: m.profile_id,
        amazon_advertiser_account_id: data.accountId ?? '',
        currency: m.currency,
        state: 'active',
        roas_target: null,
        daily_budget_cap: null,
      }));

      const { error: mktErr } = await supabase
        .from('client_markets')
        .insert(marketRows);
      if (mktErr) throw mktErr;

      setDone(clientRow.id);
      onCreated(clientRow.id, clientRow.name);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create client');
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <div className="border border-green-200 bg-green-50 rounded-xl p-4 mt-2">
        <div className="flex items-center gap-2 text-green-700">
          <Check size={15} />
          <span className="text-sm font-medium">Client created!</span>
        </div>
        <button
          onClick={() => onCreated(done, name)}
          className="mt-2 flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium"
        >
          Open {name} <ChevronRight size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="border border-brand-200 bg-brand-50 rounded-xl p-4 mt-2">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center">
          <Plus size={12} className="text-brand-600" />
        </div>
        <span className="text-sm font-semibold text-slate-800">Quick Add Client</span>
      </div>

      {/* Client name */}
      <div className="mb-3">
        <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1">
          Client name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
      </div>

      {/* Market checkboxes */}
      <div className="mb-3">
        <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">
          Markets ({markets.filter((m) => m.selected).length}/{markets.length} selected)
        </label>
        <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
          {markets.map((m, idx) => (
            <label
              key={idx}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white cursor-pointer group"
            >
              <input
                type="checkbox"
                checked={m.selected}
                onChange={() => toggleMarket(idx)}
                className="rounded border-slate-300 text-brand-500 focus:ring-brand-400"
              />
              <span className="text-xs font-medium text-slate-700 w-7">{flagEmoji(m.country_code)} {m.country_code}</span>
              <span className="text-[10px] text-slate-400 font-mono truncate flex-1">{m.profile_id}</span>
              <span className="text-[10px] text-slate-400">{m.currency}</span>
            </label>
          ))}
        </div>
      </div>

      <button
        onClick={handleCreate}
        disabled={saving || !name.trim() || markets.filter((m) => m.selected).length === 0}
        className="w-full py-2 text-sm font-medium bg-brand-500 hover:bg-brand-600 text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
      >
        {saving ? (
          <><RefreshCcw size={13} className="animate-spin" /> Creating…</>
        ) : (
          <><Plus size={13} /> Create Client</>
        )}
      </button>
    </div>
  );
}

function flagEmoji(code: string) {
  const offset = 0x1f1e6 - 65;
  return String.fromCodePoint(
    code.toUpperCase().charCodeAt(0) + offset,
    code.toUpperCase().charCodeAt(1) + offset
  );
}

// ── Main GlobalChatPanel ───────────────────────────────────────────────────────

export default function GlobalChatPanel({ onClose, bolCustomerId, bolFilters }: Props) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [suggestData, setSuggestData] = useState<SuggestClientData | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, suggestData]);

  const handleSend = async (text?: string) => {
    const trimmed = (text ?? input).trim();
    if (!trimmed || sending) return;

    const userMsg: LocalMessage = { role: 'user', content: trimmed };
    const allPrev = [...messages, userMsg];
    setMessages([...allPrev, { role: 'assistant', content: '', isStreaming: true }]);
    setSuggestData(null);
    setInput('');
    setSending(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      const response = await sendGlobalChatMessage({
        messages: allPrev,
        bolCustomerId,
        bolFilters,
      });

      setMessages([
        ...allPrev,
        { role: 'assistant', content: response.content || '*(No response)*' },
      ]);

      // Check for suggest_client_setup tool call
      const suggestCall = response.toolCalls?.find(
        (tc) => tc.name === 'suggest_client_setup'
      );
      if (suggestCall) {
        const input = suggestCall.input as {
          clientName: string;
          accountId?: string;
          markets: Array<{ country_code: string; profile_id: string; currency: string }>;
        };
        setSuggestData({
          clientName: input.clientName,
          accountId: input.accountId,
          markets: input.markets.map((m) => ({ ...m, selected: true })),
        });
      }
    } catch (err) {
      setMessages([
        ...allPrev,
        {
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClientCreated = (clientId: string) => {
    onClose();
    navigate(`/clients/${clientId}`);
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-white border-l border-slate-200 shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-brand-50 flex items-center justify-center">
            <Bot size={14} className="text-brand-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">General Chat</p>
            <p className="text-[10px] text-slate-400">All clients · Amazon Ads</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-8">
            <div className="w-12 h-12 rounded-full bg-brand-50 flex items-center justify-center mb-3">
              <Bot size={22} className="text-brand-400" />
            </div>
            <p className="text-sm font-medium text-slate-700">Ask about any client</p>
            <p className="text-xs text-slate-400 mt-1 max-w-[280px] leading-relaxed">
              Query campaigns, compare performance, or spot opportunities across the full portfolio.
            </p>
            <div className="mt-5 flex flex-col gap-2 w-full max-w-xs">
              {SUGGESTED.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSend(q)}
                  className="text-left text-xs text-brand-600 bg-brand-50 hover:bg-brand-100 px-3 py-2 rounded-lg transition-colors leading-snug"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <MessageBubble key={i} message={msg} />
            ))}
            {suggestData && (
              <QuickAddClientCard
                data={suggestData}
                onCreated={handleClientCreated}
              />
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-100 px-4 py-3 flex-shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask about any client or campaign…"
            className="flex-1 resize-none px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent min-h-[40px] max-h-[120px] leading-relaxed"
            rows={1}
            disabled={sending}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || sending}
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center bg-brand-500 hover:bg-brand-600 text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? <RefreshCcw size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
        <p className="text-[10px] text-slate-400 mt-1.5">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
