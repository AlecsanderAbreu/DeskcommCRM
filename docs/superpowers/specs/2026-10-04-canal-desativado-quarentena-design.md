# Canal desativado nunca entra na inbox: toggle por canal + quarentena

**Data:** 04/10/2026 · **Status:** desenho aprovado pelo dono, a implementar

## Problema

Revogada a chave do provedor social, a aba Redes sociais mostra "Acesso recusado" mas
as mensagens seguem entrando na inbox, sem nenhum estado degradado visível e sem
desligador na tela. Medido na VPS em 04/10/2026: sessão Instagram `WORKING`,
credencial rejeitada com 401/403, 3 inbound no dia.

Causa raiz dupla, medida no código:
1. A ingestão (WAHA, social, Meta) **nunca lê `channel_sessions.status`** — só
   `archived_at` barra entrada. `STOPPED/FAILED/STARTING` ingerem normalmente.
2. Não existe "desligado" por canal: `status` é do transporte (o health-check
   sobrescreve), `archived_at` é exclusão (some da UI, desloga, revoga), e não há
   toggle em nenhuma das três telas de canal.

## Lei (decisão do dono, 04/10/2026)

**Desativado nunca entra na inbox.** Com a semântica:
1. **Desativado = decisão do operador** (toggle), nunca saúde transitória.
   `STOPPED/FAILED/SCAN_QR_CODE/STARTING` continuam ingerindo.
2. **Quarentena, não descarte.** A entrega é gravada marcada, mas não aparece na
   inbox, não dispara IA e não gera follow-up. Reativou, tudo volta. Nada se perde.
3. Vale para os três canais (WAHA, social, Meta oficial), com toggle onde falta.

## Decisões de desenho

1. **Flag em `channel_sessions.metadata.disabled`, sem migration.** Precedente:
   `metadata.ai_gate` no mesmo campo, lido nos mesmos pontos. Coluna nova exigiria
   tripla + índice e não compra nada aqui — os filtros são em código de app
   (lista de ids + `NOT IN`), sem RLS nova.
2. **Derivação dinâmica, sem carimbo por conversa.** Inbox, dispatch, follow-up e
   envio consultam o flag do canal na hora. Toggle liga/desliga com efeito
   imediato nos dois sentidos, sem backfill e sem migração de dados.
3. **Não tocar nas barreiras de `archived_at`.** Arquivado continua descartando na
   borda; desativado passa e quarentena. Semânticas distintas, caminhos distintos.
4. **Envio segue o padrão do arquivado.** Canal desativado recusa envio com
   `error_code=channel_disabled`, terminal (`failed`), espelhando
   `messages/_handler.ts:848-869`.

## Fatos medidos no código que o desenho usa

- Rota genérica: `app/api/v1/webhooks/channel/[token]/route.ts:63-98` (select sem
  `status`; única guarda é `archived_at` em `:92-94`).
- Rota WAHA: `app/api/v1/webhooks/waha/[token]/route.ts:99-116` (lookup tolerante
  via `lib/channels/archived.ts`, sem `status`).
- Social: `lib/channels/social/ingest.ts:11-20` (select só `zernio_account_id,
  metadata` + `archived_at null`) e `:40-47` (pertencimento sem `status`).
- Inbox: `app/api/v1/conversations/_handler.ts:149-410` (lista) e
  `app/api/v1/conversations/counts/route.ts:111-169` (badges) — nenhum predicado
  de canal; padrão de exclusão por lista de ids já existe na busca (`:62-84`).
- Dispatch barato: `lib/channels/pos-entrada.ts:419-445` (`pedirDespachoDoAgente`,
  antes do `emit_event`) + defesa no `drain.ts:262-275` (estender a query com
  `JOIN channel_sessions`) + `ai-response-worker.ts` legado.
- Follow-up: `followup-turn.ts:346-352` (espelhar a guarda de arquivado, mantendo
  `to_jsonb` para clone sem a coluna) + `silence-sweep.ts:427-539` (não popular
  `latest`/`origins` de canal desativado) + gatilhos que enrollam
  (`agent-followup-gate.ts:24-55`).
- Toggle: `PATCH` espelhado em `ai-access/route.ts:32-54` (`requireRole admin` +
  `requireSupportWrite`, audit `channel.disabled/channel.enabled`); switch nas
  telas de canal + badge "Pausado" via `lib/channels/estado.ts`.
- Testes-molde: `tests/unit/followup-canal-arquivado.test.ts` (dead-letter antes
  do turno) e `tests/unit/canal-arquivado-caminho-de-volta.test.ts`.

## Fora desta versão

- Bloquear entrada por `status` de saúde (decisão explícita: saúde transitória não
  descarta mensagem).
- Regras de automação e webhooks de saída reagindo a `message.received` de canal
  desativado (inventário no plano; o editor de regras decide por evento).
- Notificações push de mensagem quarentenada.

## Critérios de aceite (todos com prova)

1. Canal desativado: entrega gravada, fora da lista e dos badges da inbox,
   sem `ai_agent.dispatch_requested`, sem enrollment de follow-up, envio recusado
   com `channel_disabled`. Prova: spec e2e + `webhook_events_log` na VPS.
2. Reativado: tudo reaparece sem reimportar nada.
3. Teste que fica vermelho sem o conserto (espelho do molde arquivado).
4. `typecheck` + `lint` + `lint:channels` verdes; suíte da área verde; vermelhos
   fora da área comparados com a base.
