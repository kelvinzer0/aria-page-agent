# ♿ Aria Page Agent

**LLM browser agent that sees the web like a screen reader.**

Powered by ARIA Accessibility Object Model (AOM) — the same semantic understanding that screen readers use to present web content to blind users.

## Why This Exists

Existing browser agents (like page-agent) scrape the DOM surface — tags, text, indices. They don't understand **what elements mean**.

Aria Page Agent builds a full Accessibility Object Model:
- **Accessible names** — computed per W3C spec (aria-labelledby → aria-label → label for → alt → title → children text)
- **Semantic relationships** — label ↔ input, table headers ↔ cells, describedby, controls, owns
- **ARIA roles** — correct mapping from HTML tags to their semantic roles
- **Element states** — checked, expanded, disabled, invalid, required, selected
- **Landmarks** — navigation, main, banner, search, complementary, contentinfo
- **Table context** — column/row headers automatically linked to cells
- **Issue detection** — missing labels, wrong roles, empty headings

This gives the LLM agent **screen reader eyes** — it understands the page's meaning, not just its visual layout.

## Architecture

```
┌─────────────────────────────────────────────┐
│                  LLM (Gemini, etc.)          │
│         Receives semantic AOM, not raw HTML  │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│            Agent Controller                  │
│   Orchestrates: AOM → Serialize → LLM → Act │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│          Semantic Serializer                  │
│  Converts AOM to LLM-friendly text format    │
│  Shows: roles, names, states, relations      │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│        AOM Engine (from aria-devtools)       │
│  Traverse DOM → Build accessibility tree     │
│  Compute: roles, names, relations, issues    │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│         Action Executor                      │
│  click, input, select, scroll, hover, focus  │
│  Operates on AOM element indices             │
└─────────────────────────────────────────────┘
```

## Example: What the LLM Sees

### Page-Agent (raw DOM scraping):
```
[0]<input type=checkbox />
[1]<label >I agree to terms</label>
[2]<div >You must agree</div>
```

### Aria Page Agent (semantic AOM):
```
☐ unchecked "I agree to terms" *required
  ↳ (described-by: "You must agree")
🔔 "You must agree"
```

The LLM now **knows**:
- The checkbox is unchecked and required
- The label "I agree to terms" is associated with it
- The error message "You must agree" describes the checkbox
- These elements are semantically related

## Features

- 🧠 **Full ARIA Object Model** — not just tag scraping
- 🔍 **Issue detection** — find accessibility problems automatically
- 📊 **Table understanding** — headers, cells, spans all connected
- 🏗️ **Landmark navigation** — page structure for orientation
- ⚡ **State tracking** — checked, expanded, disabled, etc.
- 🎯 **Precise actions** — click, input, select, scroll, hover, focus, keyboard
- 🤖 **Multi-step agent** — iterative planning and execution
- 🌐 **Multi-language** — English, Chinese, Indonesian

## Building

```bash
npm install
npm run build
```

Load the `dist` folder as an unpacked extension in Chrome.

## Configuration

Click the ⚙️ icon in the side panel to set:
- **API Key** — Your LLM API key (Gemini, etc.)
- **API Endpoint** — API base URL
- **Model** — Model name (default: gemini-2.0-flash)

## Credits

- AOM engine ported from [aria-devtools](https://github.com/ziolko/aria-devtools) by Mateusz Ziolko
- Agent architecture inspired by [page-agent](https://github.com/kelvinzer0/page-agent)
- Built with [WXT](https://wxt.dev/) + React

## License

MIT
