# O `git merge origin/main` deixa de ser autoria de quem mergeia

A guarda de migration passa a julgar só o que o commit introduz: o arquivo que a
`main` traz num merge não é colisão de quem mergeia. Quem CRIA um arquivo de
migration com número já usado continua bloqueado — as duas metades, num único
teste de caminho de produção (`tests/shell/hooks-nao-acusam-a-main.test.sh`,
casos `MIG-MERGE` e `MIG-CRIA`).

Contribuição de @webtecnica (#374)
