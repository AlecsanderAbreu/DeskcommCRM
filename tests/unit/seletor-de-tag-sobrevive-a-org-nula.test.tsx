/**
 * O SELETOR DE ETIQUETA SOBREVIVE A UMA PISCADA DE `activeOrg` PARA `null` (#1336).
 *
 * O gatilho só existe enquanto `mostrarSeletorDeTag` for verdadeiro, e as DUAS
 * pernas dessa condição passaram a depender do vocabulário lembrado
 * (`vocabularioDoSeletor` + `vocabularioConhecido`), não do vocabulário em voo —
 * é o que distingue este arquivo do irmão `inbox-filtro-de-tag-nao-desmonta`, que
 * mocka os dois hooks SEM respeitar `orgId`.
 *
 * Os dois hooks de vocabulário têm `enabled: !!orgId` e `queryKey` com o orgId
 * dentro. Os dublês abaixo reproduzem essa semântica: sem orgId, `data` é
 * `undefined` — o que o react-query devolve para consulta desabilitada (ou para
 * chave nova, ainda sem dado). É o caminho real quando `activeOrg` pisca para
 * `null` por um render: o vocabulário inteiro volta a undefined, e o seletor —
 * aberto ou com filtro aplicado — não pode desmontar (o menu fecharia na cara de
 * quem ia escolher, e o filtro sumiria sem ter como desfazer).
 *
 * O fix é o estado local que sobrevive (`ultimoVocabulario`, guarda de render do
 * próprio componente): enquanto o vocabulário de agora oscila, o último não-vazio
 * segura o controle montado. Este teste é a guarda permanente desse contrato.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { InboxFilters, type InboxFiltersValue } from "@/components/inbox/InboxFilters";
import type * as CanaisModule from "@/hooks/channels/useChannelSessions";
import type { ActiveOrg } from "@/lib/auth/types";

const activeOrgRef: { current: ActiveOrg | null } = { current: null };
const tagsRef: { current: string[] } = { current: [] };

vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ activeOrg: activeOrgRef.current }),
}));
vi.mock("@/hooks/channels/useChannelSessions", async (original) => {
  const real = await original<typeof CanaisModule>();
  return { ...real, useChannelSessions: () => ({ data: [] }) };
});
/** Sem orgId (`enabled: !!orgId`) o hook devolve `data: undefined`. */
vi.mock("@/hooks/inbox/useConversationTags", () => ({
  useConversationTagVocabulary: (orgId: string | null) => ({
    data: orgId ? tagsRef.current : undefined,
  }),
}));
vi.mock("@/hooks/contacts/useContactTagVocabulary", () => ({
  useContactTagVocabulary: (orgId: string | null) => ({
    data: orgId ? tagsRef.current : undefined,
  }),
}));
vi.mock("@/hooks/inbox/useConversationCounts", () => ({
  useConversationCounts: () => ({ data: { unassigned: 1 } }),
}));

const GATILHO = "Filtrar por tag";
/** O gatilho deixou de ser um `Select` (#1274): é botão com `aria-label`. */
const gatilho = () => screen.queryByLabelText(GATILHO);
const base: InboxFiltersValue = { tab: "unassigned", search: "", onlyUnread: false };

beforeEach(() => {
  activeOrgRef.current = {
    orgId: "org-1",
    name: "Org",
    role: "manager",
    visibility_mode: "all",
  };
  tagsRef.current = ["urgente", "vip"];
});
afterEach(cleanup);

describe("seletor de etiqueta x piscada de activeOrg para null", () => {
  it("com org resolvida, o seletor está na tela", () => {
    render(<InboxFilters value={base} onChange={() => {}} />);
    expect(gatilho()).not.toBeNull();
  });

  it("activeOrg null por UM render: o seletor PERMANECE (o menu aberto não fecha)", () => {
    const { rerender } = render(<InboxFilters value={base} onChange={() => {}} />);
    expect(gatilho()).not.toBeNull();

    activeOrgRef.current = null;
    rerender(<InboxFilters value={{ ...base }} onChange={() => {}} />);

    expect(gatilho()).not.toBeNull();
  });

  it("com FILTRO APLICADO, activeOrg null por um render mantém o seletor (dá para desfazer)", () => {
    const comFiltro: InboxFiltersValue = { ...base, tag: "urgente" };
    const { rerender } = render(<InboxFilters value={comFiltro} onChange={() => {}} />);
    expect(gatilho()).not.toBeNull();

    activeOrgRef.current = null;
    rerender(<InboxFilters value={{ ...comFiltro }} onChange={() => {}} />);

    // Sem o fix, o vocabulário volta a undefined e as DUAS pernas de
    // `mostrarSeletorDeTag` morrem juntas — o filtro aplicado sumiria da barra
    // sem nada na tela para desfazê-lo (a lista fica num subconjunto, às vezes
    // vazio). É o contrato que o último não-vazio segura.
    expect(gatilho()).not.toBeNull();
  });
});