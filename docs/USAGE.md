# Usage and commands

Everything you can do with the application and the repository, in one place.
A living document — update it when behaviour changes.

- **Last updated:** 2026-09-09 (Phases 0–3 complete; Phase 4 mostly done)
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
uv run kathara-gui --workspace DIR  # where generated labs go (default ./kathara-labs)
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

The editor, addressing and deployment all work. What is still missing is the in-app
terminal, saving to a project file, and pulling configuration back out of running
containers — see [PLAN.md](../PLAN.md).

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
| Change the image | **Details** → Container image. See the warning below before clearing it. |
| Move a device | Drag on the canvas. Snaps to a 16px grid. |
| Tidy up | Select 2+ devices → **Arrange** → align. Distribute needs 3+. |
| Disconnect an interface | **Details** → Interfaces → Disconnect ethN. |
| Delete a device | Select it, then the **Delete** button or the Delete key. |
| Delete a link | Click the link on the canvas — it thickens — then Delete. Both ends are detached and the collision domain goes with them. |
| Detach one end only | **Details** → Interfaces → Disconnect ethN, or Delete on an interface row in the tree. The far device stays attached. |
| Undo / redo | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, or the toolbar. |
| Pin a subnet to a collision domain | Left panel → **Collision domains** → type the network for that domain, e.g. `192.168.1.0/24`, then Enter. |
| Let a domain be allocated | Leave its subnet field blank. |
| Assign addresses | Right panel → **Addressing** → **Assign addresses**. Fills gaps, keeps pinned subnets and hand-written addresses. |
| Renumber everything | **Renumber all**. Replaces every address *and* every pinned subnet. |
| Change the default pool | **Addressing** → Address pool and Subnet size, before assigning. |
| Save | **Save** sends the topology to the backend. |

The **Unsaved changes** badge appears once you edit and clears on save.

### Container images

A new device is given an image for its kind: `kathara/frr` for a router, `kathara/base` for
everything else. Changing the kind follows the image, unless you have typed one yourself.

**Clearing the image field does not fall back to the kind's default** — it falls back to
*Kathará's*, which is `kathara/base` for everything. `kathara/base` has no routing daemons
at all: no `vtysh`, nothing to read `/etc/frr/daemons`, and no way to configure routing. A
router with a blank image cannot run a routing lab.

### A narrow window, or a magnified one

Below about 960 pixels of viewport the three columns stack: the diagram first, then the
panels beneath it, with the page scrolling downwards only. Zoom reaches the same place — at
200% on a 1280-pixel display the viewport is 640 CSS pixels — so magnifying the page reflows
it rather than pushing the canvas off the side.

The breakpoint is in `rem`, so enlarging the text alone reflows too, not only zooming.

**The side panels can be resized.** Drag the divider running the full height of a panel's
inner edge, or focus it with `Tab` and use the arrow keys — `Home` and `End` jump to the narrowest and widest, and a
double click returns it to the middle. Arrow keys mean a direction on screen rather than
"wider", so they agree with the drag: `←` widens the right-hand panel and narrows the left.

**The minimap shrinks with the canvas, and hides when there is no room for it.** It is an
aid to navigating the diagram, so on a small canvas the diagram wins.

### Finding your way around

Two blocks carry their own surfaces, because they do different jobs and were being confused.
**Details**, which configures the device you have selected, is tinted violet with a solid top
edge; **Laboratory**, which acts on the running lab, is amber with a dashed one.

The violet block appears only while a device is selected, and holds everything belonging to
that one device — its name, image, interfaces and routing daemons. With nothing selected
there is no tinted block, because there would be nothing in it.

Violet rather than blue: the panel behind these blocks is a cool blue-grey, so a blue tint
read as the same surface and the block disappeared into it. Violet against amber still
survives the common red-green colour deficiencies — and the edges differ in *style* as well,
because the two tints sit at almost the same lightness and would otherwise be identical to
someone with no colour vision at all.

### Reading the diagram

Each interface is drawn as a labelled point on the device's edge — `eth0`, `eth1` — and a
link terminates at the interface it actually uses, so you can see which port it enters. That
matters: wiring `eth0` but configuring `eth1` is a common mistake, and a diagram that hides
the port cannot help you find it.

An interface sits on the face pointing at whatever it is connected to, and moves as you drag
devices around. Two interfaces on the same face go to opposite corners, ordered so their
links do not cross.

A collision domain with exactly two devices is drawn as a plain link. With three or more it
gets a node of its own, because a Kathará collision domain is a shared medium rather than a
cable, and drawing a shared segment as a single line would misrepresent it.

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
| `Delete` | On a device row, remove the device. On an interface row, disconnect that interface. Ignored while typing in a field. |
| `Escape` | Leave connect mode, or abandon an in-progress text edit. |
| `Ctrl/Cmd + A` | Select every device. Ignored while typing, where it selects the field's text. |
| `Ctrl/Cmd + Z` | Undo. Add `Shift` to redo. |

The first `Tab` on a fresh page reveals a **Skip to topology** link.

### Planning the addressing

Two levels of control:

- **Per domain.** The **Collision domains** panel lists every domain in use. Type a network
  into one to pin it — `192.168.1.0/24` — and the allocator will number hosts inside it
  rather than choosing its own. Blank means "allocate one for me".
- **Globally.** The **Address pool** and **Subnet size** in the Addressing panel decide
  where unpinned domains are carved from. Default is `10.0.0.0/8` in `/24` blocks.

So to make domain C use `192.168.1.0/24` while everything else is automatic: type it into
C's field, leave the rest blank, and press **Assign addresses**.

```
allocated subnets: {'A': '10.0.0.0/24', 'B': '10.0.1.0/24'}
  r1  eth1  192.168.1.1/24   (domain C)
  r3  eth1  192.168.1.2/24   (domain C)
```

**Assign** preserves pinned subnets and any address you typed yourself. **Renumber all**
replaces both — that is what "all" means, so pin again afterwards if you need to.

A subnet field rejects a host address (`192.168.1.1/24`) and suggests the network instead,
because the model requires a network and an invalid value would otherwise be rejected on
every later request.

### Saving, sharing and reopening a scenario

**A scenario is a folder**, and it is an ordinary Kathará lab directory:

```
kathara-labs/untitled/
  lab.conf                 the topology, its layout and its metadata
  kgui.json                feature toggles and a format version
  r1.startup               addressing
  r1/etc/frr/frr.conf      configuration captured from the running router
```

There is no special file format. `lab.conf` carries the whole model — canvas positions and
device kinds ride in `# kgui:` comments that Kathará ignores — so the folder is the
document, and **Export is a plain zip of it**. Anyone can unzip and read the startup
scripts; anyone with Kathará can `cd` in and `kathara lstart`.

The **Scenario** panel holds all of it:

| Control | What it does |
|---|---|
| **Save** | Writes the folder into your workspace. Also on the header bar. |
| **Save as…** | The same, under a folder name you choose. |
| **Open…** | Lists the scenarios in your workspace; pick one to open it. |
| **Export** | Downloads the folder as `<name>.zip` — for submitting or sending. |
| **Import…** | Opens a zip, or a bare `lab.conf`, from anywhere. |
| **Capture running state** | Copies what the devices are actually running back into the scenario. |

**Save keeps it here; Export sends it out.** Scenario folders live in the workspace
(`./kathara-labs` unless `--workspace` says otherwise), which is also where labs deploy from.

**Renaming.** Click the scenario name beside the application title in the top-left corner,
type, and press Enter. Escape abandons the edit.

**The name is not cosmetic.** It decides the folder, the exported file name, and — because
Kathará identifies a lab by a hash of its name — which containers belong to this scenario.
That is why renaming is the reliable fix when two labs collide.

**A deployed lab cannot be renamed.** Renaming would not rename its containers; it would
leave them behind under the old name, where the interface can neither see nor stop them.
Stop the lab, rename, deploy again.

### Opening a lab somebody else made

Import accepts a lab that has never been near this application: a zip of a folder, a folder
zipped by Finder or Explorer (the extra wrapping directory is unwrapped for you, and macOS's
`__MACOSX` sidecar and `.DS_Store` files are discarded), or a single `lab.conf`.

**Its configuration is recovered, not discarded.** A Kathará lab keeps its addressing in
`<device>.startup` and its routing daemons in `<device>/etc/frr/daemons`, so those files are
read and folded into the model. Both the modern `ip address add 10.0.0.1/24 dev eth0` and
the older Netkit `ifconfig eth0 10.0.0.1 netmask 255.255.255.0` are understood. Without
this, an imported lab looked unaddressed and the validator complained about addresses that
were on disk all along.

**Device kinds are guessed, because Kathará does not record them.** A device running FRR is
a router; otherwise names like `pc1`, `server2` or `sw1` pick the icon. Anything unclear
stays a router, and the inspector changes it.

**It is laid out for you.** A foreign lab has no coordinates, so every device would arrive
on the same spot. See below.

### When the canvas and the running lab disagree

Deploying takes a snapshot. Edit anything afterwards — an address, a link, a device — and
the Laboratory panel lists exactly what now differs:

> **The canvas no longer matches the running lab.** Deploy again to apply these changes;
> until then, diagnostics describe what is running.
> - r1 eth0 is 192.168.1.1/24 on the canvas but 10.0.0.1/24 in the running lab

**It works in both directions.** Editing the canvas after deploying is one; changing an
address inside a container with `kathara connect` is the other, and it is reported
separately:

> - r2 eth0 is 10.0.0.77/24 in the running container but was deployed as 10.0.0.2/24

Which to keep is yours to decide: **Deploy** again to make the containers match the canvas,
or **Capture running state** to bring the containers' configuration back onto it.

**The header changes colour while this is true**, and says how many changes behind the
running lab is. The panel message was being missed, and the difference changes what every
other control means — so it is stated where it cannot be scrolled away from. The colour is
backed by words, because a colour alone is not a status.

This matters most for **Verify links**, which pings real containers and can therefore only
report the lab as deployed. Changing an address on the canvas and verifying gives results
about the *old* address — correctly, but confusingly, which is why the panel now says so
both at the top and beside the results.

Moving a device on the canvas is not counted: it changes the picture, not the network.

### Tidying the layout

**Tidy layout**, in the Arrange panel, lays the whole topology out in layers with as few
link crossings as it can, spaced so the interface labels and addresses stay readable. It
runs automatically on a lab imported without a saved layout, and never touches a layout you
already have.

It is a single undo step, so trying it costs nothing.

The algorithm layers devices by distance from the graph's centre and then orders each layer
by where its neighbours sit — the middle of the classical Sugiyama method. On the ordinary
teaching shapes (a ring, a star, a chain, a two-tier campus) it produces no crossings at
all; on a tangled thirty-device graph it cut them from around 185 to 34.

### Hibernating and resuming a lab

Deploy, configure the devices however you like, press **Capture running state**, then
**Save**. Reopening and deploying brings the lab back as you left it.

Capture writes to two places, because a device keeps its configuration in two:

- **A router's routing state** goes to `<device>/etc/frr/frr.conf`, read from `vtysh` rather
  than from disk, and placed where Kathará copies from on the next deploy.
- **Interface addresses** go back into the topology, and therefore onto the canvas and into
  the regenerated `.startup`. This is how capture works for a PC, which has no routing
  daemon to ask.

**A router's hostname comes from its device name.** Rename the device in the editor and
redeploy; FRR picks the name up from the container.

Setting it with `hostname NAME` inside `vtysh` does *not* work and is not a fault in the
capture. In Kathará's FRR image, `hostname` is handled by `vtysh` itself rather than passed
to the routing daemons, and the image runs with `no service integrated-vtysh-config`, so
`vtysh` says as much and discards it:

```
r1(config)# hostname siemanko
siemanko(config)# end
siemanko# wr
Note: this version of vtysh never writes vtysh.conf
```

The prompt changes for that session only. Open `vtysh` again and the hostname is back, every
daemon's config on disk still says the old name, and **Capture running state** therefore
records the old name — correctly. Ordinary routing configuration typed in `vtysh`, such as
`router ospf`, does reach the daemons and is captured normally.

**Feature toggles travel with the scenario.** If an instructor withdraws the subnet
calculator, opening that scenario withdraws it on your machine too. A lab imported from
outside has no such settings, so everything is on.

### Not built yet

- **In-app terminal.** Use `kathara connect` in a real terminal for now — see §4.
- **Variants** of a scenario (exam groups), **PDF manuals**, and a **built-in lab library**.
- **Setting exam-mode toggles.** The server enforces them and they are stored in the scenario folder,
  but there is no interface for an instructor to change them, so a new scenario has
  everything on.

See [PLAN.md](../PLAN.md).

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

### Redeploying

Pressing **Deploy** while a lab is already running **replaces** it: the old containers are
stopped and new ones started from the current design. The button says **Redeploy** to make
that clear, and anything changed inside a container is lost — export first if you need it.

This is the normal working loop. Edit the topology, press Redeploy, look again.

**Kathará identifies a lab by its name, not its folder.** `Lab.hash` is derived from
`LAB_NAME`, so two labs both called `untitled` in different directories are *the same lab*
to Kathará — deploying one stops the other.

Because of that, deploying when something is already running under the same lab name asks
first, listing what will be stopped. If a device is running under your lab name that is not
in your topology, another lab is probably using the name, and the warning says so.
**Renaming your lab is the reliable fix**: distinct names get distinct containers.

`kathara list` shows everything running; `kathara wipe` removes it all.

### Getting a shell on a running device

Deploying writes the lab to `./kathara-labs/<name>` — beside wherever you started
`kathara-gui`, and printed at startup. The Laboratory panel shows the exact path and a
copy-able command once a lab is running.

```bash
cd kathara-labs/untitled
kathara connect r1
```

**The `cd` matters.** Kathará identifies a lab by its directory, so `kathara connect r1`
from anywhere else fails with `MachineNotRunningError` even while `kathara list` shows the
device running.

Use `--workspace DIR` to put labs somewhere else.

### When a device says "Exited"

Docker does not restart Kathará containers, so restarting Docker Desktop, rebooting, or
letting the machine sleep overnight stops a running lab. The containers are not removed,
which makes the symptom confusing: `kathara list` still lists every device, but connecting
fails with a 409 rather than opening a shell.

```
CRITICAL (APIError) 409 Client Error ... Conflict ("container … is not running")
```

The Laboratory panel marks those devices **Exited** and says so in plain words. Press
**Deploy** to bring the lab back — it will ask first, because the stopped containers still
hold their names and have to be cleared before new ones can take them.

Nothing that was changed *inside* a container survives this. Deploy again and reapply, or
capture the configuration next time before you stop for the day.

### Running an exported lab by hand

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
| GET | `/api/topology/addressing/issues` | addressing problems in the stored topology |
| POST | `/api/topology/addressing/check` | validate a supplied topology without storing it |
| POST | `/api/topology/addressing/allocate` | assign addresses; optional per-domain subnets |
| GET | `/api/lab/probe` | preflight: Docker, Kathará, WSL2 |
| GET | `/api/lab/features` | which assistive features this scenario allows |
| POST | `/api/lab/status` | reconcile a topology against the running containers |
| POST | `/api/lab/deploy` | deploy; reports conflicts unless `confirm` is set |
| POST | `/api/lab/undeploy` | stop the lab |
| POST | `/api/lab/verify` | ping across every direct link |
| POST | `/api/topology/arrange` | positions laying a topology out with fewest crossings |
| GET | `/api/project` | scenario name, folder, feature toggles |
| GET | `/api/project/scenarios` | scenario folders in the workspace |
| POST | `/api/project/save` | write the scenario folder into the workspace |
| POST | `/api/project/export` | the scenario folder as a zip, for download |
| POST | `/api/project/open` | open a scenario folder from the workspace |
| POST | `/api/project/import` | open a zip or a `lab.conf` sent as a raw body |
| POST | `/api/project/capture` | pull running configuration into the scenario |

The `POST` endpoints for addressing and lab operations take the topology in the request body
rather than acting on the stored one, because the browser normally holds newer work than the
server does. `GET /api/topology/addressing/issues` is the exception and reports on the
stored topology.

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

**Every device shows "Exited" after a break** — Docker stopped them; the containers are
still there but nothing is running inside. Press **Deploy** and confirm. See *When a device
says "Exited"* above.

---

## 7. Accessibility testing

> The EN 301 549 conformance table (ACC-09) is written at the end of the project, once the
> interface has stopped changing. The automated evidence it will rest on is listed below and
> runs today.


Capability 6 is graded, so this is part of the deliverable rather than optional QA.

Automated, on every commit:

```bash
cd frontend && npm test        # axe-core audits over tree, panels and the whole app
```

```bash
uv run pytest tests/test_contrast.py    # palette contrast against WCAG 2.1
```

> **axe under jsdom cannot check colour contrast** — it needs a real canvas. A clean
> `npm test` proves structure, roles and naming only. `test_contrast.py` covers the palette
> from the other side by reading the real tokens out of `styles.css`, but neither proves
> *rendered* contrast, so the browser pass below still matters.

Manual:

- **Keyboard only** — unplug the mouse and build a two-device topology.
- **VoiceOver** (macOS) — Cmd+F5. Navigate the tree; every device and interface should
  announce its kind, addresses and neighbours.
- **NVDA** (Windows, free) — the screen reader most desktop users actually use, and it
  interprets ARIA differently from VoiceOver. Needs the Windows VM.
- **Zoom to 200%** — layout must not break or overlap.
- **Dark mode and increased contrast** — both follow the OS setting.
- **Reduced motion** — animations are suppressed when the OS asks.
