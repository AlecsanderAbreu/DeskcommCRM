---
impacto: exige_acao
secao: corrigido
titulo: A recuperação de senha volta a funcionar na instalação single-server
---

Quem instala agora pelo `install-single-server.sh` recebe os dois modelos de e-mail do GoTrue apontando para o app, gravados no `.env` do Supabase antes de o serviço `auth` subir: `https://SEUDOMINIO/email-templates/recovery` e `https://SEUDOMINIO/email-templates/confirmation`. Sem essas duas linhas o GoTrue manda o link no modelo padrão do Supabase, que devolve a sessão depois do `#` da URL — e fragmento não chega ao servidor: o clique em "esqueci minha senha" abria a tela de login com "link inválido". Como não existe troca de senha estando logado, quem perdia a senha ficava fora do sistema. Agora o link sai com `token_hash`, o servidor lê e `/login/reset` abre.

Contribuição de @webtecnica (PR #2153, refs #2109).

## Requer atenção

Quem já instalou antes desta versão precisa acrescentar ao serviço `auth` do Supabase as duas variáveis `GOTRUE_MAILER_TEMPLATES_CONFIRMATION` e `GOTRUE_MAILER_TEMPLATES_RECOVERY` apontando para `https://SEUDOMINIO/email-templates/confirmation` e `/recovery`, e reiniciar o `auth`. O `healthcheck.sh` já imprime os valores exatos do seu domínio quando o GoTrue está no modelo padrão, e re-rodar o `install-single-server.sh` também os grava.
