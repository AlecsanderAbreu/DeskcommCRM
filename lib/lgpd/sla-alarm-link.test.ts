import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O LINK DO E-MAIL DE PRAZO DA LGPD LEVA AO PEDIDO, COM A EMPRESA SUSPENSA OU NÃO
 * (acabamento 7 do PR 1; spec da cobrança §4 "LGPD: nunca bloqueada").
 *
 * `/app/lgpd/requests/<id>` passa pelo layout de `/app`, que manda a empresa
 * parada para `/account-suspended` SEM o pedido — o DPO caía na lista, com o
 * prazo legal correndo. Empresa parada recebe o link do hub com `?pedido=`.
 */
const enviado = vi.hoisted(() => ({ html: "", text: "" }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));
vi.mock("@/lib/email/roteador", () => ({
  sendEmail: vi.fn(async (e: { html: string; text: string }) => {
    enviado.html = e.html;
    enviado.text = e.text;
    return { ok: true };
  }),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://crm.test" } }));
vi.mock("@/lib/instalacao/config", () => ({ valorDaInstalacao: async () => ({ valor: "" }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: async () => ({ error: null }) }),
}));

import { triggerSlaAlarm } from "./sla-alarm";
import type { LgpdRequest } from "./types";

const ID = "22222222-2222-4222-8222-222222222222";
const pedido = {
  id: ID,
  organization_id: "00000000-0000-4000-8000-00000000000b",
  request_type: "data_request",
  status: "pending",
  attempts: 0,
  received_at: "2026-09-20T12:00:00.000Z",
  due_at: "2026-09-27T12:00:00.000Z",
  request_payload: {},
} as unknown as LgpdRequest;

async function alarmar(organizationStatus: string | null) {
  await triggerSlaAlarm({
    request: pedido,
    threshold: "data_request_d5",
    organizationDpoEmail: "dpo@empresa.test",
    organizationName: "Empresa B",
    organizationStatus,
    marca: { nome: "CRM", accent: "#000000", accentFg: "#ffffff" } as never,
  });
}

beforeEach(() => {
  enviado.html = "";
  enviado.text = "";
});

describe("sla-alarm: o link do e-mail abre o pedido", () => {
  it("empresa que opera: o link é o pedido dentro de /app", async () => {
    await alarmar("active");
    expect(enviado.html).toContain(`href="https://crm.test/app/lgpd/requests/${ID}"`);
    expect(enviado.text).toContain(`https://crm.test/app/lgpd/requests/${ID}`);
  });

  it.each(["suspended", "redacted", null])("empresa parada (%s): o link é o hub com ?pedido=", async (status) => {
    await alarmar(status);
    expect(enviado.html).toContain(`href="https://crm.test/account-suspended?pedido=${ID}"`);
    expect(enviado.text).toContain(`https://crm.test/account-suspended?pedido=${ID}`);
    expect(enviado.text).not.toContain("/app/lgpd/requests/");
  });
});
