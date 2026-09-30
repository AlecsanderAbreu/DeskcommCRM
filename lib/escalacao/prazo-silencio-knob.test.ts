import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * O PRAZO ficou CONFIGURÁVEL (`ATENDIMENTO_MANUAL_SILENCIO_MIN`), e o que
 * precisa guardar não é o caminho feliz — é o fallback.
 *
 * `PRAZO_DO_SILENCIO_MS` é calculado no CARREGAMENTO do módulo e usado dentro da
 * ingestão de saída do canal. Uma instalação com a variável mal escrita não pode
 * ficar com a IA falando por cima de quem está atendendo à mão — que é
 * exatamente o defeito que este módulo existe para evitar. Então o teste
 * abaixo mede os valores que caem no padrão de 60 min.
 *
 * Por que `vi.resetModules()` + import dinâmico: a constante é resolvida uma
 * vez, no import. Trocar `process.env` depois não muda nada — o que é o
 * comportamento certo do produto, então o teste precisa exercitar o
 * carregamento.
 */
async function prazoComEnv(valor: string | undefined): Promise<number> {
  vi.resetModules();
  if (valor === undefined) {
    delete process.env.ATENDIMENTO_MANUAL_SILENCIO_MIN;
  } else {
    process.env.ATENDIMENTO_MANUAL_SILENCIO_MIN = valor;
  }
  const mod = await import("@/lib/escalacao/atendimento-manual");
  return mod.PRAZO_DO_SILENCIO_MS;
}

const PADRAO_MIN = 60;

describe("PRAZO_DO_SILENCIO_MS — knob ATENDIMENTO_MANUAL_SILENCIO_MIN", () => {
  const original = process.env.ATENDIMENTO_MANUAL_SILENCIO_MIN;

  beforeEach(() => {
    delete process.env.ATENDIMENTO_MANUAL_SILENCIO_MIN;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ATENDIMENTO_MANUAL_SILENCIO_MIN;
    } else {
      process.env.ATENDIMENTO_MANUAL_SILENCIO_MIN = original;
    }
    vi.resetModules();
  });

  it("SEM a variável mantém o prazo documentado de 60 minutos", async () => {
    expect(await prazoComEnv(undefined)).toBe(PADRAO_MIN * 60_000);
  });

  it("lê minutos inteiros", async () => {
    expect(await prazoComEnv("15")).toBe(15 * 60_000);
  });

  it("lê minutos decimais (quem quer 7m30s não precisa converter)", async () => {
    expect(await prazoComEnv("7.5")).toBe(7.5 * 60_000);
  });

  it("aceita número sem decimais vindo como float de env", async () => {
    expect(await prazoComEnv("30")).toBe(30 * 60_000);
  });

  // ── Os casos que caem no padrão. Cada um deles, se vazasse, colocaria NaN ou
  // um prazo absurdo em `bot_silenced_until` — e a IA passaria a falar por
  // cima do humano.
  it.each([
    ["vazio", ""],
    ["só espaços", "   "],
    ["texto", "quinze"],
    ["zero", "0"],
    ["negativo", "-15"],
    ["lixo com numero", "15 min"],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
  ])("valor inválido (%s) cai no padrão de 60 min", async (_rotulo, valor) => {
    expect(await prazoComEnv(valor)).toBe(PADRAO_MIN * 60_000);
  });
});
