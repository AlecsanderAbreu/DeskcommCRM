# Plano — Pedido 1: bloqueado na ligação é recusado

> Base: `origin/main 69168054f`, medido em 03/10/2026. Só plano, nenhum código.
> Branch: `fix/voz-recusa-bloqueado`. Destino: **núcleo** (entrada de ligação e respeito a descadastro valem para toda instalação; sem extensão, sem nicho).

## 1. Caminhos de entrada (a recusa vale em todos)

- **SIP (Asterisk), o único com IA que atende:** `handleStasisStart` em `workers/voice-agent/index.ts`. Resolve o contato (`resolveOrCreateCallerContact` em `lib/voip/resolve-caller.ts`, que não lê `is_blocked`), grava `voice_calls`, chama `garantirLeadDaConversa` (recusa só o negócio) e devolve ao dialplan (`continueDialplan`), onde a IA assume. Recusa aqui.
- **WaCalls (chamadas WhatsApp):** ponte em `lib/wacalls/events-bridge.ts` (`incoming` grava a linha, `call-ended` gera aviso `voice_call_missed` na Central + atividade na timeline). Nenhuma IA nossa atende aqui e nenhum negócio nasce (sem chamada a `garantirLeadDaConversa` nesse módulo). Recusa aqui = sem aviso e sem atividade para bloqueado (a linha continua gravada).
- **Saída (`POST /api/v1/voice/calls`) já recusa:** `app/api/v1/voice/calls/route.ts` devolve 403 para `is_blocked` (precedente do padrão e do texto de erro).

## 2. Ponto exato da recusa (SIP)

Depois de resolver o contato, antes do insert em `voice_calls`, antes de `continueDialplan` e antes da IA. Trecho atual medido (`workers/voice-agent/index.ts:65-150`, `handleStasisStart` — função privada, não exportada; ARI via `lib/voip/ariClient.ts:44-50`, `supabaseAdmin` em nível de módulo na linha 59):

- `resolveOrCreateCallerContact(...)` (linha 85) devolve só `contact_id: string | null` (medido em `lib/voip/resolve-caller.ts:26-57`; `encontrarContatoPorTelefone` seleciona só `"id, phone_number"` em `lib/channels/contato-por-telefone.ts:91-98`; a coluna `contacts.is_blocked` existe — referenciada em várias migrations, ex. 0203/0227/0229);
- insert em `voice_calls` com `status: "ringing"` (linhas 102-115);
- `garantirLeadDaConversa(...)` (linhas 128-143, recusa só o negócio);
- `setChannelVariable` + `continueDialplan(...)` rumo ao AudioSocket, onde a IA assume (linhas 148-149).

Mudança: `resolveOrCreateCallerContact` passa a devolver `{ id, is_blocked }` lendo `is_blocked` **na mesma consulta** que resolve o contato (acrescenta a coluna ao `select` de `buscarPorVariantes`, sem consulta extra; contato criado na hora nasce com `is_blocked` falso, default da coluna). Entre o contato resolvido e o insert, se `is_blocked === true`, gravar a linha já encerrada (`status: "ended"`, `end_reason: "contact_blocked"`, `ended_at` agora, `answered_at` nulo) e desligar (`hangupChannel`), sem negócio, sem IA, sem tocar, sem alerta. Extração exigida: função de decisão pura e exportada (ex. `deveRecusarChamada`) + costura no worker que a USA — ver item 6 (teste do fio). Sem a costura, a função pura sozinha não prova nada.

**Alerta (medido, não suposto):** `hooks/calls/useInboundCallAlerts.ts:54-59` dispara em **todo** INSERT de `voice_calls` com `provider === "sip"` (linha 57) e `direction === "inbound"` (linha 58) — **sem olhar `status` nem `end_reason`**. A recusada (`ended`/`contact_blocked`) tocaria o aviso do mesmo jeito. Mudança: o `onChange` ignora a linha quando `status === "ended"` com `end_reason === "contact_blocked"` (guarda nas duas, não só no motivo: linha encerrada por outro motivo continua avisando como hoje). O caminho do aviso, medido de ponta a ponta: `entregarAviso` (`lib/notifications/deliver.ts:28-55`) mostra toast in-app e, com o canal ligado, emite push de navegador via `emitNotification` (categoria `call_inbound` em `lib/notifications/kinds.ts:8` e `lib/notifications/prefs.ts:9`). Ponte WaCalls medida: `incoming` (`lib/wacalls/events-bridge.ts:568-585`) só grava a linha, sem aviso; quem avisa é `handleCallEnded` (linhas 399-411: item `voice_call_missed` na Central + 430-466: atividade na timeline via `emitAgentActivityForContact`). Recusa WaCalls = pular os dois para bloqueado (a linha continua gravada). **Push no celular, medido:** aviso da Central só chega ao celular quando `somDoAviso` não é nulo (`lib/notifications/push-dos-avisos.ts:67-83`), e `voice_call_missed` cai no `return null` (`lib/notifications/sons-da-org.ts:69-79` — só `handoff`, `proposta_pronta_para_revisao`, etapa e `ai_provider_credential` têm som). Ou seja: chamada perdida WaCalls hoje **não** vai ao celular; pular o item da Central para bloqueado não tira push de ninguém.

## 3. Falha ao ler o bloqueio: deixa passar

Decisão: **fail-open** (só recusa com `is_blocked === true` positivo; erro de leitura loga aviso e segue). Justificativa medida: o próprio `handleStasisStart` já segue adiante quando resolver o contato falha (`workers/voice-agent/index.ts:83-88`, `callerContactId` fica `null` e a chamada continua); `resolveOrCreateCallerContact` devolve `null` em falha (`lib/voip/resolve-caller.ts:57`) — o caminho `null` (contato desconhecido) segue como hoje, nunca recusa. Precedente do dreno (erro de elegibilidade enfileira e revalida); falha total de banco já desliga sozinha no insert. Recusar no escuro derrubaria ligação legítima por instabilidade transitória, e o erro fica no log com alerta.

## 4. Gravação em `voice_calls` (sem migration)

- `status`: CHECK só aceita `starting/ringing/connected/ended` (`voice_calls_status_check`) → recusada grava `ended`.
- `end_reason`: texto **sem CHECK de propósito** (comentário no schema: pode ganhar valor novo) → recusada grava `contact_blocked`. Valor novo em campo sem CHECK **não vira migration**.
- `answered_at` nulo, `ended_at` na hora da recusa, `contact_id` e `peer_phone` normais (a linha identifica quem ligou).

## 5. Histórico mostra "recusada — contato bloqueado" (bloqueado NÃO é escondido)

Onde a ligação aparece para a equipe, medido agora (nada fica para "a implementação localizar"):

- **Tela de chamadas SIP (`/app/calls`):** `app/app/calls/_client.tsx:49-57` (`STATUS_LABEL`) rende o `status` vindo de `GET /api/v1/calls` (`app/api/v1/calls/route.ts:71-116`). A rota **lê** `end_reason` do banco (`LIST_COLS`, linha 40) mas **não o expõe**: usa-o só para mapear o vocabulário rico em `mapStatusParaApi` (linhas 49-64) e o descarta na resposta (linhas 98-116). Uma recusada (`ended` + `contact_blocked`) cairia no `default` da linha 61-62 e apareceria como **"Concluída"** — falso. Mudança: `mapStatusParaApi` mapeia `contact_blocked` para `canceled` ("Cancelada", o rótulo existente mais próximo de recusa sem inventar vocabulário novo), sem expor `end_reason` nem mudar o contrato da rota.
- **Rota `GET /api/v1/voice/calls/history`** (`app/api/v1/voice/calls/history/route.ts:38`) **já devolve** `end_reason` por linha — a recusada aparece nela com `contact_blocked`, a ser renderizado como "recusada — contato bloqueado". Medido por grep: nenhum consumidor dessa rota em `app/` ou `components/voice/`; o teste cobre a saída da rota.
- **Timeline do negócio:** o worker SIP **não** emite atividade (medido: `handleStasisStart`, linhas 65-150, não chama `emitAgentActivityForContact` — só insert + `garantirLeadDaConversa`). A recusada SIP não aparece na timeline, e está certo assim: recusar é não-interação, e atividade `voice_call_missed` ("Chamada de voz perdida" em `lib/leads/activity-vocabulary.ts:274`) quebraria o silêncio do negócio à toa. WaCalls segue sem atividade para bloqueado (item 2).

## 6. Teste + sabotagem

- Função de decisão pura e exportada (ex. `workers/voice-agent/recusa-bloqueado.ts`, `deveRecusarChamada(isBlocked)`), com teste ao lado:
  - bloqueado → recusa (grava encerrada + desliga; sem negócio, IA, toque ou alerta);
  - não bloqueado → segue exatamente igual a hoje;
  - falha de leitura (`null`/erro) → segue + log de aviso (fail-open do item 3).
- **Teste do fio (obrigatório, além da função pura):** prova que `handleStasisStart` **USA** a decisão. Medido: `handleStasisStart` é privada (`workers/voice-agent/index.ts:65`) e não há nenhum `*.test.ts` em `workers/voice-agent/` hoje — o teste do fio exige a costura (exportar a decisão e/ou o caminho, com dublês para `hangupChannel`, `continueDialplan` e `garantirLeadDaConversa`) e afirma o desvio de verdade: bloqueado → `hangupChannel` chamado UMA vez, `continueDialplan` e `garantirLeadDaConversa` NUNCA chamados; não bloqueado → fluxo idêntico ao de hoje. **Sabotagem do fio:** remover a chamada da decisão dentro do worker (manter a função pura existindo mas sem uso) = teste do fio vermelho. Função pura órfã não conta como implementação.
- Sabotagem por caso na função pura: remover a checagem deixa o caso 1 vermelho; forçar recusa sempre deixa o caso 2 vermelho; engolir o erro sem log deixa o caso 3 vermelho.
- Alerta (`useInboundCallAlerts`): teste de que linha `ended`/`contact_blocked` não dispara `entregarAviso` e linha `ringing` normal dispara (sabotagem: tirar a guarda do `end_reason` = vermelho).
- Ponte WaCalls: teste de que `incoming`/`call-ended` de bloqueado não cria aviso nem atividade (sabotagem: emitir aviso → vermelho).

## 7. VPS: telefonia desligada — prova é o CI

Medido na VPS em 03/10/2026 (só leitura, filtrado por organização): empresa `minha-empresa` (`59914589-…`) tem **zero linhas** em `phone_numbers` e **zero** em `voice_calls`. Sem número mapeado não há como ligar de verdade; a prova do pedido 1 é o CI do fork (unit + gates), sem prova em tela.

## 8. Fragmento e fechamento

- Fragmento `.changes/voz-recusa-bloqueado.md`: `impacto: capacidade_nova`, `secao: corrigido`, título na voz de quem usa, um parágrafo, crédito.
- Pré-voo (à mão, WSL quebrado nesta máquina), push ao fork, CI verde, PR ao Rafael com corpo (o que foi provado e onde + o que NÃO foi medido: prova em tela, sem telefonia na VPS).
