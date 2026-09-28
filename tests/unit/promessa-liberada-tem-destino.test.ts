/**
 * A PROMESSA LIBERADA TEM DESTINO — e agora isso é PROVADO.
 *
 * ═══ O DEFEITO, MEDIDO EM PRODUÇÃO (2026-09-16) ═══
 *
 * O agente escreveu ao cliente: *"Vou encaminhar as informações do site
 * imobiliário para análise e te retorno com a proposta."* O cliente saiu da
 * conversa esperando um orçamento. O sistema produziu ZERO casos humanos, ZERO
 * follow-ups, ZERO avisos na Central.
 *
 * O gate `casePromiseGate` (código `case_promise_without_case`) disparou UMA vez
 * — o modelo reformulou, e a segunda formulação PASSOU. O fail-safe de 2ª
 * camada, que auto-abre um caso mínimo quando a promessa insiste, NUNCA foi
 * alcançado. A causa era a DETECÇÃO: o detector léxico (`detectHumanPromise`)
 * exige palavra de alvo humano colada ao verbo, e um objeto no meio da frase
 * ("as informações") já o despistava. Cinco das sete frases medidas vazavam.
 *
 * ═══ O QUE A TAREFA 7 CONSERTOU ═══
 *
 * A camada semântica passou a perguntar ao classificador que já roda a cada
 * envio se a mensagem promete que alguém da empresa volta a falar com o cliente.
 * Com a detecção funcionando, o fail-safe de 2ª camada (que já existia em
 * `inbound-turn.ts`) passa a ser alcançável — o veto deixa de ser um filtro de
 * formulação e vira a trava que o desenho sempre prometeu.
 *
 * ═══ O QUE A TAREFA 9 ACRESCENTOU, E O QUE ESTA CERCA GUARDA ═══
 *
 * O mecanismo de avisar "o assistente prometeu e ninguém ficou responsável" já
 * existe inteiro (declaração → Operador → aviso na Central). O que faltava era
 * o sistema CONFERIR a declaração do modelo contra o que ele mesmo detectou: o
 * modelo pode omitir a promessa, o Zod preenche `promessas: []`, e o Operador lê
 * "nada a fazer". A Tarefa 9 fez o turno registrar a promessa flagrada lendo
 * DUAS fontes em OU — o contador de vetos (`casePromiseVetoCount > 0`) e o
 * detector léxico (`detectHumanPromise(body)`) —, e completar a declaração antes
 * de gravar o checkpoint.
 *
 * A SEGUNDA FONTE é a que cobre o caminho em que o contato JÁ TEM caso aberto:
 * ali o gate libera na primeira linha, não há veto, e o contador nunca sobe. É
 * o caminho em que a promessa nova fica pendurada num caso ALHEIO, sobre outro
 * assunto, cujo dono não sabe dela. Medido em 2026-09-16: tirar essa metade
 * deixou **182 testes verdes**. Sem cerca, a próxima sessão apaga a linha sem
 * saber o que perdeu — e é por isso que os casos abaixo existem.
 *
 * ═══ POR QUE A MEDIÇÃO É NO TEXTO, E NÃO DE PONTA A PONTA ═══
 *
 * O fail-safe vive DENTRO de `executarTurnoDoAgente` (`inbound-turn.ts`, ~4229
 * linhas). Dirigir esse turno num teste de unidade exige pool, config de LLM,
 * canal, job e fila — caro demais, e o que se prova aqui é pequeno e exato.
 *
 * O repositório JÁ tem precedente para exatamente isto — `handoff-por-orcamento.test.ts`,
 * cujo cabeçalho diz:
 *
 *   *"O CALL SITE não é alcançável por unidade (…). Para esses dois, a
 *   propriedade é medida ONDE ELA MORA — no texto — com controle negativo
 *   obrigatório: sem ele, um detector quebrado deixaria o arquivo verde por não
 *   medir nada."*
 *
 * A régua lê o FONTE de `inbound-turn.ts`, extrai o bloco do veto pela AST
 * (nunca por regex sobre o arquivo inteiro — a palavra `case_promise_without_case`
 * aparece também em comentário, e um regex pegaria o lugar errado), e assere
 * cada item do contrato do fail-safe. Os casos do REGISTRO da promessa (segundo
 * `describe`) usam a mesma técnica, com o mesmo controle negativo obrigatório.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import ts from "typescript";

const RAIZ = process.cwd();
const INBOUND = join(RAIZ, "lib/agent-engine/agent/inbound-turn.ts");

/**
 * Extrai o bloco do veto `case_promise_without_case` da fonte.
 *
 * Pela AST, e não por regex sobre o texto inteiro: a palavra aparece também em
 * um comentário em outro ponto do arquivo, e um regex pegando a PRIMEIRA
 * ocorrência mediria o comentário. O percurso procura um `IfStatement` cuja
 * CONDIÇÃO mencione `case_promise_without_case` — comentário não é nó de AST, e
 * o `IfStatement` do fail-safe é único.
 *
 * O bloco devolvido inclui o STATEMENT ANTERIOR (a chamada inicial a
 * `runBeforeSend`) além do `if`. Sem isso, a asserção "a cadeia é RE-RODADA"
 * perderia metade da prova: a chamada inicial fica FORA do `if`, e o que a
 * propriedade mede é justamente a PRESENÇA DAS DUAS — a inicial e a re-chamada
 * depois do caso aberto. Trazer só o `if` faria "pelo menos duas vezes" virar
 * "pelo menos uma", que é o defeito que a régua existe para impedir.
 */
function blocoDoVeto(fonte: string): string | null {
  const ast = ts.createSourceFile("inbound.ts", fonte, ts.ScriptTarget.Latest, true);
  let encontrado: string | null = null;
  function visit(node: ts.Node): void {
    if (encontrado !== null) return;
    if (ts.isIfStatement(node)) {
      const condicao = node.expression.getText(ast);
      if (condicao.includes("case_promise_without_case")) {
        const pai = node.parent;
        const irmaos =
          ts.isBlock(pai) || ts.isSourceFile(pai) ? pai.statements : null;
        const idx = irmaos ? irmaos.indexOf(node) : -1;
        const anterior = irmaos && idx > 0 ? irmaos[idx - 1] : null;
        const ini = anterior ? anterior.getStart(ast) : node.getStart(ast);
        encontrado = fonte.slice(ini, node.getEnd());
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return encontrado;
}

/** O que o detector devolve — cada chave é um item do contrato do fail-safe. */
interface Achados {
  /** O contador de vetos no turno é incrementado. */
  contador: boolean;
  /** O 1º veto ENSINA — saída antecipada ANTES de abrir o caso. */
  ensinaPrimeiro: boolean;
  /** O 2º veto ABRE caso. */
  abreCaso: boolean;
  /** A origem gravada no caso é a que o desenho promete. */
  origemCerta: boolean;
  /** Caso que não pôde ser aberto NÃO libera a promessa. */
  falhaNaoLibera: boolean;
  /** A cadeia é RE-RODADA depois do caso — o canal não é chamado por fora. */
  reRodaCadeia: boolean;
}

const ZERADO: Achados = {
  contador: false,
  ensinaPrimeiro: false,
  abreCaso: false,
  origemCerta: false,
  falhaNaoLibera: false,
  reRodaCadeia: false,
};

/**
 * O DETECTOR. Roda sobre o bloco extraído — ou sobre uma fonte falsa, no
 * controle negativo. Um só, para que o controle negativo MEÇA o mesmo
 * instrumento que os casos positivos usam: dois detectores separados deixariam
 * o controle negativo medindo um aparelho que ninguém usa em produção.
 */
function analisa(bloco: string | null): Achados {
  if (bloco === null || bloco === "") return ZERADO;

  const contador = bloco.includes("casePromiseVetoCount += 1");

  // A fronteira é a PRIMEIRA chamada a `openCase(` no bloco. Tudo antes dela é o
  // caminho do ENSINO (1º veto); tudo depois é o caminho de ABRIR (2º veto).
  const idxOpen = bloco.indexOf("openCase(");
  const antesDoOpen = idxOpen === -1 ? bloco : bloco.slice(0, idxOpen);
  const depoisDoOpen = idxOpen === -1 ? "" : bloco.slice(idxOpen);

  const ensinaPrimeiro =
    /casePromiseVetoCount\s*<\s*2/.test(antesDoOpen) && /\breturn\b/.test(antesDoOpen);

  const abreCaso = idxOpen !== -1;

  // A origem aparece como string literal com aspas simples ou duplas — aceitar
  // as duas evita que uma troca de estilo de aspas desarme a régua sem ninguém ver.
  const origemCerta =
    bloco.includes("'guardrail_autofallback'") ||
    bloco.includes('"guardrail_autofallback"');

  const falhaNaoLibera =
    /if\s*\(\s*!\s*\w+\.ok\s*\)/.test(depoisDoOpen) &&
    /return\s*\{[^}]*\berror\b/.test(depoisDoOpen);

  // "Pelo menos duas" faz sentido porque o bloco traz o STATEMENT ANTERIOR — a
  // chamada inicial a `runBeforeSend` — além da re-chamada dentro do `if`.
  const ocorrencias = (bloco.match(/runBeforeSend\s*\(/g) ?? []).length;
  const reRodaCadeia = ocorrencias >= 2 && /hasOpenCase\s*:\s*true/.test(bloco);

  return { contador, ensinaPrimeiro, abreCaso, origemCerta, falhaNaoLibera, reRodaCadeia };
}

/** O veredito agregado — todos os itens do contrato ao mesmo tempo. */
function temDestino(a: Achados): boolean {
  return (
    a.contador &&
    a.ensinaPrimeiro &&
    a.abreCaso &&
    a.origemCerta &&
    a.falhaNaoLibera &&
    a.reRodaCadeia
  );
}

const FONTE = readFileSync(INBOUND, "utf8");
const BLOCO = blocoDoVeto(FONTE);

describe("o fail-safe de promessa de retorno tem destino", () => {
  it("7. CONTROLE DE ANCORAGEM — arquivo e bloco foram mesmo encontrados", () => {
    // Sem este caso, uma varredura que devolvesse `null` faria o detector zerar
    // TODAS as chaves, e os casos abaixo passariam... verdes? Não — mas o
    // controle negativo também passaria, e aí a suíte inteira seria vácuo. Esta
    // é a guarda que diz que o aparelho mediu o arquivo certo.
    expect(FONTE.split("\n").length, "arquivo do turno suspeito de ter sido esvaziado").toBeGreaterThan(3000);
    expect(BLOCO, "a AST não achou o `if` do veto case_promise_without_case").not.toBeNull();
    expect((BLOCO ?? "").length, "o bloco extraído é vazio").toBeGreaterThan(0);
  });

  it("1. o ramo do veto existe e incrementa o contador", () => {
    // O contador por-turno (closure) é o que permite o desenho de duas camadas:
    // 1º veto ensina; 2º veto abre. Sem ele, ou todo veto abriria caso (ruído),
    // ou nenhum abriria (a invariante ferida no silêncio).
    expect(analisa(BLOCO).contador).toBe(true);
  });

  it("2. o PRIMEIRO veto ensina — há saída antecipada abaixo de 2", () => {
    // O modelo precisa ver o erro INSTRUTIVO e ter chance de abrir o caso OU
    // reformular sem prometer. Sem esta saída, o 1º veto já abriria caso — e o
    // desenho de "duas camadas" cairia pela metade.
    expect(analisa(BLOCO).ensinaPrimeiro).toBe(true);
  });

  it("3. o SEGUNDO veto abre caso, com a origem certa", () => {
    // `openCase(` é o que transforma a promessa liberada em DESTINO — um caso
    // humano que alguém vai resolver. `'guardrail_autofallback'` é a origem que
    // marca o caminho: quem lê o caso depois sabe que foi o SISTEMA quem o
    // abriu, não o modelo (e por isso não pede contexto que o modelo nunca deu).
    const a = analisa(BLOCO);
    expect(a.abreCaso).toBe(true);
    expect(a.origemCerta).toBe(true);
  });

  it("4. caso que não pôde ser aberto NÃO libera a promessa", () => {
    // Bug clássico do conserto "óbvio": abrir o caso, esquecer de checar se ele
    // FOI aberto, e liberar a promessa assim mesmo. Fere a invariante
    // EXATAMENTE quando o sistema está com defeito — o pior momento possível.
    expect(analisa(BLOCO).falhaNaoLibera).toBe(true);
  });

  it("5. depois do caso, a cadeia é RE-RODADA — o canal não é chamado por fora", () => {
    // A tentação `óbvia e errada` seria: abre o caso, chama o canal direto. Isso
    // PERDERIA pacing, LGPD e opt-out — todos vivem dentro de `runBeforeSend`.
    // A re-chamada com `hasOpenCase: true` faz o gate ver o caso novo e passar
    // pelo caminho legítimo. "Pelo menos duas" só é verdade porque o extrator
    // traz o statement anterior: a chamada inicial e a re-chamada.
    expect(analisa(BLOCO).reRodaCadeia).toBe(true);
  });

  it("6. CONTROLE NEGATIVO — o detector fica vermelho numa fonte SEM o fail-safe", () => {
    // ⛔ SEM ESTE CASO, tudo acima é teatro. Um detector que procura strings
    // pode ficar verde por NÃO MEDIR NADA — uma busca cujo alvo foi renomeado
    // devolve `false` para todos e a suíte não percebe. Aqui, a MESMA função é
    // rodada sobre uma fonte FALSA que tem o `if` do veto e NADA MAIS: sem o
    // contador, sem `openCase`, sem origem, sem re-chamada. Se o detector
    // aprovasse essa fonte, ele estaria quebrado — e o verde dos casos 1 a 5
    // não significaria nada.
    const FALSA = [
      "async function f() {",
      "  let chain = await runBeforeSend(beforeSendArgs);",
      "  if (chain.status === 'vetoed' && chain.code === 'case_promise_without_case') {",
      "    return { ok: false, error: { code: chain.code, message: chain.message } };",
      "  }",
      "}",
    ].join("\n");

    const blocoFalso = blocoDoVeto(FALSA);
    expect(
      blocoFalso,
      "o extrator não achou o `if` na fonte falsa — o controle negativo mediria o vazio",
    ).not.toBeNull();

    const a = analisa(blocoFalso);
    expect(a.contador, "detector aprovou uma fonte sem contador").toBe(false);
    expect(a.abreCaso, "detector aprovou uma fonte sem `openCase`").toBe(false);
    expect(a.origemCerta, "detector aprovou uma fonte sem origem de fail-safe").toBe(false);
    expect(a.falhaNaoLibera, "detector aprovou uma fonte sem checagem de falha").toBe(false);
    expect(
      temDestino(a),
      "detector aprovou um fail-safe inexistente — os casos positivos estavam medindo o vazio",
    ).toBe(false);
  });
});

/**
 * ═══ O REGISTRO DA PROMESSA FLAGRADA (Tarefa 9) ═══
 *
 * O turno grava `promessaFlagradaEsteTurno = { houve: true, texto: body }` para
 * o sistema completar a declaração do modelo antes de gravar o checkpoint. O
 * sinal vem de DUAS fontes somadas em OU: o CONTADOR de vetos e o DETECTOR
 * LÉXICO. A segunda cobre o caminho em que o contato JÁ TEM caso aberto (sem
 * veto, o contador fica em zero) — é a metade que a sabotagem derruba, medida
 * em 2026-09-16, e por isso tem asserção própria e controle negativo.
 *
 * A extração é pela AST, mesma razão do `blocoDoVeto`: `promessaFlagradaEsteTurno`
 * aparece em três pontos (a declaração, a atribuição aqui, o consumo em
 * `insertCheckpoint`), e um regex pegaria o lugar errado.
 */

/** O bloco do registro: a fonte do `if` inteira e a CONDIÇÃO, separadas. */
interface BlocoDoRegistro {
  texto: string;
  condicao: string;
}

/**
 * Extrai o bloco do registro da promessa.
 *
 * Procura o `IfStatement` cuja CONDIÇÃO menciona `casePromiseVetoCount` E cujo
 * TEXTO menciona `detectHumanPromise` e `promessaFlagradaEsteTurno`. As três
 * juntas distinguem o registro do resto: o `if (casePromiseVetoCount < 2)` do
 * fail-safe tem a mesma variável mas nenhuma das outras duas strings, e por
 * isso não é escolhido.
 */
function blocoDoRegistro(fonte: string): BlocoDoRegistro | null {
  const ast = ts.createSourceFile("inbound.ts", fonte, ts.ScriptTarget.Latest, true);
  let encontrado: BlocoDoRegistro | null = null;
  function visit(node: ts.Node): void {
    if (encontrado !== null) return;
    if (ts.isIfStatement(node)) {
      const condicao = node.expression.getText(ast);
      const texto = node.getText(ast);
      if (
        condicao.includes("casePromiseVetoCount") &&
        texto.includes("detectHumanPromise") &&
        texto.includes("promessaFlagradaEsteTurno")
      ) {
        encontrado = { texto, condicao };
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return encontrado;
}

interface AchadosDoRegistro {
  leContador: boolean;
  leLexico: boolean;
  somaEmOu: boolean;
}

const REGISTRO_ZERADO: AchadosDoRegistro = {
  leContador: false,
  leLexico: false,
  somaEmOu: false,
};

/**
 * O DETECTOR do registro. Roda sobre o bloco extraído — ou sobre a fonte falsa,
 * no controle negativo. Um só, pela mesma razão do detector do veto: dois
 * instrumentos separados deixariam o controle negativo medindo um aparelho que
 * ninguém usa em produção.
 */
function analisaRegistro(b: BlocoDoRegistro | null): AchadosDoRegistro {
  if (b === null) return REGISTRO_ZERADO;
  const leContador = b.condicao.includes("casePromiseVetoCount > 0");
  const leLexico = b.condicao.includes("detectHumanPromise(");
  // O OU é o que faz as duas fontes se completarem: o contador cobre o caminho
  // do veto; o léxico cobre o caminho com caso já aberto. Exigir as duas faria a
  // segunda nunca disparar sozinha.
  const somaEmOu = b.condicao.includes("||") && !b.condicao.includes("&&");
  return { leContador, leLexico, somaEmOu };
}

/** O veredito agregado do registro — as três chaves ao mesmo tempo. */
function temRegistroCompleto(b: BlocoDoRegistro | null): boolean {
  const a = analisaRegistro(b);
  return a.leContador && a.leLexico && a.somaEmOu;
}

describe("o registro da promessa flagrada lê as duas fontes", () => {
  const REGISTRO = blocoDoRegistro(FONTE);

  it("0. CONTROLE DE ANCORAGEM — o bloco do registro foi mesmo encontrado", () => {
    // Sem esta guarda, um extrator quebrado devolveria `null` e os casos abaixo
    // passariam por VÁCUO — a mesma armadilha que `blocoDoVeto` evita no
    // primeiro `describe`.
    expect(REGISTRO, "a AST não achou o `if` do registro da promessa").not.toBeNull();
    expect((REGISTRO?.texto ?? "").length, "o bloco do registro é vazio").toBeGreaterThan(0);
  });

  it("1. o registro lê o CONTADOR de vetos", () => {
    // Primeira das duas fontes. Cobre o caminho em que o gate de promessa vetou —
    // e é o único caminho que a sabotagem de 2026-09-16 deixava coberto.
    expect(analisaRegistro(REGISTRO).leContador).toBe(true);
  });

  it("2. o registro TAMBÉM lê o detector léxico — a metade que a sabotagem derruba", () => {
    // ⛔ ESTA É A ASSERÇÃO QUE A SABOTAGEM DERRUBA. Medido em 2026-09-16: tirar
    // esta metade deixou 182 testes VERDES — a suíte inteira. Ela cobre o
    // caminho em que o contato JÁ TEM caso aberto: ali o gate sai na primeira
    // linha (`if (ctx.hasOpenCase || ctx.openedCaseThisTurn) return { pass:
    // true }`), não há veto, e o contador nunca sobe. Se a única fonte fosse o
    // contador, a promessa flagrada naquele caminho ficaria invisível — e é
    // exatamente o caminho em que ela fica pendurada num caso ALHEIO, sobre
    // outro assunto, cujo dono não sabe dela. Sem cerca, a próxima sessão
    // apaga esta linha sem saber o que perdeu.
    expect(analisaRegistro(REGISTRO).leLexico).toBe(true);
  });

  it("3. as duas fontes são somadas em OU, não em E", () => {
    // Exigir as duas faria o conserto não consertar nada: o contador só sobe no
    // caminho em que há veto, e o léxico é a única fonte no caminho com caso
    // aberto. Um `&&` entre elas deixaria ambos os caminhos sem registro — o
    // buraco original com a aparência de coberto.
    const a = analisaRegistro(REGISTRO);
    expect(a.somaEmOu).toBe(true);
  });

  it("4. o registro vive DEPOIS do tratamento do veto", () => {
    // Há uma cerca de texto-fonte em `tests/unit/handoff-fernando-fiacao.test.ts`
    // que mede uma janela de 1800 bytes a partir do `if` do veto e exige
    // `openedCaseThisTurn = true;` seguido de `moverParaHandoffBestEffort(`
    // dentro dela. Código inserido entre aquele `if` e essas linhas empurra o
    // alvo para fora do limite — foi o que aconteceu na primeira tentativa
    // desta tarefa, e custou 1866 bytes contra os 1800 permitidos. O registro
    // vive depois do bloco do veto INTEIRO para não mexer nessa janela.
    const idxRegistro = FONTE.indexOf("casePromiseVetoCount > 0");
    const idxOpen = FONTE.indexOf("await openCase(");
    expect(idxRegistro, "o registro não foi achado no arquivo").toBeGreaterThan(-1);
    expect(idxOpen, "o `openCase` do fail-safe não foi achado no arquivo").toBeGreaterThan(-1);
    expect(
      idxRegistro,
      "o registro subiu para dentro do bloco do veto — a cerca do handoff do Fernando cai",
    ).toBeGreaterThan(idxOpen);
  });

  it("5. a declaração é completada ANTES de o checkpoint ser gravado", () => {
    // Se a ordem inverter, o sistema grava a declaração vazia e completa um
    // objeto que ninguém mais lê — o Operador continua vendo `promessas: []`, e
    // o vazamento que a Tarefa 9 fecha segue de pé, silencioso.
    const idxCompletar = FONTE.indexOf("declaracaoComPromessaDetectada(");
    const idxGravar = FONTE.indexOf("await insertCheckpoint(");
    expect(idxCompletar, "o módulo completador não foi achado").toBeGreaterThan(-1);
    expect(idxGravar, "o `insertCheckpoint` não foi achado").toBeGreaterThan(-1);
    expect(
      idxCompletar,
      "o checkpoint é gravado ANTES de a declaração ser completada — o Operador lê o vazio",
    ).toBeLessThan(idxGravar);
  });

  it("6. CONTROLE NEGATIVO — o detector fica vermelho numa fonte SEM o registro", () => {
    // ⛔ SEM ESTE CASO, o verde dos casos 1 a 3 não significaria nada. Um
    // detector que procura strings pode ficar verde por NÃO MEDIR NADA — uma
    // busca cujo alvo foi renomeado devolve `false` para tudo e passa. Aqui, a
    // MESMA função é rodada sobre uma fonte FALSA que tem o fail-safe (com
    // `casePromiseVetoCount += 1`, `openCase(...)` e a re-chamada da cadeia)
    // mas SEM a atribuição de `promessaFlagradaEsteTurno`. Se o detector
    // aprovasse essa fonte, ele estaria quebrado.
    const FALSA_SEM_REGISTRO = [
      "async function f() {",
      "  let chain = await runBeforeSend(beforeSendArgs);",
      "  if (chain.status === 'vetoed' && chain.code === 'case_promise_without_case') {",
      "    casePromiseVetoCount += 1;",
      "    if (casePromiseVetoCount < 2) {",
      "      return { ok: false, error: { code: chain.code, message: chain.message } };",
      "    }",
      "    await openCase(pool, ids, { source: 'guardrail_autofallback' });",
      "    chain = await runBeforeSend({ ...beforeSendArgs, hasOpenCase: true });",
      "  }",
      "}",
    ].join("\n");

    const blocoFalso = blocoDoRegistro(FALSA_SEM_REGISTRO);
    expect(
      blocoFalso,
      "o extrator achou um registro na fonte que não tem — o detector mede o vazio",
    ).toBeNull();
    expect(
      temRegistroCompleto(blocoFalso),
      "detector aprovou um registro inexistente — os casos 1 a 3 estavam medindo o vazio",
    ).toBe(false);
  });
});
