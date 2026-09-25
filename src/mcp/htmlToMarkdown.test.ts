import { describe, it, expect } from 'vitest'
import { htmlToCleanMarkdown } from './htmlToMarkdown'

describe('htmlToCleanMarkdown', () => {
  it('extracts title and description from metadata', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test Page Title</title>
          <meta name="description" content="This is a test description." />
        </head>
        <body>
          <p>Hello world!</p>
        </body>
      </html>
    `
    const parsed = htmlToCleanMarkdown(html)
    expect(parsed.title).toBe('Test Page Title')
    expect(parsed.description).toBe('This is a test description.')
    expect(parsed.markdown).toContain('Hello world!')
  })

  it('strips script, style, nav, footer, svg, and comments', () => {
    const html = `
      <html>
        <body>
          <nav><a href="/home">Home</a></nav>
          <script>console.log('secret');</script>
          <style>body { color: red; }</style>
          <!-- Comment here -->
          <svg><path d="M0 0"/></svg>
          <main>
            <h1>Main Content</h1>
            <p>Readable text paragraph.</p>
          </main>
          <footer>Footer copyright 2026</footer>
        </body>
      </html>
    `
    const parsed = htmlToCleanMarkdown(html)
    expect(parsed.markdown).not.toContain('console.log')
    expect(parsed.markdown).not.toContain('color: red')
    expect(parsed.markdown).not.toContain('Comment here')
    expect(parsed.markdown).not.toContain('Footer copyright')
    expect(parsed.markdown).toContain('# Main Content')
    expect(parsed.markdown).toContain('Readable text paragraph.')
  })

  it('converts structural elements (headings, lists, links, tables, code)', () => {
    const html = `
      <div>
        <h2>Subheading</h2>
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
        </ul>
        <p>Check <a href="https://example.com/docs">the documentation</a> now.</p>
        <pre><code class="language-js">const x = 42;</code></pre>
        <blockquote>Quote from someone</blockquote>
        <table>
          <tr><th>Name</th><th>Role</th></tr>
          <tr><td>Alice</td><td>Admin</td></tr>
        </table>
      </div>
    `
    const parsed = htmlToCleanMarkdown(html)
    expect(parsed.markdown).toContain('## Subheading')
    expect(parsed.markdown).toContain('- Item 1')
    expect(parsed.markdown).toContain('- Item 2')
    expect(parsed.markdown).toContain('[the documentation](https://example.com/docs)')
    expect(parsed.markdown).toContain('```js\nconst x = 42;\n```')
    expect(parsed.markdown).toContain('> Quote from someone')
    expect(parsed.markdown).toContain('| Name | Role |')
    expect(parsed.markdown).toContain('| Alice | Admin |')
  })

  it('decodes HTML entities properly', () => {
    const html = `<p>&quot;Hello &amp; welcome&quot; &mdash; It&#39;s &lt;great&gt; &copy; 2026</p>`
    const parsed = htmlToCleanMarkdown(html)
    expect(parsed.markdown).toContain('"Hello & welcome" — It\'s <great> © 2026')
  })
})
