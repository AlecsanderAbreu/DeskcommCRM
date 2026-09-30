---
impacto: nada_mudou
secao: corrigido
titulo: O filtro de etiqueta do atendimento continua na tela mesmo quando a organização pisca nula por um render
---

Guarda de regressão para o seletor de etiqueta do Inbox (#1336): o teste
permanente cobre o cenário em que `activeOrg` volta a nulo por um render — com
os dois hooks de vocabulário respeitando `enabled: !!orgId` (sem orgId, `data`
volta a `undefined`). O seletor, aberto ou com filtro aplicado, não desmonta.