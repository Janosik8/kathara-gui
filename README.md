# Kathara GUI

A graphical environment for modeling, deploying and verifying network topologies in
[Kathará](https://www.kathara.org/).

Design a topology visually, deploy it to Docker with one click, verify the links, and pull
running configuration back out of the containers — without hand-editing `lab.conf`,
`.startup` scripts or FRR configs.

> Engineering thesis, Teleinformatics, AGH University — Jan Ogiegło

## Status

Under development. Phases 0–3 complete — integration spike and CI, domain model and
`lab.conf` codec, topology editor, and addressing with conflict detection.

Phase 4 (deploy, diagnostics, terminal) is in progress: labs deploy, conflicting deployments
are caught, and links are verified; the in-app terminal is outstanding.

Phase 5 is largely done. A scenario saves to a single `.kgui` file holding the topology, the
generated lab and configuration captured from running containers — so a lab can be
configured by hand, captured, saved, reopened and redeployed with that configuration and its
canvas layout intact. Existing `lab.conf` labs import and export. Variants, a PDF manual
viewer and auto-layout for imports without positions remain.

- **[docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)** — what the application must, should and
  will not do, with current status against each item.
- **[docs/DESIGN.md](docs/DESIGN.md)** — why this application exists, how each capability is
  served, and the reasoning behind every significant technology choice.
- **[docs/USAGE.md](docs/USAGE.md)** — how to run it, every command, what the UI can do
  today, keyboard shortcuts, the API, and troubleshooting.
- **[PLAN.md](PLAN.md)** — development plan, phase status, capability traceability and the
  decision log.

All four are living documents kept in step with the code.

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

**Recommended** — [`uv`](https://docs.astral.sh/uv/) installs a suitable Python itself:

```
uv tool install git+https://github.com/<user>/kathara-gui
kathara-gui
```

**Without uv:**

```
python3 -m pip install --user git+https://github.com/<user>/kathara-gui
kathara-gui
```

Your browser opens automatically. To stop the server, press Ctrl+C.

Deploying writes each lab to `./kathara-labs/<name>`, beside wherever you started the
command, and the path is printed at startup — so `cd` into it and `kathara connect r1`
works from a terminal.

```
kathara-gui --help              # options
kathara-gui --no-browser        # print the URL instead of opening a browser
kathara-gui --port 8080         # fixed port instead of an unused one
kathara-gui --workspace ~/labs  # where deployed labs are written
```

## Development

```
git clone https://github.com/<user>/kathara-gui && cd kathara-gui
uv sync
uv run kathara-gui --no-browser
```

Frontend (only needed when working on the UI — releases ship it pre-built):

```
npm --prefix frontend ci
npm --prefix frontend run build
```

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
