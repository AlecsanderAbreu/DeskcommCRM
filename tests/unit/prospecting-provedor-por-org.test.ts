/**
 * #1758 — O PROVEDOR DA BUSCA É ESCOLHIDO PELA ORGANIZAÇÃO.
 *
 * Três controles, na ordem em que a issue os pede:
 *
 * 1. Quem tem `organizations.settings.prospecting.provider = 'teste'` tem a
 *    chamada feita pelo provedor ESCOLHIDO — sem rede, sem crédito da Apify —
 *    e nenhuma outra organização é afetada pela escolha alheia.
 * 2. Quem não escolheu nada continua na Apify, com a MESMA validação em
 *    `users/me`: nada muda para quem não pediu.
 * 3. O contrato de erro (`EscopoDaFalha` / `ProspectingError` de
 *    `lib/prospecting/provider.ts`) continua igual, para `worker.ts` e
 *    `guard.ts` continuarem intocados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/webhooks/secrets", () => ({
  decryptWebhookSecret: vi.fn(async () => "chave-em-claro"),
  encryptWebhookSecret: vi.fn(async () => "cifrado"),
}));

import { configureCredential, createSearch } from "@/lib/prospecting/store";
import { ProspectingError } from "@/lib/prospecting/provider";
import { searchSchema } from "@/lib/prospecting/schema";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const BUSCA = searchSchema.parse({
  name: "clínicas de SP",
  niche: "clínicas odontológicas",
  location: "São Paulo",
  limit: 5,
  budget_usd: 1,
  enrich: false,
});

interface Campanha {
  id: string;
  organization_id: string;
  name: string;
  search: typeof BUSCA;
  config: unknown;
  status: string;
  search_status: string;
  run_id: string | null;
  dataset_id: string | null;
  next_send_at: Date;
  created_at: Date;
  error: string | null;
}

/** Banco falso: só o que `store.ts` toca, roteado pelo texto do SQL. */
function fakeDb(porOrg: Record<string, Record<string, unknown> | null>) {
  const log: { sql: string; params?: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    log.push({ sql, params });
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("pg_advisory_unlock")) return { rows: [{ locked: true }] };
    if (sql.includes("select settings from organizations")) {
      const settings = porOrg[String(params[0])] ?? null;
      return { rows: settings ? [{ settings }] : [{}] };
    }
    if (sql.includes("credential_encrypted from prospecting_settings"))
      return { rows: [{ credential_encrypted: Buffer.from("ab", "hex") }] };
    if (sql.includes("prospecting_settings(organization_id,credential_encrypted)"))
      return { rows: [] };
    if (sql.startsWith("insert into prospecting_campaigns")) {
      const campanha: Campanha = {
        id: "11111111-1111-4111-8111-111111111111",
        organization_id: String(params[0]),
        name: String(params[2]),
        search: params[3] as typeof BUSCA,
        config: null,
        status: "draft",
        search_status: "starting",
        run_id: null,
        dataset_id: null,
        next_send_at: new Date("2026-10-03T12:00:00Z"),
        created_at: new Date("2026-10-03T12:00:00Z"),
        error: null,
      };
      return { rows: [campanha] };
    }
    if (sql.startsWith("select * from prospecting_campaigns")) return { rows: [] };
    if (sql.includes("set run_id=$3")) return { rows: [] };
    if (sql.includes("search_status='unknown'")) return { rows: [] };
    return { rows: [] };
  });
  const client = { query, release: () => undefined };
  return { query, log, client, pool: { query, connect: async () => client } };
}

/**
 * A campanha que `createSearch` devolve vem de uma segunda leitura; para o
 * run_id gravado ser observável sem banco real, o select final devolve o que o
 * update gravou — guardado aqui.
 */
function observarRun(pool: ReturnType<typeof fakeDb>) {
  const original = pool.query.getMockImplementation()!;
  const gravado: Record<string, Record<string, unknown>> = {};
  pool.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const r = await original(sql, params);
    const org = String(params[0]);
    if (sql.includes("set run_id=$3"))
      gravado[org] = { ...(gravado[org] ?? {}), run_id: params[2], dataset_id: params[3], search_status: "running" };
    if (sql.includes("search_status='unknown'"))
      gravado[org] = { ...(gravado[org] ?? {}), search_status: "unknown", error: params[2] };
    // Só a leitura FINAL da campanha (`and id=$2`) devolve o que o update gravou;
    // a leitura do `request_id` (idempotência) continua vazia, senão a segunda
    // organização enxergaria a campanha da primeira.
    if (sql.startsWith("select * from prospecting_campaigns") && !sql.includes("request_id")) {
      const g = gravado[org];
      if (g) return { rows: [{ id: params[1], ...(r.rows[0] ?? {}), ...g }] };
    }
    return r;
  });
  return gravado;
}

let fetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
});

describe("#1758 provedor de prospecção escolhido por organização", () => {
  it("organização com settings.prospecting.provider 'teste' é atendida pelo provedor escolhido, sem rede", async () => {
    const db = fakeDb({ [ORG_A]: { prospecting: { provider: "teste" } } });
    observarRun(db);
    fetch.mockRejectedValue(new Error("a rede não deve ser usada"));

    const campanha = await createSearch(
      db.pool as never,
      {} as never,
      ORG_A,
      "77777777-7777-4777-8777-777777777777",
      BUSCA,
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(campanha.run_id).toMatch(/^teste:/);
    expect(campanha.search_status).toBe("running");
  });

  it("a escolha de uma organização não vaza para outra: quem não escolheu segue na Apify", async () => {
    const db = fakeDb({ [ORG_A]: { prospecting: { provider: "teste" } }, [ORG_B]: null });
    observarRun(db);
    fetch.mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "run-apify", status: "RUNNING" } })),
    );

    await createSearch(db.pool as never, {} as never, ORG_A, "77777777-7777-4777-8777-777777777777", BUSCA);
    const a = fetch.mock.calls.length;

    await createSearch(db.pool as never, {} as never, ORG_B, "88888888-8888-4888-8888-888888888888", BUSCA);
    const [, init] = fetch.mock.calls.at(-1)!;

    expect(a).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toContain("https://api.apify.com/v2/acts/");
    expect(init.headers.Authorization).toBe("Bearer chave-em-claro");
  });

  it("sem escolha nenhuma, a credencial continua sendo validada em users/me da Apify", async () => {
    const db = fakeDb({ [ORG_B]: null });
    fetch.mockResolvedValue(new Response(JSON.stringify({ data: { id: "u1" } })));

    await configureCredential(db.pool as never, {} as never, ORG_B, "chave-nova");

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toContain("https://api.apify.com/v2/users/me");
    // A credencial segue no MESMO lugar: prospecting_settings, cifrada.
    expect(db.log.some((q) => q.sql.includes("prospecting_settings(organization_id,credential_encrypted)"))).toBe(
      true,
    );
  });

  it("escolha desconhecida e falha do provedor continuam saindo como ProspectingError com o escopo intacto", async () => {
    const db = fakeDb({ [ORG_A]: { prospecting: { provider: "proveedor-inexistente" } } });

    const falha = await createSearch(
      db.pool as never,
      {} as never,
      ORG_A,
      "99999999-9999-4999-8999-999999999999",
      BUSCA,
    ).catch((e: unknown) => e);

    expect(falha).toBeInstanceOf(ProspectingError);
    const erro = falha as ProspectingError;
    // O padrão da casa: fechar por padrão (escopo 'campanha'), status 422.
    expect(erro.escopo).toBe("campanha");
    expect(erro.status).toBe(422);
    // Nada de envelope novo: `worker.ts` lê message/status/escopo do mesmo jeito.
    expect(erro).toHaveProperty("message");
    expect(typeof erro.message).toBe("string");
    expect(fetch).not.toHaveBeenCalled();

    // O contrato de `provider.ts` continua o mesmo, inclusive o escopo explícito.
    const candidato = new ProspectingError("só este candidato", 422, "candidato");
    expect(candidato.escopo).toBe("candidato");
    expect(new ProspectingError("x").escopo).toBe("campanha");
    expect(new ProspectingError("x").status).toBe(422);
  });
});
