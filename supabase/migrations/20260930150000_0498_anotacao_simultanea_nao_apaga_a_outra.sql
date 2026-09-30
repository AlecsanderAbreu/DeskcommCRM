-- 0498 — duas anotações ao mesmo tempo não apagam uma à outra.
--
-- ─── O defeito, medido na main de 2026-09-30 ────────────────────────────────
--
-- `updateLeadHandler` (`app/api/v1/leads/_handler.ts`) mesclava `custom_fields`
-- NO APLICATIVO:
--
--     const prev = existing.custom_fields …        -- lido no SELECT, lá em cima
--     patch.custom_fields = { ...prev, ...input.custom_fields };
--
-- `existing` vem de uma leitura anterior. Duas escritas simultâneas com chaves
-- DIFERENTES perdem uma: a segunda leu `prev` antes de a primeira gravar, e
-- sobrescreve a coluna inteira com a versão velha mais a chave dela. Ninguém
-- recebe erro. O dado some.
--
-- ─── Quem chega a esse ponto ────────────────────────────────────────────────
--
-- O handler serve dois caminhos: o `PATCH /api/v1/leads/[id]` (o formulário do
-- dossiê) e a ferramenta MCP `crm_update_lead` (o assistente, integrações). Os
-- dois podem escrever a mesma ficha ao mesmo tempo — quem atende salvando na
-- tela enquanto o assistente anota. A rota `move` NÃO tem este defeito: o
-- `update` dela exige `updated_at = expected_updated_at`, então uma leitura velha
-- vira conflito, não dado perdido. O `PATCH` do lead não tem esse controle.
--
-- ─── Por que uma função, e não uma linha no handler ─────────────────────────
--
-- O handler grava pelo PostgREST (`supabase.update()`), e ele não sabe dizer
-- `custom_fields = coalesce(custom_fields,'{}'::jsonb) || $1::jsonb` — só sabe
-- mandar um VALOR pronto, que é justamente o valor calculado a partir de uma
-- leitura velha. O merge atômico tem de acontecer onde a trava de linha existe:
-- dentro do banco.
--
-- `for update` antes do `update` não é redundante com o `update`: ele é o que
-- faz a segunda transação ESPERAR e RELER o que a primeira gravou, em vez de
-- decidir com o que leu antes. Sem ele, duas chamadas concorrentes leem a mesma
-- versão e a última concatena em cima de dado vencido.
--
-- ─── O que esta função NÃO faz ──────────────────────────────────────────────
--
-- Ela não decide QUEM pode escrever o quê: papel e organização são de quem
-- chama (o handler resolve a organização de fonte confiável, nunca do body).
-- Aqui só se garante que nenhuma escrita apague a outra por acidente de relógio.
-- Misturar as duas coisas faria uma função que ninguém consegue auditar.
--
-- `||` em `jsonb` é raso de propósito: campo de funil é chave→valor, sem
-- aninhamento. Merge profundo mudaria o significado de "apagar um campo".
--
-- Idempotente: `create or replace` e revoke/grant reaplicáveis. Sem constraint
-- nem dado a corrigir.

create or replace function public.fn_lead_anotar_campos(
  p_org uuid, p_lead uuid, p_campos jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  resultado jsonb;
begin
  if p_campos is null or jsonb_typeof(p_campos) <> 'object' then
    raise exception 'campos_precisa_ser_objeto' using errcode = '22023';
  end if;

  -- A TRAVA É O CONSERTO. Quem chega depois espera aqui e relê o que o
  -- primeiro gravou; sem isto os dois concatenariam em cima da mesma versão
  -- velha e a última escrita venceria sozinha.
  perform 1 from public.crm_leads
   where organization_id = p_org and id = p_lead
   for update;
  if not found then
    -- Silêncio de propósito: quem pede um lead que não é da organização dele
    -- não recebe confirmação de que ele existe em outro lugar.
    return null;
  end if;

  update public.crm_leads
     set custom_fields = coalesce(custom_fields, '{}'::jsonb) || p_campos
   where organization_id = p_org and id = p_lead
   returning custom_fields into resultado;

  return resultado;
end $fn$;

-- Função nova em `public` NASCE EXPOSTA, e são DUAS origens de EXECUTE: o
-- `ALTER DEFAULT PRIVILEGES … GRANT ALL ON FUNCTIONS` do corpo do baseline (que
-- alcança toda função criada depois dele, para anon, authenticated E
-- service_role) e o grant a PUBLIC que o Postgres dá a qualquer função ao
-- criá-la. Revogar só de `public, anon` deixaria esta função — que ESCREVE —
-- executável por qualquer usuário logado de QUALQUER organização.
-- `tests/invariants/hardening-definer-varredura.test.ts` cobra as duas origens.
revoke all on function public.fn_lead_anotar_campos(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fn_lead_anotar_campos(uuid, uuid, jsonb) to service_role;

comment on function public.fn_lead_anotar_campos(uuid, uuid, jsonb) is
  'Mescla campos personalizados no lead DENTRO do banco, sob trava de linha. '
  'Existe porque o merge no aplicativo perdia escrita concorrente em silêncio. '
  'Não decide papel nem organização — isso é de quem chama.';

notify pgrst, 'reload schema';
