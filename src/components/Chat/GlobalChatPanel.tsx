import React, { useState, useRef, useEffect } from 'react';
import { Send, X, RefreshCcw, Bot } from 'lucide-react';
import type { LocalMessage } from '../../types';
import MessageBubble from './MessageBubble';
import { sendGlobalChatMessage } from '../../lib/api';

const SUGGESTED = [
  'Which client has the highest ROAS this week?',
  'Compare NL campaigns across all clients',
  'Show underperforming campaigns portfolio-wide',
];

interface Props {
  onClose: () => void;
}

export default function GlobalChatPanel({ onClose }: Props) {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (text?: string) => {
    const trimmed = (text ?? input).trim();
    if (!trimmed || sending) return;

    const userMsg: LocalMessage = { role: 'user', content: trimmed };
    const allPrev = [...messages, userMsg];
    setMessages([...allPrev, { role: 'assistant', content: '', isStreaming: true }]);
    setInput('');
    setSending(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      const response = await sendGlobalChatMessage({ messages: allPrev });
      setMessages([
        ...allPrev,
        { role: 'assistant', content: response.content || '*(No response)*' },
      ]);
    } catch (err) {
      setMessages([
        ...allPrev,
        { role: 'assistant', content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}` },
      ]);
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

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-white border-l border-slate-200 shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-brand-50 flex items-center justify-center">
            <Bot size={14} className="text-brand-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">General Chat</p>
            <p className="text-[10px] text-slate-400">All clients · Amazon Ads</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-8">
            <div className="w-12 h-12 rounded-full bg-brand-50 flex items-center justify-center mb-3">
              <Bot size={22} className="text-brand-400" />
            </div>
            <p className="text-sm font-medium text-slate-700">Ask about any client</p>
            <p className="text-xs text-slate-400 mt-1 max-w-[280px] leading-relaxed">
              Query campaigns, compare performance, or spot opportunities across the full portfolio.
            </p>
            <div className="mt-5 flex flex-col gap-2 w-full max-w-xs">
              {SUGGESTED.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSend(q)}
                  className="text-left text-xs text-brand-600 bg-brand-50 hover:bg-brand-100 px-3 py-2 rounded-lg transition-colors leading-snug"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => <MessageBubble key={i} message={msg} />)
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-100 px-4 py-3 flex-shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask about any client or campaign…"
            className="flex-1 resize-none px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent min-h-[40px] max-h-[120px] leading-relaxed"
            rows={1}
            disabled={sending}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || sending}
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center bg-brand-500 hover:bg-brand-600 text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? <RefreshCcw size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
        <p className="text-[10px] text-slate-400 mt-1.5">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
