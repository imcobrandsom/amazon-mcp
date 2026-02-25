import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type {
  Client,
  ClientMarket,
  AgentMemory,
  Conversation,
  OptimizationProposal,
} from '../types';

export function useClientDetail(clientId: string) {
  const [client, setClient] = useState<Client | null>(null);
  const [markets, setMarkets] = useState<ClientMarket[]>([]);
  const [memory, setMemory] = useState<AgentMemory[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [proposals, setProposals] = useState<OptimizationProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [clientRes, marketsRes, memoryRes, convsRes, proposalsRes] =
        await Promise.all([
          supabase.from('clients').select('*').eq('id', clientId).single(),
          supabase
            .from('client_markets')
            .select('*')
            .eq('client_id', clientId)
            .order('country_code'),
          supabase
            .from('agent_memory')
            .select('*')
            .eq('client_id', clientId)
            .eq('is_active', true)
            .order('created_at', { ascending: false }),
          supabase
            .from('conversations')
            .select('*')
            .eq('client_id', clientId)
            .order('updated_at', { ascending: false })
            .limit(20),
          supabase
            .from('optimization_proposals')
            .select('*')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false }),
        ]);

      if (clientRes.error) throw clientRes.error;
      if (marketsRes.error) throw marketsRes.error;
      if (memoryRes.error) throw memoryRes.error;
      if (convsRes.error) throw convsRes.error;
      if (proposalsRes.error) throw proposalsRes.error;

      setClient(clientRes.data);
      setMarkets(marketsRes.data ?? []);
      setMemory(memoryRes.data ?? []);
      setConversations(convsRes.data ?? []);
      setProposals(proposalsRes.data ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load client data');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (clientId) fetchAll();
  }, [clientId, fetchAll]);

  const refetchProposals = useCallback(async () => {
    const { data } = await supabase
      .from('optimization_proposals')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });
    setProposals(data ?? []);
  }, [clientId]);

  const refetchMemory = useCallback(async () => {
    const { data } = await supabase
      .from('agent_memory')
      .select('*')
      .eq('client_id', clientId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    setMemory(data ?? []);
  }, [clientId]);

  return {
    client,
    markets,
    memory,
    conversations,
    proposals,
    loading,
    error,
    refetch: fetchAll,
    refetchProposals,
    refetchMemory,
    setProposals,
  };
}
