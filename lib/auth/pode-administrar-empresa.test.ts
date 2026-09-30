/**
 * Regra única "admin de plataforma pode escrever nesta empresa?" (#1852).
 *
 * Prova: a função concentra a regra das rotas (`requireRole("admin", {
 * allowPlatformAdmin })`): super-admin de plataforma fora da sessão de suporte
 * passa; senão o papel efetivo na org tem de ser `admin`. Cobre a sessão de
 * suporte (`full` → admin passa, `support_readonly` → viewer nega) e garante
 * que as server actions não reescrevem mais a checagem na mão (as três grafias
 * originais sumiram de `app/actions/`).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { podeAdministrarEmpresa } from "@/lib/auth/pode-administrar-empresa";
import type { ActiveOrg, Role } from "@/lib/auth/types";
import type { SupportContext } from "@/lib/impersonate/support";

const ORG_ID = "22222222-2222-4222-8222-222222222222";

function org(role: Role): ActiveOrg {
  return { orgId: ORG_ID, name: "Org", role };
}

function support(accessMode: SupportContext["access_mode"]): SupportContext {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    organization_id: ORG_ID,
    actor_user_id: "33333333-3333-4333-8333-333333333333",
    auth_session_id: "44444444-4444-4444-8444-444444444444",
    previous_organization_id: null,
    expires_at: "2099-01-01T00:00:00Z",
    name: "Suporte",
    locale: null,
    access_mode: accessMode,
    status: "active",
  };
}

describe("podeAdministrarEmpresa", () => {
  it("permite super-admin de plataforma fora da sessão de suporte", () => {
    expect(
      podeAdministrarEmpresa({ is_platform_admin: true, support: null }, org("viewer")),
    ).toBe(true);
  });

  it("nega quem não é admin de plataforma nem admin da org", () => {
    for (const role of ["viewer", "agent", "ai_operator", "manager"] as Role[]) {
      expect(
        podeAdministrarEmpresa({ is_platform_admin: false, support: null }, org(role)),
        `role=${role}`,
      ).toBe(false);
    }
  });

  it("permite admin do tenant mesmo não sendo admin de plataforma", () => {
    expect(
      podeAdministrarEmpresa({ is_platform_admin: false, support: null }, org("admin")),
    ).toBe(true);
  });

  it("sessão de suporte não usa o atalho de plataforma: vote pelo papel efetivo", () => {
    // Acompanhamento com acesso total: `resolveActiveOrg` deriva role = admin.
    expect(
      podeAdministrarEmpresa({ is_platform_admin: true, support: support("full") }, org("admin")),
    ).toBe(true);
    // Mesma sessão, mas papel resolvido abaixo de admin → nega (não atalha).
    expect(
      podeAdministrarEmpresa(
        { is_platform_admin: true, support: support("full") },
        org("viewer"),
      ),
    ).toBe(false);
  });

  it("nega sessão de suporte com acesso somente leitura", () => {
    // A guarda `supportWriteError` barra `support_readonly` antes do efeito;
    // aqui a regra cai no papel derivado (viewer) e nega também.
    expect(
      podeAdministrarEmpresa(
        { is_platform_admin: true, support: support("support_readonly") },
        org("viewer"),
      ),
    ).toBe(false);
  });
});

describe("regra única (codemod das server actions)", () => {
  const GRAFIAS = [
    /!\w+\.is_platform_admin\s*&&\s*ROLE_RANK/,
    /!\s*\(\w+\.is_platform_admin\s*&&\s*!\w+\.support\)/,
    /!==\s*"admin"\s*&&\s*!\w+\.is_platform_admin/,
    /!\w+\.is_platform_admin\s*&&\s*!/,
  ];

  it("as três grafias originais não aparecem mais em app/actions", () => {
    const raiz = join(process.cwd(), "app", "actions");
    const arquivos: string[] = [];
    const pilha = [raiz];
    while (pilha.length > 0) {
      const atual = pilha.pop()!;
      for (const entrada of readdirSync(atual, { withFileTypes: true })) {
        const caminho = join(atual, entrada.name);
        if (entrada.isDirectory()) pilha.push(caminho);
        else if (entrada.name.endsWith(".ts")) arquivos.push(caminho);
      }
    }
    const infratores = arquivos
      .map((caminho) => ({ caminho, corpo: readFileSync(caminho, "utf8") }))
      .filter(({ corpo }) => GRAFIAS.some((r) => r.test(corpo)));
    expect(
      infratores.map(({ caminho, corpo }) => `${caminho}: ${corpo.match(/.{0,60}is_platform_admin.{0,60}/)?.[0] ?? ""}`),
    ).toEqual([]);
  });
});