import { defineConfig } from '@playwright/test'

// Roteiros que rodam no link da Vercel da propria PR, apontado para o banco
// isolado dela. Quem roda e o job "Navegador no preview desta PR", em
// .github/workflows/usuarios-banco-por-pr.yml, depois de provar pelo
// JavaScript publicado que aquele link fala com o banco da PR.
//
// Sem webServer: o site ja esta publicado. Sem trace, video nem screenshot:
// o repositorio e publico e esses arquivos guardariam a sessao. Em falha sobra
// so o error-context.md (arvore de acessibilidade), que o job guarda por 7 dias.
export default defineConfig({
  testDir: './test/preview-pr',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  // A segunda tentativa existe para diagnostico: teste que so passa repetindo
  // sai como "instavel" e o resumo (scripts/preview-pr-resumo.mjs) reprova.
  retries: 1,
  timeout: 90_000,
  reporter: [
    ['line'],
    ['json', { outputFile: 'test-results/preview-pr/relatorio.json' }],
  ],
  outputDir: 'test-results/preview-pr/saida',
  use: {
    baseURL: process.env.PREVIEW_PR_BASE_URL,
    browserName: 'chromium',
    channel: 'chrome',
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
})
