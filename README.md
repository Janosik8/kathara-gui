# Kathara GUI

A graphical environment for modeling, deploying and verifying network topologies in
[Kathará](https://www.kathara.org/).

Design a topology visually, deploy it to Docker with one click, verify the links, and pull
running configuration back out of the containers — without hand-editing `lab.conf`,
`.startup` scripts or FRR configs.

> Engineering thesis, Teleinformatics, AGH University — Jan Ogiegło

## Status

Under development. Phases 0 (integration spike, CI) and 1 (domain model, `lab.conf` codec)
complete; Phase 2 (topology editor) in progress.

See **[PLAN.md](PLAN.md)** for the development plan, phase status, capability traceability
and the decision log. It is a living document kept in step with the code.

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

```
kathara-gui --help          # options
kathara-gui --no-browser    # print the URL instead of opening a browser
kathara-gui --port 8080     # fixed port instead of an unused one
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
