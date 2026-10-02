/**
 * CATÁLOGO MAIOR QUE 500 — PROVA PELA TELA (issue #2135).
 *
 * A tela carregava os 500 primeiros produtos (ordem: ativos, depois nome) e
 * filtrava NO NAVEGADOR: num catálogo maior, o resto não aparecia nem pela
 * busca, enquanto o agente — que busca no servidor — enxergava todos.
 *
 * Isto prova, no `next start` real contra o Postgres real do job, o que um
 * gerente faz de verdade:
 *
 *   1. importa duas planilhas pela tela (o teto é 500 linhas por arquivo), 530
 *      produtos ao todo, um deles com nome que ordena DEPOIS da posição 500;
 *   2. busca esse produto pelo nome e ele aparece (na versão anterior, não);
 *   3. vê a contagem do catálogo inteiro e anda de página;
 *   4. busca com vírgula e parêntese — que antes iam crus para o `.or()` do
 *      PostgREST — e a tela responde, em vez de quebrar.
 *
 * Pré-requisito: `.e2e-creds.json` (o helper roda o seed se faltar). Sem WAHA,
 * Resend, Nuvemshop nem Redis.
 */
import { test, expect, type Page } from "./helpers/test";

import { lerCreds } from "./helpers/login-admin";

const creds = lerCreds();
const ESPERA = 30_000;
const LOTE = Date.now().toString(36).toUpperCase();
/** Ordena depois de tudo: é o produto que a tela antiga nunca alcançava. */
const ALVO = `ZZZ Alvo do catalogo grande ${LOTE}`;

test.describe.configure({ mode: "serial", timeout: 180_000 });

async function entrar(page: Page): Promise<void> {
  const email = creds.users.manager?.email;
  expect(email, "sem `manager` no .e2e-creds.json — rode seed-e2e-credentials.ts").toBeTruthy();
  await page.goto("/login");
  await page.locator("#email").fill(email!);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: ESPERA });
}

function planilha(de: number, ate: number, extra: string[] = []): Buffer {
  const linhas = ["codigo,nome,preco"];
  for (let i = de; i <= ate; i++) {
    const n = String(i).padStart(3, "0");
    linhas.push(`E2E-PAG-${LOTE}-${n},Produto paginado ${LOTE} ${n},10`);
  }
  return Buffer.from([...linhas, ...extra].join("\n") + "\n", "utf8");
}

async function importar(page: Page, nome: string, bytes: Buffer): Promise<void> {
  const resposta = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/api/v1/products/import"),
  );
  await page.getByTestId("arquivo-planilha").setInputFiles({ name: nome, mimeType: "text/csv", buffer: bytes });
  expect((await resposta).status()).toBe(200);
}

async function buscar(page: Page, termo: string): Promise<void> {
  await page.getByTestId("busca-produto").fill(termo);
  // A busca vai à URL depois que a pessoa para de digitar.
  await page.waitForURL((u) => (u.searchParams.get("busca") ?? "") === termo.trim(), { timeout: ESPERA });
}

test("gerente encontra produto além do 500º e anda de página", async ({ page }, info) => {
  await entrar(page);
  await page.goto("/app/products");
  await expect(page.getByTestId("tela-produtos")).toBeVisible();

  // (1) 530 produtos pela tela, em dois arquivos.
  await importar(page, "lote-1.csv", planilha(1, 499, [`E2E-PAG-${LOTE}-ALVO,${ALVO},99`]));
  await importar(page, "lote-2.csv", planilha(500, 529));

  // (2) o produto que ordena depois do 500º aparece pela busca.
  await buscar(page, ALVO);
  await expect(page.getByTestId(`produto-E2E-PAG-${LOTE}-ALVO`)).toBeVisible({ timeout: ESPERA });
  await expect(page.getByTestId("contagem-produtos")).toHaveText(/^1–1 de 1$/);
  await info.attach("01-alvo-encontrado", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  // (3) sem busca: a contagem é do catálogo inteiro, e a página anda.
  await buscar(page, `Produto paginado ${LOTE}`);
  await expect(page.getByTestId("contagem-produtos")).toHaveText(/^1–50 de 529$/, { timeout: ESPERA });
  await page.getByTestId("proxima-pagina").click();
  await page.waitForURL((u) => u.searchParams.get("pagina") === "2", { timeout: ESPERA });
  await expect(page.getByTestId("contagem-produtos")).toHaveText(/^51–100 de 529$/, { timeout: ESPERA });
  await expect(page.getByTestId(`produto-E2E-PAG-${LOTE}-051`)).toBeVisible();
  await page.getByTestId("pagina-anterior").click();
  await page.waitForURL((u) => !u.searchParams.has("pagina"), { timeout: ESPERA });
  await expect(page.getByTestId(`produto-E2E-PAG-${LOTE}-001`)).toBeVisible();

  // (4) vírgula e parêntese no termo: antes iam crus para o `.or()`.
  await buscar(page, `paginado, ${LOTE} (529`);
  await expect(page.getByTestId(`produto-E2E-PAG-${LOTE}-529`)).toBeVisible({ timeout: ESPERA });
  await info.attach("02-busca-com-virgula", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});
