import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { MINIMO_DE_CASOS, calcularTaxas, type Janela } from "@/lib/metrics/taxa-da-etapa";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/v1/pipelines/[id]/stages/win-rates — a taxa histórica de ganho de
 * CADA etapa, com a amostra junto (issue #1753).
 *
 * Só LEITURA, e isso é o ponto da proposta: `crm_stages.win_probability` nasce
 * vazio e o gestor precisa chutar «em Proposta fechamos 40%», quando o sistema
 * já sabe a resposta — é contar quantos dos que passaram por aquela etapa foram
 * ganhos. Aqui a conta chega à tela; quem ACEITA o número é quem opera, pelo
 * caminho de edição de etapa que já existe (`PATCH …/stages/{stageId}`). Nada
 * grava sozinho, nada toca `crm_lead_scores` — o mesmo «gate humano nas
 * decisões que importam» de `VISION.md`, e o mesmo argumento de
 * `lib/leads/score-formula.ts` (fórmula que um humano pode contestar parcela a
 * parcela, não um oráculo).
 *
 * Auth: sessão por cookie, papel manager+ (é configuração do funil). O
 * `organization_id` sai do JWT, nunca da query string, e viaja nos DOIS SELECT
 * — o filtro explícito é a convenção do repo e a rede que sobra se a policy
 * mudar.
 *
 * A janela é declarada NA RESPOSTA (`inicio`, `fim`, `dias`): a doutrina do
 * sistema vivo não publica medida sem a amostra, e sem o período o «39%» seria
 * um número que ninguém consegue contestar.
 */
export const dynamic = "force-dynamic";

/** Padrão da issue: «nos últimos 12 meses». */
const PADRAO_DIAS = 365;
const DIAS_MAXIMOS = 3650;

/**
 * Teto da leitura. `crm_lead_activities` é a tabela mais quente do produto e a
 * janela pode ter mais linhas que isto num funil ativo — daí a resposta trazer
 * `truncado`, para a tela avisar que a contagem é uma AMOSTRA e não o
 * histórico inteiro. Medida pela metade e silenciosa seria pior que medida
 * nenhuma.
 */
const LIMITE_DE_ATIVIDADES = 10000;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "pipeline_stages" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;

  const bruto = Number(req.nextUrl.searchParams.get("dias"));
  const dias = Number.isInteger(bruto) && bruto >= 1 && bruto <= DIAS_MAXIMOS ? bruto : PADRAO_DIAS;
  const agora = new Date();
  const inicio = new Date(agora.getTime() - dias * 86400000);
  const janela: Janela = { inicio: inicio.toISOString(), fim: agora.toISOString() };

  const supabase = await createClient();

  // As etapas do funil trazem os DOIS papéis: é sabendo qual é a de ganho e
  // qual é a de perda que a conta decide o que é «encerrado».
  const { data: etapas, error: erroEtapas } = await supabase
    .from("crm_stages")
    .select("id, is_won, is_lost, position")
    .eq("organization_id", authz.org.orgId)
    .eq("pipeline_id", id)
    .eq("is_archived", false)
    .order("position", { ascending: true });
  if (erroEtapas) return fail("internal_error", t("Falha ao listar etapas."), 500, { requestId });

  // UMA leitura por página, indexada por `idx_lead_activities_org_type_perf`
  // (organization_id, type, performed_at). Nenhuma tabela nova, nenhum índice
  // novo — a fatia desta issue era exatamente não tocar no banco.
  const { data: atividades, error: erroAtividades } = await supabase
    .from("crm_lead_activities")
    .select("lead_id, payload, performed_at")
    .eq("organization_id", authz.org.orgId)
    .eq("type", "stage_changed")
    .gte("performed_at", janela.inicio)
    .lte("performed_at", janela.fim)
    .limit(LIMITE_DE_ATIVIDADES);
  if (erroAtividades) {
    return fail("internal_error", t("Falha ao ler o histórico de etapas."), 500, { requestId });
  }

  const linhas = atividades ?? [];
  return ok(
    {
      inicio: janela.inicio,
      fim: janela.fim,
      dias,
      truncado: linhas.length >= LIMITE_DE_ATIVIDADES,
      minimoDeCasos: MINIMO_DE_CASOS,
      taxas: calcularTaxas(linhas, etapas ?? [], janela),
    },
    { requestId },
  );
}
