/**
 * O ROTEADOR NASCE EM "AUTOMÁTICO" — E A CURA NÃO APAGA ESCOLHA DE QUEM ESCOLHEU.
 *
 * O defeito medido (2026-10-02, `llm_calls` de uma instalação real): o
 * `ai_routers.config` semeava `'classifier_model', 'claude-haiku-4-5'`. Numa
 * organização configurada na **OpenRouter**, esse id entrava pelo precedência 3
 * de `decidirBinding` (modelo do call site vence o padrão da organização) e ia
 * para o endpoint da OpenRouter:
 *
 *   provider openrouter · model claude-haiku-4-5 · http_status 400
 *   error_message "claude-haiku-4-5 is not a valid model ID"
 *
 * A organização nunca escolheu Claude — o default do banco escolheu por ela. E o
 * id não existe na OpenRouter (lá é `anthropic/claude-haiku-4.5`, com ponto).
 * Três chamadas 400, o classificador calado, e todo turno caindo no fallback.
 *
 * O unitário (`tests/unit/router-config-classificador-automatico.test.ts`) mede o
 * TEXTO do schema. O que este mede é o que o self-host faz: o default no banco
 * depois de aplicar o `baseline.sql`, e a cura das linhas já semeadas.
 *
 * ⚠️ Por que isto NÃO pode ser só "o default não tem a chave": a cura por
 * `update` tem um erro possível e silencioso — `set config = jsonb_build_object(...)`
 * em vez de `config - 'classifier_model'` reescreve a linha e apaga o
 * `sticky`/`min_confidence` que a pessoa ajustou. E o erro oposto é pior: uma cura
 * ampla que apaga o modelo de quem escolheu de propósito quebra o roteador de
 * quem roda Anthropic nativo, onde o alias `claude-haiku-4-5` resolve (0104).
 * Por isso os três casos: nasce automático, cura o seed sem tocar no resto,
 * preserva a escolha deliberada.
 */

import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 4,
});

/** O id semeado que a OpenRouter rejeita. */
const ID_SEMEADO = "claude-haiku-4-5";
/** O mesmo id, prefixado — o que `lib/ai/gateway.ts` chama de canônico. */
const ID_SEMEADO_CANONICO = "anthropic/claude-haiku-4-5";

async function criarOrganizacao(): Promise<string> {
  const org = randomUUID();
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name, settings)
     values ($1, $2, 'Roteador Automatico', 'Roteador Automatico', '{}'::jsonb)`,
    [org, `rot-auto-${org}`],
  );
  return org;
}

/** Uma sessão de canal, que é o que o roteador precisa para existir. */
async function criarSessao(org: string): Promise<string> {
  const sessao = randomUUID();
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1, $2, $3, 'WORKING', '\\x00'::bytea)`,
    [sessao, org, `rot-auto-${sessao}`],
  );
  return sessao;
}

beforeAll(async () => {
  await pool.query("select 1");
});

afterAll(async () => {
  await pool.end();
});

describe("ai_routers — o classificador nasce em 'Automático'", () => {
  it("um roteador criado sem config não ganha classifier_model do banco", async () => {
    const org = await criarOrganizacao();
    const sessao = await criarSessao(org);
    const roteador = randomUUID();

    // Sem `config` no INSERT: o default da coluna é quem decide. É assim que a
    // tela e a API criam roteador (`app/api/v1/ai/routers/route.ts`).
    await pool.query(
      `insert into ai_routers (id, organization_id, name, channel_session_id)
       values ($1, $2, 'Roteador Hubiss', $3)`,
      [roteador, org, sessao],
    );

    const { rows } = await pool.query<{ config: Record<string, unknown> }>(
      `select config from ai_routers where id = $1`,
      [roteador],
    );

    expect(rows[0]!.config).not.toHaveProperty("classifier_model");
    // O resto do default sobrevive: o leitor usa `sticky`/`min_confidence` daqui.
    expect(rows[0]!.config).toMatchObject({ sticky: true, min_confidence: 0.6 });
  });

  it("o default da coluna é o da 0502, não o id do Anthropic", async () => {
    // Pergunta ao CATÁLOGO, e não ao texto: é o que o banco realmente tem.
    const { rows } = await pool.query<{ dflt: string | null }>(
      `select pg_get_expr(adbin, adrelid) as dflt
       from pg_attrdef
       where adrelid = 'public.ai_routers'::regclass
         and adnum = (select attnum from pg_attribute
                      where attrelid = 'public.ai_routers'::regclass and attname = 'config')`,
    );
    expect(rows[0]!.dflt).not.toBeNull();
    expect(rows[0]!.dflt).not.toContain("classifier_model");
  });
});

describe("a cura remove o id semeado e só ele", () => {
  it("tira o id semeado preservando o resto do config", async () => {
    const org = await criarOrganizacao();
    const sessao = await criarSessao(org);
    const roteador = randomUUID();

    // Linha como a 0085 a semeou, mais o que a pessoa ajustou na tela.
    await pool.query(
      `insert into ai_routers (id, organization_id, name, channel_session_id, config)
       values ($1, $2, 'Com seed', $3, $4::jsonb)`,
      [
        roteador,
        org,
        sessao,
        JSON.stringify({ classifier_model: ID_SEMEADO, sticky: false, min_confidence: 0.85 }),
      ],
    );

    // A mesma cura da 0502, aplicada na linha — o que `update.sh` faz.
    await pool.query(
      `update ai_routers set config = config - 'classifier_model'
       where config->>'classifier_model' in ($1, $2)
         and coalesce(config->>'classifier_provider', '') is distinct from $3`,
      [ID_SEMEADO, ID_SEMEADO_CANONICO, "anthropic"],
    );

    const { rows } = await pool.query<{ config: Record<string, unknown> }>(
      `select config from ai_routers where id = $1`,
      [roteador],
    );
    expect(rows[0]!.config).not.toHaveProperty("classifier_model");
    // O resto intacto — `set config = jsonb_build_object(...)` perderia isto.
    expect(rows[0]!.config).toMatchObject({ sticky: false, min_confidence: 0.85 });
  });

  it("preserva o modelo escolhido de propósito", async () => {
    const org = await criarOrganizacao();
    const sessao = await criarSessao(org);
    const roteador = randomUUID();

    // Anthropic nativo resolve o alias `claude-haiku-4-5` (migration 0104): para
    // quem roda Anthropic, este id é uma ESCOLHA legítima e o roteador funciona.
    await pool.query(
      `insert into ai_routers (id, organization_id, name, channel_session_id, config)
       values ($1, $2, 'Anthropic de proposito', $3, $4::jsonb)`,
      [
        roteador,
        org,
        sessao,
        JSON.stringify({ classifier_model: ID_SEMEADO, classifier_provider: "anthropic" }),
      ],
    );

    await pool.query(
      `update ai_routers set config = config - 'classifier_model'
       where config->>'classifier_model' in ($1, $2)
         and coalesce(config->>'classifier_provider', '') is distinct from $3`,
      [ID_SEMEADO, ID_SEMEADO_CANONICO, "anthropic"],
    );

    const { rows } = await pool.query<{ config: Record<string, unknown> }>(
      `select config from ai_routers where id = $1`,
      [roteador],
    );
    // Uma cura ampla ("apaga tudo que é Claude") quebraria este roteador.
    expect(rows[0]!.config).toMatchObject({
      classifier_model: ID_SEMEADO,
      classifier_provider: "anthropic",
    });
  });

  it("a cura é idempotente", async () => {
    const org = await criarOrganizacao();
    const sessao = await criarSessao(org);
    const roteador = randomUUID();

    await pool.query(
      `insert into ai_routers (id, organization_id, name, channel_session_id, config)
       values ($1, $2, 'Idempotente', $3, $4::jsonb)`,
      [
        roteador,
        org,
        sessao,
        JSON.stringify({ classifier_model: ID_SEMEADO_CANONICO, sticky: true }),
      ],
    );

    const cura = () =>
      pool.query(
        `update ai_routers set config = config - 'classifier_model'
         where config->>'classifier_model' in ($1, $2)
           and coalesce(config->>'classifier_provider', '') is distinct from $3`,
        [ID_SEMEADO, ID_SEMEADO_CANONICO, "anthropic"],
      );
    await cura();
    const primeira = await pool.query<{ config: Record<string, unknown> }>(
      `select config from ai_routers where id = $1`,
      [roteador],
    );
    await cura();
    const segunda = await pool.query<{ config: Record<string, unknown> }>(
      `select config from ai_routers where id = $1`,
      [roteador],
    );

    expect(segunda.rows[0]!.config).toEqual(primeira.rows[0]!.config);
  });
});