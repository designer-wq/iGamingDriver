import React, { useState, useEffect, useRef } from 'react';
import { searchProviderInfo } from '../services/geminiService';

interface AssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  context: string; // e.g., "Pragmatic Play" or "Fortune Tiger"
}

interface Message {
    role: 'user' | 'ai';
    content: string;
    sources?: { title: string; uri: string }[];
}

export const AssistantModal: React.FC<AssistantModalProps> = ({ isOpen, onClose, context }) => {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
        setMessages([{ role: 'ai', content: `Olá! Sou seu assistente de assets. O que você gostaria de saber sobre ${context || 'nossos provedores'}?` }]);
    }
  }, [isOpen, context, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;

    const userMsg = query;
    setQuery('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsLoading(true);

    const fullQuery = context ? `Sobre ${context}: ${userMsg}` : userMsg;
    
    const result = await searchProviderInfo(fullQuery);
    
    setMessages(prev => [...prev, { 
        role: 'ai', 
        content: result.text,
        sources: result.sources
    }]);
    setIsLoading(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-2xl bg-[#1E293B] rounded-2xl shadow-2xl border border-gray-700 flex flex-col overflow-hidden animate-slide-up ring-1 ring-white/10 h-[600px]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#111827] border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white">
                <span className="material-symbols-outlined text-[20px]">smart_toy</span>
             </div>
             <div>
                <h2 className="text-lg font-semibold text-white">Assistente IA</h2>
                <p className="text-xs text-gray-400">Powered by Google Gemini</p>
             </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#1E293B] custom-scrollbar">
            {messages.map((msg, idx) => (
                <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'ai' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-gray-700 text-gray-300'}`}>
                        <span className="material-symbols-outlined text-[18px]">{msg.role === 'ai' ? 'smart_toy' : 'person'}</span>
                    </div>
                    <div className={`flex flex-col max-w-[80%] gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                        <div className={`p-3 rounded-2xl text-sm leading-relaxed ${
                            msg.role === 'user' 
                            ? 'bg-primary text-white rounded-tr-sm' 
                            : 'bg-[#273346] text-gray-200 rounded-tl-sm border border-gray-700/50'
                        }`}>
                            {msg.content}
                        </div>
                        {msg.sources && msg.sources.length > 0 && (
                            <div className="mt-2 text-xs flex flex-wrap gap-2">
                                {msg.sources.map((src, i) => (
                                    <a key={i} href={src.uri} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-2 py-1 bg-black/20 rounded border border-white/5 hover:bg-black/40 hover:text-primary transition-colors text-gray-400">
                                        <span className="material-symbols-outlined text-[10px]">link</span>
                                        <span className="truncate max-w-[150px]">{src.title}</span>
                                    </a>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            ))}
            {isLoading && (
                <div className="flex gap-4">
                     <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-[18px]">smart_toy</span>
                    </div>
                    <div className="p-3 rounded-2xl bg-[#273346] rounded-tl-sm border border-gray-700/50 flex items-center gap-2">
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-75"></span>
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-150"></span>
                    </div>
                </div>
            )}
            <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <form onSubmit={handleSearch} className="p-4 bg-[#111827] border-t border-gray-700 flex gap-3">
            <input 
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Pergunte sobre jogos, lançamentos ou detalhes..." 
                className="flex-1 bg-[#1F2937] border border-gray-700 text-white rounded-lg px-4 py-2.5 focus:ring-1 focus:ring-primary focus:border-primary outline-none placeholder-gray-500 text-sm"
                disabled={isLoading}
            />
            <button 
                type="submit" 
                disabled={isLoading || !query.trim()}
                className="px-4 py-2 bg-primary hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center justify-center"
            >
                <span className="material-symbols-outlined">send</span>
            </button>
        </form>
      </div>
    </div>
  );
};
