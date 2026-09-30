/**
 * A linha "campanhas" da matriz de suspensão (§6a), agora que a superfície
 * EXISTE (migration 0375).
 *
 * Este arquivo substitui `suspensao-campanha-nao-existe.test.ts`, que era o
 * congelamento: ele ficava vermelho no dia em que alguém criasse disparo em
 * massa, justamente para obrigar esta decisão em vez de deixar a linha
 * "coberta" num documento. O dia chegou; a decisão é a mesma da fila do agente
 * — organização suspensa não fala com ninguém, e prospecção ativa é a última
 * coisa que ela deveria continuar fazendo.
 *
 * Mede pelo COMPORTAMENTO (a rodada não escolhe nem PROMOVE a campanha da org
 * suspensa), não pela presença do filtro no código: um teste que procurasse a
 * string `suspended` ficaria verde com o filtro aplicado à consulta errada.
 */
import { describe, expect, it, vi } from "vitest";

import { registrarExcecaoDoEnvio, rodarUmaRodadaDeCampanha } from "@/lib/campanhas/rodada";
import { OrgNaoOperanteError } from "@/lib/organizacao/operante";

interface Chamada {
  tabela: string;
  operacao: "select" | "update";
  /** A varrdura embutiu `organizations:organization_id(status)` no select? */
  selectEmbuteOrg: boolean;
  /** O update filtrou por `organizations.status` (a régua SQL)? */
  eqOrgStatus?: boolean;
  /** A varrdura usou a URL antiga `not(organization_id, in, ...)`? */
  notIn?: [string, string, string];
}

/** Supabase falso: registra o que foi perguntado e devolve o que o teste manda. */
function fakeAdmin(opts: { campanhas: unknown[] }) {
  const chamadas: Chamada[] = [];
  const builder = (tabela: string) => {
    let operacao: "select" | "update" = "select";
    let selectEmbuteOrg = false;
    let eqOrgStatus = false;
    let notIn: Chamada["notIn"];
    const b: Record<string, unknown> = {
      select: (cols?: unknown) => {
        if (typeof cols === "string" && cols.includes("organizations")) selectEmbuteOrg = true;
        return b;
      },
      update: () => {
        operacao = "update";
        return b;
      },
      eq: (coluna: string, _valor: unknown) => {
        if (coluna === "organizations.status") eqOrgStatus = true;
        return b;
      },
      lte: () => b,
      or: () => b,
      order: () => b,
      limit: () => b,
      neq: () => b,
      not: (coluna: string, op: string, valor: string) => {
        if (coluna === "organization_id" && op === "in") notIn = [coluna, op, valor];
        return b;
      },
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        chamadas.push({ tabela, operacao, selectEmbuteOrg, eqOrgStatus, notIn });
        const data = tabela === "campaigns" ? opts.campanhas : null;
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return b;
  };
  return { admin: { from: (t: string) => builder(t) }, chamadas };
}

describe("suspensão × campanha", () => {
  it("a rodada não pergunta mais a lista de orgs paradas — o status vem embutido no select", async () => {
    const { admin, chamadas } = fakeAdmin({ campanhas: [] });
    await rodarUmaRodadaDeCampanha(admin as never);
    // Nenhuma chamada à tabela `organizations` para ler os ids das paradas.
    expect(chamadas.some((c) => c.tabela === "organizations")).toBe(false);
    // A escolha das `running` embute `organizations:organization_id(status)`.
    const escolha = chamadas.find((c) => c.tabela === "campaigns" && c.operacao === "select");
    expect(escolha?.selectEmbuteOrg).toBe(true);
    expect(escolha?.notIn).toBeUndefined();
  });

  it("a rodada EXCLUI as campanhas de organização suspensa da escolha (ehOperante sobre o status embutido)", async () => {
    const { admin, chamadas } = fakeAdmin({
      campanhas: [
        {
          id: "c-suspensa",
          organization_id: "11111111-1111-4111-8111-111111111111",
          organizations: { status: "suspended" },
        },
        {
          id: "c-ativa",
          organization_id: "22222222-2222-4222-8222-222222222222",
          organizations: { status: "active" },
        },
      ],
    });
    const r = await rodarUmaRodadaDeCampanha(admin as never);
    // A suspensa não abre conversa (nada é enviado) — a escolha filtrou por
    // `ehOperante`, sem nunca tocar numa `in (...)` da URL.
    expect(r.enviadas).toBe(0);
    const escolha = chamadas.find((c) => c.tabela === "campaigns" && c.operacao === "select");
    expect(escolha?.selectEmbuteOrg).toBe(true);
    expect(escolha?.notIn).toBeUndefined();
  });

  it("a PROMOÇÃO da agendada também exclui a suspensa, no banco, no próprio update", async () => {
    const { admin, chamadas } = fakeAdmin({ campanhas: [] });
    await rodarUmaRodadaDeCampanha(admin as never);
    const promocao = chamadas.find((c) => c.tabela === "campaigns" && c.operacao === "update");
    expect(promocao?.eqOrgStatus).toBe(true);
    expect(promocao?.notIn).toBeUndefined();
  });

  it("nenhuma consulta usa a URL antiga `in ()` de paradas nem lê os ids", async () => {
    const { admin, chamadas } = fakeAdmin({ campanhas: [] });
    await rodarUmaRodadaDeCampanha(admin as never);
    for (const c of chamadas) expect(c.notIn, JSON.stringify(c)).toBeUndefined();
    expect(chamadas.filter((c) => c.tabela === "organizations")).toHaveLength(0);
  });
});

describe("exceção do envio × organização parada", () => {
  /** Supabase falso que só registra o que o `update` gravaria. */
  function adminQueGrava() {
    const gravados: Array<Record<string, unknown>> = [];
    const b: Record<string, unknown> = {
      update: (payload: Record<string, unknown>) => {
        gravados.push(payload);
        return b;
      },
      eq: () => b,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
    };
    return { admin: { from: () => b } as never, gravados };
  }

  it("org parada no meio do envio devolve o destinatário à fila, sem send_exception", async () => {
    const { admin, gravados } = adminQueGrava();
    await expect(registrarExcecaoDoEnvio(admin, "dest-1", new OrgNaoOperanteError("org"))).resolves.toBe("org_nao_operante");
    expect(gravados).toEqual([{ status: "pending", sending_at: null }]);
  });

  it("controle: outro erro segue marcando failed/send_exception com o motivo", async () => {
    const { admin, gravados } = adminQueGrava();
    await expect(registrarExcecaoDoEnvio(admin, "dest-1", new Error("rede"))).resolves.toBe("falhou");
    expect(gravados).toEqual([{ status: "failed", last_error_code: "send_exception", last_error_detail: "rede" }]);
  });
});

vi.mock("@/lib/agent-engine/db/request-pool", () => ({
  getRequestPool: () => ({ query: async () => ({ rows: [] }) }),
}));
