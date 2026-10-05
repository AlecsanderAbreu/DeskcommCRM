// @vitest-environment node
/**
 * A MÁSCARA DA INGESTÃO TEM O BRASIL POR BAIXO DE QUALQUER PAÍS (doc 88).
 *
 * Uma organização que troca de BR para PT continua tendo cliente brasileiro na
 * conversa. Com só os padrões de Portugal, `CPF 123.456.789-09` e
 * `CEP 01310-100` passavam intactos para o índice do RAG — a própria troca de
 * país desligava a máscara que existia antes dela.
 */
import { describe, expect, it } from "vitest";

import { anonymize, padroesDaIngestao, padroesDePii } from "@/lib/ai/anonymize";
import { perfilDoPais } from "@/lib/legal/perfil-do-pais";

describe("máscara da ingestão para o RAG", () => {
  it("Brasil: exatamente a máscara de antes", () => {
    expect(padroesDaIngestao(perfilDoPais("BR"))).toEqual(padroesDePii([perfilDoPais("BR")]));
  });

  it("Portugal: mascara o próprio documento E continua mascarando CPF e CEP", () => {
    const { anonymized } = anonymize(
      "CPF 123.456.789-09, CEP 01310-100, NIF 123456789, morada 1000-001 Lisboa",
      padroesDaIngestao(perfilDoPais("PT")),
    );
    expect(anonymized).toBe("CPF [CPF], CEP [CEP], NIF [NIF], morada [CODIGO_POSTAL] Lisboa");
  });
});
