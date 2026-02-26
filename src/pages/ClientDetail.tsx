import React, { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Settings,
  Target,
  DollarSign,
  Layers,
  History,
  ShoppingCart,
  Lightbulb,
} from 'lucide-react';
import { useClientDetail } from '../hooks/useClientDetail';
import ChatInterface from '../components/Chat/ChatInterface';
import ProposalsPanel from '../components/Proposals/ProposalsPanel';
import BolSection from '../components/Bol/BolSection';
import type { ClientMarket, OptimizationProposal } from '../types';
import clsx from 'clsx';
import { supabase } from '../lib/supabase';

type RightTab = 'proposals' | 'bol';

export default function ClientDetail() {
  const { clientId } = useParams<{ clientId: string }>();
  const {
    client,
    markets,
    memory,
    conversations,
    proposals,
    loading,
    error,
    refetch,
    refetchProposals,
    refetchMemory,
    setProposals,
  } = useClientDetail(clientId!);

  const [activeMarketIndex, setActiveMarketIndex] = useState(0);
  const [rightTab, setRightTab] = useState<RightTab>('proposals');

  const activeMarket: ClientMarket | null = markets[activeMarketIndex] ?? null;

  const handleProposalsCreated = useCallback(
    (newProposals: OptimizationProposal[]) => {
      setProposals((prev) => [...newProposals, ...prev]);
    },
    [setProposals]
  );

  const handleProposalUpdated = useCallback(
    (updated: OptimizationProposal) => {
      setProposals((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
    },
    [setProposals]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <svg className="animate-spin h-5 w-5 text-brand-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-slate-500 text-sm">{error ?? 'Client not found'}</p>
        <Link to="/" className="text-sm text-brand-500 hover:underline">
          ← Back to clients
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Client header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
            >
              <ArrowLeft size={16} />
            </Link>
            {client.logo_url ? (
              <img
                src={client.logo_url}
                alt={client.name}
                className="w-9 h-9 rounded-lg object-contain border border-slate-100"
              />
            ) : (
              <div className="w-9 h-9 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center">
                <span className="text-sm font-bold text-brand-600">
                  {client.name[0]}
                </span>
              </div>
            )}
            <div>
              <h1 className="text-base font-semibold text-slate-900">
                {client.name}
              </h1>
              <p className="text-xs text-slate-500">
                {markets.length} market{markets.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <Link
            to={`/clients/${clientId}/history`}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
          >
            <History size={13} />
            Conversation history
          </Link>
        </div>

        {/* Market tabs */}
        {markets.length > 0 && (
          <div className="flex items-center gap-0.5 mt-4">
            {markets.map((m, idx) => (
              <button
                key={m.id}
                onClick={() => setActiveMarketIndex(idx)}
                className={clsx(
                  'px-3.5 py-1.5 text-xs font-medium rounded-t-md border-b-2 transition-colors',
                  idx === activeMarketIndex
                    ? 'text-brand-600 border-brand-500 bg-brand-50'
                    : 'text-slate-500 border-transparent hover:text-slate-700 hover:bg-slate-50'
                )}
              >
                <span className="mr-1">{flagEmoji(m.country_code)}</span>
                {m.country_code}
                {m.state === 'paused' && (
                  <span className="ml-1.5 text-[9px] font-bold text-slate-400 uppercase">
                    paused
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Always-visible two-column layout — left changes based on markets */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Market info bar — only when a market is active */}
        {activeMarket && <MarketInfoBar market={activeMarket} />}

        <div className="flex-1 overflow-hidden grid grid-cols-[1fr_380px] gap-4 p-4">
          {/* Left column: chat or no-markets placeholder */}
          {markets.length === 0 ? (
            <NoMarkets clientId={clientId!} onCreated={refetch} />
          ) : activeMarket ? (
            <ChatInterface
              key={activeMarket.id}
              clientId={clientId!}
              clientName={client.name}
              market={activeMarket}
              memory={memory}
              recentConversation={conversations[0] ?? null}
              onProposalsCreated={handleProposalsCreated}
              onRefreshMemory={refetchMemory}
            />
          ) : null}

          {/* Right panel — always visible (Proposals / Bol.com) */}
          <div className="flex flex-col overflow-hidden gap-2">
            {/* Tab bar */}
            <div className="flex items-center bg-white border border-slate-200 rounded-lg p-0.5 flex-shrink-0">
              <button
                onClick={() => setRightTab('proposals')}
                disabled={!activeMarket}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors',
                  rightTab === 'proposals' && activeMarket
                    ? 'bg-brand-500 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-700',
                  !activeMarket && 'opacity-40 cursor-not-allowed'
                )}
              >
                <Lightbulb size={11} />
                Proposals
              </button>
              <button
                onClick={() => setRightTab('bol')}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors',
                  rightTab === 'bol'
                    ? 'bg-orange-500 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                )}
              >
                <ShoppingCart size={11} />
                Bol.com
              </button>
            </div>

            {/* Panel content */}
            <div className="flex-1 overflow-hidden">
              {rightTab === 'proposals' && activeMarket ? (
                <ProposalsPanel
                  proposals={proposals}
                  marketId={activeMarket.id}
                  onUpdated={handleProposalUpdated}
                />
              ) : rightTab === 'proposals' ? (
                <div className="flex h-full items-center justify-center text-xs text-slate-400 px-4 text-center">
                  Add a market to see proposals
                </div>
              ) : (
                <BolSection clientId={clientId!} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MarketInfoBar({ market }: { market: ClientMarket }) {
  return (
    <div className="flex items-center gap-6 px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex-shrink-0">
      <Pill
        icon={<Target size={11} />}
        label="ROAS Target"
        value={market.roas_target ? `${market.roas_target}x` : '—'}
      />
      <Pill
        icon={<DollarSign size={11} />}
        label="Daily Budget"
        value={
          market.daily_budget_cap
            ? `${market.currency} ${market.daily_budget_cap.toLocaleString()}`
            : '—'
        }
      />
      <Pill
        icon={<Layers size={11} />}
        label="Profile ID"
        value={market.amazon_advertiser_profile_id}
        mono
      />
      <span
        className={clsx(
          'text-[10px] font-semibold uppercase px-2 py-0.5 rounded',
          market.state === 'active'
            ? 'bg-green-100 text-green-700'
            : 'bg-slate-100 text-slate-500'
        )}
      >
        {market.state}
      </span>
    </div>
  );
}

function Pill({
  icon,
  label,
  value,
  mono = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-slate-400">{icon}</span>
      <span className="text-[10px] text-slate-500">{label}:</span>
      <span
        className={clsx(
          'text-xs text-slate-800 font-medium',
          mono && 'font-mono text-[11px]'
        )}
      >
        {value}
      </span>
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

function NoMarkets({
  clientId,
  onCreated,
}: {
  clientId: string;
  onCreated: () => void;
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <p className="text-slate-500 text-sm">No markets configured yet.</p>
      <button
        onClick={() => setShow(true)}
        className="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-lg transition-colors"
      >
        Add Market
      </button>
      {show && (
        <AddMarketModal
          clientId={clientId}
          onClose={() => setShow(false)}
          onCreated={() => {
            setShow(false);
            onCreated();
          }}
        />
      )}
    </div>
  );
}

function AddMarketModal({
  clientId,
  onClose,
  onCreated,
}: {
  clientId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    country_code: 'NL',
    amazon_advertiser_profile_id: '',
    amazon_advertiser_account_id: '',
    roas_target: '',
    daily_budget_cap: '',
    currency: 'EUR',
  });
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { error } = await supabase.from('client_markets').insert({
        client_id: clientId,
        country_code: form.country_code.toUpperCase(),
        amazon_advertiser_profile_id: form.amazon_advertiser_profile_id,
        amazon_advertiser_account_id: form.amazon_advertiser_account_id,
        roas_target: form.roas_target ? parseFloat(form.roas_target) : null,
        daily_budget_cap: form.daily_budget_cap
          ? parseFloat(form.daily_budget_cap)
          : null,
        currency: form.currency,
        state: 'active',
      });
      if (error) throw error;
      onCreated();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create market');
    } finally {
      setSaving(false);
    }
  };

  const field = (
    label: string,
    key: keyof typeof form,
    type = 'text',
    required = false,
    placeholder = ''
  ) => (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
        required={required}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">
          Add Market
        </h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          {field('Country Code', 'country_code', 'text', true, 'NL')}
          {field(
            'Amazon Advertiser Profile ID',
            'amazon_advertiser_profile_id',
            'text',
            true,
            '12345678'
          )}
          {field(
            'Amazon Advertiser Account ID',
            'amazon_advertiser_account_id',
            'text',
            true,
            'A1B2C3D4E5'
          )}
          <div className="grid grid-cols-2 gap-3">
            {field('ROAS Target', 'roas_target', 'number', false, '4.0')}
            {field(
              'Daily Budget Cap',
              'daily_budget_cap',
              'number',
              false,
              '500'
            )}
          </div>
          {field('Currency', 'currency', 'text', false, 'EUR')}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm bg-brand-500 hover:bg-brand-600 text-white rounded-lg font-medium disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Add Market'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
