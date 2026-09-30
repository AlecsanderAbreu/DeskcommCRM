### Cerca: toda versão de agente grava todas as chaves de configuração

Ao reverter para uma versão antiga ou criar um agente pela porta MCP, campos de
configuração da versão (anotação interna e o rascunho com IA da proposta) algumas
vezes não eram copiados para a versão nova — o agente nascia/voltava com esses
ajustes no padrão, sem aviso. Agora todo caminho que grava uma versão carrega todas
as chaves de configuração, e um teste novo trava a próxima fenda desse tipo.

Contribuição de @webtecnica (#2004).