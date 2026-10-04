---
impacto: capacidade_nova
secao: adicionado
titulo: Em coexistência, o que a equipe cadastra no endereço do app WhatsApp Business vira cadastro no CRM
---

Num número em coexistência (o mesmo número no app WhatsApp Business e na Cloud API), a empresa também cadastra e renomeia contato no **endereço** do app — o da agenda do celular. A Meta entrega isso no webhook `smb_app_state_sync`, que o canal oficial descartava: o CRM ficava sem o nome que a equipe usa no celular, e o contato só nascia na primeira mensagem, muitas vezes sem nome nenhum.

Agora esse webhook entra: o contato passa a existir no CRM com o nome do app (o mesmo que a Meta manda para o `display_name`, pela mesma resolução de número da mensagem recebida e do eco). A aba "API Oficial (Meta)" passa a listar `smb_app_state_sync` entre os campos a assinar no dashboard da Meta — sem coexistência a Meta não envia esse evento, então assinar é inofensivo para quem não usa.

O que este passo **não** faz, de propósito: não cria conversa nem mensagem (nada mudou na caixa de entrada, em `last_inbound_at`, no contador de não lidas nem no agente — ninguém trocou mensagem), não sobrescreve um nome que já existe no CRM (o `coalesce` da `fn_upsert_wa_contact` preenche quando vazio e nunca sobrescreve), e não apaga cadastro quando o app remove o contato do endereço (a Meta manda `remove` sem nome, e apagar histórico do CRM por causa da agenda do celular não está provado em lugar nenhum).

A importação do histórico de conversas (`history`, até 180 dias) e o botão de Embedded Signup com coexistência continuam fora deste passo — ver a #1632.

Contribuição de @webtecnica (refs #1632).
