---
impacto: capacidade_nova
secao: adicionado
titulo: Fluxo de follow-up ganha caixas de mover o card no funil e gravar tag
---

Um fluxo de follow-up só sabia mandar mensagem. Agora ele também tem duas caixas de ação que não falam com o cliente: "mover lead no funil", que põe o card na etapa escolhida pelo mesmo caminho que o quadro e as automações usam (trocar de funil continua recusado), e "editar tag do lead", que grava etiqueta com o merge idempotente da ação de automação — tag que o negócio já tem não duplica e nada é apagado. As duas entram no seletor de caixas do editor, ganham card e formulário, e a publicação recusa a caixa publicada sem etapa ou sem tag escolhida. Salvar rascunho continua aceitando a caixa pela metade, como as outras. Nenhuma mudança de banco: o grafo continua no jsonb que já existia. "Disparar campanha" e editar outros dados do lead ficaram para o passo seguinte.

Contribuição de @webtecnica (#2181, refs #2065).
