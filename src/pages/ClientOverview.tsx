import React, { useState } from 'react';
import { Search, Plus, MessageSquare, Trash2 } from 'lucide-react';
import ClientCard from '../components/ClientCard';
import GlobalChatPanel from '../components/Chat/GlobalChatPanel';
import { useClients } from '../hooks/useClients';
import { supabase } from '../lib/supabase';

// ── Country / currency helpers ────────────────────────────────────────────────
const AMAZON_COUNTRIES = [
  { code: 'NL', currency: 'EUR' }, { code: 'DE', currency: 'EUR' },
  { code: 'FR', currency: 'EUR' }, { code: 'IT', currency: 'EUR' },
  { code: 'ES', currency: 'EUR' }, { code: 'BE', currency: 'EUR' },
  { code: 'GB', currency: 'GBP' }, { code: 'SE', currency: 'SEK' },
  { code: 'PL', currency: 'PLN' }, { code: 'TR', currency: 'TRY' },
  { code: 'AE', currency: 'AED' }, { code: 'SA', currency: 'SAR' },
  { code: 'EG', currency: 'EGP' }, { code: 'IN', currency: 'INR' },
  { code: 'JP', currency: 'JPY' }, { code: 'AU', currency: 'AUD' },
  { code: 'CA', currency: 'CAD' }, { code: 'MX', currency: 'MXN' },
  { code: 'US', currency: 'USD' },
];
const currencyFor = (code: string) =>
  AMAZON_COUNTRIES.find((c) => c.code === code)?.currency ?? 'EUR';

function flagEmoji(code: string) {
  const offset = 0x1f1e6 - 65;
  return String.fromCodePoint(
    code.toUpperCase().charCodeAt(0) + offset,
    code.toUpperCase().charCodeAt(1) + offset
  );
}

// ── Market row type ───────────────────────────────────────────────────────────
interface MarketRow {
  _key: string;
  country_code: string;
  amazon_advertiser_profile_id: string;
  amazon_advertiser_account_id: string;
  roas_target: string;
  daily_budget_cap: string;
  currency: string;
}

const newMarketRow = (): MarketRow => ({
  _key: crypto.randomUUID(),
  country_code: 'NL',
  amazon_advertiser_profile_id: '',
  amazon_advertiser_account_id: '',
  roas_target: '',
  daily_budget_cap: '',
  currency: 'EUR',
});

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ClientOverview() {
  const { clients, loading, error, refetch } = useClients();
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showChat, setShowChat] = useState(false);

  const filtered = clients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Clients</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {clients.length} client{clients.length !== 1 ? 's' : ''} managed
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowChat(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 border border-slate-200 hover:border-brand-400 hover:bg-brand-50 text-slate-600 hover:text-brand-600 text-sm font-medium rounded-lg transition-colors"
          >
            <MessageSquare size={15} />
            General Chat
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={15} />
            Add Client
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-xs">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search clients…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 h-36 animate-pulse">
              <div className="flex gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-slate-100" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-slate-100 rounded w-2/3" />
                  <div className="h-2 bg-slate-100 rounded w-1/3" />
                </div>
              </div>
              <div className="h-2 bg-slate-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-slate-500 text-sm">{error}</p>
          <button onClick={refetch} className="mt-3 text-sm text-brand-500 hover:underline">
            Try again
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-slate-500 text-sm">
            {search ? `No clients matching "${search}"` : 'No clients yet. Add your first client.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((client) => (
            <ClientCard key={client.id} client={client} />
          ))}
        </div>
      )}

      {/* Add Client modal */}
      {showAdd && (
        <AddClientModal
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); refetch(); }}
        />
      )}

      {/* Global chat slide-over */}
      {showChat && <GlobalChatPanel onClose={() => setShowChat(false)} />}
    </div>
  );
}

// ── Add Client Modal (with optional multi-market setup) ───────────────────────
function AddClientModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [markets, setMarkets] = useState<MarketRow[]>([newMarketRow()]);
  const [saving, setSaving] = useState(false);

  const addMarket = () => setMarkets((prev) => [...prev, newMarketRow()]);
  const removeMarket = (key: string) =>
    setMarkets((prev) => prev.filter((m) => m._key !== key));
  const updateMarket = (key: string, field: keyof MarketRow, value: string) =>
    setMarkets((prev) =>
      prev.map((m) => {
        if (m._key !== key) return m;
        const updated = { ...m, [field]: value };
        // auto-fill currency when country changes
        if (field === 'country_code') updated.currency = currencyFor(value);
        return updated;
      })
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      // 1. Create client
      const { data: client, error: clientErr } = await supabase
        .from('clients')
        .insert({ name: name.trim(), logo_url: logoUrl.trim() || null })
        .select()
        .single();
      if (clientErr) throw clientErr;

      // 2. Insert any market rows that have a Profile ID
      const validMarkets = markets.filter(
        (m) => m.amazon_advertiser_profile_id.trim()
      );
      if (validMarkets.length > 0) {
        const { error: mErr } = await supabase.from('client_markets').insert(
          validMarkets.map((m) => ({
            client_id: client.id,
            country_code: m.country_code.toUpperCase(),
            amazon_advertiser_profile_id: m.amazon_advertiser_profile_id.trim(),
            amazon_advertiser_account_id: m.amazon_advertiser_account_id.trim(),
            roas_target: m.roas_target ? parseFloat(m.roas_target) : null,
            daily_budget_cap: m.daily_budget_cap ? parseFloat(m.daily_budget_cap) : null,
            currency: m.currency,
            state: 'active',
          }))
        );
        if (mErr) throw mErr;
      }

      onCreated();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create client');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8">
        {/* Modal header */}
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">Add New Client</h2>
          <p className="text-xs text-slate-500 mt-0.5">Fill in client details and add one or more markets in one go.</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="px-6 py-5 space-y-5">
            {/* Client info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Client Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400"
                  placeholder="e.g. Bloomique"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Logo URL <span className="text-slate-400">(optional)</span>
                </label>
                <input
                  type="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400"
                  placeholder="https://…"
                />
              </div>
            </div>

            {/* Markets section */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Markets</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Add one or more country markets. Profile ID is required per market.</p>
                </div>
                <button
                  type="button"
                  onClick={addMarket}
                  className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium transition-colors"
                >
                  <Plus size={13} /> Add country
                </button>
              </div>

              <div className="space-y-3">
                {markets.map((m) => (
                  <div key={m._key} className="border border-slate-200 rounded-lg p-4 bg-slate-50 relative">
                    {/* Remove button */}
                    {markets.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeMarket(m._key)}
                        className="absolute top-3 right-3 p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}

                    {/* Row 1: country + profile + account */}
                    <div className="grid grid-cols-[120px_1fr_1fr] gap-3 mb-3">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">Country</label>
                        <select
                          value={m.country_code}
                          onChange={(e) => updateMarket(m._key, 'country_code', e.target.value)}
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-brand-400"
                        >
                          {AMAZON_COUNTRIES.map((c) => (
                            <option key={c.code} value={c.code}>
                              {flagEmoji(c.code)} {c.code}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Advertiser Profile ID <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          value={m.amazon_advertiser_profile_id}
                          onChange={(e) => updateMarket(m._key, 'amazon_advertiser_profile_id', e.target.value)}
                          placeholder="amzn1.ads-account…"
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-400"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">Advertiser Account ID</label>
                        <input
                          type="text"
                          value={m.amazon_advertiser_account_id}
                          onChange={(e) => updateMarket(m._key, 'amazon_advertiser_account_id', e.target.value)}
                          placeholder="ENTITY…"
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-400"
                        />
                      </div>
                    </div>

                    {/* Row 2: currency + budget + ROAS */}
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">Currency</label>
                        <input
                          type="text"
                          value={m.currency}
                          onChange={(e) => updateMarket(m._key, 'currency', e.target.value.toUpperCase())}
                          maxLength={3}
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-400"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">Daily Budget Cap</label>
                        <input
                          type="number"
                          value={m.daily_budget_cap}
                          onChange={(e) => updateMarket(m._key, 'daily_budget_cap', e.target.value)}
                          placeholder="500"
                          min="0"
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-400"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">ROAS Target (x)</label>
                        <input
                          type="number"
                          value={m.roas_target}
                          onChange={(e) => updateMarket(m._key, 'roas_target', e.target.value)}
                          placeholder="4.0"
                          min="0"
                          step="0.1"
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-400"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-100 flex justify-between items-center">
            <p className="text-[11px] text-slate-400">
              Markets without a Profile ID will be skipped.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !name.trim()}
                className="px-4 py-2 text-sm bg-brand-500 hover:bg-brand-600 text-white rounded-lg font-medium disabled:opacity-50 transition-colors"
              >
                {saving ? 'Creating…' : 'Create Client'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
