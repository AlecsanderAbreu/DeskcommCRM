import { ehOperante } from "@/lib/organizacao/operante";

/**
 * Onde um pedido de LGPD abre, conforme a empresa opera ou não.
 *
 * `/app/**` passa pelo layout de `/app`, que manda a empresa parada ao hub
 * `/account-suspended` SEM dizer qual pedido era (o layout não enxerga a rota).
 * Então quem monta o link já escolhe a porta: o e-mail de prazo
 * (`lib/lgpd/sla-alarm.ts`) e o hub, quando a empresa volta a operar antes do
 * clique. As duas pontas usam esta função, e a volta não perde o pedido.
 *
 * Usa a régua, mas NÃO filtra: o alarme segue saindo para a empresa parada
 * (LGPD nunca é bloqueada). Por isso consta de `NAO_E_FILTRO` em
 * `tests/unit/cron-respeita-org-operante.test.ts`.
 *
 * Sem `next/*` nem `server-only`: o alarme roda no cron.
 */
export function caminhoDoPedido(statusDaOrg: string | null | undefined, pedidoId: string): string {
  return ehOperante(statusDaOrg)
    ? `/app/lgpd/requests/${pedidoId}`
    : `/account-suspended?pedido=${pedidoId}`;
}
