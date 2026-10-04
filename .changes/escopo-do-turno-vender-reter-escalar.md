---
impacto: nada_mudou
secao: corrigido
titulo: Numa conversa de atendimento, as consultas do agente a negócios, agenda, retornos e casos ficam no contato da conversa
---

Numa conversa de atendimento, as consultas do agente a negócios, compromissos, retornos,
radar de risco e casos humanos passam a considerar apenas o contato daquela conversa. Um
pedido sobre outro cliente recebe a mesma recusa que um identificador inexistente. A
busca de contatos encontra o contato da conversa mesmo quando outros nomes parecidos vêm
antes na lista.

Durante a conversa, a consulta ao banco de dados externo conectado passa a ser recusada:
o agente responde que a equipe confirma o dado, em vez de consultá-lo. Até que a conexão
possa indicar qual coluna identifica o cliente, isso vale para toda conversa. Fora de uma
conversa de atendimento (integração, MCP externo, rota HTTP), nada muda.
