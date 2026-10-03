---
impacto: capacidade_nova
secao: corrigido
titulo: A conversão de venda clique-para-WhatsApp para de ser recusada pela Meta
---

A Meta recusava todo Purchase vindo de anúncio clique-para-WhatsApp (HTTP 400, error_subcode 2804116, "Falta a identificação da Página ou da conta do WhatsApp Business"). A tela de Conversões agora guarda a identidade que ela cobra, o envio manda o id que existir (Página primeiro, conta do WhatsApp Business na falta dela) e nunca inventa um. O erro da Meta passa a aparecer com a frase dela no livro-razão, em vez do "Invalid parameter" genérico que escondia a causa.

Para a venda passar, preencha em Configurações › Conversões o ID da Página (ou o ID da conta do WhatsApp Business); sem um dos dois, a recusa continua como antes. O produto não chuta o valor, porque id errado atribui a venda à conta de outra pessoa.
