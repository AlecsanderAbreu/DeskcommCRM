import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * LGPD (#1991): o media-derive-worker NUNCA pode gravar uma transcrição
 * (`messages.media_derived_text`) numa mensagem que já foi redigida pela
 * anonimização. A virada de `is_anonymized` dispara um gatilho que já rodou e
 * não alcança esta gravação; a varredura diária (passo 9 de `lib/lgpd`) só
 * conserta em D+1. A correta é fechar NA ORIGEM: uma guarda no UPDATE final.
 *
 * O cenário da issue é a CORRIDA: o worker lê a mensagem (mídia presente) →
 * o contato é anonimizado (body vira `'[mensagem anonimizada]'`, mídia zerada)
 * → o worker tenta gravar. Sem a guarda ele regravaria o texto derivado numa
 * mensagem redigida; com ela, zero linhas são casadas e nada é gravado.
 *
 * O dublê emula o PostgREST do jeito que importa: o UPDATE só devolve a linha
 * casada quando a mensagem NÃO está redigida. É o análogo unit de o banco
 * aplicar `body <> '[mensagem anonimizada]'` no WHERE.
 */
const downloadMock = vi.fn();
const updateEqMock = vi.fn();

/** A linha que a mensagem tinha ANTES da anonimização (mídia presente). */
const messageRow = {
  id: "msg1",
  organization_id: "org1",
  type: "audio" as string,
  media_mime: "audio/ogg",
  media_storage_path: "org1/conv1/msg1.ogg" as string | null,
  media_derived_status: null as string | null,
};

let bindingDeVisao: { provider: string; model_id: string; credential_id: string | null } | null = null;
let agenteComVideo: Record<string, unknown> | null = { id: "v1" };

/**
 * Verdade do "banco": a mensagem está redigida agora? O teste vira isto no
 * MEIO do fluxo (no dublê de `deriveMediaText`), reproduzindo a corrida
 * "leu — anonimizou — grava".
 */
let redigida: boolean;

/** Os filtros (coluna, valor) que o worker pôs no UPDATE final. */
let filtrosDoUpdate: [string, string, string][];

/** Emula o corpo sentinela que a anonimização grava na mensagem. */
const BODY_ANONIMIZADO = "[mensagem anonimizada]";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const linha =
        tabela === "ai_purpose_bindings"
          ? bindingDeVisao
          : tabela === "ai_agent_versions"
            ? agenteComVideo
            : messageRow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const terminais: any = {
        maybeSingle: async () => ({ data: linha, error: null }),
        single: async () => ({ data: linha, error: null }),
        update: (patch: Record<string, unknown>) => {
          updateEqMock(patch);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const chain: any = new Proxy(
            {
              eq: (c: string, v: string) => {
                filtrosDoUpdate.push(["eq", c, v]);
                return chain;
              },
              neq: (c: string, v: string) => {
                filtrosDoUpdate.push(["neq", c, v]);
                return chain;
              },
              select: () => {
                filtrosDoUpdate.push(["select", "*", ""]);
                return chain;
              },
              then: (onFulfilled: (v: unknown) => void, onRejected?: (e: unknown) => void) => {
                // Redigida → o WHERE `body <> sentinela` casa ZERO linhas.
                const p = Promise.resolve({
                  data: redigida ? [] : [messageRow],
                  error: null,
                });
                return p.then(onFulfilled, onRejected);
              },
            },
            { get: (alvo, prop) => (prop in alvo ? alvo[prop as keyof typeof alvo] : () => chain) },
          );
          return chain;
        },
      };
      // A leitura (select) devolve a linha ANTES da virada — é o estado que o
      // worker efetivamente leu no começo do fluxo.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = new Proxy(terminais, {
        get: (alvo, prop) => (prop in alvo ? alvo[prop as keyof typeof alvo] : () => chain),
      });
      return chain;
    },
    storage: { from: () => ({ download: downloadMock }) },
  }),
}));

vi.mock("@/lib/messaging/media/derive", () => ({
  deriveMediaText: vi.fn(),
}));

vi.mock("@/lib/agent-engine/edge/llm/credentials", () => ({
  resolveOrgLlmConfig: vi.fn(async () => ({
    provider: "openai",
    apiKey: "sk-test",
    origemDaChave: "credencial_da_organizacao",
    defaultModel: "gpt-5",
    params: {},
    enabledModels: [],
    orcamento: { modo: "off" as const, tetoCents: 0, efetivoEm: null, limiarPct: 80 },
    orcamentoIndisponivelPorque: null,
    baseUrl: null,
  })),
}));

import { deriveMessageMedia, MENSAGEM_ANONIMIZADA } from "@/workers/media-derive-worker";
import { deriveMediaText } from "@/lib/messaging/media/derive";

function eventRow(attempts = 0) {
  return {
    id: "ev1",
    organization_id: "org1",
    event_type: "media.derive_requested",
    entity_kind: "message",
    entity_id: "msg1",
    payload: { message_id: "msg1" },
    metadata: {},
    consumed_by: [],
    attempts,
  };
}

/**
 * O dublê de `deriveMediaText` — o ponto em que a anonimização acontece.
 *
 * `viraRedigida=true` reproduz a corrida da issue: o worker já leu a mensagem
 * (mídia presente) e a virada de `is_anonymized` aconteceu ANTES da gravação
 * final. O texto derivado NÃO pode ser gravado aí.
 */
function derivarComViraRedigida() {
  vi.mocked(deriveMediaText).mockImplementation(async () => {
    redigida = true;
    return "transcrição do áudio real";
  });
}

describe("deriveMessageMedia — LGPD: não grava transcrição em mensagem já redigida (#1991)", () => {
  beforeEach(() => {
    redigida = false;
    filtrosDoUpdate = [];
    downloadMock.mockReset().mockResolvedValue({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null });
    updateEqMock.mockReset();
    messageRow.media_derived_status = null;
    messageRow.type = "audio";
    messageRow.media_storage_path = "org1/conv1/msg1.ogg";
    messageRow.media_mime = "audio/ogg";
    bindingDeVisao = null;
    agenteComVideo = { id: "v1" };
    vi.mocked(deriveMediaText).mockReset().mockResolvedValue("transcrição do áudio real");
  });

  it("a guarda `body <> mensagem anonimizada` está SEMPRE no UPDATE final", async () => {
    // Controle estrutural: numa mensagem NÃO redigida o worker grava (status ok)
    // mas ainda assim envia a guarda no WHERE — sem ela, a corrida voltaria a
    // regravar a mensagem redigida.
    const r = await deriveMessageMedia(eventRow());
    expect(r.status, "a mensagem viva deveria ser derivada").toBe("ok");

    const filtro = filtrosDoUpdate.find(([op, coluna]) => op === "neq" && coluna === "body");
    expect(filtro).toBeDefined();
    expect(filtro).toEqual(["neq", "body", BODY_ANONIMIZADO]);
    expect(MENSAGEM_ANONIMIZADA).toBe(BODY_ANONIMIZADO);
  });

  it("lê → anonimiza → grava: a transcrição NÃO é gravada (nenhum UPDATE efetivo)", async () => {
    // A corrida exata da issue: o worker lê a mensagem com mídia, o contato é
    // anonimizado entre a leitura e a gravação, e o UPDATE final então casa
    // zero linhas. O worker precisa deixar de afirmar sucesso.
    derivarComViraRedigida();

    const r = await deriveMessageMedia(eventRow());

    // A gravação não aconteceu: nada de "ok" sobre uma escrita recusada.
    expect(r.status).not.toBe("ok");
    expect(r.status).toBe("skipped");
    expect(r.detail).toBe("message_redacted");
  });

  it("mensagem viva (não redigida) grava normal — controle do caminho feliz", async () => {
    const r = await deriveMessageMedia(eventRow());
    expect(r.status).toBe("ok");
    expect(updateEqMock).toHaveBeenCalledWith(
      expect.objectContaining({ media_derived_text: "transcrição do áudio real", media_derived_status: "ready" }),
    );
  });
});