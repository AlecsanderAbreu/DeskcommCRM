---
impacto: nada_mudou
secao: corrigido
titulo: A atualização não devolve mais o privilégio de TRUNCATE ao papel anônimo em idempotency_keys
---
O `baseline.sql` é reaplicado inteiro em toda atualização. A concessão de `ALL` ao `anon` em `idempotency_keys` vinha do snapshot e a revogação de `TRUNCATE` — o único privilégio que ignora RLS — ficava no fim do arquivo: entre as duas pontas, e para sempre se a passada morresse no meio, o papel anônimo carregava o privilégio.

Agora a revogação acompanha a concessão, e o estado final não muda: o `anon` continua sem `TRUNCATE` e com o restante, que é o que a criação de tenant pela chave anônima usa. Nada é preciso fazer na instalação.

Contribuição de @Tong-bit-art.
