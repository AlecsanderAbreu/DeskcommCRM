-- 0510 — COBRANÇA DO REVENDEDOR, PR 2: planos e limites
--        (spec docs/superpowers/specs/2026-09-29-cobranca-do-revendedor-design.md §1.2, §2.1-§2.7, §3.1, §5)
--
-- ── A causa ───────────────────────────────────────────────────────────────────
-- O dono de uma instalação passa a poder cobrar as empresas dela. É capacidade
-- do NÚCLEO com chave da instalação (`platform_config.MODULO_COBRANCA`, só
-- `ligado` liga), desligada por padrão (ADR-0004, D-1). As travas de pessoas e de
-- números e o teste grátis moram em tabelas do núcleo e consultam as da
-- cobrança, por isso as duas tabelas vão VAZIAS para toda instalação. Com a
-- chave desligada, os gatilhos devolvem "sem limite" e nada nasce.
--
-- ── O que muda ────────────────────────────────────────────────────────────────
-- A. `cobranca_planos` (da instalação, RLS sem policy) e `cobranca_assinaturas`
--    (uma linha por org; leitura do admin da org; escrita do service_role).
--    Org SEM linha é isenta. Saem `organizations.ai_budget_cents` e `rate_limit_rps`.
-- B. `fn_cobranca_ligada()` e `fn_limite_do_plano(org, recurso)`.
-- C. Assentos: gatilho INVOKER do vínculo provisório + gatilho DEFINER do teto (PT402).
-- D. Canais: teto de números de mensagem (PT402), na trava de fn_reserve_channel_connection.
-- E. Teste grátis na criação da org; `fn_create_tenant_with_owner` aceita `plano_id`.
-- F. Suspensão por cobrança poupa a isenta; reativar zera o aviso; desligar libera.
--
-- Idempotente: `if not exists`, `drop policy if exists` + create, `create or
-- replace`, `drop trigger if exists` + create, `drop column if exists`. Sem
-- BEGIN/COMMIT. Toda função perde EXECUTE de public, anon e authenticated.
-- PT402 = limite do plano: MENSAGEM `limite_do_plano:<recurso>:<teto>` (é o que
-- lib/cobranca/limites.ts lê; duas camadas de canal só repassam a mensagem) e
-- DETAIL {recurso, limite, em_uso}; a rota devolve 409 plan_limit_reached.
-- Gates: tests/invariants/cobranca-*.test.ts.

-- ── A. as duas tabelas, vazias; as colunas mortas saem ───────────────────────
create table if not exists public.cobranca_planos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 1 and 60),
  preco_cents bigint not null check (preco_cents >= 500),
  moeda text not null default 'BRL' check (moeda = any (array['BRL'::text])),
  intervalo text not null check (intervalo in ('mes', 'ano')),
  trial_dias integer not null default 14 check (trial_dias between 0 and 90),
  max_assentos integer check (max_assentos >= 1),
  max_canais integer check (max_canais >= 1),
  teto_ia_usd_cents integer check (teto_ia_usd_cents >= 100),
  padrao_no_cadastro boolean not null default false,
  arquivado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

comment on table public.cobranca_planos is
  'Planos que o dono da instalação vende às empresas dela (migration 0510). Da INSTALAÇÃO, sem organization_id: RLS ligada sem policy, só o service_role. Limite nulo = sem limite. preco_cents >= 500 (mínimo de boleto); moeda só BRL; teto_ia_usd_cents na moeda de fn_gasto_de_ia_do_mes.';

create unique index if not exists cobranca_planos_um_padrao
  on public.cobranca_planos ((true)) where padrao_no_cadastro and arquivado_em is null;

alter table public.cobranca_planos enable row level security;
revoke all on public.cobranca_planos from anon, authenticated;
grant select, insert, update, delete on public.cobranca_planos to service_role;

drop trigger if exists trg_cobranca_planos_touch on public.cobranca_planos;
create trigger trg_cobranca_planos_touch
  before update on public.cobranca_planos
  for each row execute function public.fn_touch_updated_at();

create table if not exists public.cobranca_assinaturas (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  plano_id uuid not null references public.cobranca_planos(id) on delete restrict,
  plano_agendado_id uuid references public.cobranca_planos(id) on delete restrict,
  estado text not null default 'trial' check (estado in ('trial', 'ativa', 'em_atraso', 'cancelada')),
  trial_ate timestamptz,
  provedor text check (provedor in ('stripe', 'asaas')),
  modo text check (modo in ('teste', 'producao')),
  provedor_cliente_id text,
  provedor_assinatura_id text,
  vencida_desde timestamptz,
  proximo_vencimento timestamptz,
  cancela_no_fim boolean not null default false,
  prazo_extra_ate timestamptz,
  ultimo_aviso text check (ultimo_aviso in ('trial_acabando', 'venceu', 'suspende_em_breve', 'suspensa')),
  ultimo_aviso_em timestamptz,
  checkout_url text,
  checkout_expira_em timestamptz,
  relida_em timestamptz,
  assinaturas_vivas integer not null default 0,
  ultimo_erro text check (ultimo_erro in ('credencial_invalida', 'provedor_fora', 'pagamento_de_assinatura_cancelada', 'leitura_invalida')),
  ultimo_erro_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cobranca_assinaturas_provedor_e_cliente_juntos
    check ((provedor is null) = (provedor_cliente_id is null))
);

comment on table public.cobranca_assinaturas is
  'Assinatura de cada empresa da instalação (migration 0510): uma linha por org; SEM linha = isenta de cobrança, limite e régua. estado vem da releitura do provedor, nunca do corpo do webhook; suspensa NÃO é estado daqui (fonte: organizations.status/suspended_kind). CPF/CNPJ nunca é guardado. Leitura: admin da própria org; escrita: só service_role.';
comment on column public.cobranca_assinaturas.vencida_desde is
  'Início da dívida corrente. MONOTÔNICO: só recua (least) ou zera quando o estado volta a ativa/trial; cancelar e reassinar não reinicia o relógio.';
comment on column public.cobranca_assinaturas.proximo_vencimento is
  'Fim do período pago. Só é sobrescrito por valor lido NÃO nulo.';

create unique index if not exists cobranca_assinaturas_cliente
  on public.cobranca_assinaturas (provedor, provedor_cliente_id) where provedor is not null;

alter table public.cobranca_assinaturas enable row level security;
drop policy if exists tenant_isolation_cobranca_assinaturas_select on public.cobranca_assinaturas;
create policy tenant_isolation_cobranca_assinaturas_select on public.cobranca_assinaturas
  for select to authenticated using (public.fn_role_at_least(organization_id, 'admin'));
revoke all on public.cobranca_assinaturas from anon, authenticated;
grant select on public.cobranca_assinaturas to authenticated;
grant select, insert, update, delete on public.cobranca_assinaturas to service_role;

drop trigger if exists trg_cobranca_assinaturas_touch on public.cobranca_assinaturas;
create trigger trg_cobranca_assinaturas_touch
  before update on public.cobranca_assinaturas
  for each row execute function public.fn_touch_updated_at();

-- Zero leitores em app, lib, workers, components, hooks e scripts (só os tipos);
-- nenhuma view nem função do baseline as cita (só o CREATE TABLE do dump); a
-- imagem anterior não as lê, então o rollback pelo agent.sh segue de pé.
alter table public.organizations
  drop column if exists ai_budget_cents,
  drop column if exists rate_limit_rps;

-- ── B. a chave e o limite ────────────────────────────────────────────────────
-- A régua SQL de "a cobrança está ligada": só `ligado` liga, como em
-- lib/instalacao/modulos.ts (linha ausente ou outro valor = desligada).
create or replace function public.fn_cobranca_ligada()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_config c
     where c.chave = 'MODULO_COBRANCA' and c.valor = 'ligado'
  );
$$;

revoke execute on function public.fn_cobranca_ligada() from public, anon, authenticated;
grant execute on function public.fn_cobranca_ligada() to service_role;

-- O limite do plano para um recurso. NULL = sem limite: chave desligada, org sem
-- assinatura (isenta) ou plano sem teto. O recurso é conferido ANTES da chave,
-- para um literal errado estourar em qualquer instalação. Vale o plano_id, nunca
-- o agendado (D-3). Os literais são RECURSOS_DO_PLANO (lib/cobranca/vocabulario.ts).
create or replace function public.fn_limite_do_plano(p_org uuid, p_recurso text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plano public.cobranca_planos%rowtype;
begin
  if p_recurso is null or p_recurso not in ('assentos', 'canais', 'ia_usd_cents') then
    raise exception 'recurso_do_plano_invalido' using errcode = '22023';
  end if;
  if not public.fn_cobranca_ligada() then
    return null;
  end if;
  select p.* into v_plano
    from public.cobranca_assinaturas a
    join public.cobranca_planos p on p.id = a.plano_id
   where a.organization_id = p_org;
  if not found then
    return null;
  end if;
  return case p_recurso
    when 'assentos' then v_plano.max_assentos
    when 'canais' then v_plano.max_canais
    else v_plano.teto_ia_usd_cents
  end;
end;
$$;

revoke execute on function public.fn_limite_do_plano(uuid, text) from public, anon, authenticated;
grant execute on function public.fn_limite_do_plano(uuid, text) to service_role;

-- ── C. assentos: provisório só pelo servidor, e o teto de pessoas ────────────
-- O vínculo provisório (0237) não ocupa vaga, e fn_user_org_ids o trata como
-- membro pleno. Sem esta trava, um admin de tenant inseriria provisórios pelo
-- PostgREST (user_orgs_insert aceita admin), e cada um entraria sem contar no
-- plano. O único escritor legítimo é fn_create_tenant_with_owner.
-- INVOKER e separado do gatilho de assentos DE PROPÓSITO: numa definer,
-- current_user é o dono da função e "quem escreve?" responderia sempre postgres
-- (molde: fn_organizacao_estado_so_pelo_servidor, 0501). A sessão ainda revoga e
-- reativa o provisório existente (rotas de Equipe, cliente da sessão); o que ela
-- não faz é CRIAR um.
create or replace function public.fn_membro_provisorio_so_pelo_servidor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cria_provisorio boolean;
begin
  if current_user not in ('authenticated', 'anon') or not new.provisional_until_handover then
    return new;
  end if;
  if tg_op = 'INSERT' then
    v_cria_provisorio := true;
  else
    v_cria_provisorio := not old.provisional_until_handover
                         or new.organization_id is distinct from old.organization_id;
  end if;
  if v_cria_provisorio then
    raise exception 'membro_provisorio_so_pelo_servidor'
      using errcode = '42501',
            detail = 'Vínculo provisório nasce só por fn_create_tenant_with_owner, nunca pela sessão.';
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_membro_provisorio_so_pelo_servidor() from public, anon, authenticated;

-- A coluna é da 0237. No baseline ela só é acrescentada DEPOIS da VARREDURA anon,
-- e `create trigger ... update of provisional_until_handover` exige a coluna: sem
-- esta linha a instalação nova para aqui com ON_ERROR_STOP. Idempotente.
alter table public.user_organizations
  add column if not exists provisional_until_handover boolean not null default false;

drop trigger if exists trg_membro_provisorio_so_pelo_servidor on public.user_organizations;
create trigger trg_membro_provisorio_so_pelo_servidor
  before insert or update of revoked_at, provisional_until_handover, organization_id
  on public.user_organizations
  for each row execute function public.fn_membro_provisorio_so_pelo_servidor();

-- O teto de pessoas. Conta ativo (sem revoked_at) e não provisório; convite
-- pendente não conta (D-10). Só confere quem PASSA a ocupar vaga: INSERT ativo,
-- revoked_at que volta a nulo, provisório que vira definitivo, troca de org de um
-- ativo. A trava consultiva faz duas entradas simultâneas não verem o mesmo
-- "cabe mais um". PT402; a MENSAGEM `limite_do_plano:assentos:<teto>` é o
-- contrato com lib/cobranca/limites.ts; DETAIL {recurso, limite, em_uso}.
create or replace function public.fn_trava_assentos_do_plano()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limite integer;
  v_em_uso integer;
begin
  if new.revoked_at is not null or new.provisional_until_handover then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.revoked_at is null
       and not old.provisional_until_handover
       and new.organization_id is not distinct from old.organization_id then
      return new;
    end if;
  end if;

  v_limite := public.fn_limite_do_plano(new.organization_id, 'assentos');
  if v_limite is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text, 2282));

  select count(*) into v_em_uso
    from public.user_organizations uo
   where uo.organization_id = new.organization_id
     and uo.revoked_at is null
     and not uo.provisional_until_handover
     and uo.user_id <> new.user_id;

  if v_em_uso >= v_limite then
    raise exception 'limite_do_plano:assentos:%', v_limite
      using errcode = 'PT402',
            detail = jsonb_build_object('recurso', 'assentos', 'limite', v_limite, 'em_uso', v_em_uso)::text;
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_trava_assentos_do_plano() from public, anon, authenticated;

drop trigger if exists trg_trava_assentos_do_plano on public.user_organizations;
create trigger trg_trava_assentos_do_plano
  before insert or update of revoked_at, provisional_until_handover, organization_id
  on public.user_organizations
  for each row execute function public.fn_trava_assentos_do_plano();

-- ── D. canais de mensagem: o teto de números conectados ──────────────────────
-- Conta canal NÃO arquivado que não seja `wacalls` (voz; a lista de mensagem é
-- PROVIDERS_DE_MENSAGEM em lib/channels/capabilities.ts). A trava consultiva é
-- a MESMA de fn_reserve_channel_connection (hashtextextended(org, 2281)):
-- reserva e inserção direta nunca contam ao mesmo tempo. Dentro da reserva a
-- trava já é da própria transação, e travas consultivas são reentrantes.
-- Um UPDATE que regrava archived_at = null num canal JÁ ativo (a reconexão de
-- savePartnerSession/reactivateChannelSession) sai na guarda de transição.
-- Essa guarda NÃO é intercambiável com o `cs.id <> new.id` da contagem: numa
-- org que já está ACIMA do teto (chave ligada sobre orgs existentes, ou
-- downgrade), os OUTROS canais já somam o teto, e só a guarda impede que a
-- reconexão de um número no ar vire PT402. O `cs.id <> new.id` serve a quem
-- entra de verdade (desarquivar, trocar provider ou org): não conta o próprio.
create or replace function public.fn_trava_canais_do_plano()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limite integer;
  v_em_uso integer;
begin
  if new.archived_at is not null or new.provider = 'wacalls' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.archived_at is null
       and old.provider <> 'wacalls'
       and new.organization_id is not distinct from old.organization_id then
      return new;
    end if;
  end if;

  v_limite := public.fn_limite_do_plano(new.organization_id, 'canais');
  if v_limite is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text, 2281));

  select count(*) into v_em_uso
    from public.channel_sessions cs
   where cs.organization_id = new.organization_id
     and cs.archived_at is null
     and cs.provider <> 'wacalls'
     and cs.id <> new.id;

  if v_em_uso >= v_limite then
    raise exception 'limite_do_plano:canais:%', v_limite
      using errcode = 'PT402',
            detail = jsonb_build_object('recurso', 'canais', 'limite', v_limite, 'em_uso', v_em_uso)::text;
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_trava_canais_do_plano() from public, anon, authenticated;

drop trigger if exists trg_trava_canais_do_plano on public.channel_sessions;
create trigger trg_trava_canais_do_plano
  before insert or update of archived_at, provider, organization_id
  on public.channel_sessions
  for each row execute function public.fn_trava_canais_do_plano();
