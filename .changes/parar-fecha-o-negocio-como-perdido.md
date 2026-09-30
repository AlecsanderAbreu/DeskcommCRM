---
impacto: nada_mudou
secao: corrigido
titulo: Quem responde PARAR passa a ter o negócio aberto fechado como perdido, sozinho
---
Quando um contato respondia PARAR (ou outra palavra de saída), o sistema já bloqueava o contato na hora, mas o negócio dele ficava aberto na etapa de origem até alguém arrastá-lo à mão para "Perdido". Enquanto isso o card continuava contando como demanda viva e sujando o radar de risco. Agora, junto com o bloqueio, cada negócio aberto do contato é encerrado como "Perdido — Cliente solicitou cancelamento", com a linha na timeline dizendo que foi o pedido do cliente. Se o funil não tiver etapa de perdido, o negócio fica como estava e o motivo vai para o log; a mensagem entra do mesmo jeito. Não é preciso fazer nada na instalação.
