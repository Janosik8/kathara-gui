# Kathara GUI

A graphical environment for modeling, deploying and verifying network topologies in
[Kathará](https://www.kathara.org/).

Design a topology visually, deploy it to Docker with one click, verify the links, and pull
running configuration back out of the containers — without hand-editing `lab.conf`,
`.startup` scripts or FRR configs.

> Engineering thesis, Teleinformatics, AGH University — Jan Ogiegło

## Status

Every requirement is built (86 of 91) or dropped by decision (5). You can design a
topology on a canvas or from the keyboard, group it into named zones, annotate it with
text placed anywhere, plan the addressing
with conflict detection, deploy it with one click, restart a single device, verify every
link, capture what was configured inside the containers, and save, export, import and
reopen scenarios, including labs made without this application; a BGP lab is laid out by
autonomous system. An instructor can withdraw assistive features for an exam, lock them
with a password, and send the scenario sealed with a password until the exam starts. While a lab runs, the design is read-only
(D9).

It has passed a manual procedure on Windows, now 137 steps: 122 passed, 2 describe features
dropped by decision, and 13, for the features added since 2026-10-29, are not yet run by hand.
The installer has been run on a clean Windows 11 machine, and an EN 301 549 conformance
table states partial conformance, by decision: screen readers are out of scope (D10 in
`PLAN.md`).

Not built, by decision (D11): an in-app terminal (copy the `docker exec` command from the
Laboratory panel instead), scenario variants, example labs, a PDF manual viewer and
autosave. No release is published yet. `docs/REQUIREMENTS.md` has the full list.

- **[docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)** — what the application must, should and
  will not do, with current status against each item.
- **[docs/DESIGN.md](docs/DESIGN.md)** — why this application exists, how each capability is
  served, and the reasoning behind every significant technology choice.
- **[docs/USAGE.md](docs/USAGE.md)** — how to run it, every command, what the UI can do
  today, keyboard shortcuts, the API, and troubleshooting.
- **[docs/CONFORMANCE.md](docs/CONFORMANCE.md)** — the EN 301 549 accessibility
  conformance table, criterion by criterion.
- **[PLAN.md](PLAN.md)** — development plan, phase status, capability traceability, the
  decision log and the findings.

All five are living documents kept in step with the code.

## Requirements

- **Docker**, running, configured for **Linux containers**
- **Kathará** — installed automatically as a Python dependency
- **Python 3.12–3.14** — installed for you if you use `uv`

### Windows

Kathará has platform-specific prerequisites that this application inherits:

- Docker Desktop **≥ 2.5** using the **WSL2** backend
- **Do not** enable "Use Windows Containers" — Kathará requires Linux containers
- Share the drive holding your labs in Docker Desktop's settings

## Install

The application runs as a local web application: it starts a server on `127.0.0.1` and opens
your browser. The same command works on macOS, Windows and Linux.

You need **uv** (it provides Python and installs the application) and, once, **Node.js**
(to build the interface). On Windows: `winget install astral-sh.uv` and
`winget install OpenJS.NodeJS.LTS`, then open a new terminal. Then get the code and run the
installer in its folder:

```
git clone https://github.com/Janosik8/kathara-gui
cd kathara-gui
.\install.cmd          # Windows (PowerShell or Command Prompt; double-clicking works too)
./install.sh           # macOS, Linux
```

(No git? Download the ZIP from GitHub, unpack it, and run the installer in that folder.)

The installer checks for uv and Node and says how to get whichever is missing, builds the
interface, installs the `kathara-gui` command and checks that it starts. It waits for a key
before closing, so its messages can be read. Then, in a **new** terminal:

```
kathara-gui
```

**Not** `uv tool install git+https://…` or `pip install git+https://…`: the interface is a
build product and is not in git, so either installs a copy that answers "Kathara GUI has no
interface" (bug 38, F45). To update, `git pull` and run the installer again. To remove it, run `.\uninstall.cmd`
or `./uninstall.sh`; your labs are kept.

Your browser opens automatically. To stop the server, press Ctrl+C.

Deploying writes each lab to `./kathara-labs/<name>`, next to wherever you started the
command; the path is printed at startup. To open a shell on a running device, choose it in
the Laboratory panel and copy the `docker exec` command there. It works in any terminal and
doesn't need Kathará's own command-line tool.

```
kathara-gui --help              # options
kathara-gui --no-browser        # print the URL instead of opening a browser
kathara-gui --port 8080         # fixed port instead of an unused one
kathara-gui --workspace ~/labs  # where deployed labs are written
```

## Development

```
git clone https://github.com/Janosik8/kathara-gui
cd kathara-gui
uv sync
uv run kathara-gui --no-browser
```

Frontend (built by the installer; when working on the UI, rebuild it by hand):

```
npm --prefix frontend ci
npm --prefix frontend run build
```

In PowerShell on Windows, type `npm.cmd` instead of `npm`: the default execution policy
blocks `npm.ps1`. See `docs/USAGE.md` §2.

### Tests

```
uv run pytest                 # unit tests; no Docker required
uv run pytest -m docker       # integration tests; needs a running Docker daemon
uv run ruff check .
```

### Integration spike

Verifies the full Kathará path — deploy, exec, retrieve files, undeploy — against a real
Docker daemon:

```
uv run python scripts/spike_vertical.py
```

## Security

The server can execute commands inside containers, so it binds loopback only, requires a
session token minted at startup on every request, and rejects cross-origin requests. The
token appears in the URL printed at startup; treat that URL as a credential.

## License

MIT
