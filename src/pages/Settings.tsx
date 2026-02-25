import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle, XCircle, Link2, RefreshCcw, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatDistanceToNow } from 'date-fns';

interface AmazonCreds {
  connected_at: string | null;
  access_token_expires_at: string | null;
  refresh_token: string | null;
}

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [creds, setCreds] = useState<AmazonCreds | null>(null);
  const [loading, setLoading] = useState(true);

  const connected = searchParams.get('amazon_connected');
  const errorCode = searchParams.get('amazon_error');

  useEffect(() => {
    fetchCreds();
    // Clear URL params after reading
    if (connected || errorCode) {
      setSearchParams({}, { replace: true });
    }
  }, []);

  const fetchCreds = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('amazon_credentials')
      .select('connected_at, access_token_expires_at, refresh_token')
      .eq('id', 1)
      .single();
    setCreds(data ?? null);
    setLoading(false);
  };

  const isConnected = !!creds?.refresh_token;

  const errorMessages: Record<string, string> = {
    access_denied: 'You denied access. Please try again and click Allow.',
    no_code: 'No authorization code received. Please try again.',
    token_exchange_failed: 'Failed to exchange the authorization code. Check your Client ID and Secret in Vercel.',
    db_error: 'Connected but failed to save credentials. Check Supabase.',
    unknown: 'An unexpected error occurred. Check Vercel logs.',
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Settings</h1>
      <p className="text-sm text-slate-500 mb-6">Manage integrations and connections.</p>

      {/* Success banner */}
      {connected && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 mb-4 text-sm">
          <CheckCircle size={15} />
          Amazon Ads connected successfully.
        </div>
      )}

      {/* Error banner */}
      {errorCode && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          <XCircle size={15} />
          {errorMessages[errorCode] ?? 'Connection failed.'}
        </div>
      )}

      {/* Amazon Ads card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {/* Amazon logo placeholder */}
            <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center flex-shrink-0">
              <span className="text-amber-600 font-bold text-sm">A</span>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Amazon Advertising</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Connect your Amazon Ads account to enable AI-powered campaign management.
              </p>
            </div>
          </div>

          {/* Status badge */}
          {!loading && (
            <span className={`text-[10px] font-semibold uppercase px-2 py-1 rounded-full flex-shrink-0 ${
              isConnected
                ? 'bg-green-100 text-green-700'
                : 'bg-slate-100 text-slate-500'
            }`}>
              {isConnected ? 'Connected' : 'Not connected'}
            </span>
          )}
        </div>

        {/* Connection details */}
        {!loading && isConnected && creds?.connected_at && (
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-1.5">
            <Detail
              label="Connected"
              value={formatDistanceToNow(new Date(creds.connected_at), { addSuffix: true })}
            />
            {creds.access_token_expires_at && (
              <Detail
                label="Access token expires"
                value={formatDistanceToNow(new Date(creds.access_token_expires_at), { addSuffix: true })}
              />
            )}
            <p className="text-[10px] text-slate-400 mt-1">
              Access tokens are refreshed automatically before expiry.
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-2">
          <a
            href="/api/amazon-connect"
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Link2 size={13} />
            {isConnected ? 'Reconnect Amazon Ads' : 'Connect Amazon Ads'}
          </a>
          {isConnected && (
            <button
              onClick={fetchCreds}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <RefreshCcw size={13} />
              Refresh status
            </button>
          )}
        </div>

        {/* Setup note */}
        {!isConnected && !loading && (
          <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
            <AlertTriangle size={13} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-700">
              Before connecting, make sure{' '}
              <code className="bg-amber-100 px-1 rounded text-[11px]">
                https://amazon-mcp-eight.vercel.app/api/amazon-callback
              </code>{' '}
              is added as an Allowed Return URL in your Amazon LwA app.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-slate-500 w-36">{label}</span>
      <span className="text-slate-700 font-medium">{value}</span>
    </div>
  );
}
