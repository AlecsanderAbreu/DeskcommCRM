---
impacto: capacidade_nova
secao: corrigido
titulo: A conexão do WhatsApp ganha uma opção de guardar o histórico do número, desligada por padrão
---

Quem conecta um número ao CRM podia ver o canal descartar o passado do aparelho: a sessão nascia só com o filtro de conversas, e o padrão do motor é não guardar nada — 3 conversas e 1 MB no número medido, contra 825 conversas e 57 MB quando o acervo é pedido. Agora a tela de conexões oferece a opção "Guardar o histórico anterior à vinculação" por conexão, **desligada por padrão**, e quando ela está ligada o corpo de criação da sessão pede o acervo ao canal (`noweb.store` com `enabled` e `fullSync`). O que passa a ficar guardado é o histórico do número, no servidor do canal: as conversas que já existiam no aparelho são baixadas e ficam ali, ocupando disco fora do alcance da anonimização do CRM — ela limpa o banco do CRM, não o do canal.

Ligar tem custo declarado: `fullSync` baixa o histórico ANTERIOR à vinculação, então a ligação e a reconexão de um número movimentado fazem o canal gastar tempo, CPU e disco para trazer o passado (o contêiner do canal tem teto de 1.280 MB na instalação padrão). Quem não quiser esse custo deixa a opção desligada, que é o estado de todo canal novo.

**Ligar depois é um clique, sem desconectar:** a opção é gravada e aplicada na sessão que já existe (a config é atualizada em cima da que já está lá, preservando filtro e webhooks), e o número segue pareado — a janela é a de reiniciar a sessão, em segundos, sem QR novo.

O que NÃO muda: ligar o acervo não faz conversa antiga aparecer no inbox do CRM, que ainda não lê o histórico de volta do canal; o inbox continua recebendo do jeito de sempre, e esta leitura é assunto de outra issue. Instalações atualizadas não mudam nada sozinhas — quem já tem número pareado continua com o que tem, porque a opção nasce desligada e só uma conexão ligada por quem opera pede o acervo.

Contribuição de @webtecnica (#999).
