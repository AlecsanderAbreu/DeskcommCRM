/**
 * O DOSSIÊ DO FOLLOW-UP FALA DE REENVIO TÉCNICO, NÃO DE CONTATO (#2014).
 *
 * O rastro do defeito: "Última falha … (tentativa 2 de 5)" fazia quem opera
 * ler como se o cliente tivesse sido procurado 2 de 5 vezes — mas
 * `followup_enrollments.attempts` conta REENVIOS depois de erro técnico. Um
 * gestor abrindo o dossiê após uma instabilidade concluía que o cliente fora
 * procurado várias vezes quando não fora.
 *
 * Este arquivo monta o dossiê de verdade e afirma o TEXTO que aparece:
 * "Erro no envio … (reenvio automático X de Y)", "Etapas executadas" (não
 * "Passos dados") e desfecho legível ("Encerrado sem resposta") em vez do
 * valor cru do wire. A ser a regressão reintroduzida, é aqui que ela acorda.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FollowupEnrollmentDossie } from "@/hooks/followup/useFollowupEnrollment";
import type * as DateFnsLocale from "date-fns/locale";

import { DossieDoFollowup } from "./DossieDoFollowup";

const dados = vi.hoisted(() => {
  // Anotado com o tipo (não `satisfies`): o `last_error`, `outcome` etc. são
  // `string | null` na interface, e o teste reescreve esses campos entre os
  // casos. Com `satisfies`, o tipo inferido estreitaria cada um ao literal
  // `null` e a reescrita não compilaria.
  const data: FollowupEnrollmentDossie = {
    id: "9f2c1b6a-4d7e-4f8a-9c0b-1d2e3f4a5b6c",
    status: "active",
    current_node_id: "n1",
    next_eval_at: null,
    claimed_until: null,
    motor_ocupado: false,
    started_at: "2026-09-01T10:00:00Z",
    completed_at: null,
    updated_at: "2026-09-01T10:00:00Z",
    outcome: null,
    cancel_reason: null,
    last_error: null,
    attempts: 0,
    max_attempts: 5,
    steps_taken: 2,
    contact: { id: "c1", name: "Maria" },
    flow: { pointer_id: "p1", name: "Vendas", version_id: "v1" },
    agent_name: null,
    no_atual: null,
    nos: [],
    saidas: [],
    eventos: [],
    eventos_truncados: false,
    plano_de_tempo: null,
    autores: {},
  };
  return { data };
});

vi.mock("@/hooks/followup/useFollowupEnrollment", () => ({
  useFollowupEnrollment: () => ({
    data: dados.data,
    isLoading: false,
    isError: false,
  }),
  useIntervirNoFollowup: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock("@/hooks/followup/useFollowupQueue", () => ({
  useCancelFollowupEnrollment: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("@/hooks/i18n/useLocaleDeData", async () => {
  const { ptBR } = await vi.importActual<typeof DateFnsLocale>("date-fns/locale");
  return {
    useLocaleDeData: () => ptBR,
    useTagDeIdioma: () => "pt-BR",
  };
});

describe("o dossiê distingue reenvio técnico de contato com o cliente (#2014)", () => {
  it("Erro no envio: o rótulo e a contagem falam de reenvio automático, nunca de tentativa", () => {
    dados.data.outcome = null;
    dados.data.last_error = "timeout ao falar com a WAHA";
    dados.data.attempts = 2;
    dados.data.max_attempts = 5;
    render(<DossieDoFollowup id={dados.data.id} canWrite={true} />);
    const aviso = screen.getByText(/Erro no envio/);
    expect(aviso.textContent).toContain("timeout ao falar com a WAHA");
    expect(aviso.textContent).toContain("reenvio automático");
    expect(aviso.textContent).toContain("2");
    expect(aviso.textContent).toContain("5");
    expect(aviso.textContent).not.toMatch(/tentativa|Última falha/i);
  });

  it("Etapas executadas: o contador de passos não usa mais o jargão de tentativa", () => {
    dados.data.last_error = null;
    dados.data.outcome = null;
    render(<DossieDoFollowup id={dados.data.id} canWrite={true} />);
    expect(screen.queryByText("Passos dados")).toBeNull();
    expect(screen.getByText("Etapas executadas")).toBeTruthy();
  });

  it("o desfecho saí legível em vez do valor cru do wire", () => {
    dados.data.last_error = null;
    dados.data.outcome = "exhausted";
    render(<DossieDoFollowup id={dados.data.id} canWrite={true} />);
    const desfecho = screen.getByText(/Desfecho/);
    expect(desfecho.textContent).toContain("Encerrado sem resposta");
    expect(desfecho.textContent).not.toContain("exhausted");
  });
});