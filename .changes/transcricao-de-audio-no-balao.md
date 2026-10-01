---
impacto: capacidade_nova
secao: adicionado
titulo: Transcrição do áudio no balão da conversa (inbox)
---

A transcrição derivada (`messages.media_derived_text`, `media_derived_status = 'ready'`) passou a chegar
ao balão da inbox: o `MediaRenderer` renderiza o player de voz e, quando a transcrição está pronta,
mostra o texto abaixo dele — para o atendente que não pode ouvir. O tipo `Message` e o SELECT de
mensagens (MSG_COLS) ganharam as colunas de transcrição; agora UI e IA lêem a MESMA fonte.