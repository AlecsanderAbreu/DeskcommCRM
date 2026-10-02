---
impacto: capacidade_nova
secao: corrigido
titulo: A instalação em modo single-server passa a respeitar um Traefik ou Nginx Proxy Manager que já ocupa as portas 80/443
---
Quem já tem um proxy reverso próprio na VPS (Traefik do painel da hospedagem, Nginx Proxy Manager) não conseguia instalar o modo single-server por cima dele: o instalador gravava `REVERSE_PROXY=caddy` no `.env`, apagando a escolha feita no ambiente, e o kit montava os comandos de `docker compose` sem o overlay do proxy — o Caddy da instalação tentava abrir as portas 80/443 que já estavam tomadas e a instalação parava no meio. Agora basta exportar `REVERSE_PROXY=traefik` (ou `npm`) antes de rodar o `install-single-server.sh`: o valor chega ao `.env` gravado e todo `docker compose` do modo single-server inclui o arquivo de overlay do proxy, na frente do Caddy. Sem a variável no ambiente nada muda — o padrão continua sendo o Caddy do kit, exatamente como hoje. O que ainda falta (a regra do Supabase no overlay do Traefik) segue aberto na #2099.

Crédito: #2150 (@webtecnica).
