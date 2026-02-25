import React, { useState } from 'react';
import { Lightbulb } from 'lucide-react';
import type { OptimizationProposal, ProposalStatus } from '../../types';
import ProposalCard from './ProposalCard';
import clsx from 'clsx';

interface Props {
  proposals: OptimizationProposal[];
  marketId: string;
  onUpdated: (p: OptimizationProposal) => void;
}

const STATUS_TABS: { key: ProposalStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'executed', label: 'Executed' },
];

export default function ProposalsPanel({
  proposals,
  marketId,
  onUpdated,
}: Props) {
  const [activeTab, setActiveTab] = useState<ProposalStatus | 'all'>('pending');

  // Filter to current market
  const marketProposals = proposals.filter(
    (p) => !marketId || p.market_id === marketId || p.market_id === null
  );

  const filtered =
    activeTab === 'all'
      ? marketProposals
      : marketProposals.filter((p) => p.status === activeTab);

  const pendingCount = marketProposals.filter((p) => p.status === 'pending').length;

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb size={14} className="text-amber-500" />
          <h2 className="text-sm font-semibold text-slate-900">Proposals</h2>
          {pendingCount > 0 && (
            <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
              {pendingCount} pending
            </span>
          )}
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-0.5">
          {STATUS_TABS.map(({ key, label }) => {
            const count =
              key === 'all'
                ? marketProposals.length
                : marketProposals.filter((p) => p.status === key).length;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={clsx(
                  'px-2.5 py-1 text-xs rounded-md font-medium transition-colors',
                  activeTab === key
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                )}
              >
                {label}
                {count > 0 && (
                  <span className="ml-1 opacity-60">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Proposals list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Lightbulb size={24} className="text-slate-300 mb-2" />
            <p className="text-xs text-slate-400">
              {activeTab === 'pending'
                ? 'No pending proposals. Chat with the agent to generate optimization ideas.'
                : `No ${activeTab} proposals.`}
            </p>
          </div>
        ) : (
          filtered.map((p) => (
            <ProposalCard key={p.id} proposal={p} onUpdated={onUpdated} />
          ))
        )}
      </div>
    </div>
  );
}
