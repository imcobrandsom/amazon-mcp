import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
} from 'react';
import { Send, Brain, Plus, RefreshCcw } from 'lucide-react';
import type {
  ClientMarket,
  AgentMemory,
  Conversation,
  LocalMessage,
  OptimizationProposal,
} from '../../types';
import MessageBubble from './MessageBubble';
import MemoryPanel from './MemoryPanel';
import { supabase } from '../../lib/supabase';
import { sendChatMessage, generateSummary } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

interface Props {
  clientId: string;
  clientName: string;
  market: ClientMarket;
  memory: AgentMemory[];
  recentConversation: Conversation | null;
  onProposalsCreated: (proposals: OptimizationProposal[]) => void;
  onRefreshMemory: () => void;
}

export default function ChatInterface({
  clientId,
  clientName,
  market,
  memory,
  recentConversation,
  onProposalsCreated,
  onRefreshMemory,
}: Props) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [showMemory, setShowMemory] = useState(false);
  const [previousSummary, setPreviousSummary] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load or create conversation when market changes
  useEffect(() => {
    initConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market.id]);

  const initConversation = useCallback(async () => {
    setMessages([]);
    setConversationId(null);
    setPreviousSummary(recentConversation?.summary ?? null);

    // Create new conversation row
    if (!user) return;
    const { data, error } = await supabase
      .from('conversations')
      .insert({
        client_id: clientId,
        market_id: market.id,
        user_id: user.id,
      })
      .select()
      .single();

    if (!error && data) {
      setConversationId(data.id);
    }
  }, [clientId, market.id, user, recentConversation?.summary]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleNewConversation = async () => {
    // Save summary of current conversation first
    if (conversationId && messages.length > 0) {
      try {
        await generateSummary({ conversationId, messages });
      } catch (e) {
        console.error('Failed to generate summary:', e);
      }
    }
    await initConversation();
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || sending || !conversationId) return;

    const userMsg: LocalMessage = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Save user message to DB
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      role: 'user',
      content: trimmed,
    });

    // Add typing indicator
    const thinkingMsg: LocalMessage = {
      role: 'assistant',
      content: '',
      isStreaming: true,
    };
    setMessages((prev) => [...prev, thinkingMsg]);

    try {
      const allMessages: LocalMessage[] = [
        ...messages,
        userMsg,
      ];

      const response = await sendChatMessage({
        conversationId,
        clientId,
        marketId: market.id,
        messages: allMessages,
        clientContext: { ...market, clientName },
        memory: memory.filter((m) => m.is_active),
        previousSummary,
      });

      // Replace typing with actual response
      const assistantMsg: LocalMessage = {
        role: 'assistant',
        content: response.content || '*(No text response)*',
      };
      setMessages((prev) => [
        ...prev.slice(0, -1), // remove typing indicator
        assistantMsg,
      ]);

      // Update proposals panel if any were created
      if (response.proposals?.length) {
        onProposalsCreated(response.proposals);
      }
    } catch (err) {
      const errorMsg: LocalMessage = {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Something went wrong. Please try again.'}`,
      };
      setMessages((prev) => [...prev.slice(0, -1), errorMsg]);
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

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  return (
    <>
      <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200 overflow-hidden">
        {/* Chat header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500">
              Conversation
            </span>
            {previousSummary && (
              <span className="text-[10px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">
                Continuing from previous session
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Memory indicator */}
            <button
              onClick={() => setShowMemory(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-slate-100 text-xs text-slate-500 hover:text-slate-700 transition-colors"
              title="View agent memory"
            >
              <Brain size={13} />
              <span>{memory.length} memories</span>
            </button>
            {/* New conversation */}
            <button
              onClick={handleNewConversation}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-slate-100 text-xs text-slate-500 hover:text-slate-700 transition-colors"
              title="Start new conversation (saves summary of current)"
            >
              <Plus size={13} />
              New
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center py-8">
              <div className="w-10 h-10 rounded-full bg-brand-50 flex items-center justify-center mb-3">
                <span className="text-brand-500 font-bold text-sm">F</span>
              </div>
              <p className="text-sm font-medium text-slate-700">
                Ready for {clientName} — {market.country_code}
              </p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs">
                Ask about campaign performance, budgets, or let the agent
                identify optimization opportunities.
              </p>
              {previousSummary && (
                <div className="mt-4 max-w-sm bg-slate-50 rounded-lg p-3 text-left">
                  <p className="text-[10px] font-medium text-slate-500 uppercase mb-1">
                    Previous session
                  </p>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {previousSummary}
                  </p>
                </div>
              )}
            </div>
          )}
          {messages.map((msg, i) => (
            <MessageBubble key={i} message={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-slate-100 px-4 py-3 flex-shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder={`Ask about ${clientName} ${market.country_code} campaigns…`}
              className="flex-1 resize-none px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent min-h-[40px] max-h-[120px] leading-relaxed"
              rows={1}
              disabled={sending || !conversationId}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending || !conversationId}
              className="flex-shrink-0 w-9 h-9 flex items-center justify-center bg-brand-500 hover:bg-brand-600 text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {sending ? (
                <RefreshCcw size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
            </button>
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>

      {/* Memory panel overlay */}
      {showMemory && (
        <MemoryPanel
          clientId={clientId}
          memory={memory}
          onClose={() => setShowMemory(false)}
          onRefresh={onRefreshMemory}
        />
      )}
    </>
  );
}
