import { defineConfig } from 'wxt'

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  manifest: {
    name: 'Aria Page Agent',
    description: 'LLM browser agent that sees the web like a screen reader - powered by ARIA Accessibility Object Model',
    version: '1.0.0',
    permissions: ['activeTab', 'storage', 'tabs', 'scripting', 'sidePanel'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Aria Page Agent',
    },
    side_panel: {
      default_path: 'sidepanel/index.html',
    },
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['content-scripts/content.js'],
        run_at: 'document_end',
      },
    ],
    background: {
      service_worker: 'background.ts',
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'unsafe-eval'; object-src 'self';",
      content_scripts: "script-src 'self' 'unsafe-eval'; object-src 'self';"
    },
  },
})
