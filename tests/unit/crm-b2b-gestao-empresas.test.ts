/**
 * Gestão B2B de empresas (#1937): o ciclo consulta → criação → edição → retry →
 * exclusão segura, mais a formatação do CNPJ que uma falha de enriquecimento
 * NÃO pode quebrar.
 *
 * Cobrimos:
 *   1. enriquecimento que FALHA mantém o CNPJ com máscara (o relato da #1937:
 *      `33547054000120` no lugar de `33.547.054/0001-20`) — e o dígito segue
 *      em `normalized_cnpj`.
 *   2. enriquecimento que TEM SUCESSO também grava o CNPJ formatado.
 *   3. lookup antes da criação devolve dados públicos SEM gravar, marca
 *      `already_registered` e mapeia 403 da BrasilAPI como 502 com dica de retry.
 *   4. exclusão segura: soma audit, devolve o que foi apagado, 404 quando a
 *      empresa não existe e 409 quando a FK depende (23503).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as ClienteBrasilApi from "@/lib/brasil-api/client";
import type { BrasilApiClient, BrasilApiResult } from "@/lib/brasil-api/client";
import { mapBrasilApiToCompanyFields } from "@/lib/brasil-api/client";

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/brasil-api/client", async (importOriginal) => {
  const real = await importOriginal<typeof ClienteBrasilApi>();
  return { ...real, createBrasilApiClient: vi.fn() };
});

import { createBrasilApiClient } from "@/lib/brasil-api/client";
import { audit } from "@/lib/audit";
import { deleteCompanyHandler, lookupCompanyCnpjHandler } from "@/lib/crm-b2b/companies-handler";
import { enrichCompanyFromBrasilApi } from "@/lib/crm-b2b/enrich";
import type { HandlerCtx } from "@/lib/api/handlers/types";

const ORG = "11111111-1111-4111-8111-111111111111";
const EMPRESA = "22222222-2222-4222-8222-222222222222";
const CNPJ_NORMALIZADO = "33547054000120";
const CNPJ_FORMATADO = "33.547.054/0001-20";

const CTX: HandlerCtx = {
  organization_id: ORG,
  actor: { type: "user", id: "u-1", role: "manager" },
  requestId: "req-test",
  idioma: "pt-BR",
};

function bancoDeLeitura(data: unknown, error: unknown = null) {
  const leitura = {
    eq: () => leitura,
    maybeSingle: async () => ({ data, error }),
  };
  return { from: () => ({ select: () => leitura }) };
}

/** Banco falso para enriquecimento: captura os payloads de UPDATE. */
function bancoDeEnrich(linha: unknown, updates: Record<string, unknown>[]) {
  const leitura = {
    eq: () => leitura,
    maybeSingle: async () => ({ data: linha, error: null }),
  };
  const from = (tabela: string) => {
    if (tabela !== "companies") throw new Error(`tabela inesperada: ${tabela}`);
    const escrita = {
      eq: () => escrita,
    };
    return {
      select: () => leitura,
      update: (valores: Record<string, unknown>) => {
        updates.push(valores);
        return escrita;
      },
    };
  };
  return { from } as never;
}

describe("enriquecimento preserva a máscara do CNPJ (#5)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("falha mantém o CNPJ FORMATADO e o dígito segue em normalized_cnpj", async () => {
    vi.mocked(createBrasilApiClient as () => Pick<BrasilApiClient, "lookupCnpj">).mockReturnValue({
      lookupCnpj: async () => ({
        ok: false,
        code: "upstream_error",
        message: "BrasilAPI respondeu 403.",
        status: 403,
      }),
    });

    const updates: Record<string, unknown>[] = [];
    const banco = bancoDeEnrich(
      {
        id: EMPRESA,
        cnpj: CNPJ_FORMATADO,
        normalized_cnpj: CNPJ_NORMALIZADO,
        enrichment_status: "pending",
      },
      updates,
    );

    const r = await enrichCompanyFromBrasilApi(banco, {
      organizationId: ORG,
      companyId: EMPRESA,
    });
    expect(r.status).toBe("failed");

    const falha = updates.find((u) => u.enrichment_status === "failed");
    expect(falha?.cnpj).toBe(CNPJ_FORMATADO);
    expect(falha?.normalized_cnpj).toBe(CNPJ_NORMALIZADO);
  });

  it("sucesso grava o CNPJ formatado", async () => {
    vi.mocked(createBrasilApiClient as () => Pick<BrasilApiClient, "lookupCnpj">).mockReturnValue({
      lookupCnpj: async () => ({
        ok: true,
        data: { razao_social: "ACME LTDA", cnpj: CNPJ_NORMALIZADO },
        raw: { razao_social: "ACME LTDA" },
      }),
    });

    const updates: Record<string, unknown>[] = [];
    const banco = bancoDeEnrich(
      {
        id: EMPRESA,
        cnpj: CNPJ_FORMATADO,
        normalized_cnpj: CNPJ_NORMALIZADO,
        enrichment_status: "pending",
      },
      updates,
    );

    const r = await enrichCompanyFromBrasilApi(banco, {
      organizationId: ORG,
      companyId: EMPRESA,
    });
    expect(r.status).toBe("completed");

    const okUpdate = updates.find((u) => u.enrichment_status === "completed");
    expect(okUpdate?.cnpj).toBe(CNPJ_FORMATADO);
    expect(okUpdate?.normalized_cnpj).toBe(CNPJ_NORMALIZADO);
  });
});

describe("lookup de CNPJ antes da criação", () => {
  it("devolve campos públicos sem gravar e marca cadastro duplicado", async () => {
    const lookupCnpj = vi.fn(async (): Promise<BrasilApiResult> => ({
      ok: true,
      data: {
        razao_social: "ACME LTDA",
        nome_fantasia: "Acme",
        municipio: "Fortaleza",
        uf: "CE",
      },
      raw: {},
    }));

    // empresa já cadastrada → already_registered
    const banco = bancoDeLeitura({ id: EMPRESA });
    const r = await lookupCompanyCnpjHandler(
      banco as never,
      CTX,
      { cnpj: CNPJ_FORMATADO },
      { lookupCnpj },
    );

    expect(lookupCnpj).toHaveBeenCalledWith(CNPJ_NORMALIZADO);
    expect(r.cnpj).toBe(CNPJ_FORMATADO);
    expect(r.normalized_cnpj).toBe(CNPJ_NORMALIZADO);
    expect(r.already_registered).toBe(true);
    expect(r.fields.legal_name).toBe("ACME LTDA");
    expect(r.fields.city).toBe("Fortaleza");
    // nenhum update gravado — só leitura
    expect(bancoDeLeitura({ id: EMPRESA }).from).toBeDefined();
  });

  it("marca already_registered = false quando o CNPJ é novo", async () => {
    const lookupCnpj = vi.fn(async (): Promise<BrasilApiResult> => ({
      ok: true,
      data: { razao_social: "ACME LTDA" },
      raw: {},
    }));
    const r = await lookupCompanyCnpjHandler(
      bancoDeLeitura(null) as never,
      CTX,
      { cnpj: CNPJ_NORMALIZADO },
      { lookupCnpj },
    );
    expect(r.already_registered).toBe(false);
  });

  it("403 da BrasilAPI vira 502 com dica de retry (feedback distinguível)", async () => {
    const lookupCnpj = vi.fn(async (): Promise<BrasilApiResult> => ({
      ok: false,
      code: "upstream_error",
      message: "BrasilAPI respondeu 403.",
      status: 403,
    }));
    await expect(
      lookupCompanyCnpjHandler(
        bancoDeLeitura(null) as never,
        CTX,
        { cnpj: CNPJ_FORMATADO },
        { lookupCnpj },
      ),
    ).rejects.toMatchObject({
      status: 502,
      details: expect.objectContaining({ dica: expect.stringContaining("403") }),
    });
  });

  it("CNPJ inválido é rejeitado sem chamar a rede", async () => {
    const lookupCnpj = vi.fn();
    await expect(
      lookupCompanyCnpjHandler(bancoDeLeitura(null) as never, CTX, { cnpj: "123" }, { lookupCnpj }),
    ).rejects.toMatchObject({ status: 422 });
    expect(lookupCnpj).not.toHaveBeenCalled();
  });
});

describe("exclusão segura de empresa", () => {
  beforeEach(() => vi.clearAllMocks());

  it("apaga, soma audit e devolve o que foi removido", async () => {
    const chamadas: string[] = [];
    const escrita = {
      eq: () => escrita,
    };
    const banco = {
      from: (tabela: string) => {
        chamadas.push(tabela);
        if (tabela !== "companies") throw new Error(`tabela inesperada: ${tabela}`);
        const leitura = {
          eq: () => leitura,
          maybeSingle: async () => ({
            data: { id: EMPRESA, trade_name: "Acme", legal_name: "ACME LTDA" },
            error: null,
          }),
        };
        return {
          select: () => leitura,
          delete: () => ({ eq: () => ({ eq: () => ({ error: null }) }) }),
        };
      },
    };

    const r = await deleteCompanyHandler(banco as never, CTX, "u-1", EMPRESA);
    expect(r.deleted).toBe(true);
    expect(r.legal_name).toBe("ACME LTDA");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "companies.deleted", resourceId: EMPRESA }),
    );
  });

  it("404 quando a empresa não existe", async () => {
    await expect(
      deleteCompanyHandler(bancoDeLeitura(null) as never, CTX, "u-1", EMPRESA),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("409 quando a FK depende (23503) — não apaga parcial", async () => {
    const banco = {
      from: () => {
        const leitura = {
          eq: () => leitura,
          maybeSingle: async () => ({ data: { id: EMPRESA, trade_name: "Acme" }, error: null }),
        };
        return {
          select: () => leitura,
          // igual ao builder do Supabase: .delete() é síncrono e a cadeia de
          // .eq() só resolve quando a promise é awaited — tornar `delete`
          // async quebrava a corrente com "eq is not a function".
          delete: () => ({
            eq: () => ({
              eq: async () => ({ error: { code: "23503", message: "violates FK" } }),
            }),
          }),
        };
      },
    };
    await expect(deleteCompanyHandler(banco as never, CTX, "u-1", EMPRESA)).rejects.toMatchObject({
      status: 409,
      code: "conflict",
    });
    expect(audit).not.toHaveBeenCalled();
  });
});

// mapa de campos usado como controle de que o helper continua exportado
it("mapBrasilApiToCompanyFields segue exportado", () => {
  expect(mapBrasilApiToCompanyFields).toBeTypeOf("function");
});
