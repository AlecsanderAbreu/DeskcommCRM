-- 0523 — o classificador do roteador nasce "Automático"
--
-- O `ai_routers.config` semeava `'classifier_model', 'claude-haiku-4-5'`, um id
-- fixo do ANTHROPIC dentro de um produto multi-provedor. Medido numa instalação
-- real com a organização na OpenRouter (2026-10-02, `llm_calls`):
--
--   provider openrouter · model claude-haiku-4-5 · http_status 400
--   error_message "claude-haiku-4-5 is not a valid model ID"
--   origem_da_escolha "variavel_de_ambiente"
--
-- O id fixo entra pelo PRECEDÊNCIA 3 de `decidirBinding`
-- (`lib/ai/pontos/resolver.ts`): modelo do call site vence o padrão da
-- organização, e como `classifyIntent` só passa `model` quando o roteador tem
-- um, o roteador nascia com o id do Anthropic e ele ia para o endpoint da
-- OpenRouter — `origin` = provider da org, `modelId` = id do call site, sem
-- tradução no meio. A organização configurou OpenRouter e NUNCA escolheu
-- Claude; o default do banco escolheu por ela.
--
-- E o id nem existe na OpenRouter. Conferido no catálogo público
-- (`GET https://openrouter.ai/api/v1/models`, 464 ids, medido em 2026-10-02):
-- o modelo é `anthropic/claude-haiku-4.5` — PONTO entre 4 e 5, não traço. Nem
-- `claude-haiku-4-5` nem `anthropic/claude-haiku-4-5` existem lá. A forma com
-- traço é a do ANTHROPIC nativo (migration 0010/0104), o que faz o default
-- parecer válido em qualquer revisão de catálogo.
--
-- O conserto é o que `lib/agent-engine/agent/router-config.ts` já exige na
-- docstring de `classifierModel`: "NUNCA um id fixo aqui". O default passa a
-- não trazer `classifier_model`, e `loadActiveRouter` devolve `null` =
-- "Automático" — o seam resolve pelo painel de provedores, senão pelo padrão da
-- organização, como qualquer outro ponto. Mesmo caminho já medido e corrigido em
-- `lib/agent-engine/flywheel/live.ts` ("Fixavam claude-haiku-4-5 ... a rodada
-- agendada morria a cada execução"), que é o mesmo defeito na mesma forma.
--
-- `sticky` e `min_confidence` saem do default porque o resto do produto já os
-- tem como defaults no leitor (`router-config.ts:111-115`): semei-los aqui só
-- criava mais um lugar onde o roteador nascia diferente do que o leitor
-- presume. Nenhum knob é perdido: quem configurou à mão tem os valores
-- gravados no jsonb e a cura abaixo não os toca.
--
-- A cura é cirúrgica: só some com `classifier_model` quando o valor é
-- EXATAMENTE o id semeado (`claude-haiku-4-5` ou `anthropic/claude-haiku-4-5`).
-- Quem escolheu um modelo de propósito — qualquer outro id — não é tocado, nem
-- o roteador de quem escolheu o mesmo id num provedor onde ele existe (Anthropic
-- nativo resolve o alias `claude-haiku-4-5`; ver migration 0104). O
-- `classifier_model` de quem escolheu some virando "Automático", que é o estado
-- que a própria tela promete e que resolve melhor — nunca com um id adivinhado
-- no lugar do que a pessoa escolheu.

-- 1 · Default novo: sem id de modelo. Quem cria um roteador agora nasce em
-- "Automático" e o seam escolhe.
alter table public.ai_routers
  alter column config set default jsonb_build_object(
    'sticky', true,
    'min_confidence', 0.6);

-- 2 · Cura das linhas já semeadas com o id fixo, preservando todo o resto do
-- config. `jsonb_build_object` com o config inteiro seria reescrever a linha;
-- `-` remove só a chave e devolve o resto byte a byte.
--
-- ⚠️ A EXCEÇÃO DO `classifier_provider` É O QUE IMPORTA, e ela existe porque o
-- id semeado e o id escolhido são o MESMO NOME. Sem ela, esta cura apagaria a
-- escolha de quem roda Anthropic nativo e escolheu `claude-haiku-4-5` de
-- propósito — lá o alias resolve (`GET /v1/models/claude-haiku-4-5`, migration
-- 0104) e o roteador funciona. O id é o mesmo; o que distingue os dois casos é
-- QUE PROVEDOR a linha aponta, e é isso que a guarda lê.
--
-- O lado que sobra sem `classifier_provider` é o de quem escolheu o id num
-- provedor onde ele NÃO existe e mesmo assim não apontou o provedor. Perder o
-- id fixo e voltar a "Automático" é a falha MENOR: o seam resolve um modelo válido
-- para aquela organização. O oposto — manter um id que dá 400 em toda
-- classificação — é o que não pode acontecer.
update public.ai_routers
set config = config - 'classifier_model'
where config->>'classifier_model' in ('claude-haiku-4-5', 'anthropic/claude-haiku-4-5')
  and coalesce(config->>'classifier_provider', '') is distinct from 'anthropic';

-- Idempotente por construção: rodar duas vezes dá o mesmo estado (o default já
-- não tem a chave, e o `where` só acha chave com o id semeado). `update` sem
-- `where` de organização — `ai_routers` é de todas as organizações e o default
-- foi semeado em todas; a correção é do schema, não de um cliente.