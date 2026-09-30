---
impacto: nada_mudou
secao: corrigido
titulo: Duas pessoas anotando o mesmo negócio ao mesmo tempo não se apagam mais
---

Quando duas edições dos campos personalizados de um negócio chegavam juntas, por exemplo quem atende salvando a ficha no dossiê enquanto o assistente anotava outro campo pelo MCP, a segunda gravava por cima da primeira e um dos dois campos sumia. Não aparecia erro nenhum: o dado simplesmente não estava mais lá.

Agora a mescla acontece dentro do banco, com o negócio travado durante a gravação. A segunda edição espera a primeira terminar e soma o que ela gravou, então os dois campos ficam. A rota que move o negócio de etapa já tinha proteção própria e não muda.

Nada muda ao atualizar e não há nada a configurar. A migration é idempotente e não mexe em dado existente.
