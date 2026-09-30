import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cena = vi.hoisted(() => ({
  B: "00000000-0000-4000-8000-00000000000b",
  C: "00000000-0000-4000-8000-00000000000c",
  D: "00000000-0000-4000-8000-00000000000d",
  papel: "admin" as "admin" | "agent",
  status: {} as Record<string, string>,
  statusNaSessao: undefined as string | undefined,
  falhaNaLeitura: false,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((destino: string) => {
    throw new Error(`NEXT_REDIRECT:${destino}`);
  }),
}));
vi.mock("@/lib/auth/server", () => ({
  requireAuth: async () => ({
    id: "11111111-1111-4111-8111-111111111111",
    email: "admin@empresa.test",
    is_platform_admin: false,
    support: null,
    idioma: "pt-BR",
    organizations: [
      { organization_id: cena.B, organization_name: "Empresa B", role: cena.papel },
      { organization_id: cena.C, organization_name: "Empresa C", role: "admin" },
      { organization_id: cena.D, organization_name: "Empresa D", role: "admin" },
    ],
  }),
  // A régua da SESSÃO (o embed de `loadAuthUser`), que é a do `resolveActiveOrg`
  // do layout; `statusNaSessao` só difere do banco no caso da divergência.
  orgAtivaSemPortao: async () => ({
    orgId: cena.B, name: "Empresa B", role: cena.papel,
    org_status: cena.statusNaSessao ?? cena.status[cena.B],
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        in: async (_coluna: string, ids: string[]) =>
          cena.falhaNaLeitura
            ? { data: null, error: { message: "rede" } }
            : { data: ids.map((id) => ({ id, status: cena.status[id] ?? "active" })), error: null },
      }),
    }),
  }),
}));
vi.mock("@/lib/branding/saida", () => ({ emailDeSuporte: async () => "suporte@revenda.test" }));
vi.mock("@/app/app/lgpd/requests/RequestsTable", () => ({
  RequestsTable: ({ baseDoPedido }: { baseDoPedido?: string }) => <p data-testid="lgpd-lista">{baseDoPedido}</p>,
}));
vi.mock("@/app/app/lgpd/requests/[id]/_client", () => ({
  LgpdRequestDetail: ({ id, hrefDaLista }: { id: string; hrefDaLista?: string }) => (
    <p data-testid="lgpd-pedido">{`${id} ${hrefDaLista}`}</p>
  ),
}));
vi.mock("@/app/onboarding/_components/OutrasOrganizacoes", () => ({
  OutrasOrganizacoes: ({ outras }: { outras: Array<{ id: string; nome: string }> }) => (
    <p data-testid="outras">{outras.map((o) => o.nome).join(",")}</p>
  ),
}));

import AccountSuspendedPage from "./page";

async function montar(pedido?: string) {
  return render(await AccountSuspendedPage({ searchParams: Promise.resolve(pedido ? { pedido } : {}) }));
}

beforeEach(() => {
  cena.papel = "admin";
  cena.status = { [cena.B]: "suspended", [cena.C]: "active", [cena.D]: "suspended" };
  cena.statusNaSessao = undefined;
  cena.falhaNaLeitura = false;
});

describe("/account-suspended: o hub de quem está numa empresa suspensa", () => {
  it("empresa que opera não fica presa aqui: volta para /app", async () => {
    cena.status[cena.B] = "active";
    await expect(montar()).rejects.toThrow("NEXT_REDIRECT:/app");
  });

  // Review Focus 2: o layout de /app manda para cá se QUALQUER das duas réguas
  // (sessão ou leitura do banco) diz parada; o hub só devolve para /app quando
  // AS DUAS dizem que opera. Sem isso, a divergência vira laço de 307.
  it.each([
    ["sessão diz parada, banco diz ativa", "suspended", "active"],
    ["sessão diz ativa, banco diz parada", "active", "suspended"],
  ])("%s → renderiza o hub, sem redirect", async (_nome, naSessao, noBanco) => {
    cena.statusNaSessao = naSessao;
    cena.status[cena.B] = noBanco;
    await montar();
    expect(screen.getByRole("heading", { name: "Conta suspensa" })).toBeVisible();
  });

  it("admin vê o suporte, a LGPD abrindo no próprio hub e só as empresas que operam", async () => {
    await montar();
    expect(screen.getByRole("heading", { name: "Conta suspensa" })).toBeVisible();
    expect(screen.getByRole("link", { name: "suporte@revenda.test" })).toHaveAttribute("href", "mailto:suporte@revenda.test");
    expect(screen.getByTestId("lgpd-lista")).toHaveTextContent("/account-suspended?pedido=");
    expect(screen.getByTestId("outras")).toHaveTextContent(/^Empresa C$/);
  });

  it("quem não administra é mandado ao administrador, sem LGPD e sem o endereço do suporte", async () => {
    cena.papel = "agent";
    await montar();
    expect(screen.getByText("Sua conta está suspensa. Avise o administrador da sua empresa.")).toBeVisible();
    expect(screen.queryByTestId("lgpd-lista")).toBeNull();
    expect(screen.queryByRole("link", { name: "suporte@revenda.test" })).toBeNull();
  });

  it("?pedido= com uuid abre o detalhe no hub", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    await montar(id);
    expect(screen.getByTestId("lgpd-pedido")).toHaveTextContent(`${id} /account-suspended`);
  });

  it("?pedido= que não é uuid cai na lista", async () => {
    await montar("../app/inbox");
    expect(screen.getByTestId("lgpd-lista")).toBeVisible();
    expect(screen.queryByTestId("lgpd-pedido")).toBeNull();
  });

  it("leitura do estado que falha LANÇA: nem hub nem redirect por palpite", async () => {
    cena.falhaNaLeitura = true;
    await expect(montar()).rejects.toThrow(/account_suspended_status_indisponivel/);
  });
});
