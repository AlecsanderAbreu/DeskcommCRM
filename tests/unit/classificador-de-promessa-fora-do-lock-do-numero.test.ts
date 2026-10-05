import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  runBeforeSend,
  semanticPromiseGate,
  type RunBeforeSendArgs,
} from '@/lib/agent-engine/guardrails/before-send';

/**
 * A PERGUNTA DESTE ARQUIVO: ONDE o classificador semântico de promessa (F4-02) roda?
 *
 * `runBeforeSend` toma conexão, abre transação, pega o `pg_advisory_xact_lock` do NÚMERO,
 * carrega o estado, julga a cadeia, envia e só então commita. Tudo o que roda entre o
 * `begin` e o `commit` segura o lock do número E as travas de leitura das tabelas que a
 * carga já leu — `contacts` entre elas (readStopFlags).
 *
 * O classificador é uma chamada de modelo (segundos, sem prazo próprio) e morava ali
 * dentro, na fase de carga. Enquanto o modelo pensava, o `runModelCall` gravava a linha de
 * `llm_calls` por OUTRA conexão do pool — e `llm_calls` tem FK para `contacts`. Medido
 * numa VPS em 2026-10-02: com um DDL na fila de `contacts` (o baseline sendo reaplicado),
 * o insert entrou na fila atrás do DDL, o DDL esperava esta transação, e esta transação
 * esperava o insert. Ciclo que o Postgres não detecta (uma aresta mora no processo):
 * 8m47s `idle in transaction`, o worker inteiro parado e o PostgREST sem cache de schema.
 *
 * O invariante que este arquivo prende é de POSIÇÃO, como o de
 * `espera-humana-fora-do-lock-do-numero.test.ts` (#654), de que esta bancada é cópia:
 *   a) o classificador roda ANTES do `begin`: quando ele acontece, não há transação aberta
 *      nem lock do número em posse;
 *   b) a posse (`begin`→`commit`) não contém o tempo do classificador;
 *   c) ele julga o MESMO corpo que vai ao canal (o corpo final de estilo);
 *   d) o veto semântico continua barrando o envio.
 *
 * O QUE ESTE ARQUIVO NÃO MEDE: o ciclo de travas em si — ele precisa de Postgres de
 * verdade, um DDL na fila e duas conexões. A medição foi feita na VPS e está descrita no
 * PR; aqui fica a posição, que é o que impede o ciclo.
 *
 * POR QUE ELE NASCE VERMELHO: com o classificador na fase de carga, o evento `classifica`
 * vem depois de `begin` e `lock`, e as asserções de ordem falham.
 */

type Eventos = string[];

const relogio = (): number => performance.now();

/** Pool fake: registra a ORDEM dos eventos do guardrail. */
function poolFalso(eventos: Eventos) {
  const client = {
    query: vi.fn(async (sql: string): Promise<{ rows: unknown[] }> => {
      const s = String(sql).toLowerCase().trim();
      if (s.includes('pg_advisory_xact_lock')) eventos.push('lock');
      if (s === 'begin') eventos.push('begin');
      if (s === 'commit') eventos.push('commit');
      if (s === 'rollback') eventos.push('rollback');
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => {
      eventos.push('connect');
      return client;
    }),
    query: vi.fn().mockResolvedValue({ rows: [{ id: 'trace-1' }] }),
  };
  return { pool: pool as unknown as pg.Pool, client };
}

function argsDoTurno(pool: pg.Pool, extras: Partial<RunBeforeSendArgs> = {}): RunBeforeSendArgs {
  return {
    pool,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    tenantId: '00000000-0000-4000-8000-000000000001',
    leadId: '00000000-0000-4000-8000-000000000002',
    jobId: '00000000-0000-4000-8000-000000000003',
    channelSessionId: '00000000-0000-4000-8000-000000000004',
    body: 'Olá! Segue o orçamento que você pediu.',
    optedOutThisTurn: false,
    crmDailyLimit: null,
    now: new Date('2026-10-02T19:35:51.000Z'),
    rng: () => 0,
    sleep: async () => {},
    gates: [],
    send: async () => ({ kind: 'sent', idempotencyKey: 'k', messageId: 'm' }),
    ...extras,
  };
}

describe('o classificador semântico de promessa roda FORA da transação do envio', () => {
  it('roda antes do begin: nenhuma transação aberta, nenhum lock do número em posse', async () => {
    const eventos: Eventos = [];
    const { pool } = poolFalso(eventos);
    const classifica = vi.fn(async () => {
      eventos.push('classifica');
      return { isPromise: false, suspectPhrase: null, prometeuRetornoHumano: false, retornoSoDoAssistente: false };
    });

    const r = await runBeforeSend(
      argsDoTurno(pool, {
        classifyPromiseSemantic: classifica,
        send: async () => {
          eventos.push('send');
          return { kind: 'sent', idempotencyKey: 'k', messageId: 'm1' };
        },
      }),
    );

    expect(r.status).toBe('sent');
    expect(classifica).toHaveBeenCalledTimes(1);
    expect(eventos).toEqual(['connect', 'classifica', 'begin', 'lock', 'send', 'commit']);
  });

  it('a janela begin→commit não contém o tempo do classificador', async () => {
    const eventos: Eventos = [];
    const { pool, client } = poolFalso(eventos);
    const CLASSIFICADOR_MS = 40;
    let posseInicio = 0;
    let posseFim = 0;

    const original = client.query;
    client.query = vi.fn(async (sql: string) => {
      const s = String(sql).toLowerCase().trim();
      if (s === 'begin') posseInicio = relogio();
      if (s === 'commit') posseFim = relogio();
      return original(sql);
    }) as unknown as typeof client.query;

    const r = await runBeforeSend(
      argsDoTurno(pool, {
        // Espera de verdade, curta: é o tempo do modelo que ANTES ficava dentro da posse.
        classifyPromiseSemantic: async () => {
          await new Promise((resolve) => setTimeout(resolve, CLASSIFICADOR_MS));
          return { isPromise: false, suspectPhrase: null, prometeuRetornoHumano: false, retornoSoDoAssistente: false };
        },
      }),
    );

    expect(r.status).toBe('sent');
    expect(posseInicio).toBeGreaterThan(0);
    expect(posseFim - posseInicio).toBeLessThan(CLASSIFICADOR_MS);
  });

  it('julga o mesmo corpo que vai ao canal', async () => {
    const eventos: Eventos = [];
    const { pool } = poolFalso(eventos);
    let julgado = '';
    let enviado = '';

    await runBeforeSend(
      argsDoTurno(pool, {
        classifyPromiseSemantic: async (corpo: string) => {
          julgado = corpo;
          return { isPromise: false, suspectPhrase: null, prometeuRetornoHumano: false, retornoSoDoAssistente: false };
        },
        send: async (corpo: string) => {
          enviado = corpo;
          return { kind: 'sent', idempotencyKey: 'k', messageId: 'm1' };
        },
      }),
    );

    expect(julgado).toBe('Olá! Segue o orçamento que você pediu.');
    expect(enviado).toBe(julgado);
  });

  it('o veto semântico continua barrando: sem envio e com a transação desfeita', async () => {
    const eventos: Eventos = [];
    const { pool } = poolFalso(eventos);
    const envio = vi.fn(async () => ({ kind: 'sent' as const, idempotencyKey: 'k', messageId: 'm1' }));

    const r = await runBeforeSend(
      argsDoTurno(pool, {
        body: 'Pode deixar que eu faço de graça para você.',
        gates: [semanticPromiseGate],
        classifyPromiseSemantic: async () => ({ isPromise: true, suspectPhrase: 'faço de graça', prometeuRetornoHumano: false, retornoSoDoAssistente: false }),
        send: envio,
      }),
    );

    expect(r.status).toBe('vetoed');
    expect(envio).not.toHaveBeenCalled();
    expect(eventos).toContain('rollback');
    expect(eventos).not.toContain('commit');
  });
});
