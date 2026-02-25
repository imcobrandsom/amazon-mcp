import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Client } from '../types';

export function useClients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch clients with market count, pending proposals, and latest summary
      const { data, error: err } = await supabase
        .from('clients')
        .select(`
          *,
          client_markets(count),
          optimization_proposals(count),
          conversations(summary, updated_at)
        `)
        .order('name');

      if (err) throw err;

      const enriched: Client[] = (data ?? []).map((row: Record<string, unknown>) => {
        const markets = row.client_markets as Array<{ count: number }>;
        const proposals = row.optimization_proposals as Array<{ count: number }>;
        const convs = row.conversations as Array<{ summary: string | null; updated_at: string }>;

        const sortedConvs = (convs ?? [])
          .filter((c) => c.summary)
          .sort(
            (a, b) =>
              new Date(b.updated_at).getTime() -
              new Date(a.updated_at).getTime()
          );

        return {
          id: row.id as string,
          name: row.name as string,
          logo_url: row.logo_url as string | null,
          created_at: row.created_at as string,
          market_count: markets?.[0]?.count ?? 0,
          pending_proposals: proposals?.[0]?.count ?? 0,
          last_summary: sortedConvs[0]?.summary ?? null,
        };
      });

      setClients(enriched);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load clients');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  return { clients, loading, error, refetch: fetchClients };
}
