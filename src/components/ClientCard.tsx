import React from 'react';
import { Link } from 'react-router-dom';
import { Globe, MessageSquare, AlertCircle } from 'lucide-react';
import type { Client } from '../types';
import clsx from 'clsx';

interface Props {
  client: Client;
}

export default function ClientCard({ client }: Props) {
  const initials = client.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <Link
      to={`/clients/${client.id}`}
      className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col gap-4 hover:border-brand-400 hover:shadow-md transition-all group"
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          {client.logo_url ? (
            <img
              src={client.logo_url}
              alt={client.name}
              className="w-10 h-10 rounded-lg object-contain bg-slate-50 border border-slate-100"
            />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center">
              <span className="text-sm font-bold text-brand-600">{initials}</span>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-slate-900 text-sm group-hover:text-brand-600 transition-colors truncate">
            {client.name}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Added {new Date(client.created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4">
        <Stat
          icon={<Globe size={12} />}
          value={client.market_count ?? 0}
          label="market"
        />
        <Stat
          icon={<AlertCircle size={12} />}
          value={client.pending_proposals ?? 0}
          label="pending"
          highlight={(client.pending_proposals ?? 0) > 0}
        />
      </div>

      {/* Last summary */}
      {client.last_summary && (
        <div className="flex items-start gap-2 pt-2 border-t border-slate-100">
          <MessageSquare size={12} className="text-slate-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
            {client.last_summary}
          </p>
        </div>
      )}
    </Link>
  );
}

function Stat({
  icon,
  value,
  label,
  highlight = false,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={clsx('text-slate-400', highlight && value > 0 && 'text-amber-500')}>
        {icon}
      </span>
      <span
        className={clsx(
          'text-xs font-medium',
          highlight && value > 0 ? 'text-amber-600' : 'text-slate-600'
        )}
      >
        {value} {label}
        {value !== 1 ? 's' : ''}
      </span>
    </div>
  );
}
