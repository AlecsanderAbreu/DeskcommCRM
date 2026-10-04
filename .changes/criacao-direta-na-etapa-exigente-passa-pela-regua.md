---
impacto: nada_mudou
secao: corrigido
titulo: Criar negócio direto numa etapa exigente também passa pela régua de campos obrigatórios
---

A criação de negócio (`POST /api/v1/leads`, o diálogo do Kanban com etapa escolhida, a ferramenta MCP `crm_create_lead`, o webhook de captação, a importação de planilha e a transferência entre funis da automação) passou a perguntar a mesma régua de campos obrigatórios que o arrasto, o lote, o encerramento e o clone já perguntavam — até aqui a criação era o único caminho que nascia na etapa exigente com o campo em branco, e a cobrança só aparecia na escrita seguinte, com o negócio já lá.

Nada muda para quem não configurou `obrigatorio_em` num campo do funil: a regra continua opt-in, e uma leitura indisponível das configurações deixa a criação acontecer como antes. Na transferência entre funis a recusa acontece antes de clonar e de fechar a origem, então o negócio continua aberto no funil de onde saiu.

Contribuição de @webtecnica (#2295).
