---
impacto: nada_mudou
secao: corrigido
titulo: Atendimentos sem comanda e o filtro de valor do funil param de misturar moedas
---
Quem atende em mais de uma moeda via o total dos atendimentos sem comanda como um número que não existe: R$ 5.000,00 e 5.000,00 € apareciam como "R$ 10.000,00", somando centavos de moedas diferentes e escrevendo tudo em real, mesmo na instalação que opera em outra moeda. Agora cada moeda tem o seu total, lado a lado ("R$ 5.000,00 + 5000,00 €"), sem conversão, e a linha de cada atendimento sai na moeda dele. O filtro de valor mínimo e máximo do funil faz o mesmo: só compara dentro da moeda em que o limite foi escrito e deixa de fora o negócio de outra moeda, que não dá para responder sem converter. Numa instalação de uma moeda só nada muda — o total, o filtro e as telas continuam exatamente como são hoje. Crédito: @webtecnica no #2159.
