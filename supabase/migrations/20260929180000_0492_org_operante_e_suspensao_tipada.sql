-- 0492 — A SUSPENSÃO QUE SUSPENDE: org operante, suspensão tipada e estado só pelo servidor
--        (spec docs/superpowers/specs/2026-09-29-cobranca-do-revendedor-design.md §2.1, §2.5, §2.6, §3.1)
--
-- ── A causa ───────────────────────────────────────────────────────────────────
-- Suspender uma organização só tirava a pessoa da tela. A rota fazia leitura,
-- UPDATE e `event_log` sem await em três passos soltos; nada parava os jobs
-- `pending` nem as mensagens `queued`; e `status` era gravável pelo PostgREST
-- por qualquer platform admin — `orgs_write_platform_admin` aceita
-- `fn_is_platform_admin()`, que ignora o scope, então um `support_readonly`
-- reativava uma suspensa com um PATCH.
--
-- ── O que muda ────────────────────────────────────────────────────────────────
-- A. `organizations.suspended_kind` ('administrativa' | 'cobranca'), backfill
--    ANTES do CHECK. Sem CHECK de coerência com `status`: o lgpd-redact-worker
--    troca para `redacted` sem limpar o tipo; a regra de leitura mora em
--    lib/organizacao/operante.ts. `fn_org_operante(uuid)` é a régua SQL do
--    predicado (`status = 'active'`, falha fechada).
-- B. Gatilho `trg_organizacao_estado_so_pelo_servidor` (molde: `fn_meet_stamp`):
--    a sessão (`authenticated`/`anon`) não cria organização nem muda status,
--    tipo, campos de suspensão ou `created_by`.
-- C. `fn_suspender_organizacao`: uma transação, lock na linha, anti-backlog
--    (jobs `pending` → `failed`/`org_nao_operante`; mensagens `queued` →
--    `failed`/`org_suspensa`) e `tenant.suspended` no `event_log` na MESMA
--    transação. A administrativa prevalece sobre a de cobrança.
-- D. `agent_inbox_items.kind` ganha 'org_reativada' (lista completa do baseline).
-- E. `fn_reativar_organizacao`: exige o tipo, zera a suspensão, falha jobs
--    `pending` que sobraram e abre UM item 'org_reativada' com a contagem de
--    conversas que receberam mensagem durante a suspensão. Nada é reprocessado.
--
-- Na PR 1 nenhuma das duas funções cita `cobranca_assinaturas` (nasce na PR 2;
-- plpgsql resolve a relação ao executar, e daria 42P01 em toda chamada).
-- Idempotente: `add column if not exists`, drop+add de constraint, `create or
-- replace`, `drop trigger if exists`. Toda função perde EXECUTE das duas
-- origens (public e anon) e de authenticated; só service_role executa.
-- Gate: tests/invariants/org-suspensa.test.ts.

-- ── A. suspended_kind + fn_org_operante ──────────────────────────────────────
alter table public.organizations add column if not exists suspended_kind text;

update public.organizations
   set suspended_kind = 'administrativa'
 where status = 'suspended'
   and suspended_kind is null;

alter table public.organizations
  drop constraint if exists organizations_suspended_kind_check;
alter table public.organizations
  add constraint organizations_suspended_kind_check check (suspended_kind in ('administrativa', 'cobranca'));

comment on column public.organizations.suspended_kind is
  'Por que a organização está suspensa: administrativa (platform admin) ou cobranca (régua de cobrança). Só significa algo com status = suspended: o lgpd-redact-worker troca para redacted sem limpar. Escrito só por fn_suspender_organizacao e fn_reativar_organizacao (migration 0492).';

create or replace function public.fn_org_operante(p_org uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select o.status = 'active' from public.organizations o where o.id = p_org), false);
$$;

revoke execute on function public.fn_org_operante(uuid) from public, anon, authenticated;
grant execute on function public.fn_org_operante(uuid) to service_role;

-- ── B. o estado da organização só muda pelo servidor ─────────────────────────
-- `orgs_write_platform_admin` aceita qualquer `fn_is_platform_admin()`, que
-- ignora o scope, e `authenticated` tem GRANT ALL: sem isto um support_readonly
-- reativaria uma suspensa, trocaria o tipo da suspensão ou criaria org isenta
-- pelo PostgREST. Todo escritor legítimo é service_role ou função definer, onde
-- `current_user` é o dono da função. Molde: `fn_meet_stamp`.
create or replace function public.fn_organizacao_estado_so_pelo_servidor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'organizacao_nasce_so_pelo_servidor'
      using errcode = '42501',
            detail = 'Organização nasce por rota de servidor (service_role ou função definer), nunca pela sessão.';
  end if;
  if new.status is distinct from old.status
     or new.suspended_kind is distinct from old.suspended_kind
     or new.suspended_at is distinct from old.suspended_at
     or new.suspended_reason is distinct from old.suspended_reason
     or new.suspended_by is distinct from old.suspended_by
     or new.created_by is distinct from old.created_by then
    raise exception 'estado_da_organizacao_so_pelo_servidor'
      using errcode = '42501',
            detail = 'Status, suspensão e autoria mudam só por fn_suspender_organizacao, fn_reativar_organizacao ou rota de servidor.';
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_organizacao_estado_so_pelo_servidor() from public, anon, authenticated;

drop trigger if exists trg_organizacao_estado_so_pelo_servidor on public.organizations;
create trigger trg_organizacao_estado_so_pelo_servidor
  before insert or update on public.organizations
  for each row execute function public.fn_organizacao_estado_so_pelo_servidor();

