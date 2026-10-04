---
impacto: capacidade_nova
secao: adicionado
titulo: O Jev pode conferir na conversa o campo personalizado que a IA vai gravar
---

Nova tarefa do Jev, "Conferir o campo antes de a IA gravar": antes de o agente de IA gravar um campo personalizado do negócio, o valor é conferido nas mensagens do cliente daquele turno. Número, data, e-mail e valor em dinheiro são procurados no texto, sem chamada nenhuma; só o que sobra vai numa única pergunta ao Jev. O campo que o cliente não disse deixa de ser gravado e a IA é orientada a perguntar a ele; os outros campos da mesma chamada seguem gravando.

A tarefa nasce DESLIGADA: ela lê as mensagens do turno juntas, e por isso só roda com o aceite da conversa e depois de alguém ligá-la no cartão do Jev (IA › Provedores). Desligada, sem credencial ou com o Jev fora, o campo é gravado como antes.

Vale só para o agente de IA interno (o Conversador e o Operador). A tela, a API e as integrações MCP por token gravam como sempre, sem conferência e sem leitura extra. A chamada aparece em IA › Execuções e o gasto em Uso de IA.

Contribuição de @webtecnica (#2245), a partir da issue #2234 de @TOSTES-LAB.
