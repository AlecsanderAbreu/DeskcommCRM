---
impacto: capacidade_nova
secao: adicionado
titulo: Webhook de saída ganha os gatilhos de ganho, perda, reabertura e troca de responsável
---

Quem liga o CRM a um ERP, ao faturamento ou a uma planilha de comissão agora recebe um evento quando um negócio é **ganho** ou **perdido**, quando um lead encerrado **reabre** e quando o **responsável muda** — e recebe o mesmo evento com o mesmo corpo não importa o caminho: arrastar o card, o botão Ganhou/Perdeu, o mover em lote, o fechamento da IA (`crm_close_demand`) ou a criação do negócio já em etapa de fechamento. Antes, o arrasto emitia `lead.stage_changed` e o botão não disparava regra nenhuma: o fato era o mesmo e o webhook dependia do botão.

Os quatro gatilhos novos aparecem no seletor de automações (Ganhou, Perdeu, Reaberto, Responsável mudou) com os campos de condição do próprio negócio. O corpo de ganho passa a trazer `lost_reason` e `closed_at` no lead, junto de `value_cents` e `currency`; o corpo da troca de responsável **não** leva UUID de usuário nenhum — o responsável só aparece (`owner: kind, id, nome`) quando quem monta a regra liga "Incluir responsável do atendimento". Nada muda em quem já trata `lead.stage_changed`.
