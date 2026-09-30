/**
 * TODO CRON RESPEITA A ORGANIZAÇÃO PARADA — OU DIZ, POR ESCRITO, POR QUE NÃO PRECISA.
 *
 * Organização parada (suspensa, redigida, arquivada — `lib/organizacao/operante.ts`)
 * não gasta nem fala. Rota nova em `app/api/v1/cron/` nasce sem saber disso, e o
 * modo de falha é mudo: nada quebra, a org suspensa só continua custando.
 *
 * A rota passa se ELA ou um módulo que ela importa DIRETAMENTE usa a régua
 * (import de `@/lib/organizacao/operante`, ou `fn_org_operante(` no SQL). Um nível
 * só, de propósito: o filtro de várias rotas mora no módulo de `lib/` que elas
 * chamam. Import só de TIPO não conta — tipo não filtra nada. E a porta de saída
 * (`app/api/v1/messages/_handler.ts`) não conta: ela recusa o envio, mas quem a
 * chama já abriu conversa, gastou a varredura e vai retentar na próxima rodada.
 *
 * As demais constam de `SEM_FILTRO` com o motivo. A lista só encolhe: entrada de
 * rota que sumiu, ou que passou a usar a régua, reprova até ser tirada.
 *
 * A rota da cobrança (PR 3a) importa a régua para o filtro da §3.2 e não entra
 * na lista.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const DIR_CRON = join(RAIZ, "app", "api", "v1", "cron");
const MODULO_DA_REGUA = "@/lib/organizacao/operante";
const FUNCAO_SQL_DA_REGUA = "fn_org_operante(";
/** Importar isto não faz a rota respeitar a org parada: assert na saída não é filtro. */
const NAO_E_FILTRO = new Set([join(RAIZ, "app", "api", "v1", "messages", "_handler.ts")]);

const SEM_FILTRO: Record<string, string> = {
  "agenda-expira-pendentes": "só libera o horário de pedido pendente vencido; escrita interna, sem custo nem saída",
  "agenda-google-push": "sincronia com o Google Agenda: deliberadamente não gatilhada (spec §4)",
  "agenda-google-refresh": "renova token do Google Agenda: deliberadamente não gatilhado (spec §4)",
  "agenda-google-sync": "sincronia com o Google Agenda: deliberadamente não gatilhada (spec §4)",
  "agent-dispatcher": "no-op permanente desde a convergência; não há o que filtrar",
  "canal-mudo-watcher": "só abre aviso na Central da própria org; sem custo nem saída",
  "case-stale-watcher": "só reabre aviso de caso na Central; sem custo nem saída",
  "channel-health": "só pergunta ao transporte se a sessão está de pé; nenhuma mensagem ao cliente",
  "contact-avatars": "baixa a foto de perfil: deliberadamente não gatilhado (spec §4)",
  "contact-birthdays": "só emite contact.birthday; o consumidor (automationRulesHandler) é 'pula'",
  "contact-phones": "só consulta o transporte para achar o telefone; nenhuma mensagem ao cliente",
  "contact-proposals-watcher": "só expira propostas de dado vencidas; escrita interna",
  "data-retention": "retenção e expurgo: obrigação, nunca bloqueada (spec §1.3)",
  "followup-sem-agente": "só abre aviso na Central sobre fluxo sem agente; sem custo nem saída",
  "handoff-devolucao": "devolve a conversa à IA; a IA só fala por evento, barrado pelo gate e pelo dispatcher",
  "lead-date-field-due": "só emite lead.date_field_due; o consumidor (automationRulesHandler) é 'pula'",
  "lead-time-triggers": "só emite lead.silent_for/stage_stale; o consumidor (automationRulesHandler) é 'pula'",
  "lgpd-sla-watcher": "LGPD nunca é bloqueada (spec §1.3)",
  "media-retention": "retenção de mídia: apagar é obrigação, não custo",
  "proposal-acceptance-rate": "só calcula a taxa e abre aviso interno; sem custo nem saída",
  "proposal-expiry": "só vence proposta e abre aviso interno; sem custo nem saída",
  "proposal-promised-not-created": "só abre aviso interno de promessa vencida; sem custo nem saída",
  "proposta-travada": "só destrava proposta presa em 'enviando'; escrita interna",
  "recover-stuck-messages": "marca failed e avisa, nunca reenvia: deliberadamente não gatilhado (spec §4)",
  "recurring-entries": "só gera lançamento financeiro pendente; escrita interna",
  "risk-watcher": "só classifica risco e registra a proposta de reativação; nada sai",
  "routing-worker": "só distribui o dono da conversa; sem custo nem saída",
  "snooze-watcher": "só reabre conversa adiada; sem custo nem saída",
  "storage-redaction": "LGPD e retenção nunca são bloqueadas (spec §1.3)",
  "sync-model-catalog": "catálogo da instalação inteira; não pertence a organização nenhuma",
  "webhook-log-retention": "retenção do arquivo de webhook: obrigação, nunca bloqueada",
  "webhook-replay": "reprocessa ENTRADA do WAHA; mensagem que chega continua gravada (spec §1.3)",
};

function rotasDeCron(): string[] {
  return readdirSync(DIR_CRON, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(DIR_CRON, e.name, "route.ts")))
    .map((e) => e.name)
    .sort();
}

function usaAReguaNaFonte(fonte: string, nome: string): boolean {
  const arquivo = ts.createSourceFile(nome, fonte, ts.ScriptTarget.Latest, true);
  let usa = false;
  const visitar = (no: ts.Node): void => {
    if (usa) return;
    if (
      ts.isImportDeclaration(no) &&
      ts.isStringLiteral(no.moduleSpecifier) &&
      no.moduleSpecifier.text === MODULO_DA_REGUA &&
      !no.importClause?.isTypeOnly
    ) {
      usa = true;
      return;
    }
    if (
      (ts.isStringLiteral(no) ||
        ts.isNoSubstitutionTemplateLiteral(no) ||
        ts.isTemplateHead(no) ||
        ts.isTemplateMiddle(no) ||
        ts.isTemplateTail(no)) &&
      no.text.includes(FUNCAO_SQL_DA_REGUA)
    ) {
      usa = true;
      return;
    }
    ts.forEachChild(no, visitar);
  };
  visitar(arquivo);
  return usa;
}

function resolver(especificador: string): string | null {
  const base = join(RAIZ, especificador.slice(2));
  for (const candidato of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidato)) return candidato;
  }
  return null;
}

function importsDiretos(caminho: string): string[] {
  const arquivo = ts.createSourceFile(caminho, readFileSync(caminho, "utf8"), ts.ScriptTarget.Latest, true);
  const saida: string[] = [];
  for (const st of arquivo.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (st.importClause?.isTypeOnly || !st.moduleSpecifier.text.startsWith("@/")) continue;
    const alvo = resolver(st.moduleSpecifier.text);
    if (alvo) saida.push(alvo);
  }
  return saida;
}

function rotaRespeita(rota: string): boolean {
  const arquivo = join(DIR_CRON, rota, "route.ts");
  const usa = (caminho: string) => usaAReguaNaFonte(readFileSync(caminho, "utf8"), caminho);
  return usa(arquivo) || importsDiretos(arquivo).filter((c) => !NAO_E_FILTRO.has(c)).some(usa);
}

describe("a sonda", () => {
  it("reconhece o import da régua e a função SQL (controles positivos)", () => {
    expect(usaAReguaNaFonte(`import { idsDeOrgsParadas } from "@/lib/organizacao/operante";`, "a.ts")).toBe(true);
    expect(
      usaAReguaNaFonte("await pool.query(`select public.fn_org_operante($1) as operante`, [id]);", "b.ts"),
    ).toBe(true);
  });

  it("a porta de saída existe e é a que não conta como filtro (controle do NAO_E_FILTRO)", () => {
    for (const caminho of NAO_E_FILTRO) expect(existsSync(caminho), caminho).toBe(true);
  });

  it("não se engana com comentário nem com import só de tipo (controles negativos)", () => {
    expect(usaAReguaNaFonte("// não chama fn_org_operante( aqui\nexport const x = 1;", "c.ts")).toBe(false);
    expect(usaAReguaNaFonte(`import type { TipoDeSuspensao } from "@/lib/organizacao/operante";`, "d.ts")).toBe(false);
  });
});

describe("crons × organização parada", () => {
  const rotas = rotasDeCron();

  it("o diretório de crons foi lido (instrumento vivo)", () => {
    expect(rotas).toContain("event-log-drain");
    expect(rotas).toContain("kb-conversations-batch");
  });

  it.each(rotas)("%s usa a régua ou consta de SEM_FILTRO com motivo", (rota) => {
    expect(
      rotaRespeita(rota) || rota in SEM_FILTRO,
      `app/api/v1/cron/${rota} não filtra organização parada. Importe ${MODULO_DA_REGUA} ` +
        "(ou chame fn_org_operante no SQL) — ou, se ela não custa nem sai para fora, " +
        "acrescente-a a SEM_FILTRO com o motivo.",
    ).toBe(true);
  });

  it("a lista só encolhe: toda entrada existe e ainda não usa a régua", () => {
    for (const rota of Object.keys(SEM_FILTRO)) {
      expect(existsSync(join(DIR_CRON, rota, "route.ts")), `${rota} não existe mais — tire de SEM_FILTRO`).toBe(true);
      expect(rotaRespeita(rota), `${rota} já usa a régua — tire de SEM_FILTRO`).toBe(false);
    }
  });

  it("todo motivo tem ao menos 20 caracteres", () => {
    for (const [rota, motivo] of Object.entries(SEM_FILTRO)) {
      expect(motivo.trim().length, `${rota}: motivo curto demais`).toBeGreaterThanOrEqual(20);
    }
  });

  it("a rota da cobrança não entra na lista — ela filtra pela régua (PR 3a)", () => {
    expect(Object.keys(SEM_FILTRO)).not.toContain("cobranca");
  });
});
