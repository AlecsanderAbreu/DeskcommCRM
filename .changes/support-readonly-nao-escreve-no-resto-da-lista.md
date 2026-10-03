---
impacto: nada_mudou
secao: corrigido
titulo: Acesso só de leitura ao painel de plataforma deixa de escrever nas tabelas de IA, agenda, campanhas, CRM e financeiro
---
A 0508 e a primeira fatia fecharam a escrita de quem entra no painel de plataforma com `scope=support_readonly` em parte do banco, mas 36 regras de escrita criadas nos blocos seguintes ainda aceitavam a checagem que ignora o scope do JWT: agentes de IA, base de conhecimento, disponibilidade e agenda, campanhas, catálogo, funil e tarefas do CRM, honorários, sessões de voz e os moldes de lançamento recorrente.

Agora todas exigem `scope=full` para escrever. A leitura continua como estava — `support_readonly` segue enxergando os dados, só não altera; os moldes recorrentes ganharam um par de regras (ler/escrever) porque eram a única tabela sem regra de leitura própria. Membros da organização e platform admin `full` escrevem exatamente como antes.

Nada é preciso fazer na instalação.

Contribuição de @Tong-bit-art (#2115).
