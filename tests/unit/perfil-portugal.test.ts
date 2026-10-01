// @vitest-environment node
import { describe, expect, it } from "vitest";

import { anonymize, detectResidualPii, padroesDePii } from "@/lib/ai/anonymize";
import {
  citacaoDaLei,
  isValidNif,
  paisesOferecidos,
  perfilDoPais,
} from "@/lib/legal/perfil-do-pais";

describe("perfil de Portugal (issue #1946)", () => {
  it("Portugal entra na lista que o seletor de Configurações oferece", () => {
    const codigos = paisesOferecidos().map((p) => p.codigo);
    expect(codigos).toContain("PT");
    expect(codigos).toContain("BR");
  });

  it("o perfil PT não decai para o Brasil quando pedido por código", () => {
    const perfil = perfilDoPais("PT");
    expect(perfil.codigo).toBe("PT");
    expect(perfil.nome).toBe("Portugal");
    expect(perfil.documento.rotulo).toBe("NIF");
    expect(perfil.telefoneExemplo).toBe("+351****5678");
  });

  it("documento NIF aceita o dígito de controlo (mod-11 público) e espaçado", () => {
    expect(isValidNif("123456789")).toBe(true);
    expect(isValidNif("123 456 789")).toBe(true);
    expect(perfilDoPais("PT").documento.valida("123456789")).toBe(true);
  });

  it("documento NIF recusa dígito trocado, repetido e CPF brasileiro", () => {
    expect(isValidNif("123456788")).toBe(false); // dígito de controlo trocado
    expect(isValidNif("999999999")).toBe(false); // repetido
    expect(perfilDoPais("PT").documento.valida("52998224725")).toBe(false); // CPF de 11 dígitos
  });

  it("o documento português confere dígito, não é só forma", () => {
    expect(perfilDoPais("PT").documento.confereDigito).toBe(true);
    expect(perfilDoPais("PT").documento.exemplo).toBe("123 456 789");
    // normalização guarda só os dígitos (a planilha não decide o formato do banco)
    expect(perfilDoPais("PT").documento.normaliza("123 456 789")).toBe("123456789");
  });

  it("o exemplo de telefone é de Portugal, não o DDI brasileiro", () => {
    expect(perfilDoPais("PT").telefoneExemplo).toMatch(/^\+351/);
    expect(perfilDoPais("PT").telefoneExemplo).not.toMatch(/^\+55/);
  });

  it("a lei é o RGPD (UE) 2016/679, art. 15, ainda fora de revisão", () => {
    const lei = perfilDoPais("PT").lei;
    expect(lei?.nome).toBe("RGPD");
    expect(lei?.numero).toContain("2016/679");
    expect(lei?.artigo).toContain("15");
    expect(lei?.revisada).toBe(false);
    // sem revisão o documento NÃO cita a lei (nem cai na LGPD): antes de revisar
    // é melhor não afirmar citação nenhuma do que afirmar a lei errada.
    expect(citacaoDaLei(perfilDoPais("PT"))).toBeNull();
  });

  it("o país entra na lista pelo checksum público, não pela lei revisada", () => {
    // prova a porta aberta no paisesOferecidos: PT está oferecido mesmo com
    // lei.revisada false e sem afirmar citação — o NIF chega a quem está em
    // Portugal enquanto o documento legal fica sem citação.
    const pt = paisesOferecidos().find((p) => p.codigo === "PT")!;
    expect(pt).toBeDefined();
    expect(pt.documento.confereDigito).toBe(true);
    expect(pt.lei?.revisada).toBe(false);
  });

  it("padroesDePii declara NIF e código postal 1234-567", () => {
    const tipos = padroesDePii([perfilDoPais("PT")]).map((p) => p.tipo);
    expect(tipos).toEqual(["nif", "codigoPostal", "email", "phone"]);
  });

  it("o anonimizador redige o NIF português e o código postal", () => {
    const padroes = padroesDePii([perfilDoPais("PT")]);
    const textoTurvo = anonymize("o NIF é 123456789 e mora no 1234-567", padroes);
    expect(textoTurvo.anonymized).toContain("[NIF]");
    expect(textoTurvo.anonymized).toContain("[CODIGO_POSTAL]");
    expect(textoTurvo.anonymized).not.toContain("123456789");
    expect(detectResidualPii("123456789 e 1234-567", padroes)).not.toBeNull();
  });

  it("o CPF brasileiro NÃO é confundido com o NIF português", () => {
    // os 11 dígitos do CPF não cabem no padrão de NIF (9 dígitos delimitados);
    // o universal de telefone pode mascará-lo no texto, mas nunca como NIF.
    const padroes = padroesDePii([perfilDoPais("PT")]);
    const texto = anonymize("CPF 52998224725 por aqui", padroes);
    expect(texto.hits.some((h) => h.type === "nif")).toBe(false);
    expect(detectResidualPii("52998224725", padroes)).not.toBe("nif");
  });
});