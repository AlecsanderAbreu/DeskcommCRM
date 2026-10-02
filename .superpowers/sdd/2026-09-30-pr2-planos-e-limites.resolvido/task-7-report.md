# Task 7 — Prova do banco inteira

Base = HEAD = 2c7d4ace36eed661612f095d85bd1cd6ff0235ac. Nenhum commit (verificacao; nada a mesclar).

## Passo 1
- `git merge --no-commit feat/org-operante` -> "Already up to date" ; "nada a mesclar" (feat/org-operante 66cc8d468 e ancestral do HEAD). As conferencias pos-merge e o Procedimento G nao se aplicam.
- MANIFEST 0510: 1 ; bloco do baseline 0510: 1 ; secoes A-F: 1 cada ; `pnpm checar:colisao-de-migration` exit=0 (OK, 1 migration livre).

## Passo 2
- `TEST_DB_IMAGE=pgvector/pgvector:pg17 pnpm test:db <7 arquivos cobranca-*>`: exit=0, Test Files 7 passed (7), Tests 71 passed (71), 0 FAIL. Load durante: ~48-59.
- Sem `docker ps` residual meu (so contêineres de outras sessoes: painel-admin-prova, deskcomm-cal).

## Desvios
1. `pnpm test:db` SEM arquivos (todos os invariantes, install+update) NAO rodado: regra de POUCA MEMORIA do dono (load 50+). Fica para o CI / Task 39.
2. 71 testes em vez de 70 do brief: um caso a mais acrescentado por tarefa anterior; todos verdes.

## Autoavaliacao
Prova das 7 suites da cobranca em pg17 verde. Lacuna conhecida: suite completa de invariantes nao exercitada localmente.

## Relatorio de correcao rodada 1
Achado 1 (suite de invariantes nao rodada na imagem padrao): atendido no minimo exigido pelo achado (5 invariantes modificados pelo PR + 7 cobranca-*), na imagem PADRAO (pg15, sem TEST_DB_IMAGE). `pnpm test:db` sem lista (todos os invariantes) segue para o CI / Task 39, por regra de POUCA MEMORIA (load 39-49).
- Comando: `pnpm test:db followup-org-suspensa org-suspensa rls-completude-varredura rls-isolation vocabulario-banco-x-typescript + 7 cobranca-*.test.ts` (caminhos tests/invariants/)
- Saida: exit=0 ; `Test Files  12 passed (12)` ; `Tests  355 passed (355)` ; 0 linhas FAIL ; load 48,88 ao fim.
- `docker ps`: nenhum conteiner meu residual.
- Nenhuma mudanca de codigo; commit apenas deste relatorio.
