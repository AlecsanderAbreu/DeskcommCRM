---
impacto: nada_mudou
secao: corrigido
titulo: O prazo de uma solicitação LGPD passa a sair no dia certo, e deixa de contar como vencido antes da hora
---

O prazo que o produto calcula é um **dia útil** do calendário do país, contado a partir do dia em que o pedido entrou. O valor gravado é a meia-noite UTC desse dia — e quem lia esse valor redesenhava o instante no fuso de quem estava lendo, o que jogava o prazo um dia para trás em toda instalação brasileira, e para a frente em Angola e Portugal. O efeito era visível em três lugares: o **e-mail de alerta que vai para o DPO** anunciava o vencimento com a data do dia anterior; a **lista de solicitações** classificava a linha como "Vencido" a partir das 21h do dia anterior ao prazo, com quase um dia pela frente; e o **painel da instalação** acendia o alerta de LGPD em risco na mesma hora.

Agora o prazo sai no dia que foi contado, o alerta só considera o pedido vencido depois que o dia inteiro do prazo passou, e a lista só marca "Vencido" no dia seguinte. O que estava certo continua igual: o dia útil contado, os feriados do país da organização e o recebimento em fim de semana ou feriado, que continuam começando no próximo dia útil. Nada é preciso fazer na instalação, e nenhuma solicitação existente muda de prazo — as que já foram gravadas passam a sair na data correta.
