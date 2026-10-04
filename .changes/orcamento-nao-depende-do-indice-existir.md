---
impacto: nada_mudou
secao: corrigido
titulo: O portão de orçamento de IA não falha aberto se a atualização aplicar o código antes do índice
---

O portão de orçamento passou a usar a forma `on conflict do nothing` sem alvo nos dois inserts do motor. A forma com alvo dependia de o índice único parcial da 0540 já existir: numa instalação cuja atualização aplicasse o código antes do banco, a consulta do orçamento falhava com 42P10 e a chamada seguia sem teto — o portão abria em vez de fechar. A forma sem alvo não depende de inferência, e o conflito possível (a mesma organização e o mesmo tipo de aviso aberto) continua sem duplicar item. O log do worker que abre o aviso de orçamento agora distingue "já estava aberto" de falha real.

Nada é preciso fazer na instalação.

Contribuição de @Tong-bit-art.
