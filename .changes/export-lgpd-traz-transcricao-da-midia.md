---
impacto: nada_mudou
secao: corrigido
titulo: Exportação LGPD do titular passa a incluir a transcrição/texto extraído da mídia
---

Quando um titular pede acesso aos próprios dados (LGPD Art. 18 II), o arquivo gerado já entregava a mídia (áudio, imagem) que ele trocou com a empresa, mas não a transcrição do áudio nem o texto extraído da imagem — o corpo que a IA efetivamente leu. Agora o export traz `media_derived_text` de cada mensagem do titular, com rótulo legível no relatório ("transcrição/texto extraído da mídia"), e a de outros contatos continua fora do pacote. Sem ação do operador: o worker gera o mesmo `data.json` e `report.pdf`, agora mais completos.

Refs #1990

Contribuição de @webtecnica (#2020).