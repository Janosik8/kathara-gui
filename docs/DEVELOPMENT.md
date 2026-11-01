# Developing Kathara GUI

How the application is built, where each part lives, and how to change it. It describes the
code as it is now. How to *use* the application is in [USAGE.md](USAGE.md); *why* it is
built this way is in [DESIGN.md](DESIGN.md).

<!-- contents -->
## Contents

- [1. Overview](#1-overview)
- [2. Code map](#2-code-map)
  - [Backend, `src/kathara_gui/`](#backend-srckathara_gui)
  - [Frontend, `frontend/src/`](#frontend-frontendsrc)
- [3. The model and the lab folder](#3-the-model-and-the-lab-folder)
- [4. How a request travels](#4-how-a-request-travels)
- [5. Security](#5-security)
- [6. Working on it](#6-working-on-it)
  - [Running from source](#running-from-source)
  - [Options](#options)
  - [Live reload for interface work](#live-reload-for-interface-work)
  - [Installing by hand](#installing-by-hand)
  - [Commands](#commands)
  - [When something goes wrong in development](#when-something-goes-wrong-in-development)
- [7. Tests and CI](#7-tests-and-ci)
  - [Checking accessibility by hand](#checking-accessibility-by-hand)
- [8. API reference](#8-api-reference)
  - [Scripting it](#scripting-it)
- [9. Making a change](#9-making-a-change)
<!-- /contents -->

---

## 1. Overview

Kathara GUI is one local process. `kathara-gui` starts a Python web server on `127.0.0.1`,
which serves a React application to the browser and answers its `/api/*` requests. The
server talks to Docker through Kathará's Python API; the browser never talks to Docker.

```
browser (React, frontend/src)  ──/api/*──▶  FastAPI (src/kathara_gui)  ──▶  Kathará API  ──▶  Docker
                                                  │
                                                  └──▶  workspace: kathara-labs/<lab>/lab.conf …
```

- **`cli.py`** (`main()`, the `kathara-gui` entry point) parses `--port`, `--no-browser`,
  `--check` and `--workspace`, calls `create_app()`, prints the address with its token, opens
  the browser and runs uvicorn on `127.0.0.1`. On exit it warns about labs still running
  (`runner.running_everywhere()`). In a source checkout it also warns when the built
  interface is missing or older than `frontend/src` (`frontend_staleness()`).
- **`main.py`** (`create_app()`) builds the FastAPI application: the security middleware,
  the five API routers, `/api/health`, and the built interface. If
  `src/kathara_gui/static/index.html` exists it is mounted at `/`, after the API routes;
  if not, `/` returns a page explaining that the interface has not been built.
- **The interface** is built by Vite into `src/kathara_gui/static/`. That folder is not in
  git; the installer builds it, and the wheel includes it (`artifacts` in `pyproject.toml`).

The topology is held in the browser while it is edited. The server keeps a session (the
scenario's folder, its feature switches, what was deployed), and the endpoints that act on a
topology take it in the request body rather than trusting the server's copy, because the
browser normally holds newer work.

## 2. Code map

### Backend, `src/kathara_gui/`

| Path | What it does |
|---|---|
| `cli.py` | Entry point; options, startup, shutdown notice, stale-build warning |
| `main.py` | `create_app()`: security middleware, routers, static files |
| `features.py` | `Features`, the exam switches (`subnet_calculator`, `addressing_validation`, `infrastructure_verification`, `interface_addresses`); `require()` answers 403 when one is off |
| `fsutil.py` | `write_text_lf` and friends: every generated file is written with LF line endings |
| `domain/model.py` | The pydantic topology model; the single source of truth (§3) |
| `domain/codec/labconf.py` | `parse()` and `serialize()` for `lab.conf`, including the `# kgui:` records |
| `domain/codec/startup.py` | The per-device `.startup` scripts: render, and parse addresses and loopbacks back |
| `domain/addressing.py` | `infer_subnets`, `validate` (the addressing checks), `allocate` (Assign addresses) |
| `domain/naming.py` | Device and lab name rules and suggestions |
| `domain/layout.py` | Layered layout for labs without positions; `count_crossings` measures it |
| `domain/asgroups.py` | Reads BGP AS numbers and lays each autonomous system out in its own zone |
| `domain/drift.py` | Describes, in sentences, how the design differs from what was deployed or what the containers hold |
| `kathara/connection.py` | `manager()`: Kathará's manager, after a Docker ping, reconnecting if the old connection died |
| `kathara/runner.py` | `deploy`, `undeploy`, `restart`, `status`, `find_conflicts`, `running_everywhere`, `wipe` |
| `kathara/readiness.py` | Waits for the devices' startup scripts to finish |
| `kathara/diagnostics.py` | `verify()`: pings between every pair on each collision domain |
| `kathara/state.py` | `capture()` (`vtysh show running-config` into `frr.conf`), reading `ip addr` back into the design |
| `kathara/probe.py` | Environment check: Docker, Kathará |
| `project/session.py` | `Session`: the open scenario, under a lock; the FastAPI dependency |
| `project/scenario.py` | A scenario is a lab folder: `save`, `load`, `export_zip`, `import_archive` |
| `project/labdir.py` | `write_lab()`: writes the lab folder from the model and removes stale files |
| `project/examlock.py` | The author's lock on the switches, and the sealed (encrypted) export |
| `api/topology.py` | `/api/topology`: get, replace, reset, import, export, arrange |
| `api/addressing.py` | `/api/topology/addressing`: issues, check, allocate |
| `api/lab.py` | `/api/lab`: probe, status, deploy, undeploy, restart, verify, wipe, features |
| `api/project.py` | `/api/project`: save, open, import, export, capture, scenarios, the exam lock |
| `api/preferences.py` | `/api/preferences`: the side panels' arrangement, kept in the workspace |

### Frontend, `frontend/src/`

React 19, [React Flow](https://reactflow.dev/) (`@xyflow/react`) for the canvas, zustand for
state, Vite to build.

| Path | What it does |
|---|---|
| `App.tsx` | Layout and orchestration: every API call, the header's running and drift states, the read-only lock |
| `api/client.ts` | All endpoints in one `api` object; sends the token; turns errors into `ApiError` |
| `types.ts` | TypeScript mirror of the pydantic model |
| `store/operations.ts` | The `Operation` union and the pure reducer `apply(topology, op)`; `describe(op)` words each one |
| `store/topology.ts` | The zustand store: `dispatch`, `undo`, `redo`, `load`; undo keeps up to 100 snapshots |
| `store/alignment.ts` | Align and distribute |
| `canvas/` | `TopologyCanvas.tsx`; node types `DeviceNode`, `ZoneNode`, `TextNode`; edge types `LinkEdge`, `SegmentEdge`; geometry helpers; device icons |
| `panels/` | The side panels: Inspector (Details), LabPanel, ScenarioPanel, AddressingPanel, CollisionDomainsPanel, ZonesPanel, TextLabelsPanel, ExamPanel, Palette, AlignmentToolbar, and small controls |
| `a11y/` | `TopologyTree.tsx`, the keyboard tree equivalent of the canvas; `LiveRegion.tsx`, which announces each change |
| `styles.css` | Colour and spacing tokens in `:root`, with dark, reduced-motion and forced-colours variants |

## 3. The model and the lab folder

`domain/model.py` defines `Topology` (name and metadata, `nodes`, `collision_domains`,
`zones`, `texts`), `Node` (name, kind, image, interfaces, daemons, loopbacks, position, and
Kathará's options), `Interface` (number, collision domain, address), `CollisionDomain`
(name, pinned subnet, position, label position), `Zone` and `TextLabel`. A device's kind is
`router`, `switch`, `pc` or `server`; a router gets `kathara/frr`, the rest `kathara/base`.

**`lab.conf` is generated from the model**, never edited in place. What Kathará's format
cannot hold travels in comments Kathará ignores, in a block that starts with `# kgui:v1`:

```
# kgui:node r1 pos=120,340 kind=router daemons=zebra,ospfd
# kgui:cd A subnet=10.0.0.0/24 pos=… label=…
# kgui:iface r1:0 ip=10.0.0.1/24
# kgui:lo r1 ip=10.255.0.1/32
# kgui:zone z1 shape=cloud pos=… size=… name=…
# kgui:text t1 pos=… size=… text=…
r1[0]="A"
```

Values are URL-encoded. `parse()` reads them back when present and works without them, so
a lab made by hand imports too; its addresses are then recovered from the `.startup` files
and its daemons from `etc/frr/daemons`.

A scenario folder holds `lab.conf`, one `<device>.startup` per device, `kgui.json` (the
feature switches and their lock) and whatever was captured, such as
`<device>/etc/frr/frr.conf`. Export is a zip of that folder.

## 4. How a request travels

All three start in `App.tsx` and go through `api/client.ts`.

- **Deploy** → `POST /api/lab/deploy` (`api/lab.py`). The session saves the scenario
  (`project/scenario.py`, `project/labdir.write_lab`), then `kathara/runner.deploy()` asks
  for confirmation if containers of the same lab name are running, deploys through
  `connection.manager()`, and waits for the startup scripts (`readiness`). The session
  records what was deployed, which is what the drift checks compare against.
- **Verify links** → `POST /api/lab/verify`. `features.require("infrastructure_verification")`
  first, then `kathara/diagnostics.verify()` runs `ping` inside the containers across every
  link.
- **Capture** → `POST /api/project/capture` (`api/project.py`). `kathara/state.capture()`
  writes each router's running configuration to `frr.conf`; the containers' addresses are
  read back into the design; the scenario is saved.

The lab endpoints are plain `def`, so FastAPI runs them in its thread pool: Docker calls
block.

## 5. Security

The server can run commands inside containers, and any web page can send requests to
`127.0.0.1`. So, in the `guard` middleware in `main.py`:

- It listens on loopback only.
- A request whose `Origin` is not the application's own is refused with 403.
- Every request except the page itself and its assets needs the session token, as
  `X-KGUI-Token` or `?token=`, compared with `secrets.compare_digest`; otherwise 401. The
  token is made at startup (`secrets.token_urlsafe(32)`).
- The page takes the token from its address into `sessionStorage` and removes it from the
  address bar (`api/client.ts`).

Exam switches are enforced on the server: an endpoint whose feature is off calls
`features.require()` and answers 403, so hiding a button is not the only barrier.

## 6. Working on it

You need uv, Node.js (20.19+ or 22.12+) and, for anything that deploys, Docker. Python
3.12–3.14 is provided by uv.

### Running from source

```bash
uv sync
npm --prefix frontend ci
npm --prefix frontend run build
uv run kathara-gui
```

In Windows PowerShell, type `npm.cmd` for `npm`: the default execution policy blocks
`npm.ps1`. Commands are one per line, with `--prefix` rather than `cd frontend && …`,
because Windows PowerShell 5.1 has no `&&`.

`uv run kathara-gui` always runs the current Python code but serves the interface as last
built; it warns at startup when the build is missing or older than `frontend/src`. Rebuild
after any frontend change.

### Options

```bash
uv run kathara-gui --help
uv run kathara-gui --no-browser     # print the URL instead of opening a browser
uv run kathara-gui --port 8080      # fixed port instead of an unused one
uv run kathara-gui --version
uv run kathara-gui --check          # verify startup and exit; used by CI
uv run kathara-gui --workspace DIR  # where scenarios go (default ./kathara-labs)
```

### Live reload for interface work

Two processes. The Vite dev server proxies `/api` to the backend, so the browser stays on
one origin and the `Origin` check behaves as in production.

```bash
# terminal 1
uv run kathara-gui --no-browser --port 8000

# terminal 2
npm --prefix frontend run dev
```

Open the Vite address (usually `http://localhost:5173`) with the token from terminal 1
appended: `http://localhost:5173/?token=<token>`. Without it every API call returns 401.

Point the proxy elsewhere with `KGUI_BACKEND=http://127.0.0.1:9000 npm run dev` in a Unix
shell, or `$env:KGUI_BACKEND="http://127.0.0.1:9000"; npm.cmd --prefix frontend run dev` in
PowerShell.

### Installing by hand

What `install.cmd` and `install.sh` do, in order: check that uv and npm exist (and say how
to get them if not), `npm --prefix frontend ci`, `npm --prefix frontend run build`,
`uv tool install --reinstall-package kathara-gui .`, run the installed `kathara-gui --check`,
and `uv tool update-shell`. `install.cmd` is a `.cmd` file because the default PowerShell
policy refuses `.ps1` scripts; it calls `npm.cmd`, and pauses at the end when double-clicked.

**Build the interface before `uv tool install .`** It is not in git, so a wheel built
before it has no interface, and that copy answers "Kathara GUI has no interface". For the
same reason, `uv tool install git+https://…` and `pip install git+https://…` do not work.
`--reinstall-package` makes uv rebuild rather than reuse its cached copy.

### Commands

```bash
uv run pytest                 # unit tests, no Docker needed
uv run pytest -m docker       # integration tests, needs a running Docker daemon
uv run pytest -q tests/test_labconf_codec.py     # one file
uv run pytest -k position                        # by name
uv run ruff check .           # lint
uv run ruff check --fix .     # autofix
uv run python scripts/spike_vertical.py          # the full Kathará path against Docker
```

```bash
npm --prefix frontend run dev          # dev server with hot reload
npm --prefix frontend test             # vitest, including the axe accessibility audits
npm --prefix frontend run test:watch
npm --prefix frontend run lint         # TypeScript type check
npm --prefix frontend run build        # build into src/kathara_gui/static/
```

What CI checks, to run before a push, in order, stopping at the first failure:

```bash
uv run ruff check .
uv run pytest -q
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
```

### When something goes wrong in development

**`npm error EACCES ... _cacache`** — the npm cache is unwritable. Use another:
`NPM_CONFIG_CACHE=./.npm-cache npm install`.

**403 "Cross-origin requests are not permitted"** — the page was loaded from a different
origin than the backend. With live reload, use the Vite address and let the proxy handle
`/api`.

**Every API call returns 401** — the token is missing. It is kept per browser tab, so a new
tab needs the full address again.

**Blank page, or 404 at the root** — the interface has not been built:
`npm --prefix frontend run build`.

## 7. Tests and CI

- **Python**, `tests/test_*.py`: the model, codec, addressing, layout, naming, sessions,
  every API router, security, packaging and the CLI. Most run in milliseconds with no
  Docker. `test_kathara_interop.py` feeds generated labs to Kathará's own parser.
- **Docker integration**, `tests/*_integration.py`, marked `docker` and skipped unless asked
  for (`addopts = "-m 'not docker'"` in `pyproject.toml`): deploy, ping, capture and
  undeploy against a real daemon, including a deliberately broken link.
- **Frontend**, `frontend/src/**/*.test.ts(x)` beside the code: vitest with jsdom. Tests
  query by role and accessible name. The App, tree and panel tests include axe audits
  (`vitest-axe`).
- **Contrast**, `tests/test_contrast.py`: reads the colour tokens out of `styles.css` and
  checks them against WCAG 2.1, because axe cannot check contrast under jsdom.
  `tests/test_reflow.py` checks the narrow-window layout against the same stylesheet.

`.github/workflows/ci.yml` runs on every push to `main` and on pull requests:

| Job | What it does |
|---|---|
| `test` | ruff and pytest on Ubuntu, Windows and macOS, Python 3.12 and 3.13, and Ubuntu with 3.14 |
| `frontend` | `npm ci`, type check, `npm test`, build; keeps the build for the next job |
| `install-smoke` | installs the wheel with the built interface on all three systems and runs `kathara-gui --version` and `--check` |
| `integration` | the spike script and `pytest -m docker` against Docker on Ubuntu |

### Checking accessibility by hand

The automated checks prove structure, roles, naming and the palette, not what is rendered.
Before a release, also: build a two-device topology with the keyboard only; zoom to 200%
and check nothing overlaps; switch the system to dark mode and to increased contrast; and
turn on reduced motion. Screen readers are out of scope.

## 8. API reference

All endpoints need the token, as `X-KGUI-Token` or `?token=`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness and version |
| GET | `/api/topology` | current topology, dirty flag, path |
| PUT | `/api/topology` | replace the topology |
| POST | `/api/topology/reset` | back to empty |
| POST | `/api/topology/import` | parse `lab.conf` text; returns warnings |
| GET | `/api/topology/export` | render the topology as `lab.conf` |
| GET | `/api/topology/addressing/issues` | addressing problems in the stored topology |
| POST | `/api/topology/addressing/check` | validate a supplied topology without storing it |
| POST | `/api/topology/addressing/allocate` | assign addresses; optional per-domain subnets |
| GET | `/api/lab/probe` | preflight: Docker, Kathará, WSL2 |
| GET | `/api/lab/features` | which assistive features this scenario allows |
| POST | `/api/lab/status` | reconcile a topology against the running containers |
| POST | `/api/lab/deploy` | deploy; reports conflicts unless `confirm` is set |
| POST | `/api/lab/undeploy` | stop the lab |
| POST | `/api/lab/verify` | ping across every direct link |
| POST | `/api/lab/restart` | stop and start the named `devices` of the running lab from its folder; the rest keep running |
| GET | `/api/lab/everything` | how many devices, in how many labs, **Stop every lab** would stop |
| POST | `/api/lab/wipe` | stop every lab of this user, capturing nothing (`kathara wipe`) |
| POST | `/api/topology/arrange` | positions laying a topology out with fewest crossings |
| GET | `/api/project` | scenario name, folder, feature toggles, and `exam`: whether they are locked, and unlocked for this session |
| PUT | `/api/project/features` | set the exam switches; written to `kgui.json` at once; 423 while locked |
| POST | `/api/project/exam/lock` | lock the switches with the author's `password` (at least 4 characters) |
| POST | `/api/project/exam/unlock` | unlock them for this session; `intact` is false if `kgui.json` was edited outside the application; 403 for a wrong password |
| POST | `/api/project/exam/relock` | lock them again after an unlock |
| DELETE | `/api/project/exam/lock` | remove the lock; only while unlocked |
| GET | `/api/project/scenarios` | scenario folders in the workspace, each with `running` when its lab has a running container |
| POST | `/api/project/save` | write the scenario folder into the workspace |
| POST | `/api/project/export` | the scenario folder as a zip, for download; with a `password` (at least 4 characters), sealed as a `.kgx` |
| POST | `/api/project/open` | open a scenario folder from the workspace |
| POST | `/api/project/import` | open a zip or a `lab.conf` sent as a raw body; 409 if a scenario of that lab's name exists, unless `?replace=true`; 423 if that scenario's lab is running; a sealed `.kgx` needs its password in the `X-KGUI-Password` header, percent-encoded: 428 without one, 403 for a wrong one |
| POST | `/api/project/capture` | pull running configuration into the scenario |
| GET | `/api/preferences` | the side panels' layout: each panel's section order, which are collapsed, and whether the panel is hidden |
| PUT | `/api/preferences` | store that layout in `.kgui-preferences.json`; unknown sections are dropped, missing ones restored |

The OpenAPI schema while the server runs: `http://127.0.0.1:8150/openapi.json?token=<token>`.
The interactive page at `/docs?token=<token>` opens but shows no endpoints: it fetches the
schema without the token, and the server refuses that with 401.

### Scripting it

Use the port and token printed at startup. Export the generated `lab.conf`:

```bash
# Unix shell
TOKEN=<token from startup>
curl -s -H "X-KGUI-Token: $TOKEN" http://127.0.0.1:8150/api/topology/export \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["text"])'
```

```powershell
# PowerShell. In Windows PowerShell 5.1, `curl` is an alias for Invoke-WebRequest and
# does not take curl's options, so use Invoke-RestMethod.
$h = @{ "X-KGUI-Token" = "<token from startup>" }
(Invoke-RestMethod -Headers $h http://127.0.0.1:8150/api/topology/export).text
```

Import a hand-written lab:

```bash
# Unix shell
curl -s -X POST -H "X-KGUI-Token: $TOKEN" -H "Content-Type: application/json" \
  --data "$(python3 -c 'import json;print(json.dumps({"text":open("lab.conf").read()}))')" \
  http://127.0.0.1:8150/api/topology/import
```

```powershell
# PowerShell. The [string] matters: Windows PowerShell 5.1's Get-Content attaches
# hidden properties that ConvertTo-Json would send too, and the server refuses them.
$body = @{ text = [string](Get-Content -Raw lab.conf) } | ConvertTo-Json
Invoke-RestMethod -Method Post -Headers $h -ContentType "application/json" `
  -Body $body http://127.0.0.1:8150/api/topology/import
```

## 9. Making a change

Where the usual kinds of change go:

- **A new editing action** (something the user does to the design): add a case to the
  `Operation` union and to `apply()` in `store/operations.ts`, a sentence for it in
  `describe()`, and a test in `operations.test.ts`. Dispatch it from the panel or canvas
  through the store; undo and the announcement come with it.
- **A new field in the model**: add it to `domain/model.py` and `types.ts`. If Kathará's
  `lab.conf` cannot hold it, carry it in a `# kgui:` record in `domain/codec/labconf.py`,
  and add a round-trip test to `tests/test_labconf_codec.py`.
- **A new endpoint**: a function in the matching router under `api/`, its entry in
  `api/client.ts`, a test in `tests/test_api_*.py`, and a row in §8. If it acts on a lab,
  take the topology in the request body. If a feature switch should be able to turn it
  off, call `session.features.require(...)` first.
- **Anything that touches Docker**: unit tests mock Kathará, and several defects passed every
  unit test while failing against real containers. Run `uv run pytest -m docker` and try it
  by hand in the running application.
- **Anything the user sees**: check it with the keyboard alone and at 200% zoom, and keep the
  colours to the tokens in `styles.css` so `test_contrast.py` covers them.

Conventions:

- Files that go into a lab are written with LF line endings (`fsutil.write_text_lf`),
  because they run inside Linux containers whatever the host.
- Device names are checked for what every system accepts (`domain/naming.py`): `con` cannot
  be a folder on Windows, and `R1` and `r1` are one folder on macOS.
- Errors are shown in words, in the interface: a failure that is handled but never shown is
  a defect.
- Claims about speed or layout are measured in tests rather than asserted.
