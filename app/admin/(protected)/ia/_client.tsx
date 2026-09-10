"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  deletePlatformAiCredential,
} from "@/app/actions/settings/deletePlatformAiCredential";
import {
  syncAllCatalogs,
} from "@/app/actions/settings/syncAllCatalogs";
import {
  updatePlatformAiCredential,
} from "@/app/actions/settings/updatePlatformAiCredential";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import type { PlatformAiCredentialSafe } from "@/lib/ai/credenciais/plataforma";
import type { Provider } from "@/lib/ai/provider-validators";
import { Brain, CheckCircle, Warning, Trash, ArrowsClockwise } from "@/lib/ui/icons";

interface Props {
  credenciaisIniciais: PlatformAiCredentialSafe[];
  envChaves: Record<string, boolean>;
  idioma: string;
}

interface ProviderMeta {
  id: Provider;
  nome: string;
  descricao: string;
  placeholder: string;
  documentacaoUrl: string;
}

const PROVEDORES_INFO: ProviderMeta[] = [
  {
    id: "anthropic",
    nome: "Anthropic",
    descricao: "Família Claude 3.5 (Sonnet, Haiku, Opus). Alta capacidade para raciocínio, vendas e suporte humanizado.",
    placeholder: "sk-ant-api03-...",
    documentacaoUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openai",
    nome: "OpenAI",
    descricao: "Modelos GPT-4o, GPT-4o mini, séries o1 e Whisper para transcrição de áudios no WhatsApp.",
    placeholder: "sk-proj-...",
    documentacaoUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "google",
    nome: "Google Gemini",
    descricao: "Modelos Gemini 1.5 Pro, Flash e 2.0. Excelente custo-benefício e janela de contexto estendida.",
    placeholder: "AIzaSy...",
    documentacaoUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    id: "openrouter",
    nome: "OpenRouter",
    descricao: "Acesso unificado a centenas de modelos abertos e proprietários (DeepSeek R1/V3, Llama 3.3, Qwen, etc.).",
    placeholder: "sk-or-v1-...",
    documentacaoUrl: "https://openrouter.ai/keys",
  },
];

export function IaPlatformClient({ credenciaisIniciais, envChaves }: Props) {
  const t = useT();
  const router = useRouter();
  const [salvandoProvider, setSalvandoProvider] = useState<Provider | null>(null);
  const [sincronizandoTodos, setSincronizandoTodos] = useState(false);
  const [chavesInput, setChavesInput] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  const credenciaisPorProvider = new Map<Provider, PlatformAiCredentialSafe>(
    credenciaisIniciais.map((c) => [c.provider, c]),
  );

  const handleSincronizarTodos = () => {
    setSincronizandoTodos(true);
    startTransition(async () => {
      try {
        const res = await syncAllCatalogs();
        if (res.ok) {
          let detalhes = "";
          for (const [provider, r] of Object.entries(res.resumo)) {
            if (r.ok) detalhes += `${provider}: ${r.gravados} gravados. `;
          }
          toast.success(
            `${t("Catálogos sincronizados com sucesso!")} ${detalhes}`,
          );
          router.refresh();
        } else {
          toast.error(res.message || t("Erro ao sincronizar catálogos."));
        }
      } catch {
        toast.error(t("Falha ao se comunicar com os provedores."));
      } finally {
        setSincronizandoTodos(false);
      }
    });
  };

  const handleSalvar = (provider: Provider, isActiveDefault = true) => {
    const credAtual = credenciaisPorProvider.get(provider);
    const keyDigitada = (chavesInput[provider] ?? "").trim();

    if (!keyDigitada && !credAtual) {
      toast.error(t("Por favor, insira uma chave de API válida para o provedor."));
      return;
    }

    if (!keyDigitada && credAtual) {
      toast.info(t("Nenhuma alteração de chave digitada para este provedor."));
      return;
    }

    setSalvandoProvider(provider);
    startTransition(async () => {
      try {
        const res = await updatePlatformAiCredential({
          provider,
          apiKey: keyDigitada,
          isActive: credAtual ? credAtual.is_active : isActiveDefault,
        });

        if (!res.ok) {
          toast.error(res.error || t("Falha ao salvar credencial."));
        } else {
          toast.success(
            `${t("Credencial salva e validada com sucesso!")} (${res.models.length} ${t("modelos identificados")})`,
          );
          setChavesInput((prev) => ({ ...prev, [provider]: "" }));
          router.refresh();
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("Erro inesperado ao salvar."));
      } finally {
        setSalvandoProvider(null);
      }
    });
  };

  const handleToggleAtivo = (provider: Provider, novoStatus: boolean) => {
    const credAtual = credenciaisPorProvider.get(provider);
    if (!credAtual) return;

    setSalvandoProvider(provider);
    startTransition(async () => {
      try {
        // Se não digitou chave nova, a action de update exige apiKey.
        // Se a chave já existe, chamamos com a flag atualizada apenas se tivermos o fluxo ou salvamos
        // Para alternar o toggle sem re-digitar a chave:
        toast.info(t("Para alterar o status, confirme informando a nova chave ou salvando as alterações."));
      } finally {
        setSalvandoProvider(null);
      }
    });
  };

  const handleRemover = (provider: Provider) => {
    if (!confirm(t("Tem certeza que deseja remover a credencial deste provedor da plataforma?"))) {
      return;
    }

    setSalvandoProvider(provider);
    startTransition(async () => {
      try {
        const res = await deletePlatformAiCredential({ provider });
        if (!res.ok) {
          toast.error(res.error || t("Falha ao remover credencial."));
        } else {
          toast.success(t("Credencial removida com sucesso."));
          router.refresh();
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("Erro inesperado ao remover."));
      } finally {
        setSalvandoProvider(null);
      }
    });
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Brain size={28} className="text-accent" />
              <h1 className="text-2xl font-semibold tracking-tight">
                {t("Provedores de Inteligência Artificial")}
              </h1>
            </div>
            <p className="text-sm text-muted-foreground">
              {t(
                "Configure as chaves de API globais dos provedores de IA para toda a plataforma SaaS. As credenciais configuradas aqui serão utilizadas automaticamente por todos os assinantes e agentes, eliminando a necessidade de cada cliente cadastrar suas próprias chaves.",
              )}
            </p>
          </div>
          <Button
            onClick={handleSincronizarTodos}
            disabled={sincronizandoTodos}
            className="shrink-0"
          >
            <ArrowsClockwise
              size={18}
              className={`mr-2 ${sincronizandoTodos ? "animate-spin" : ""}`}
            />
            {sincronizandoTodos ? t("Sincronizando...") : t("Sincronizar Todos os Modelos")}
          </Button>
        </div>
      </header>

      <div className="grid gap-6">
        {PROVEDORES_INFO.map((prov) => {
          const cred = credenciaisPorProvider.get(prov.id);
          const temNoEnv = Boolean(envChaves[prov.id]);
          const estaSalvando = salvandoProvider === prov.id;
          const valorInput = chavesInput[prov.id] ?? "";

          return (
            <Card key={prov.id} className="flex flex-col gap-4 p-5 transition-shadow hover:shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-4">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-medium">{prov.nome}</span>
                    {cred ? (
                      <Badge variant={cred.is_active ? "success" : "neutral"}>
                        {cred.is_active ? t("Ativa na Plataforma") : t("Desativada")}
                      </Badge>
                    ) : temNoEnv ? (
                      <Badge variant="info">{t("Ativa via .env (Fallback)")}</Badge>
                    ) : (
                      <Badge variant="neutral">{t("Não configurada")}</Badge>
                    )}

                    {cred?.validated_at ? (
                      <span className="flex items-center gap-1 text-xs text-success-fg">
                        <CheckCircle size={14} />
                        {t("Validada")}
                      </span>
                    ) : cred?.validation_error ? (
                      <span className="flex items-center gap-1 text-xs text-error-fg" title={cred.validation_error}>
                        <Warning size={14} />
                        {t("Erro de validação")}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{prov.descricao}</p>
                </div>

                {cred && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-error hover:bg-error-bg hover:text-error-fg"
                    disabled={estaSalvando}
                    onClick={() => handleRemover(prov.id)}
                  >
                    <Trash size={16} className="mr-1" />
                    {t("Remover")}
                  </Button>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`key-${prov.id}`} className="text-xs font-medium">
                      {cred ? t("Substituir Chave de API") : t("Chave de API do Provedor")}
                    </Label>
                    <a
                      href={prov.documentacaoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-accent hover:underline"
                    >
                      {`${t("Obter chave no painel")} ${prov.nome}`}
                    </a>
                  </div>
                  <Input
                    id={`key-${prov.id}`}
                    type="password"
                    placeholder={
                      cred
                        ? `•••••••••••••••••••••••• (terminada em ${cred.api_key_last4})`
                        : prov.placeholder
                    }
                    value={valorInput}
                    onChange={(e) =>
                      setChavesInput((prev) => ({ ...prev, [prov.id]: e.target.value }))
                    }
                    disabled={estaSalvando}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {cred
                      ? t("Chave salva com criptografia militar AES-256-GCM. Digite apenas se desejar substituí-la.")
                      : t("A chave será testada e salva criptografada. Nunca é exposta na interface nem para assinantes.")}
                  </p>
                </div>

                {cred && cred.models_available && cred.models_available.length > 0 && (
                  <div className="rounded-md bg-muted/40 p-2.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {`${t("Modelos ativos detectados")} (${cred.models_available.length}):`}{" "}
                    </span>
                    <span className="line-clamp-2">
                      {cred.models_available.slice(0, 10).join(", ")}
                      {cred.models_available.length > 10 ? ` e mais ${cred.models_available.length - 10}...` : ""}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button
                    size="sm"
                    disabled={estaSalvando || !valorInput.trim()}
                    onClick={() => handleSalvar(prov.id)}
                  >
                    {estaSalvando ? (
                      <>
                        <ArrowsClockwise size={16} className="mr-1 animate-spin" />
                        {t("Validando e Salvando...")}
                      </>
                    ) : (
                      t("Validar e Salvar")
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
