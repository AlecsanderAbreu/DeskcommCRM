# Plano — Pedido 1: bloqueado na ligação é recusado

> Base: `origin/main 69168054f`, medido em 03/10/2026. Só plano, nenhum código.
> Branch: `fix/voz-recusa-bloqueado`. Destino: **núcleo** (entrada de ligação e respeito a descadastro valem para toda instalação; sem extensão, sem nicho).

## 1. Caminhos de entrada (a recusa vale em todos)

- **SIP (Asterisk), o único com IA que atende:** `handleStasisStart` em `workers/voice-agent/index.ts`. Resolve o contato (`resolveOrCreateCallerContact` em `lib/voip/resolve-caller.ts`, que não lê `is_blocked`), grava `voice_calls`, chama `garantirLeadDaConversa` (recusa só o negócio) e devolve ao dialplan (`continueDialplan`), onde a IA assume. Recusa aqui.
- **WaCalls (chamadas WhatsApp):** ponte em `lib/wacalls/events-bridge.ts` (`incoming` grava a linha, `call-ended` gera aviso `voice_call_missed` na Central + atividade na timeline). Nenhuma IA nossa atende aqui e nenhum negócio nasce (sem chamada a `garantirLeadDaConversa` nesse módulo). Recusa aqui = sem aviso e sem atividade para bloqueado (a linha continua gravada).
- **Saída (`POST /api/v1/voice/calls`) já recusa:** `app/api/v1/voice/calls/route.ts` devolve 403 para `is_blocked` (precedente do padrão e do texto de erro).

## 2. Ponto exato da recusa (SIP)

Depois de resolver o contato, antes de `continueDialplan` e antes da IA. Trecho atual (`workers/voice-agent/index.ts`):

- `resolveOrCreateCallerContact(...)` devolve só o `contact_id` (falha não bloqueia a chamada);
- insert em `voice_calls` com `status: "ringing"`;
- `garantirLeadDaConversa(...)` (recusa só o negócio);
- `continueDialplan(...)` rumo ao AudioSocket, onde a IA assume.

Mudança: entre o contato resolvido e o resto, ler `is_blocked` do contato; se `true`, gravar a linha já encerrada e desligar (`hangupChannel`), sem negócio, sem IA, sem tocar, sem alerta.

## 3. Falha ao ler o bloqueio: deixa passar

Decisão: **fail-open** (só recusa com `is_blocked === true` positivo; erro de leitura loga aviso e segue). Justificativa: quem ligou iniciou o contato; o próprio `handleStasisStart` já segue adiante quando resolver o contato falha; precedente do dreno (erro de elegibilidade enfileira e revalida); falha total de banco já desliga sozinha no insert. Recusar no escuro derrubaria ligação legítima por instabilidade transitória, e o erro fica no log com alerta.

## 4. Gravação em `voice_calls` (sem migration)

- `status`: CHECK só aceita `starting/ringing/connected/ended` (`voice_calls_status_check`) → recusada grava `ended`.
- `end_reason`: texto **sem CHECK de propósito** (comentário no schema: pode ganhar valor novo) → recusada grava `contact_blocked`. Valor novo em campo sem CHECK **não vira migration**.
- `answered_at` nulo, `ended_at` na hora da recusa, `contact_id` e `peer_phone` normais (a linha identifica quem ligou).

## 5. Histórico mostra "recusada — contato bloqueado" (bloqueado NÃO é escondido)

- Rota `GET /api/v1/voice/calls/history` já devolve `end_reason` por linha. A chamada recusada aparece nela com `contact_blocked`, a ser renderizado como "recusada — contato bloqueado".
- Medido por grep: nenhum consumidor da rota em `app/` ou `components/voice/` (só o painel de opt-in chama outra rota). A tela que renderiza `end_reason` será localizada na implementação pelo chamador da rota; o teste cobre a saída da rota.

## 6. Teste + sabotagem

- Arquivo novo junto do worker (ex.: `workers/voice-agent/recusa-bloqueado.test.ts`) sobre função de decisão pura (recebe flags do contato, devolve recusar/seguir):
  - bloqueado → recusa (grava encerrada + desliga; sem negócio, IA, toque ou alerta);
  - não bloqueado → segue exatamente igual a hoje;
  - falha de leitura → segue + log de aviso (fail-open do item 3).
- Sabotagem por caso: remover a checagem deixa o caso 1 vermelho; forçar recusa sempre deixa o caso 2 vermelho; engolir o erro sem log deixa o caso 3 vermelho.
- Ponte WaCalls: teste de que `incoming`/`call-ended` de bloqueado não cria aviso nem atividade (sabotagem: emitir aviso → vermelho).

## 7. VPS: telefonia desligada — prova é o CI

Medido na VPS em 03/10/2026 (só leitura, filtrado por organização): empresa `minha-empresa` (`59914589-…`) tem **zero linhas** em `phone_numbers` e **zero** em `voice_calls`. Sem número mapeado não há como ligar de verdade; a prova do pedido 1 é o CI do fork (unit + gates), sem prova em tela.

## 8. Fragmento e fechamento

- Fragmento `.changes/voz-recusa-bloqueado.md`: `impacto: capacidade_nova`, `secao: corrigido`, título na voz de quem usa, um parágrafo, crédito.
- Pré-voo (à mão, WSL quebrado nesta máquina), push ao fork, CI verde, PR ao Rafael com corpo (o que foi provado e onde + o que NÃO foi medido: prova em tela, sem telefonia na VPS).
