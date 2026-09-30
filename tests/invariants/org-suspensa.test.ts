import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { lastLine, sql, writeCountAs } from "./gov-helpers";

/**
 * A SUSPENSÃO QUE SUSPENDE (migration 0492; spec cobrança do revendedor §2.1,
 * §3.1 e §12, invariantes 2 a 4).
 *
 * Antes: suspender só tirava a pessoa da tela. A rota fazia leitura, UPDATE e
 * `event_log` sem await em três passos soltos; nada parava jobs `pending` nem
 * mensagens `queued`; e `status` era gravável pelo PostgREST por qualquer
 * platform admin — `orgs_write_platform_admin` aceita `fn_is_platform_admin()`,
 * que ignora o scope, então um `support_readonly` reativava uma suspensa.
 *
 *   inv. 2 — status, tipo, campos de suspensão e `created_by` só mudam pelo
 *            servidor; INSERT de organização pela sessão é recusado;
 *   inv. 3 — com a org suspensa, o barramento e a LGPD continuam vivos;
 *   inv. 4 — fn_suspender/fn_reativar: anti-backlog, a administrativa
 *            prevalece, idempotência, evento na mesma transação, item
 *            `org_reativada` com a contagem, resíduo de `redacted` não quebra.
 *
 * Os casos com ⭐ são os que o banco de antes deixava passar.
 *
 * ⚠️ O gatilho e a RLS recusam com o MESMO SQLSTATE (42501). Por isso cada
 * recusa confere também a MENSAGEM do gatilho — sem ela, uma recusa de RLS
 * passaria por prova do gatilho.
 */

const ORG_A = "c0de0492-0000-4000-8000-00000000000a"; // a que é suspensa
const ORG_B = "c0de0492-0000-4000-8000-00000000000b"; // a vizinha, sempre ativa
const ORG_C = "c0de0492-0000-4000-8000-00000000000c"; // alvo do inv. 2
const ORG_R = "c0de0492-0000-4000-8000-00000000000d"; // redigida com tipo residual
const ORG_FORJADA = "c0de0492-0000-4000-8000-00000000000e"; // nunca pode nascer

const DONO = "c0de0492-1111-4000-8000-000000000001"; // platform admin `full`
const SUPORTE = "c0de0492-1111-4000-8000-000000000002"; // platform admin `support_readonly`
const ADMIN_A = "c0de0492-1111-4000-8000-000000000003"; // admin do tenant A

const SESSAO_A = "c0de0492-2222-4000-8000-00000000000a";
const SESSAO_B = "c0de0492-2222-4000-8000-00000000000b";
const CONTATO_A1 = "c0de0492-3333-4000-8000-0000000000a1";
const CONTATO_A2 = "c0de0492-3333-4000-8000-0000000000a2";
const CONTATO_B = "c0de0492-3333-4000-8000-0000000000b1";
const CONVERSA_A1 = "c0de0492-4444-4000-8000-0000000000a1";
const CONVERSA_A2 = "c0de0492-4444-4000-8000-0000000000a2";
const CONVERSA_B = "c0de0492-4444-4000-8000-0000000000b1";
const JOB_A = "c0de0492-5555-4000-8000-00000000000a";
const JOB_B = "c0de0492-5555-4000-8000-00000000000b";
const MSG_A = "c0de0492-6666-4000-8000-00000000000a";
const MSG_B = "c0de0492-6666-4000-8000-00000000000b";
const PEDIDO_LGPD = "c0de0492-7777-4000-8000-000000000001";

const MOTIVO = "motivo de teste do invariante 0492";

type Resultado = { changed: boolean; motivo?: string };

function valor(consulta: string): string {
  return lastLine(sql(consulta));
}

/** Chama uma função de estado como `service_role` (o único papel com EXECUTE). */
function servidor(chamada: string): Resultado {
  return JSON.parse(lastLine(sql(`set role service_role;\nselect ${chamada};`))) as Resultado;
}

function suspender(org: string, tipo: string): Resultado {
  return servidor(`public.fn_suspender_organizacao('${org}', '${tipo}', '${MOTIVO}', '${DONO}')`);
}

function reativar(org: string, tipo: string): Resultado {
  return servidor(`public.fn_reativar_organizacao('${org}', '${tipo}', '${DONO}')`);
}

function operante(org: string): string {
  return valor(`set role service_role;\nselect public.fn_org_operante('${org}')::text;`);
}

/** `status/tipo` numa linha só; `-` quando o tipo é nulo. */
function estado(org: string): string {
  return valor(
    `select status || '/' || coalesce(suspended_kind, '-') from public.organizations where id = '${org}';`,
  );
}

function eventos(org: string, tipo: string): number {
  return Number(
    valor(`select count(*) from public.event_log where organization_id = '${org}' and event_type = '${tipo}';`),
  );
}

/** Script que roda como `authenticated` com o JWT do usuário — o caminho do PostgREST. */
function comoUsuario(usuario: string, comando: string): string {
  return `set role authenticated;
select set_config('request.jwt.claims', '{"sub":"${usuario}"}', false);
${comando};`;
}

/** stderr do psql com SQLSTATE (VERBOSITY verbose), ou "" se o script passou. */
function erroDe(script: string): string {
  try {
    sql(`\\set VERBOSITY verbose\n${script}`);
    return "";
  } catch (err) {
    return String((err as { stderr?: string }).stderr ?? err);
  }
}

/** Cada teste parte do mesmo estado: A, B e C ativas, fila cheia, sem item de reativação. */
function reiniciar(): void {
  sql(`
    update public.organizations
       set status = 'active', suspended_kind = null, suspended_at = null,
           suspended_reason = null, suspended_by = null
     where id in ('${ORG_A}', '${ORG_B}', '${ORG_C}');
    update public.job_queue set status = 'pending', last_error = null where id in ('${JOB_A}', '${JOB_B}');
    update public.messages set status = 'queued', error_code = null where id in ('${MSG_A}', '${MSG_B}');
    update public.conversations set last_inbound_at = null where id in ('${CONVERSA_A1}', '${CONVERSA_A2}');
    delete from public.agent_inbox_items where organization_id = '${ORG_A}' and kind = 'org_reativada';
  `);
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${DONO}', 'dono-0492@invariant.test'),
      ('${SUPORTE}', 'suporte-0492@invariant.test'),
      ('${ADMIN_A}', 'admin-a-0492@invariant.test')
      on conflict do nothing;
    insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason) values
      ('${DONO}', '${DONO}', 'full', false, 'fixture do invariante 0492'),
      ('${SUPORTE}', '${DONO}', 'support_readonly', false, 'fixture do invariante 0492')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'org-0492-a', 'Org 0492 A', 'Org 0492 A'),
      ('${ORG_B}', 'org-0492-b', 'Org 0492 B', 'Org 0492 B'),
      ('${ORG_C}', 'org-0492-c', 'Org 0492 C', 'Org 0492 C'),
      ('${ORG_R}', 'org-0492-r', 'Org 0492 R', 'Org 0492 R')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${ADMIN_A}', '${ORG_A}', 'admin', now()) on conflict do nothing;
    do $s$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted) values
        ('${SESSAO_A}', '${ORG_A}', 'org-0492-a', '\\x00'::bytea),
        ('${SESSAO_B}', '${ORG_B}', 'org-0492-b', '\\x00'::bytea);
    exception when unique_violation then null; end $s$;
    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO_A1}', '${ORG_A}', 'Contato 0492 A1'),
      ('${CONTATO_A2}', '${ORG_A}', 'Contato 0492 A2'),
      ('${CONTATO_B}', '${ORG_B}', 'Contato 0492 B')
      on conflict (id) do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status) values
      ('${CONVERSA_A1}', '${ORG_A}', '${CONTATO_A1}', '${SESSAO_A}', 'open'),
      ('${CONVERSA_A2}', '${ORG_A}', '${CONTATO_A2}', '${SESSAO_A}', 'open'),
      ('${CONVERSA_B}', '${ORG_B}', '${CONTATO_B}', '${SESSAO_B}', 'open')
      on conflict (id) do nothing;
    -- 'watchdog' não tem contato nem fronteira de atendimento (fn_job_service_boundary
    -- devolve cedo): é a forma mais barata de um job 'pending' de verdade.
    insert into public.job_queue (id, organization_id, kind, status) values
      ('${JOB_A}', '${ORG_A}', 'watchdog', 'pending'),
      ('${JOB_B}', '${ORG_B}', 'watchdog', 'pending')
      on conflict (id) do nothing;
    insert into public.messages
      (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, sent_via, body) values
      ('${MSG_A}', '${ORG_A}', '${CONVERSA_A1}', '${SESSAO_A}', '${CONTATO_A1}', 'text', 'outbound', 'queued', 'user', 'resposta na fila'),
      ('${MSG_B}', '${ORG_B}', '${CONVERSA_B}', '${SESSAO_B}', '${CONTATO_B}', 'text', 'outbound', 'queued', 'user', 'resposta na fila')
      on conflict (id) do nothing;
  `);
});

beforeEach(reiniciar);

describe("fn_org_operante — a régua SQL do predicado", () => {
  it("só `active` opera; suspensa, arquivada, redigida e inexistente não operam", () => {
    sql(`
      update public.organizations set status = 'suspended', suspended_kind = 'administrativa', suspended_at = now() where id = '${ORG_A}';
      update public.organizations set status = 'archived' where id = '${ORG_C}';
      update public.organizations set status = 'redacted', suspended_kind = 'cobranca' where id = '${ORG_R}';
    `);
    expect(operante(ORG_B)).toBe("true");
    expect(operante(ORG_A)).toBe("false");
    expect(operante(ORG_C)).toBe("false");
    expect(operante(ORG_R)).toBe("false");
    expect(operante(ORG_FORJADA)).toBe("false");
  });

  it("⭐ o tipo da suspensão é vocabulário fechado", () => {
    const e = erroDe(`update public.organizations set suspended_kind = 'fraude' where id = '${ORG_A}';`);
    expect(e).toContain("23514");
    expect(e).toContain("organizations_suspended_kind_check");
  });

  it("a sessão não executa fn_org_operante (EXECUTE só do service_role)", () => {
    const e = erroDe(comoUsuario(ADMIN_A, `select public.fn_org_operante('${ORG_A}')`));
    expect(e).toContain("42501");
    expect(e).toContain("permission denied");
  });
});

describe("inv. 2 — status e suspensão só mudam pelo servidor", () => {
  for (const [scope, usuario] of [
    ["support_readonly", SUPORTE],
    ["full", DONO],
  ] as const) {
    it(`⭐ platform admin ${scope} não reativa uma suspensa pelo PostgREST`, () => {
      sql(`update public.organizations set status = 'suspended', suspended_kind = 'cobranca', suspended_at = now() where id = '${ORG_C}';`);
      const e = erroDe(comoUsuario(usuario, `update public.organizations set status = 'active' where id = '${ORG_C}'`));
      expect(e).toContain("42501");
      expect(e).toContain("estado_da_organizacao_so_pelo_servidor");
      expect(estado(ORG_C)).toBe("suspended/cobranca");
    });

    it(`⭐ platform admin ${scope} não troca o tipo da suspensão`, () => {
      sql(`update public.organizations set status = 'suspended', suspended_kind = 'administrativa', suspended_at = now() where id = '${ORG_C}';`);
      const e = erroDe(comoUsuario(usuario, `update public.organizations set suspended_kind = 'cobranca' where id = '${ORG_C}'`));
      expect(e).toContain("42501");
      expect(e).toContain("estado_da_organizacao_so_pelo_servidor");
      expect(estado(ORG_C)).toBe("suspended/administrativa");
    });

    it(`⭐ platform admin ${scope} não suspende nem reescreve autoria pelo PostgREST`, () => {
      for (const atribuicao of [
        `status = 'suspended'`,
        `suspended_at = now()`,
        `suspended_reason = 'forjado'`,
        `suspended_by = '${usuario}'`,
        `created_by = '${usuario}'`,
      ]) {
        const e = erroDe(comoUsuario(usuario, `update public.organizations set ${atribuicao} where id = '${ORG_C}'`));
        expect(e, atribuicao).toContain("estado_da_organizacao_so_pelo_servidor");
      }
      expect(estado(ORG_C)).toBe("active/-");
    });

    it(`⭐ platform admin ${scope} não cria organização pelo PostgREST`, () => {
      const e = erroDe(
        comoUsuario(
          usuario,
          `insert into public.organizations (id, slug, legal_name, display_name) values ('${ORG_FORJADA}', 'forjada-0492', 'Forjada', 'Forjada')`,
        ),
      );
      expect(e).toContain("42501");
      expect(e).toContain("organizacao_nasce_so_pelo_servidor");
      expect(valor(`select count(*) from public.organizations where id = '${ORG_FORJADA}';`)).toBe("0");
    });
  }

  it("controle: a RLS deixa o dono escrever nome e fuso pela sessão (o que o updateTenant grava)", () => {
    expect(
      writeCountAs(
        DONO,
        `update public.organizations set display_name = 'Org 0492 C renomeada', timezone = 'America/Manaus' where id = '${ORG_C}'`,
      ),
    ).toBe(1);
    expect(valor(`select display_name || '|' || timezone from public.organizations where id = '${ORG_C}';`)).toBe(
      "Org 0492 C renomeada|America/Manaus",
    );
  });

  it("controle: service_role (rota de servidor, worker de LGPD) escreve o status", () => {
    sql(`set role service_role;\nupdate public.organizations set status = 'redacted' where id = '${ORG_C}';`);
    expect(estado(ORG_C)).toBe("redacted/-");
  });
});
