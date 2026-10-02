---
impacto: nada_mudou
secao: corrigido
titulo: O envio de mensagem do agente não segura mais o banco enquanto a IA confere promessas
---

Antes de cada mensagem do agente sair, uma conferência rápida de IA procura promessas fora do combinado (como "faço de graça"). Essa conferência rodava com uma trava do banco aberta, e durante uma atualização do banco isso podia formar um travamento sem fim: o envio esperava a conferência, a conferência esperava a atualização e a atualização esperava o envio. O agente inteiro parava até alguém interromper a atualização. Agora a conferência acontece antes de a trava ser tomada, e o resto do envio segue igual.

Não é preciso fazer nada na instalação.

Contribuição de @AlecsanderAbreu.
