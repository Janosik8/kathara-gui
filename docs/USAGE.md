# Usage and commands

Everything you can do with the application and the repository, in one place.
A living document — update it when behaviour changes.

- **Last updated:** 2026-08-23 (Phase 2 complete)
- See [PLAN.md](../PLAN.md) for what is built and what is not.

---

## 1. Prerequisites

| Need | Why | Check |
|---|---|---|
| Python 3.12–3.14 | the backend | `python3 --version` |
| [uv](https://docs.astral.sh/uv/) | installs Python and dependencies | `uv --version` |
| Node 20+ | **only** to build the UI from source | `node --version` |
| Docker, running | Kathará deploys containers | `docker info` |

End users installing a release need only Python and Docker — the UI ships pre-built.
Node is a contributor requirement.

Install uv if missing: `brew install uv` (macOS) or see the uv docs.

---

## 2. Running it

### From a source checkout (what you have now)

The UI is gitignored, so build it once before the first run and again after any
frontend change:

```bash
cd frontend && npm install && npm run build && cd ..
uv run kathara-gui
```

Your browser opens automatically. The terminal prints a URL containing a session token:

```
Kathara GUI running at:
  http://127.0.0.1:8150/?token=wFbIvMF6qm3SElYwFWH6s0aGA68ycorLCbJOfg0DeCE
```

**That URL is a credential.** Anything on your machine can reach `127.0.0.1`, so the token
is what stops another page from driving your containers. Don't paste it into a bug report.

Stop the server with Ctrl+C.

### Options

```bash
uv run kathara-gui --help
uv run kathara-gui --no-browser     # print the URL instead of opening a browser
uv run kathara-gui --port 8080      # fixed port instead of an unused one
uv run kathara-gui --version
uv run kathara-gui --check          # verify startup and exit; used by CI
```

A fresh port is chosen each run by default, because hardcoding 8000 collides with whatever
else you have running.

### Live-reloading UI work

Two processes. The Vite dev server proxies `/api` to the backend, so the browser stays on
one origin and the `Origin` check behaves exactly as in production.

```bash
# terminal 1
uv run kathara-gui --no-browser --port 8000

# terminal 2
cd frontend && npm run dev
```

Open the Vite URL (usually `http://localhost:5173`) but **append the token** from terminal 1:
`http://localhost:5173/?token=<token>`. Without it every API call returns 401.

Point the proxy elsewhere with `KGUI_BACKEND=http://127.0.0.1:9000 npm run dev`.

### Installed as a tool

```bash
uv tool install .        # from this checkout
kathara-gui
uv tool uninstall kathara-gui
```

---

## 3. What you can do in the UI today

Phase 2 is complete, so the editor works end to end. Deployment and diagnostics are Phase 4;
there is no "Deploy" button yet.

| Action | How |
|---|---|
| Add a device | **Add router / switch / pc / server** in the left panel. The button names the device it will create. |
| Select | Click a device in the tree or on the canvas. |
| Select several | **Ctrl/Cmd + click**, or Ctrl/Cmd + Enter in the tree. |
| Connect two devices | Turn on **Connect mode** (button, or press `C`), click one device, then click another. A link appears. |
| Draw several links | Connect mode stays on after each link, so keep clicking pairs. |
| Add a device to an existing network | In connect mode, click the device, then click the **link or collision domain** it should join. All of them then share one collision domain. |
| Cancel a half-made link | Click the same end again, or click empty canvas. |
| Leave connect mode | Press `Escape`, or the toggle again. |
| Rename | Select a device → **Details** → Name → Enter or click away. |
| Set an address | Select a device → **Details** → Interfaces → address field, e.g. `10.0.0.1/24`. |
| Enable routing daemons | **Details** → Routing daemons. Ticking any protocol also ticks `zebra`. |
| Change the image | **Details** → Container image. Blank uses the default for the kind. |
| Move a device | Drag on the canvas. Snaps to a 16px grid. |
| Tidy up | Select 2+ devices → **Arrange** → align. Distribute needs 3+. |
| Disconnect an interface | **Details** → Interfaces → Disconnect ethN. |
| Delete | Select, then the **Delete** button or the Delete key. |
| Undo / redo | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, or the toolbar. |
| Save | **Save** sends the topology to the backend. |

The **Unsaved changes** badge appears once you edit and clears on save.

### Keyboard

The whole application is operable without a mouse — that is a graded requirement, so please
report anything that is not.

| Key | Effect |
|---|---|
| `Tab` | Move between regions. The tree is a single tab stop. |
| `↑` `↓` | Move between rows in the tree. |
| `→` | Expand a device, or move to its first interface. |
| `←` | Collapse, or jump back to the parent device. |
| `Home` / `End` | First / last row. |
| `Enter` | Select the focused device. |
| `Ctrl/Cmd + Enter` | Add to the selection. |
| `C` | Toggle connect mode. In it, `Enter` on a device picks it, and `Enter` on an interface row picks that row's collision domain. |
| `Delete` | Remove the focused or selected device. Ignored while typing in a field. |
| `Escape` | Leave connect mode, or abandon an in-progress text edit. |
| `Ctrl/Cmd + Z` | Undo. Add `Shift` to redo. |

The first `Tab` on a fresh page reveals a **Skip to topology** link.

### Not built yet

Deploy, diagnostics, in-app terminal, addressing auto-allocation and conflict detection,
`.kgui` import/export, PDF manuals, exam mode. See [PLAN.md](../PLAN.md).

---

## 4. Verifying a topology outside the UI

Until the Deploy button exists (Phase 4), check your work through the API and the Kathará
CLI. Export the generated `lab.conf`:

```bash
TOKEN=<token from startup>
curl -s -H "X-KGUI-Token: $TOKEN" http://127.0.0.1:8150/api/topology/export \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["text"])'
```

Import a hand-written lab:

```bash
curl -s -X POST -H "X-KGUI-Token: $TOKEN" -H "Content-Type: application/json" \
  --data "$(python3 -c 'import json;print(json.dumps({"text":open("lab.conf").read()}))')" \
  http://127.0.0.1:8150/api/topology/import
```

Then run it for real:

```bash
mkdir mylab && cd mylab
# paste the exported lab.conf here
kathara lstart
kathara list
kathara connect r1
kathara lclean
```

### API reference

All endpoints need the token, as `X-KGUI-Token` or `?token=`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness and version |
| GET | `/api/topology` | current topology, dirty flag, path |
| PUT | `/api/topology` | replace the topology |
| POST | `/api/topology/reset` | back to empty |
| POST | `/api/topology/import` | parse `lab.conf` text; returns warnings |
| GET | `/api/topology/export` | render the topology as `lab.conf` |

Interactive docs while the server runs: `http://127.0.0.1:8150/docs?token=<token>`

---

## 5. Development commands

```bash
uv sync                       # install/refresh Python dependencies
uv run pytest                 # unit tests, no Docker needed
uv run pytest -m docker       # integration tests, needs a running daemon
uv run pytest -q tests/test_labconf_codec.py     # one file
uv run pytest -k position                        # by name
uv run ruff check .           # lint
uv run ruff check --fix .     # autofix
uv run python scripts/spike_vertical.py          # full Kathará path against Docker
```

```bash
cd frontend
npm run dev          # dev server with hot reload
npm test             # vitest, includes axe accessibility audits
npm run test:watch
npm run lint         # TypeScript type check
npm run build        # build into ../src/kathara_gui/static/
```

Run everything the way CI does:

```bash
uv run ruff check . && uv run pytest -q \
  && (cd frontend && npm run lint && npm test && npm run build)
```

### Layout

```
src/kathara_gui/      backend
  domain/             pure logic — no Docker, filesystem or network
  kathara/            adapter over the Kathará Python API
  project/            lab directory and session
  api/                HTTP routers
frontend/src/
  store/              operations reducer, undo, alignment
  a11y/               accessible tree, live regions
  canvas/  panels/    React Flow canvas, side panels
tests/                Python tests
scripts/              the integration spike
```

---

## 6. Troubleshooting

**`npm error EACCES ... _cacache`** — the npm cache is unwritable. Use another:
`NPM_CONFIG_CACHE=./.npm-cache npm install`

**Blank page, or 404 at the root** — the UI has not been built. `cd frontend && npm run build`

**Every API call returns 401** — the token is missing. Use the full URL printed at startup,
including `?token=…`. It is stored per browser tab, so a new tab needs the URL again.

**403 "Cross-origin requests are not permitted"** — the page was loaded from a different
origin than the backend. In dev, use the Vite URL and let the proxy handle `/api`.

**`docker info` fails** — start Docker Desktop and wait for it to report running.

**Port already in use** — omit `--port` and an unused one is chosen for you.

**Kathará on Windows** — Docker Desktop ≥ 2.5 with the **WSL2** backend, **Linux containers
only** ("Use Windows Containers" must be off), and the drive holding your labs shared in
Docker settings. The Kathará CLI works in PowerShell, not `cmd`.

**Containers left running** — `kathara wipe` removes all of them.

---

## 7. Accessibility testing

Capability 6 is graded, so this is part of the deliverable rather than optional QA.

Automated, on every commit:

```bash
cd frontend && npm test        # axe-core audits over tree, panels and the whole app
```

> **axe under jsdom cannot check colour contrast** — it needs a real canvas. A clean run
> proves structure, roles and naming only. Contrast must be verified in a browser.

Manual:

- **Keyboard only** — unplug the mouse and build a two-device topology.
- **VoiceOver** (macOS) — Cmd+F5. Navigate the tree; every device and interface should
  announce its kind, addresses and neighbours.
- **NVDA** (Windows, free) — the screen reader most desktop users actually use, and it
  interprets ARIA differently from VoiceOver. Needs the Windows VM.
- **Zoom to 200%** — layout must not break or overlap.
- **Dark mode and increased contrast** — both follow the OS setting.
- **Reduced motion** — animations are suppressed when the OS asks.
