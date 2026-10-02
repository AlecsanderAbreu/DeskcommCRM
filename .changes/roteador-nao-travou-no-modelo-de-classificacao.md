---
impacto: nada_mudou
secao: corrigido
titulo: O roteador volta a escolher qual agente atende cada mensagem
---

Em empresas que usam a OpenRouter, o roteador de agentes falhava a cada mensagem com o erro "claude-haiku-4-5 is not a valid model ID" e nenhuma escolha de agente acontecia — toda conversa caía no mesmo agente, ou em nenhum, como se os roteadores configurados não existissem. A mensagem nunca aparecia no painel de erro: era o aviso que a própria tela do classificador mostrava.

O modelo do classificador vinha gravado pelo próprio Deskcomm ao criar o roteador, apontando para um serviço que a OpenRouter não reconhece. Ninguém escolheu esse modelo, e a empresa podia ter configurado Claude como modelo de atendimento — o roteador é que insistia no dele. Agora o roteador nasce em "Automático": quem decide o modelo do classificador é o painel de provedores ou, na falta dele, o modelo de atendimento da empresa, e nenhuma escolha é sobrescrita por baixo dos panos.

Quem já tinha um roteador com o classificador travado nesse modelo tem duas saídas, e nenhuma delas é obrigatória: deixar em "Automático" (que é o novo padrão) ou escolher o modelo do classificador na tela do roteador, se quiser uma resposta mais barata e rápida do que o modelo de atendimento. Quem escolheu o modelo de propósito — inclusive quem usa a Anthropic, onde esse nome é válido — continua com a escolha dela. Empresas que não usam roteador de agentes não veem nenhuma diferença. Não é preciso fazer nada na instalação.