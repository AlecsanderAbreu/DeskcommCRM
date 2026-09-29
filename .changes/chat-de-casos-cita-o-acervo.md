---
impacto: capacidade_nova
secao: adicionado
titulo: O chat de casos cita o acervo de conhecimento
---

Ao perguntar dentro de um caso (`Conversar sobre o caso`), a IA agora consulta o acervo de
conhecimento do agente que abriu o caso e devolve, junto da resposta, as citações dos materiais
que a sustentaram — abertas num painel ao lado. Mesma busca, mesmo limiar e mesma fonte que a IA
usa nas conversas (F1 da #1869). Sem acervo publicado, a resposta sai sem citação e sem erro. As
guardas existentes seguem de pé: 404 em vez de 403 para conjunto vazio, idempotência por
`turn_id` e a recusa de contato anonimizado.