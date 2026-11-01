# Kathara GUI

A graphical environment for modeling, deploying and verifying network topologies in
[Kathará](https://www.kathara.org/).

Design a topology visually, deploy it to Docker with one click, verify the links, and pull
running configuration back out of the containers — without hand-editing `lab.conf`,
`.startup` scripts or FRR configs.

> Engineering thesis, Teleinformatics, AGH University — Jan Ogiegło

## What it does

- **Design** a topology on a canvas or from the keyboard: routers, switches, PCs, servers
  and shared segments, grouped into named zones and annotated with text placed anywhere.
- **Plan the addressing**, with conflicts and mistakes reported, or assign the
  addresses automatically from a pool.
- **Deploy** the lab to Docker with one click, restart a single device, and stop it again.
  While a lab runs, the design is read-only.
- **Verify** every link in the running lab.
- **Capture** what was configured inside the containers to their respective configuration files. 
- **Save, export, import and reopen** scenarios, including labs made without this
  application
- **Exams:** an instructor can withdraw the assistive features, lock them with a password,
  and send the scenario sealed with a password until the exam starts.

It runs on Windows, macOS and Linux. How to use it, panel by panel, is in
**[docs/USAGE.md](docs/USAGE.md)**.

## Requirements
- uv
- Node.js
- Git
Kathará has platform-specific prerequisites that this application inherits:

- Docker Desktop **≥ 2.5** using the **WSL2** backend
- **Do not** enable "Use Windows Containers" — Kathará requires Linux containers
- Share the drive holding your labs in Docker Desktop's settings

## Install

The application runs as a local web application: it starts a server on `127.0.0.1` and opens
your browser. The same command works on macOS, Windows and Linux.

You need **uv** (it provides Python and installs the application) and, once, **Node.js**
(to build the interface). On Windows: `winget install astral-sh.uv` and
`winget install OpenJS.NodeJS.LTS` (and `winget install Git.Git` if Git is missing), then
open a new terminal. Then get the code and run the
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

To update, `git pull` and run the installer again. To remove it, run `.\uninstall.cmd`
or `./uninstall.sh`; your labs are kept.

Your browser opens automatically. To stop the server, press Ctrl+C. How to use the
application, panel by panel, is in **[docs/USAGE.md](docs/USAGE.md)**.

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
npm --prefix frontend test    # interface tests
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

MIT, except the four device pictures, which are Cisco's network topology icons, used
unmodified under Cisco's terms: see `icons/NOTICE.md`.
