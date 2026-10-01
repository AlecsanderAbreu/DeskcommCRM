/**
 * Venda de quem veio de anúncio da Meta para a PÁGINA — e o valor lido da conversa.
 *
 * Os modos de falha que este arquivo vigia:
 *  - lead da página com UTM da Meta ganho e NADA no Histórico (o silêncio que
 *    originou a mudança);
 *  - venda orgânica (ou de outra plataforma) indo para a conta de anúncios;
 *  - evento sem clique saindo como `business_messaging`, que a Meta recusa;
 *  - valor inventado pelo modelo chegando à Meta.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { conversaoDeVendaHandler } from "@/lib/conversoes/envio.handler";
import { lerAtribuicao } from "@/lib/conversoes/leitura-da-atribuicao";
import { lerValorDaConversa } from "@/lib/conversoes/valor-da-conversa";
import type { EventRow } from "@/lib/event-log/dispatcher";
import { INTERNOS, transporteMeta } from "@/lib/plataformas-de-anuncio/meta/conversions";
import type { ConversaoOffline } from "@/lib/plataformas-de-anuncio/types";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/conversoes/valor-da-conversa", () => ({ lerValorDaConversa: vi.fn() }));

const ORG = "11111111-1111-1111-1111-111111111111";
const LEAD = "22222222-2222-2222-2222-222222222222";
const CONTATO = "33333333-3333-3333-3333-333333333333";

const upserts: { tabela: string; valores: Record<string, unknown> }[] = [];

function fakeAdmin(tabelas: Record<string, unknown>) {
  return {
    from(tabela: string) {
      const construtor = {
        select: () => construtor,
        eq: () => construtor,
        neq: () => construtor,
        order: () => construtor,
        limit: () => construtor,
        maybeSingle: async () => ({ data: tabelas[tabela] ?? null, error: null }),
        upsert: async (valores: Record<string, unknown>) => {
          upserts.push({ tabela, valores });
          return { error: null };
        },
      };
      return construtor;
    },
    rpc: async () => ({ data: "token-decifrado", error: null }),
  };
}

const contatoDaPagina = (utm_source: string) => ({
  phone_number: "+55 (11) 98888-7777",
  source_metadata: { ad_platform: "site", ad_source_id: null, origem: "site", utm_source },
});

const leadGanhoSemValor = {
  id: LEAD,
  status: "won",
  value_cents: null,
  currency: "BRL",
  closed_at: new Date().toISOString(),
  contact_id: CONTATO,
};

const conexaoAtiva = {
  dataset_id: "123456789012345",
  access_token_encrypted: "\\xdeadbeef",
  test_event_code: null,
  enabled: true,
};

function evento(tipo: string): EventRow {
  return {
    id: "evt",
    organization_id: ORG,
    event_type: tipo,
    entity_kind: "crm_lead",
    entity_id: LEAD,
    payload: {},
    metadata: {},
    consumed_by: [],
    attempts: 0,
    created_at: new Date().toISOString(),
  };
}

interface EventoEnviado {
  action_source: string;
  messaging_channel?: string;
  user_data: { ctwa_clid?: string; ph?: string[] };
  custom_data: { value: number; currency: string; content_name?: string };
}

function corpoEnviado(spy: ReturnType<typeof vi.spyOn>): EventoEnviado {
  const init = spy.mock.calls[0]?.[1] as RequestInit;
  return (JSON.parse(String(init.body)) as { data: EventoEnviado[] }).data[0]!;
}

beforeEach(() => {
  upserts.length = 0;
  vi.restoreAllMocks();
  vi.mocked(lerValorDaConversa).mockReset();
});

describe("quem veio da página com UTM da Meta conta como anúncio", () => {
  it.each(["meta", "facebook", "fb", "instagram", "ig", " Meta "])(
    "utm_source=%s vira atribuição da Meta, identificada pelo telefone",
    async (utm) => {
      const r = await lerAtribuicao(
        fakeAdmin({ contacts: contatoDaPagina(utm) }) as never,
        ORG,
        CONTATO,
      );
      expect(r).toEqual({
        temAtribuicao: true,
        atribuicao: { plataforma: "meta_ads", cliqueDeOrigem: "", telefone: "5511988887777" },
      });
    },
  );

  it.each(["google", "facebook_organico", "newsletter", ""])(
    "utm_source=%s NÃO vai para a Meta — venda orgânica fica fora",
    async (utm) => {
      const r = await lerAtribuicao(
        fakeAdmin({ contacts: contatoDaPagina(utm) }) as never,
        ORG,
        CONTATO,
      );
      expect(r).toEqual({ temAtribuicao: false, motivo: "sem_atribuicao" });
    },
  );
});

describe("o envio sem clique", () => {
  const conversao = (extra: Partial<ConversaoOffline> = {}): ConversaoOffline => ({
    organizationId: ORG,
    leadId: LEAD,
    evento: "Purchase",
    eventoId: `${LEAD}:Purchase`,
    ocorridoEm: new Date(),
    cliqueDeOrigem: "",
    telefone: "5511988887777",
    valorCentavos: 497_90,
    moeda: "BRL",
    produto: "Mentoria Speed",
    ...extra,
  });
  const credencial = { datasetId: "123", accessToken: "tok", testEventCode: null };

  it("sai como system_generated, sem ctwa_clid, com telefone em hash e o produto", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response('{"events_received":1}', { status: 200 }));

    const r = await transporteMeta.enviar(credencial, conversao());

    expect(r.tipo).toBe("ok");
    const ev = corpoEnviado(spy);
    expect(ev.action_source).toBe("system_generated");
    expect(ev.messaging_channel).toBeUndefined();
    expect(ev.user_data.ctwa_clid).toBeUndefined();
    expect(ev.user_data.ph).toEqual([INTERNOS.hash("5511988887777")]);
    expect(ev.custom_data).toEqual({ value: 497.9, currency: "BRL", content_name: "Mentoria Speed" });
  });

  it("com clique, continua business_messaging (o caminho de sempre não muda)", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response('{"events_received":1}', { status: 200 }));

    await transporteMeta.enviar(credencial, conversao({ cliqueDeOrigem: "CLIQUE", produto: null }));

    const ev = corpoEnviado(spy);
    expect(ev.action_source).toBe("business_messaging");
    expect(ev.messaging_channel).toBe("whatsapp");
    expect(ev.user_data.ctwa_clid).toBe("CLIQUE");
    expect(ev.custom_data.content_name).toBeUndefined();
  });

  it("sem clique e sem telefone é recusa permanente, sem falar com a rede", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const r = await transporteMeta.enviar(credencial, conversao({ telefone: null }));
    expect(r.tipo).toBe("permanente");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("a venda ganha sem valor, de ponta a ponta no handler", () => {
  it("usa o valor lido da conversa, envia e registra no Histórico com o trecho", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({
        crm_leads: leadGanhoSemValor,
        contacts: contatoDaPagina("meta"),
        ad_platform_connections: conexaoAtiva,
      }) as never,
    );
    vi.mocked(lerValorDaConversa).mockResolvedValue({
      ok: true,
      valorCentavos: 497_00,
      moeda: "BRL",
      produto: "Mentoria",
      trecho: "fechado, 497 no pix",
    });
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response('{"events_received":1}', { status: 200 }));

    const r = await conversaoDeVendaHandler.handle(evento("lead.won"));

    expect(r.status).toBe("ok");
    expect(corpoEnviado(spy).custom_data).toEqual({
      value: 497,
      currency: "BRL",
      content_name: "Mentoria",
    });
    const linha = upserts.at(-1)?.valores;
    expect(linha?.status).toBe("sent");
    expect(linha?.platform).toBe("meta_ads");
    expect(linha?.value_cents).toBe(497_00);
    expect(String(linha?.detail)).toContain("fechado, 497 no pix");
  });

  it("sem valor na conversa: pendência sem_valor VISÍVEL, com o motivo, e nada sai", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({
        crm_leads: leadGanhoSemValor,
        contacts: contatoDaPagina("meta"),
        ad_platform_connections: conexaoAtiva,
      }) as never,
    );
    vi.mocked(lerValorDaConversa).mockResolvedValue({
      ok: false,
      motivo: "A IA não encontrou o valor da venda dito na conversa.",
    });
    const spy = vi.spyOn(globalThis, "fetch");

    const r = await conversaoDeVendaHandler.handle(evento("lead.won"));

    expect(r.detail).toBe("sem_valor");
    expect(spy).not.toHaveBeenCalled();
    const linha = upserts.at(-1)?.valores;
    expect(linha?.status).toBe("skipped");
    expect(linha?.reason).toBe("sem_valor");
    expect(linha?.detail).toBe("A IA não encontrou o valor da venda dito na conversa.");
  });

  it("valor preenchido no negócio vence: a conversa nem é lida", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({
        crm_leads: { ...leadGanhoSemValor, value_cents: 250_00 },
        contacts: contatoDaPagina("meta"),
        ad_platform_connections: conexaoAtiva,
      }) as never,
    );
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response('{"events_received":1}', { status: 200 }));

    await conversaoDeVendaHandler.handle(evento("lead.won"));

    expect(lerValorDaConversa).not.toHaveBeenCalled();
    expect(corpoEnviado(spy).custom_data.value).toBe(250);
  });

  it("venda orgânica continua fora: sem leitura de conversa, sem envio, sem linha", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({
        crm_leads: leadGanhoSemValor,
        contacts: contatoDaPagina("google"),
        ad_platform_connections: conexaoAtiva,
      }) as never,
    );
    const spy = vi.spyOn(globalThis, "fetch");

    const r = await conversaoDeVendaHandler.handle(evento("lead.won"));

    expect(r.detail).toBe("sem_atribuicao");
    expect(lerValorDaConversa).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
  });
});
