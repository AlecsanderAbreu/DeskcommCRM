---
impacto: capacidade_nova
secao: adicionado
titulo: Pedido de parar de receber mensagens ou de falar com uma pessoa dito em áudio passa a abrir aviso na Central
---

Um "não quero mais receber mensagens" falado chegava ao CRM com o texto vazio, e nem o bloqueio da entrada nem o Jev o enxergavam. Agora, quando a transcrição de um áudio do cliente fica pronta, a mesma regra que reconhece o pedido por escrito roda sobre o transcrito e, onde ela não reconhece e a tarefa de pedidos do Jev está ligada, o Jev é perguntado como numa mensagem de texto. O resultado é só um aviso na Central. O aviso da regra ("Um cliente pediu para parar de receber mensagens num áudio" ou "...para falar com uma pessoa num áudio") abre com a tarefa do Jev ligada ou desligada. O aviso só abre onde o atendimento automático rodaria naquela conversa: há um agente não pausado no número, a IA pode responder, o contato não está com uma pessoa nem bloqueado, e a conversa não é de grupo.

A transcrição de um áudio não bloqueia o contato. O bloqueio corta todo envio ao contato (resposta do agente, funil, follow-up, campanha) e só um admin o desfaz, à mão (Contatos › Desbloquear); uma transcrição pode errar, e o erro dela somaria com o da regra. É a mesma política do texto digitado, onde o pedido ambíguo escala para uma pessoa e não bloqueia. Quem quiser parar de receber continua bloqueado ao responder PARAR por escrito, e o aviso diz isso à equipe.

Contribuição de @webtecnica (#2246, refs #2233).
