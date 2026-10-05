/**
 * O ART. 15.º DO RGPD NO DOCUMENTO DE ACESSO — as alíneas que o relatório tem
 * de entregar, e de onde vem cada valor (issue #2340, continuação do doc 88).
 *
 * ─── O que o art. 15.º, n.º 1 pede ──────────────────────────────────────────
 *
 *   a) finalidades do tratamento .................. preenche o RESPONSÁVEL
 *   b) categorias de dados ....................... já sai no corpo do relatório
 *   c) destinatários ............................. preenche o RESPONSÁVEL
 *   d) prazo de conservação ...................... preenche o RESPONSÁVEL
 *   e) direitos de retificação, apagamento e oposição ... texto fixo da lei
 *   f) reclamação a uma autoridade de supervisão .. vem do PERFIL do país
 *   g) origem dos dados ......................... seção "Como seus dados
 *                                                  chegaram até nós"
 *   h) decisões automatizadas .................... os agentes de IA da org
 *
 * `b)` e `g)` ficaram de fora de propósito: o relatório já os entrega em outro
 * lugar. Este módulo é só a parte que faltava — a issue #2340 é a pré-condição
 * travada por `tests/unit/so-a-nuvemshop-cria-pedido-de-titular`.
 *
 * ─── Por que `settings.art15`, e não três colunas ────────────────────────────
 *
 * São textos de UM documento, preenchidos por quem responde por ele, sem tipo
 * e sem índice: um mapa em `organizations.settings` (jsonb, o mesmo lugar de
 * `settings.routing` e `settings.visibility_mode`) não custa migration nem
 * coluna nova, e quem já grava settings não ganha coluna para esquecer. O
 * schema Zod abaixo é a regra em um lugar só, como `routingConfigSchema`.
 *
 * Ausente o preenchimento o valor é `null` — e o relatório imprime "não
 * informado pelo controlador". Mentir numa alínea que a lei exige é pior do
 * que entregar a linha vazia: o titular vê que falta e o responsável vê o que
 * tem de preencher.
 */
import { z } from "zod";

/**
 * `organizations.settings.art15` — só as alíneas que o responsável preenche.
 * String vazia ou só espaço vira `null` (`trim`): campo com espaço não é
 * preenchimento.
 */
export const art15SettingsSchema = z.object({
  finalidades: z.string().trim().max(2000).nullish(),
  destinatarios: z.string().trim().max(2000).nullish(),
  prazo_conservacao: z.string().trim().max(500).nullish(),
});

export type Art15Settings = z.infer<typeof art15SettingsSchema>;

/** O que o responsável preencheu, com `null` onde não preencheu. */
export interface Art15DoControlador {
  finalidades: string | null;
  destinatarios: string | null;
  prazo_conservacao: string | null;
}

const VAZIO: Art15DoControlador = {
  finalidades: null,
  destinatarios: null,
  prazo_conservacao: null,
};

/**
 * Lê `organizations.settings.art15`. NUNCA lança: settings corrompido, string
 * no lugar de objeto ou valor fora do schema devolve o bloco vazio — o
 * documento sai com "não informado pelo controlador" em vez de derrubar um
 * export que já percorreu vinte tabelas (doutrina do `lerControlador`).
 */
export function art15DoControlador(settings: unknown): Art15DoControlador {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return VAZIO;
  const bruto = (settings as Record<string, unknown>).art15;
  const parse = art15SettingsSchema.safeParse(bruto);
  if (!parse.success) return VAZIO;
  return {
    finalidades: parse.data.finalidades || null,
    destinatarios: parse.data.destinatarios || null,
    prazo_conservacao: parse.data.prazo_conservacao || null,
  };
}

/** O que o relatório imprime onde o responsável deixou a alínea em branco. */
export const NAO_INFORMADO_PELO_CONTROLADOR = "não informado pelo controlador";

/**
 * Alínea e) — o texto da lei, o mesmo para todo país que cita o art. 15.º.
 * Art. 15.º, n.º 1, al. e) do RGPD: direito de retificação (art. 16.º), de
 * apagamento (art. 17.º), de limitação do tratamento (art. 18.º) e de oposição
 * (art. 21.º), que este relatório acaba de exercer.
 */
export const DIREITOS_DA_ALINEA_E =
  "Direito de requerer ao responsável a retificação ou o apagamento dos seus dados " +
  "pessoais e a limitação do tratamento que lhe diz respeito, bem como o direito de " +
  "se opor a esse tratamento (artigos 16.º, 17.º, 18.º e 21.º do RGPD).";

/**
 * A linha do n.º 3 que o relatório promete e que o worker cumpre: o `data.json`
 * sobe junto do `report.pdf` no mesmo diretório do bucket
 * (`workers/lgpd-export-worker.ts`), com TODAS as mensagens — ver
 * `messages_completas` em `lib/lgpd/export-collector.ts`.
 */
export const COPIA_COMPLETA_DO_NUMERO_3 =
  "Cópia completa dos seus dados pessoais em curso de tratamento, em formato " +
  "estruturado, de uso corrente e legível por máquina, no arquivo data.json que " +
  "acompanha este relatório (art. 15.º, n.º 3).";
