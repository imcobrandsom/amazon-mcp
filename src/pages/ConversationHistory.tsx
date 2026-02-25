import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, MessageSquare } from 'lucide-react';
import { useClientDetail } from '../hooks/useClientDetail';
import { formatDistanceToNow, format } from 'date-fns';

export default function ConversationHistory() {
  const { clientId } = useParams<{ clientId: string }>();
  const { client, conversations, loading } = useClientDetail(clientId!);

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

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to={`/clients/${clientId}`}
          className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            Conversation History
          </h1>
          {client && (
            <p className="text-sm text-slate-500">{client.name}</p>
          )}
        </div>
      </div>

      {/* List */}
      {conversations.length === 0 ? (
        <div className="text-center py-16">
          <MessageSquare size={32} className="text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No conversations yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className="bg-white rounded-xl border border-slate-200 p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <MessageSquare size={14} className="text-brand-500" />
                  <span className="text-xs font-medium text-slate-700">
                    {format(new Date(conv.created_at), 'MMM d, yyyy · HH:mm')}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400">
                  {formatDistanceToNow(new Date(conv.updated_at), {
                    addSuffix: true,
                  })}
                </span>
              </div>
              {conv.summary ? (
                <p className="text-sm text-slate-600 leading-relaxed">
                  {conv.summary}
                </p>
              ) : (
                <p className="text-xs text-slate-400 italic">
                  No summary generated.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
