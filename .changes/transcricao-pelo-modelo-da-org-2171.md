impacto: capacidade_nova
secao: corrigido
titulo: A transcrição de áudio usa o modelo de conversa da organização quando ele entende áudio, e o status da derivação nunca fica nulo
---

A nota de voz de uma organização rodando Gemini com a chave do Google validada era recebida, mas não transcrevia: o ponto `transcricao_de_audio` só falava o protocolo da OpenAI e pedia uma chave própria. A resolução virou uma escada — serviço de transcrição da instalação, depois o modelo de CONVERSA da organização quando ele declara a capacidade `audio`, depois o padrão OpenAI-compatível, e no fim um "nada" legítimo com o motivo — e o degrau da OpenAI só é consultado quando os de cima não valem. Quem já transcrevia pelo whisper não muda nada: sem `TRANSCRIPTION_API_KEY` e com um modelo que não declara áudio, o desfecho é o mesmo de sempre.

O segundo defeito da #2171 era o silêncio: `media_derived_status` ficava nulo quando a transcrição não existia ou falhava — "ninguém tentou" e "tentou e não deu" eram o mesmo nulo, e o dreno esperava o teto de 8 minutos por uma leitura que nunca ia chegar. Todo desfecho terminal passou a gravar `failed` ou `skipped` com o motivo em `metadata.media_derived_motivo`, inclusive quando o provedor devolve a transcrição vazia, quando o download da mídia esgota as tentativas e quando o evento de derivação nem sai. Nada muda para quem opera: o motivo fica no mesmo registro que a Central já mostra.

Contribuição de @webtecnica (#2189, refs #2171).
