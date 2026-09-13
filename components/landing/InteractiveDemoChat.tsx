"use client";

import { useState, useEffect, useRef } from "react";
import { Car, Stethoscope, Scale, GraduationCap, Home, Sparkles, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { traduzir } from "@/lib/i18n/dicionario";

const NICHES = [
  { id: "veiculos", label: "Veículos", icon: Car },
  { id: "clinica", label: "Clínicas", icon: Stethoscope },
  { id: "advocacia", label: "Advocacia", icon: Scale },
  { id: "escola", label: "Escola", icon: GraduationCap },
  { id: "imobiliaria", label: "Imobiliária", icon: Home },
  { id: "estetica", label: "Estética", icon: Sparkles },
];

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export function InteractiveDemoChat() {
  const t = (texto: string) => traduzir(texto, "pt-BR");
  const [activeNiche, setActiveNiche] = useState(NICHES[0]!);
  const [rateLimited, setRateLimited] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleNicheChange = (niche: typeof NICHES[0]) => {
    setActiveNiche(niche);
    setRateLimited(false);
    setInput("");
    setMessages([{ 
      id: "welcome", 
      role: "assistant", 
      content: `Olá! Sou o atendente virtual focado no nicho de ${niche.label}. Como posso te ajudar hoje?` 
    }]);
  };

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{ 
        id: "welcome", 
        role: "assistant", 
        content: `Olá! Sou o atendente virtual focado no nicho de ${activeNiche.label}. Como posso te ajudar hoje?` 
      }]);
    }
  }, [activeNiche.label, messages.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || rateLimited) return;

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    setRateLimited(false);

    try {
      const response = await fetch("/api/public/demo-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          niche: activeNiche.id,
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          setRateLimited(true);
        }
        setIsLoading(false);
        return;
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) {
        setIsLoading(false);
        return;
      }

      const aiMsgId = "ai_" + Date.now().toString();
      setMessages((prev) => [...prev, { id: aiMsgId, role: "assistant", content: "" }]);

      let done = false;
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const textChunk = chunk
            .split("\n")
            .filter((line) => line.startsWith("0:"))
            .map((line) => {
              try {
                return JSON.parse(line.slice(2));
              } catch {
                return "";
              }
            })
            .join("");

          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId ? { ...m, content: m.content + textChunk } : m
            )
          );
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[600px] max-w-3xl mx-auto border border-zinc-800 rounded-xl overflow-hidden bg-[#121212] shadow-2xl">
      <div className="flex overflow-x-auto bg-[#1a1a1a] border-b border-zinc-800 p-2 scrollbar-hide">
        {NICHES.map((niche) => {
          const Icon = niche.icon;
          const isActive = activeNiche.id === niche.id;
          return (
            <button
              key={niche.id}
              onClick={() => handleNicheChange(niche)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? "bg-sky-500/10 text-sky-400"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              }`}
            >
              <Icon className="w-4 h-4" />
              {niche.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                m.role === "user"
                  ? "bg-sky-600 text-white rounded-br-none"
                  : "bg-zinc-800 text-zinc-200 rounded-bl-none"
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{m.content}</p>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-zinc-800 text-zinc-200 rounded-2xl rounded-bl-none px-4 py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          </div>
        )}
      </div>

      {rateLimited && (
        <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/20 text-red-400 text-xs text-center">{t("Você atingiu o limite de mensagens para esta demonstração. Crie sua conta para testar mais!")}</div>
      )}
      {!rateLimited && (
        <div className="px-4 py-1.5 bg-[#1a1a1a] border-t border-zinc-800 text-zinc-500 text-xs text-center">{t("Ambiente de Sandbox - As mensagens não são salvas no sistema.")}</div>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 p-4 bg-[#1a1a1a] border-t border-zinc-800"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading || rateLimited}
          placeholder={rateLimited ? "Limite atingido" : "Digite sua mensagem..."}
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-2 text-sm text-zinc-200 focus:outline-hidden focus:border-sky-500 transition-colors disabled:opacity-50"
        />
        <Button
          type="submit"
          disabled={isLoading || !input.trim() || rateLimited}
          size="icon"
          className="rounded-full bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}
