/**
 * GET /api/v1/lgpd/requests
 *
 * Lista paginada de lgpd_requests para o tenant ativo.
 * Apenas role >= admin pode acessar (lgpd:execute permission).
 * organization_id sempre resolvido de sessão confiável — nunca do body.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { diasAtePrazo, diasDeAtraso } from "@/lib/lgpd/sla";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z
    .enum(["received", "processing", "completed", "failed", "pending_review"])
    .optional(),
  type: z
    .enum(["redact", "data_request", "store_redact"])
    .optional(),
  sla_bucket: z.enum(["overdue", "critical", "warning", "ok"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

type SlaBucket = "overdue" | "critical" | "warning" | "ok";

/**
 * O balde de SLA da linha — em DIAS CIVIS, não em milissegundos.
 *
 * `due_at` guarda a meia-noite UTC do dia útil contado e o prazo vai até o FIM
 * desse dia (contrato em `lib/lgpd/sla.ts`). Comparar instantes punha o balde
 * `overdue` aceso 27 horas antes do prazo numa instalação brasileira: às 21h do
 * dia anterior ao prazo, a meia-noite UTC já tinha passado, e a linha dizia
 * "Vencido" para um prazo que só terminava no dia seguinte.
 *
 * `critical` é a mesma régua a menos de dois dias: `diasAtePrazo` vale 0 no dia
 * do prazo e 1 no dia anterior — os dois são "menos de dois dias".
 */
function computeSlaBucket(dueAt: string | null, receivedAt: string): SlaBucket {
  if (!dueAt) return "ok";
  const now = new Date();
  if (diasDeAtraso(dueAt, now) > 0) return "overdue";
  const restantes = diasAtePrazo(dueAt, now);
  if (restantes <= 1) return "critical";

  const totalWindow = new Date(dueAt).getTime() - new Date(receivedAt).getTime();
  const ateFimDaJanela = new Date(dueAt).getTime() - now.getTime();
  if (totalWindow > 0 && ateFimDaJanela < totalWindow * 0.5) return "warning";
  return "ok";
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("admin", {
    requestId,
    resource: "lgpd_requests",
    allowPlatformAdmin: "leitura",
    permiteOrgSuspensa: true,
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { org: activeOrg } = authz;

  const supabase = await createClient();

  // Parse + validate query params
  const rawParams: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    rawParams[k] = v;
  });
  const parsed = querySchema.safeParse(rawParams);
  if (!parsed.success) {
    return fail("validation_failed", t("Parâmetros inválidos."), 422, {
      details: parsed.error.flatten(),
      requestId,
    });
  }
  const { status, type, page, limit } = parsed.data;

  const orgId = activeOrg.orgId;
  const offset = (page - 1) * limit;

  // Count query (before sla_bucket filter which is client-side)
  let countQuery = supabase
    .from("lgpd_requests")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId);
  if (status) countQuery = countQuery.eq("status", status);
  if (type) countQuery = countQuery.eq("request_type", type);
  const { count } = await countQuery;
  const total = count ?? 0;

  // Data query
  let dataQuery = supabase
    .from("lgpd_requests")
    .select(
      "id, organization_id, request_type, source, contact_id, external_customer_id, status, attempts, received_at, due_at, completed_at, emergency, scope, error_message",
    )
    .eq("organization_id", orgId)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("received_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) dataQuery = dataQuery.eq("status", status);
  if (type) dataQuery = dataQuery.eq("request_type", type);

  const { data: rows, error: dbErr } = await dataQuery;
  if (dbErr) {
    return fail("internal_error", dbErr.message, 500, { requestId });
  }

  // Compute sla_bucket per row and apply optional filter
  const enriched = (rows ?? []).map((r) => ({
    ...r,
    sla_bucket: computeSlaBucket(r.due_at, r.received_at),
  }));

  const filtered = parsed.data.sla_bucket
    ? enriched.filter((r) => r.sla_bucket === parsed.data.sla_bucket)
    : enriched;

  return ok(filtered, {
    requestId,
    meta: {
      total,
      page,
      limit,
      has_more: offset + limit < total,
    },
  });
}
