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
