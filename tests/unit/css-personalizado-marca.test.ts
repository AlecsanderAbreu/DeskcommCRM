import { describe, expect, it } from "vitest";

import {
  CSS_PERSONALIZADO_MAX_BYTES,
  validarCssPersonalizado,
} from "@/lib/branding/css-personalizado";

describe("CSS personalizado da instalação", () => {
  it("aceita regras cosméticas e as escopa ao documento da instalação", () => {
    const resultado = validarCssPersonalizado(
      ".text-muted-foreground { color: #52645a; }\n.rounded-md:hover { border-radius: 12px; }",
    );

    expect(resultado.erro).toBeNull();
    expect(resultado.regras).toBe(2);
    expect(resultado.declaracoes).toBe(2);
    expect(resultado.css).toContain(":root:root .text-muted-foreground");
    expect(resultado.css).toContain(":root:root .rounded-md:hover");

    const filho = validarCssPersonalizado(".card > .card-title { color: #52645a; }");
    expect(filho.erro).toBeNull();
    expect(filho.css).toContain(":root:root .card > .card-title");
  });

  it("não injeta uma folha quando o campo está vazio", () => {
    expect(validarCssPersonalizado("  \n ")).toEqual({
      css: null,
      erro: null,
      regras: 0,
      declaracoes: 0,
    });
  });

  it.each([
    ["regra de tipo que alcança todo o documento", "body { color: red; }"],
    ["seletor universal", "* { color: red; }"],
    ["atributo que poderia selecionar credenciais", '[type="password"] { color: red; }'],
    ["posição que poderia sobrepor a interface", ".button { position: fixed; }"],
    ["propriedade que oculta controles", ".button { display: none; }"],
    ["diretiva e carregamento remoto", '@import url("https://example.invalid/a.css");'],
    ["URL remota", ".logo { color: url(https://example.invalid/a); }"],
    ["script dentro da tag de estilo", ".x { color: red; }</style><script>alert(1)</script>"],
    ["escape CSS", String.raw`.x\3a hover { color: red; }`],
    ["important que furaria a cascata", ".x { color: red !important; }"],
    ["at-rule aninhada", ".x { @media (min-width: 1px) { color: red; } }"],
    ["comentário", ".x { color: red; /* note */ }"],
  ])("recusa %s por padrão", (_caso, css) => {
    expect(validarCssPersonalizado(css).css).toBeNull();
    expect(validarCssPersonalizado(css).erro).toBeTruthy();
  });

  it("recusa seletor vazio, sintaxe inválida e folhas acima de 16 KB", () => {
    expect(validarCssPersonalizado(".x { color: red;").erro).toMatch(/sintaxe inválida/i);
    expect(validarCssPersonalizado(".x { color: red; }\nbody {color: blue}").css).toBeNull();
    expect(
      validarCssPersonalizado(`.x { color: ${"a".repeat(CSS_PERSONALIZADO_MAX_BYTES)}; }`).erro,
    ).toMatch(/16 KB/);
  });
});
