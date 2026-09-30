/**
 * ATENDIMENTO MANUAL PELO CANAL — o dono pegou o celular e respondeu o cliente
 * direto no WhatsApp (ou por outra plataforma ligada à mesma conta). A IA para
 * NESSA conversa, para não responder junto — e volta sozinha quando o prazo
 * vence.
 *
 * ## Por que existe
 *
 * `app/api/v1/messages/_handler.ts` (composer) já silencia o bot quando o ATOR é
 * uma pessoa — mas por uma janela deslizante de 5 min. O envio feito do celular
 * do operador NÃO passa por ali: ele entra pela ingestão de saída do canal (o
 * caminho `fromMe` do webhook, mensagem enviada fora do CRM) e era gravado como
 * histórico sem tocar em trava nenhuma. Resultado: a IA continuava respondendo
 * por cima de quem estava atendendo à mão.
 *
 * A lacuna foi medida em produção: um humano negociou preço e
 * pagamento de peça direto no WhatsApp, e a IA, sem saber disso, se meteu de
 * volta na conversa afirmando que "os dados do PIX estão sendo confirmados" —
 * algo que ela não tem nenhuma ferramenta para saber.
 *
 * ## O prazo, e por que o padrão é 60 minutos
 *
 * O silêncio EXPIRA sozinho. Não é `'infinity'`: `'infinity'` é o handoff
 * FORMAL, aquele em que alguém clicou "assumir" na tela e assumiu junto a
 * responsabilidade de devolver. Aqui ninguém clicou em nada — a pessoa só
 * respondeu uma mensagem pelo celular. Silêncio durável nesse gesto significa
 * que um "oi" do próprio dono testando o número desliga o atendimento
 * automático daquela conversa para sempre, e ninguém fica sabendo: a conversa
 * some do robô sem aparecer para nenhum humano.
 *
 * 60 minutos porque é a ordem de grandeza de um atendimento humano de verdade
 * — quem parou para responder pelo celular termina o assunto dentro da hora —,
 * é muito mais que a janela de 5 min do composer (que cobre só o tempo de
 * digitar dentro do CRM) e é curto o bastante para que um engano se pague
 * sozinho no mesmo turno de trabalho, em vez de virar uma conversa morta.
 *
 * ## O prazo é configurável por instalação — `ATENDIMENTO_MANUAL_SILENCIO_MIN`
 *
 * O raciocínio acima vale para o caso que ele mediu, mas ele mediu UM caso: o
 * dono que responde pelo celular de vez em quando e fecha o assunto. Quem
 * atende o dia INTEIRO pelo celular tem um outro shape — e é o caso mais comum
 * de consultório e clínica, onde uma pessoa atende, atende e atende.
 *
 * Medido numa instalação real (2026-09-30): com 60 min, a IA não respondia
 * NENHUMA mensagem de paciente ao longo do expediente. Não era falha do agente,
 * do funil nem do modelo — a atendente renovava o prazo a cada fala, e o dia
 * inteiro de atendimento manual é, na prática, silêncio de 60 min sem fim. O
 * sintoma é o pior possível de diagnosticar: o agente está publicado, o canal
 * está de pé, e os logs dizem "turno pulado (sem gasto)", `motivo:
 * "conversa_silenciada"` — que parece exatamente uma pausa correta.
 *
 * Por isso o prazo virou env, com o 60 de antes como PADRÃO: quem não setar
 * nada continua com o comportamento medido e documentado acima, sem nenhuma
 * mudança. Quem atende o dia inteiro pelo celular reduz o prazo para a janela
 * em que quer devolver a conversa à IA (15 min, no caso medido, dão para
 * fechar uma resposta e devolver antes de a conversa esfriar).
 *
 * `ATENDIMENTO_MANUAL_SILENCIO_MIN` em MINUTOS, para quem opera não fazer
 * conta de milissegundo. Aceita inteiro ou decimal. Ausente, vazio, zero,
 * negativo ou não-número cai no padrão de 60 — o mesmo desenho de "campo
 * vazio mantém o ritmo de antes" que a proteção de envio ganhou no #1996.
 *
 * ⚠️ Quem quiser outro prazo mexe AQUI, num lugar só: a constante é lida por
 * TODO canal cuja ingestão reconhece saída feita fora do CRM, e pelo teste.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { normalizarInstante } from "@/lib/ai/elegibilidade/gate";

/** O prazo documentado acima, e o que volta quando o knob não diz nada. */
const PRAZO_PADRAO_MIN = 60;

/**
 * Quanto tempo a IA fica calada depois de uma resposta manual pelo canal.
 * Ver "O prazo, e por que o padrão é 60 minutos" na docstring do módulo.
 *
 * Lê `ATENDIMENTO_MANUAL_SILENCIO_MIN` (minutos). O fallback é o PRIMEIRO
 * motivo de nunca quebrar quem não configurou: `prazoDoSilencioMs()` é
 * chamado dentro do caminho de ingestão, e uma instalação com env inválido
 * precisa silenciar a IA do mesmo jeito que silenciava antes — um
 * `Number.parseInt` que devolvesse `NaN` faria `bot_silenced_until` virar uma
 * data inválida, ou pior, `NaN` de volta para o banco, e o efeito seria a IA
 * falando por cima do humano, que é o defeito que este módulo existe para
 * não ter. Então: valor não_numérico, vazio, zero ou negativo é o padrão.
 */
function prazoDoSilencioMs(): number {
  const bruto = process.env.ATENDIMENTO_MANUAL_SILENCIO_MIN;
  if (bruto == null || bruto.trim() === "") return PRAZO_PADRAO_MIN * 60_000;
  const min = Number(bruto);
  if (!Number.isFinite(min) || min <= 0) return PRAZO_PADRAO_MIN * 60_000;
  return min * 60_000;
}

export const PRAZO_DO_SILENCIO_MS = prazoDoSilencioMs();

/** Motivo gravado quando uma pessoa responde pelo canal, fora do CRM. */
export const MOTIVO_ATENDIMENTO_MANUAL = "Atendimento manual pelo canal (resposta fora do CRM)";

/**
 * Motivo gravado quando o operador manda `#off` do celular. Separado do motivo
 * acima de propósito: a tela e a trilha precisam distinguir "alguém respondeu à
 * mão" de "alguém desligou o automático com o comando".
 */
export const MOTIVO_COMANDO_OFF = "Comando #off enviado pelo celular";

export interface PausaPorAtendimentoManualInput {
  organizationId: string;
  conversationId: string;
  /** Rótulo da origem do evento, só para log (o adapter que chamou se identifica). */
  canal?: string;
  /** Texto gravado em `last_handoff_reason`. Default = `MOTIVO_ATENDIMENTO_MANUAL`. */
  motivo?: string;
  /**
   * `true` grava `'infinity'` (só `#on` pelo celular ou "devolver ao automático"
   * na tela religam) em vez do prazo. Só vale para o agente que ligou "Comandos
   * pelo celular" (`ai_agents.config.aceita_comandos_celular`): sem o `#on` à
   * mão, silêncio durável por um "oi" no celular seria a conversa morta que a
   * docstring deste módulo descreve.
   */
  duravel?: boolean;
  /**
   * O instante da fala humana. INJECTADO para o teste não depender do relógio
   * real: o `now()` do banco e o `Date.now()` do processo são dois relógios, e
   * comparar um com o outro produz falha intermitente. Default = agora.
   */
  agora?: Date;
}

/**
 * Pausa a IA numa conversa porque uma pessoa respondeu por fora do CRM, por
 * `PRAZO_DO_SILENCIO_MS` a contar de `agora`. Devolve `true` se gravou (pausa
 * nova ou prazo renovado), `false` se havia silêncio mais longo em vigor ou se
 * falhou.
 */
export async function pausarIaPorAtendimentoManual(
  admin: SupabaseClient,
  input: PausaPorAtendimentoManualInput,
): Promise<boolean> {
  const agora = input.agora ?? new Date();
  const propostoMs = input.duravel
    ? Number.POSITIVE_INFINITY
    : agora.getTime() + PRAZO_DO_SILENCIO_MS;
  const gravado = input.duravel ? "infinity" : new Date(propostoMs).toISOString();
  const motivo = input.motivo ?? MOTIVO_ATENDIMENTO_MANUAL;

  try {
    const { data: atual, error: readErr } = await admin
      .from("conversations")
      .select("bot_silenced_until")
      .eq("organization_id", input.organizationId)
      .eq("id", input.conversationId)
      .maybeSingle();

    if (readErr) {
      logger.warn("[atendimento-manual] leitura da conversa falhou — IA não pausada", {
        organization_id: input.organizationId,
        conversation_id: input.conversationId,
        detail: readErr.message.slice(0, 160),
      });
      return false;
    }
    if (atual == null) return false;

    // NUNCA encurta um silêncio maior já em vigor. `Infinity` (handoff formal)
    // vence qualquer prazo finito; uma janela mais longa que a nossa também.
    // Instante ilegível vira `null` e é tratado como "sem silêncio" — a leitura
    // conservadora seria não pausar, e ela deixaria a IA falando por cima do
    // humano, que é o defeito que este módulo existe para não ter.
    const silenciadaAte = normalizarInstante(
      (atual as { bot_silenced_until: string | null }).bot_silenced_until,
    );
    const atualMs =
      silenciadaAte === null
        ? Number.NEGATIVE_INFINITY
        : silenciadaAte instanceof Date
          ? silenciadaAte.getTime()
          : silenciadaAte;
    if (atualMs >= propostoMs) return false;

    const { error: updErr } = await admin
      .from("conversations")
      .update({
        bot_silenced_until: gravado,
        last_handoff_at: agora.toISOString(),
        last_handoff_reason: motivo,
      })
      .eq("organization_id", input.organizationId)
      .eq("id", input.conversationId);

    if (updErr) {
      logger.warn("[atendimento-manual] pausa da IA não gravada", {
        organization_id: input.organizationId,
        conversation_id: input.conversationId,
        detail: updErr.message.slice(0, 160),
      });
      return false;
    }

    logger.info("[atendimento-manual] IA pausada — pessoa respondeu pelo canal", {
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      canal: input.canal ?? "desconhecido",
      silenciada_ate: gravado,
      motivo,
    });
    return true;
  } catch (err) {
    logger.warn("[atendimento-manual] pausa da IA lançou", {
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      detail: err instanceof Error ? err.message.slice(0, 160) : "erro",
    });
    return false;
  }
}

/**
 * Pausa DURÁVEL (`'infinity'`) — o `#off` do celular, e a resposta manual de quem
 * ligou "Comandos pelo celular". A regra é a mesma de cima; só o prazo muda.
 */
export async function pausarIaDuravelmente(
  admin: SupabaseClient,
  input: Omit<PausarIaPorAtendimentoManualInput, "duravel">,
): Promise<boolean> {
  return pausarIaPorAtendimentoManual(admin, { ...input, duravel: true });
}
