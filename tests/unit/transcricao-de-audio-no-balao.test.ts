import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const raiz = path.resolve(__dirname, "../..");
const leia = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf8");

const mediaRenderer = leia("components/inbox/media/MediaRenderer.tsx");
const tipoMsg = leia("lib/types/messaging.ts");
const handler = leia("app/api/v1/messages/_handler.ts");

describe("transcrição de áudio no balão da inbox (#2057)", () => {
  it("o tipo Message expõe os campos de transcrição (media_derived_text/status)", () => {
    const msg = /export interface Message\s*\{[^}]*\}/.exec(tipoMsg)?.[0] ?? "";
    expect(msg).toMatch(/media_derived_text\??:\s*string\s*\|\s*null;/);
    expect(msg).toMatch(/media_derived_status\??:\s*string\s*\|\s*null;/);
  });

  it("o SELECT de mensagens do inbox (MSG_COLS) traz as colunas de transcrição", () => {
    expect(handler).toMatch(/const MSG_COLS\s*=\s*"[^"]*"/);
    const cols = /const MSG_COLS\s*=\s*"([^"]+)"/.exec(handler)?.[1];
    expect(cols).toContain("media_derived_text");
    expect(cols).toContain("media_derived_status");
    expect(cols).toBeDefined();
  });

  it("o caso 'audio' do MediaRenderer agora é renderizado DENTRO de um contêiner que admite transcrição", () => {
    expect(mediaRenderer).toMatch(/case "audio":\s*\{/);
    expect(mediaRenderer).toMatch(/media_derived_status\s*===\s*"ready"/);
    expect(mediaRenderer).toMatch(/data-testid="transcricao-de-audio"/);
  });

  it("a transcrição só aparece quando 'ready' E há texto (guarda explícita)", () => {
    expect(mediaRenderer).toMatch(/pronto && transcricao \?/);
    expect(mediaRenderer).toMatch(/const pronto = message\.media_derived_status === "ready";/);
    expect(mediaRenderer).toMatch(/const transcricao = message\.media_derived_text\?\.trim\(\);/);
  });

  it("a transcrição conversa com o leitor do agente, que já consumia media_derived_text", () => {
    // O fluxo de IA já lia a coluna; o balão agora só reflete o MESMO dado (fonte única).
    expect(mediaRenderer).toMatch(/AudioPlayer messageId=\{message\.id\}/);
  });

  it("fragmento de release documenta a mudança", () => {
    const frag = leia(".changes/transcricao-de-audio-no-balao.md");
    expect(frag).toMatch(/^---/);
    expect(frag).toMatch(/secao: (adicionado|corrigido)/);
    expect(frag).toMatch(/media_derived_text/);
  });
});