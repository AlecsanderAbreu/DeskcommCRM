import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import { runFollowupTick, type FollowupJobRequest, type TickDeps } from "@/lib/followup/engine";
import { flowGraphSchema, type FlowGraph } from "@/lib/followup/graph-schema";
import { MAX_ACTION_RECHECKS } from "@/lib/followup/node-handlers";
import { completeTurnForEnrollment, createPgAdminClient } from "@/lib/followup/turn-bridge";

import { isolarFixtureDeFollowup } from "./followup-isolamento";
import { relogioAncoradoNoBanco } from "./followup-relogio";
import { criarOrigemDeFollowup } from "./followup-service-origin";

/**
 * O MOTOR DE FOLLOW-UP COM A ORGANIZAÇÃO SUSPENSA (migration 0496; spec cobrança
 * do revendedor §1.3 — nada que custe ou saia roda com a org suspensa, e a
 * reativação não é rajada).
 *
 * Antes: o claim (`fn_claim_due_followup_enrollments`) não olhava
 * `organizations.status`. A org suspensa seguia avançando fluxos e enfileirando
 * turnos; o anti-backlog falhava o turno `pending` de uma inscrição parada num nó
 * `action`, e depois da reativação os rechecks retomavam até
 * `MAX_ACTION_RECHECKS`, que marcava `dead` com `action_turn_never_completed` e
 * abria `followup_dead` na Central com um motivo falso.
 *
 * Decisão do controlador: na reativação, a inscrição RETOMA — o claim faz rodízio
 * por organização com `p_limit` e o envio tem throttle, então não há rajada.
 *
 * Roda com o adaptador `pg` de produção (`createPgAdminClient`, o do worker) e
 * com o `enqueueJob` gravando o turno de verdade em `job_queue`, para a suspensão
 * alcançá-lo.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 4,
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await isolarFixtureDeFollowup(pool);
});

const ORG_SUSPENSA = "c0de0496-f011-4000-8000-00000000000a";
const ORG_ATIVA = "c0de0496-f011-4000-8000-00000000000b";

const TRIGGER_END: FlowGraph = flowGraphSchema.parse({
  nodes: [
    { id: "t1", type: "trigger", label: "Start", position: { x: 0, y: 0 }, config: {} },
    { id: "e1", type: "end", label: "Done", position: { x: 0, y: 0 }, config: { outcome: "converted" } },
  ],
  edges: [{ id: "t1-e1", source: "t1", target: "e1", priority: 0, condition: { type: "always" } }],
});

const ACTION_END: FlowGraph = flowGraphSchema.parse({
  nodes: [
    {
      id: "a1",
      type: "action",
      label: "Send",
      position: { x: 0, y: 0 },
      config: { mode: "ai_message", prompt_hint: "lembre o lead da proposta" },
    },
    { id: "e1", type: "end", label: "Done", position: { x: 0, y: 0 }, config: { outcome: "converted" } },
  ],
  edges: [{ id: "a1-e1", source: "a1", target: "e1", priority: 0, condition: { type: "always" } }],
});

async function seedOrg(org: string): Promise<void> {
  const nome = `followup-org-suspensa-${org.slice(-2)}`;
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name) values ($1, $2, $3, $4) on conflict (id) do nothing`,
    [org, nome, nome, nome],
  );
  // Cada teste parte da org ativa (a suspensão vem pela função de estado).
  await pool.query(
    `update organizations set status = 'active', suspended_kind = null, suspended_at = null,
       suspended_reason = null, suspended_by = null where id = $1`,
    [org],
  );
}

async function seedEnrollment(org: string, graph: FlowGraph, noAtual: string): Promise<string> {
  const { rows: contatos } = await pool.query<{ id: string }>(
    `insert into contacts (organization_id, display_name) values ($1, 'Contato do follow-up') returning id`,
    [org],
  );
  const contato = contatos[0]!.id;
  const { rows: versoes } = await pool.query<{ id: string }>(
    `insert into followup_flow_versions (organization_id, graph) values ($1, $2) returning id`,
    [org, JSON.stringify(graph)],
  );
  const { rows: ponteiros } = await pool.query<{ id: string }>(
    `insert into followup_flow_pointers (organization_id, name, status, active_version_id)
     values ($1, $2, 'active', $3) returning id`,
    [org, `Fluxo ${Date.now()}-${Math.random()}`, versoes[0]!.id],
  );
  const fronteira = await criarOrigemDeFollowup(pool, org, contato);
  const { rows } = await pool.query<{ id: string }>(
    `insert into followup_enrollments
       (organization_id, pointer_id, version_id, contact_id, current_node_id, status, next_eval_at,
        conversation_id, service_boundary)
     values ($1, $2, $3, $4, $5, 'active', now() - interval '1 second', $6, $7::jsonb)
     returning id`,
    [org, ponteiros[0]!.id, versoes[0]!.id, contato, noAtual, fronteira.conversation_id, JSON.stringify(fronteira)],
  );
  return rows[0]!.id;
}

/** O turno vai para a fila de verdade — é ela que a suspensão esvazia. */
function deps(): TickDeps {
  return {
    db: createPgAdminClient(pool),
    clock: relogioAncoradoNoBanco(),
    enqueueJob: async (job: FollowupJobRequest) => {
      await pool.query(
        `insert into job_queue (organization_id, contact_id, kind, payload) values ($1, $2, 'followup_turn', $3)`,
        [job.organization_id, job.contact_id, job.payload],
      );
    },
  };
}

async function vencer(enrollmentId: string): Promise<void> {
  await pool.query(`update followup_enrollments set next_eval_at = now() - interval '1 second' where id = $1`, [
    enrollmentId,
  ]);
}

async function turnos(enrollmentId: string): Promise<string[]> {
  const { rows } = await pool.query<{ estado: string }>(
    `select status || coalesce('|' || last_error, '') as estado from job_queue
      where kind = 'followup_turn' and payload->>'followup_enrollment_id' = $1 order by created_at, id`,
    [enrollmentId],
  );
  return rows.map((r) => r.estado);
}

const suspender = (org: string) =>
  pool.query(`select public.fn_suspender_organizacao($1, 'administrativa', 'invariante 0496', null)`, [org]);
const reativar = (org: string) =>
  pool.query(`select public.fn_reativar_organizacao($1, 'administrativa', null)`, [org]);

describe("fn_claim_due_followup_enrollments × organização parada", () => {
  it("⭐ não devolve o vencido da org suspensa; devolve o da org ativa (controle)", async () => {
    await seedOrg(ORG_SUSPENSA);
    await seedOrg(ORG_ATIVA);
    const daSuspensa = await seedEnrollment(ORG_SUSPENSA, TRIGGER_END, "t1");
    const daAtiva = await seedEnrollment(ORG_ATIVA, TRIGGER_END, "t1");
    await suspender(ORG_SUSPENSA);

    const { rows } = await pool.query<{ id: string }>(`select id from fn_claim_due_followup_enrollments(50, 60)`);
    const reclamados = rows.map((r) => r.id);
    expect(reclamados).toContain(daAtiva);
    expect(reclamados).not.toContain(daSuspensa);

    // Nem o lease foi tocado: a inscrição da suspensa segue intacta para a reativação.
    const { rows: linha } = await pool.query(`select claimed_until, status from followup_enrollments where id = $1`, [
      daSuspensa,
    ]);
    expect(linha[0]).toMatchObject({ claimed_until: null, status: "active" });
  });
});

describe("suspender e reativar com a inscrição parada num nó action", () => {
  it("⭐ a inscrição retoma na reativação: não morre, não abre followup_dead e sai num turno novo", async () => {
    await seedOrg(ORG_SUSPENSA);
    const inscricao = await seedEnrollment(ORG_SUSPENSA, ACTION_END, "a1");

    // Enfileira o turno e o espera o máximo que o dead-man tolera: o worker está
    // lento, e mais um recheck sem o turno fechar mataria a inscrição.
    await runFollowupTick(deps(), { limit: 5 });
    expect(await turnos(inscricao)).toEqual(["pending"]);
    for (let i = 0; i < MAX_ACTION_RECHECKS - 1; i++) {
      await vencer(inscricao);
      await runFollowupTick(deps(), { limit: 5 });
    }
    expect((await pool.query(`select status from followup_enrollments where id = $1`, [inscricao])).rows[0].status).toBe(
      "active",
    );

    await suspender(ORG_SUSPENSA);
    expect(await turnos(inscricao)).toEqual(["failed|org_nao_operante"]);

    // Suspensa: o motor não a toca.
    await vencer(inscricao);
    const suspensa = await runFollowupTick(deps(), { limit: 5 });
    expect(suspensa.claimed).toBe(0);

    await reativar(ORG_SUSPENSA);
    await vencer(inscricao);
    const retomada = await runFollowupTick(deps(), { limit: 5 });
    expect(retomada.dead).toBe(0);
    expect(await turnos(inscricao)).toEqual(["failed|org_nao_operante", "pending"]);

    // O turno novo fecha e a inscrição segue o fluxo.
    await completeTurnForEnrollment(createPgAdminClient(pool), ORG_SUSPENSA, inscricao, "a1", { kind: "sent" });
    const { rows } = await pool.query(`select status, current_node_id from followup_enrollments where id = $1`, [
      inscricao,
    ]);
    expect(rows[0]).toMatchObject({ status: "active", current_node_id: "e1" });
    const { rows: mortos } = await pool.query(
      `select count(*)::int as n from agent_inbox_items where organization_id = $1 and kind = 'followup_dead'`,
      [ORG_SUSPENSA],
    );
    expect(mortos[0].n).toBe(0);
  });
});
