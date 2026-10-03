import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ valorDaInstalacao: vi.fn() }));
vi.mock("@/lib/instalacao/config", () => ({ valorDaInstalacao: mocks.valorDaInstalacao }));

import {
  CHAVE_CSS_PERSONALIZADO,
  cssPersonalizadoDaInstalacao,
  invalidarCssPersonalizadoDaInstalacao,
} from "./css-personalizado";

type EstadoMemo = typeof globalThis & {
  __cssPersonalizadoDaInstalacao?: unknown;
  __geracaoCssPersonalizadoDaInstalacao?: number;
};

const estado = globalThis as EstadoMemo;

describe("leitura do CSS personalizado da instalação", () => {
  beforeEach(() => {
    delete estado.__cssPersonalizadoDaInstalacao;
    estado.__geracaoCssPersonalizadoDaInstalacao = 0;
    mocks.valorDaInstalacao.mockReset();
  });

  it("usa a chave de configuração e mantém memo até a invalidação da escrita", async () => {
    mocks.valorDaInstalacao
      .mockResolvedValueOnce({ valor: ".login { color: #123456; }", fonte: "banco" })
      .mockResolvedValueOnce({ valor: ".login { color: #654321; }", fonte: "banco" });

    expect(await cssPersonalizadoDaInstalacao()).toBe(".login { color: #123456; }");
    expect(await cssPersonalizadoDaInstalacao()).toBe(".login { color: #123456; }");
    expect(mocks.valorDaInstalacao).toHaveBeenCalledTimes(1);
    expect(mocks.valorDaInstalacao).toHaveBeenCalledWith(CHAVE_CSS_PERSONALIZADO);

    invalidarCssPersonalizadoDaInstalacao();
    expect(await cssPersonalizadoDaInstalacao()).toBe(".login { color: #654321; }");
    expect(mocks.valorDaInstalacao).toHaveBeenCalledTimes(2);
  });

  it("devolve texto vazio se a configuração não tem folha", async () => {
    mocks.valorDaInstalacao.mockResolvedValue({ valor: null, fonte: "ausente" });

    expect(await cssPersonalizadoDaInstalacao()).toBe("");
  });
});
