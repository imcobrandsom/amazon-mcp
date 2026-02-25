import React, { useState } from 'react';
import { CheckCircle, XCircle, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import type { OptimizationProposal } from '../../types';
import { updateProposalStatus } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';

interface Props {
  proposal: OptimizationProposal;
  onUpdated: (p: OptimizationProposal) => void;
}

const TYPE_LABELS: Record<string, string> = {
  bid: 'Bid',
  budget: 'Budget',
  keyword: 'Keyword',
  targeting: 'Targeting',
};

const TYPE_COLORS: Record<string, string> = {
  bid: 'bg-blue-100 text-blue-700',
  budget: 'bg-violet-100 text-violet-700',
  keyword: 'bg-emerald-100 text-emerald-700',
  targeting: 'bg-orange-100 text-orange-700',
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  executed: 'bg-blue-100 text-blue-700',
};

export default function ProposalCard({ proposal, onUpdated }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleAction = async (action: 'approve' | 'reject' | 'execute') => {
    if (!user) return;
    setLoading(true);
    try {
      const { proposal: updated } = await updateProposalStatus({
        proposalId: proposal.id,
        action,
        reviewedBy: user.id,
      });
      onUpdated(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      {/* Main content */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={clsx(
                'text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded',
                TYPE_COLORS[proposal.proposal_type]
              )}
            >
              {TYPE_LABELS[proposal.proposal_type]}
            </span>
            <span
              className={clsx(
                'text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded',
                STATUS_STYLES[proposal.status]
              )}
            >
              {proposal.status}
            </span>
          </div>
          <span className="text-[10px] text-slate-400 flex-shrink-0">
            {formatDistanceToNow(new Date(proposal.created_at), {
              addSuffix: true,
            })}
          </span>
        </div>

        <h4 className="text-sm font-semibold text-slate-900 mb-2">
          {proposal.title}
        </h4>

        {/* Current → Proposed */}
        <div className="flex items-center gap-2 text-xs text-slate-600 mb-2">
          <span className="bg-slate-100 px-2 py-0.5 rounded font-mono">
            {proposal.current_value ?? '—'}
          </span>
          <span className="text-slate-400">→</span>
          <span className="bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded font-mono font-medium">
            {proposal.proposed_value ?? '—'}
          </span>
        </div>

        {/* Expected impact */}
        {proposal.expected_impact && (
          <p className="text-xs text-slate-500 mb-3">
            <span className="font-medium text-slate-700">Expected: </span>
            {proposal.expected_impact}
          </p>
        )}

        {/* Expandable description */}
        {proposal.description && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 mb-2 transition-colors"
          >
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {expanded ? 'Hide' : 'Show'} details
          </button>
        )}
        {expanded && proposal.description && (
          <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 rounded-md p-2.5 mb-2">
            {proposal.description}
          </p>
        )}

        {/* Actions */}
        {proposal.status === 'pending' && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
            <button
              onClick={() => handleAction('approve')}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 text-xs font-medium rounded-md transition-colors disabled:opacity-50"
            >
              <CheckCircle size={12} />
              Approve
            </button>
            <button
              onClick={() => handleAction('reject')}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-medium rounded-md transition-colors disabled:opacity-50"
            >
              <XCircle size={12} />
              Reject
            </button>
          </div>
        )}

        {proposal.status === 'approved' && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <p className="text-xs text-green-600 font-medium">
                Ready for execution
              </p>
              <button
                onClick={() => handleAction('execute')}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-500 hover:bg-brand-600 text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50"
              >
                <Zap size={12} />
                Execute via n8n
              </button>
            </div>
          </div>
        )}

        {proposal.status === 'executed' && proposal.executed_at && (
          <p className="text-[10px] text-slate-400 mt-2 pt-2 border-t border-slate-100">
            Executed{' '}
            {formatDistanceToNow(new Date(proposal.executed_at), {
              addSuffix: true,
            })}
          </p>
        )}
      </div>
    </div>
  );
}
