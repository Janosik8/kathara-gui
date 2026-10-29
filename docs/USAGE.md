# Usage and commands

Everything you can do with the application and the repository, in one place.
A living document — update it when behaviour changes.

- **Last updated:** 2026-09-27 (Phases 0–3 complete; 4–6 mostly done; first Windows run)
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
npm --prefix frontend ci
npm --prefix frontend run build
uv run kathara-gui
```

One command per line, and `--prefix` instead of `cd frontend`, so the same lines work in
PowerShell, Command Prompt and a Unix shell. Windows PowerShell 5.1, the default on
Windows 10 and 11, has no `&&` and rejects `cd frontend && npm install` outright (bug 21).

**In PowerShell on Windows, type `npm.cmd` where these say `npm`:**

```powershell
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run build
uv run kathara-gui
```

Windows ships with PowerShell's execution policy set to *Restricted*, and Node installs
`npm` as a PowerShell script (`npm.ps1`), so plain `npm` fails with "npm.ps1 cannot be
loaded because running scripts is disabled on this system". `npm.cmd` is the same program
without the script wrapper, and needs no change to your security settings. If you'd rather
type `npm`, allow locally created scripts once, for your account only:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. Command Prompt and Unix shells are
not affected, and `uv` isn't either, because it's a real executable.

**The `npm` steps are only needed the first time, and after the frontend source changes**
(for example after a `git pull`). `uv run kathara-gui` alone always runs the current Python
code, but it serves the interface as last built. In a source checkout it compares the two
at startup and prints a warning with the rebuild command when the build is missing or older
than the source, so an out-of-date interface never goes unnoticed. An installed release
ships its interface pre-built and never shows the warning.

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
npm --prefix frontend run dev
```

Open the Vite URL (usually `http://localhost:5173`) but **append the token** from terminal 1:
`http://localhost:5173/?token=<token>`. Without it every API call returns 401.

Point the proxy elsewhere with `KGUI_BACKEND=http://127.0.0.1:9000 npm run dev` in a Unix
shell, or `$env:KGUI_BACKEND="http://127.0.0.1:9000"; npm --prefix frontend run dev` in
PowerShell.

### Installed as a tool

```bash
uv tool install .        # from this checkout
kathara-gui
uv tool uninstall kathara-gui
```

---

## 3. What you can do in the UI today

The editor, addressing, deployment, verification, saving and capturing running
configuration all work. What is still missing is listed under *Not built yet* below and in
[PLAN.md](../PLAN.md).

| Action | How |
|---|---|
| Add a device | **Add router / switch / pc / server** in the left panel. The button names the device it will create. |
| Select | Click a device in the tree or on the canvas. |
| Select several | **Ctrl/Cmd + click**, or Ctrl/Cmd + Enter in the tree. |
| Connect two devices | Turn on **Connect mode** (the button above the collision domain list, or press `C`; it is filled blue, with ◉, while on), click one device, then click another. A link appears. `C` can be switched off with **Single-key shortcuts (C)** in the top bar. |
| Draw several links | Connect mode stays on after each link, so keep clicking pairs. |
| Add a device to an existing network | In connect mode, click the device, then click the **link or collision domain** it should join. All of them then share one collision domain. |
| Cancel a half-made link | Click the same end again, or click empty canvas. |
| Leave connect mode | Press `Escape`, or the toggle again. |
| Rename | Select a device → **Details** → Name → Enter or click away. Kathará accepts only lowercase letters, digits and underscores, up to 30 characters, so `R1` or `edge-1` is refused with a suggestion (`r1`, `edge_1`). A lab opened from elsewhere with such names still opens; Deploy lists each one to rename. |
| Set an address | Select a device → **Details** → Interfaces → address field, e.g. `10.0.0.1/24`. |
| Enable routing daemons | **Details** → Routing daemons. Every daemon FRR can start is listed, each with what it is for (`ldpd` is MPLS LDP). Ticking any protocol also ticks `zebra`. **Apply to all routers** gives every router this one's daemons, as one undo step. |
| Add loopback addresses | **Details** → Loopback (lo) → type into the field, e.g. `10.255.0.1/32`, then Enter. Press **+** beside the first row for another field, and **−** on a row to remove that address. There is always one row. Each address goes on `lo` in the container, next to `127.0.0.1/8`, and shows under the device's name on the canvas. |
| Run a device privileged | **Details** → **Privileged**. Kathará starts it only when the application runs as administrator (Windows: PowerShell opened with *Run as administrator*) or root (macOS, Linux: `sudo`); otherwise Deploy says so and starts nothing. |
| Change the image | **Details** → Container image. See the warning below before clearing it. |
| Move a device | Drag on the canvas. Snaps to a 16px grid. |
| Tidy up | Select 2+ devices → **Arrange** → align. Distribute needs 3+. |
| Disconnect an interface | **Details** → Interfaces → Disconnect ethN. |
| Delete a device | Select it, then the **Delete** button or the Delete key. |
| Delete a link | Click the link on the canvas — it thickens — then Delete. Both ends are detached and the collision domain goes with them. A segment shared by three or more devices is deleted the same way: click its oval node, then Delete. |
| Move a shared segment | Drag its oval node. It stays where you put it, also when its devices move, and is saved with the scenario. **Tidy layout** puts it back between its devices. |
| Detach one end only | **Details** → Interfaces → Disconnect ethN, or Delete on an interface row in the tree. The far device stays attached. |
| Undo / redo | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, or the toolbar. |
| Pin a subnet to a collision domain | Left panel → **Collision domains** → type the network for that domain, e.g. `192.168.1.0/24`, then Enter. |
| Let a domain be allocated | Leave its subnet field blank. |
| Assign addresses | Right panel → **Addressing** → **Assign addresses**. Fills gaps, keeps pinned subnets and hand-written addresses inside them; replaces an address outside its domain's pinned subnet, and says which. |
| Renumber everything | **Renumber all**. Replaces every address *and* every pinned subnet. |
| Change the default pool | **Addressing** → Address pool and Subnet size, before assigning. The pool must be a network: `192.168.0.0/8` is refused, naming both readings (`192.0.0.0/8`, or `192.168.0.0/16`). |
| Save | **Save** in the top bar, or Ctrl/Cmd+S, writes the scenario to its folder in the workspace: `lab.conf`, the `.startup` files and the device folders. **The folder is named exactly as the lab**, so after a rename in the header, Save renames the folder too, keeping what is in it, and says "folder renamed from …". **Save as…** writes a copy under a new name, and the copy takes that name too. **Deploy saves as well.** |
| Rename the lab | Click its name in the header. A lab name can hold letters (any language), digits, spaces, `-` and `_`, up to 48 characters, because it is also the folder's name. A name another scenario already has is refused as you type it: Kathará knows a running lab by its name, so two labs with one name would stop each other. Not while the lab runs. |
| Open | **Open…** in the top bar lists the scenarios in your workspace. A scenario whose lab is still running opens read-only, with **Stop** and **Capture** available, as after a reload. |
| Start a new scenario | **New…** in the top bar. An empty canvas with no folder; the scenario that was open stays in its own. Warns first if there are unsaved changes. |
| Export, import | **Export** and **Import…** in the top bar, after Open. The first press says what each does and the second does it. Export downloads the folder as a `.zip`; Import takes such a zip, a folder zipped by hand, or a plain `lab.conf`, and asks before replacing a scenario of the same name. |
| Deploy | Right panel → **Laboratory** → **Deploy**. The design becomes read-only while the lab runs. |
| Verify links | **Laboratory** → **Verify links**: pings across every link. Close the results with their **×**. |
| See what changed inside the containers | **Laboratory** → **Check for changes**. It asks Docker which devices are running, exited or gone, and compares every interface's address inside the containers with what was deployed or last captured. It does not compare routing configuration typed in `vtysh`; **Capture** reads that. A device whose container was removed outside the application (Docker Desktop, `docker rm`) is named, with a warning in the panel: Redeploy to start it again, or Stop. Nothing polls in the background (NFR-11), so the device states shown are as of the last deploy, capture or check. |
| Keep what changed inside the containers | **Scenario** → **Capture running state**. |
| Open a shell on a device | **Laboratory** → choose the device → **Copy command**, then paste it into any terminal. |
| Stop the lab | **Laboratory** → **Stop**, then choose whether to capture first or discard. |
| Stop every lab on this computer | **Laboratory** → **All labs** → **Stop every lab**. Captures nothing; see *Stopping everything* in §4. |

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

**Every side-panel section can be collapsed and moved.** Press a section's heading to fold
it down to the heading alone, and again to open it. Drag a section by its header (the ⠿
grip, or anywhere on the header but its buttons) to another place in the same panel; a line
shows where it will land. From the keyboard, ▲ and ▼ beside the heading move it one place,
and focus stays on the button so it can be pressed again. Both panels work this way.

The arrangement is remembered between launches, in `.kgui-preferences.json` in the
workspace. Delete that file to go back to the default order with everything open. The
browser cannot remember it: every launch takes a new port, and the browser keys its storage
by port. Collapsing and moving still work while a lab runs and the design is read-only,
because they change nothing in the design. A collapsed **Scenario** or **Laboratory** opens
by itself when something in it needs an answer or reports a result, such as a capture, a
question before a redeploy, or the link checks.

### Reading the diagram

Each interface is drawn as a labelled point on the device's edge — `eth0`, `eth1` — and a
link terminates at the interface it actually uses, so you can see which port it enters. That
matters: wiring `eth0` but configuring `eth1` is a common mistake, and a diagram that hides
the port cannot help you find it.

Interfaces are always numbered from `eth0` without gaps, because Kathará refuses to deploy a
device that has `eth1` but no `eth0`. Deleting a link or disconnecting an interface therefore
moves the ones above it down: a device's `eth1` becomes `eth0`, keeping its link and its
address. A lab saved with a gap is renumbered the same way when opened, and the panel lists
each interface that moved.

An interface sits on the face pointing at whatever it is connected to, and moves as you drag
devices around. Two interfaces on the same face go to opposite corners, ordered so their
links do not cross.

A collision domain with exactly two devices is drawn as a plain link. With three or more it
gets a node of its own, because a Kathará collision domain is a shared medium rather than a
cable, and drawing a shared segment as a single line would misrepresent it. That node sits
between its devices until you drag it somewhere; from then on it stays put. Each link
meets the node's outline on the side it arrives from, so none crosses its label. Click it
and press Delete to remove the whole segment, as you would a link.

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
| `C` | Toggle connect mode, unless **Single-key shortcuts (C)** in the top bar is unticked (it starts ticked on every launch). In it, `Enter` on a device picks it, and `Enter` on an interface row picks that row's collision domain. |
| `Delete` | On a device row, remove the device. On an interface row, disconnect that interface. Ignored while typing in a field. |
| `Escape` | Leave connect mode, or abandon an in-progress text edit. |
| `Ctrl/Cmd + A` | Select every device. Ignored while typing, where it selects the field's text. |
| `Ctrl/Cmd + Z` | Undo. Add `Shift` to redo. |
| `Ctrl/Cmd + S` | Save, as the **Save** button does. Works inside a field too, and saves what you were typing there. |
| `←` `→` on a panel divider | Widen or narrow that panel. `Home` and `End` reach its limits. |

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

**Assign** preserves pinned subnets, and any address you typed yourself that lies inside its
domain's pinned subnet. An address *outside* the pinned subnet is replaced, because the pin
says where that domain is; the status line names each one and the address it had. A domain
with nothing pinned whose devices already agree on a subnet keeps that subnet, and new
devices on it are numbered inside it. **Renumber all** replaces everything — that is what
"all" means, so pin again afterwards if you need to.

A subnet field rejects a host address (`192.168.1.1/24`) and suggests the network instead,
because the model requires a network and an invalid value would otherwise be rejected on
every later request.

**Two collision domains with overlapping subnets** are a *warning*, not an error, and it
only states the fact: "Collision domains A and B have the same subnet, 10.9.0.0/24." Usually
it is a slip, but a VPN or VRF lab reuses one subnet on purpose on either side, and Kathará
runs it without complaint. The same goes for one loopback address on two devices: wrong for a
router ID, deliberate for anycast.

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

All but the last are in the top bar; **Capture running state** is in the **Scenario** panel on the right:

| Control | What it does |
|---|---|
| **New…** | Starts an empty scenario that is not saved anywhere yet. The next Save writes it to a folder of its own name, so it cannot overwrite the one that was open. |
| **Save** | Writes the folder into your workspace. Ctrl/Cmd+S does the same. |
| **Save as…** | The same, under a folder name you choose. Opens a field under the top bar; `Escape` closes it. |
| **Open…** | Lists the scenarios in your workspace under the top bar; pick one to open it. Each is listed by its lab name, which is also its folder; a folder that differs (one from before folders took the lab's name) is shown after it. A scenario whose lab is running has a green dot and the word **running** beside its name. Allowed while a lab runs, which keeps running. |
| **Export** | Opens a strip under the top bar saying what is in the download; **Download .zip**, or Export pressed again, downloads the folder as `<name>.zip`, for submitting or sending. The scenario is saved first. |
| **Import…** | Opens a strip under the top bar saying what can be imported; **Choose a file…**, or Import… pressed again, opens the file chooser. Takes a zip, or a bare `lab.conf`, from anywhere. A scenario from outside this application is marked so in the Scenario panel. A zip is named after its file, and the lab inside is renamed to match, so `student.zip` opens as `student`. A browser's copy number is ignored: "base exam (1).zip" is `base exam`. A bare `lab.conf` keeps the name its `LAB_NAME` gives it. If the workspace already has a scenario of that name, it asks before replacing it; a scenario whose lab is running is never replaced — stop it first. |
| **Capture running state** | Copies what the devices are actually running back into the scenario. The result stays listed until you close it with its **×**. |

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

### While the lab is running, the design is read-only

Once a lab is deployed the header turns red and says **Lab running — design is
read-only**, and every editing control is disabled: adding, deleting, linking, moving, the
inspector, addressing, arranging and undo. You can still select devices and read their
settings, on the canvas and in the tree. **New**, **Open** and **Import** stay available:
the lab keeps running in the background, and opening its scenario again brings it back
read-only, with Stop and Capture. Anything that tries to edit anyway
is refused and says why in the status line: a keyboard shortcut, a press on a disabled
button, or dragging a device, which stays where it is.

After reloading the page, the header says **Checking whether the lab is running…** for
about a second, and the design is locked meanwhile. Docker has to be asked, and an edit
made before the answer would have changed a lab that turns out to be running.

The reason is that there are two places the network can change, the canvas and the
containers, and when both can change at once there's no simple answer to "which one is
right?". Locking the canvas leaves only one direction: things you change inside the
containers with `kathara connect`.

**To bring those changes onto the canvas**, press **Capture running state**. Routing
configuration goes to each router's `frr.conf` and interface addresses onto the canvas, and
the captured state becomes what the running lab is compared against.

**To find out whether anything has changed inside the containers**, press **Check for
changes** in the Laboratory panel. It only looks when you ask; nothing polls in the
background, so an idle editor puts no load on the machine running the lab. What differs is
listed in words:

> **The running lab no longer matches the canvas.** Capture running state to keep these
> changes, or stop the lab and discard them.
> - r2 eth0 is 10.0.0.77/24 in the running container but was deployed as 10.0.0.2/24

While there's a difference, the header also changes colour and says how many places differ,
so it can't be scrolled out of sight. The colour always comes with words, because colour
alone doesn't convey a status.

**To edit the design, stop the lab.** **Stop** asks what to do with anything changed inside
the containers:

- **Capture, then stop** keeps it. If the capture fails, nothing is stopped and nothing is
  lost.
- **Stop and discard container changes** drops it. The canvas stays as it was at the last
  deploy or capture.
- **Keep running** changes nothing.

If every container has already exited there's nothing to capture from, so Stop just clears
them without asking.

A page reloaded while its lab is running comes back locked, because the containers keep
running after the browser tab closes.

**Verify links** pings from the real containers, to the addresses in the design. So an
address you deleted or moved inside a container, and haven't captured, is still pinged, and
the link fails. Verify links therefore reads the containers' addresses first, and if they
differ from the design it asks: **Capture, then verify** (the design takes the containers'
addresses, and a link with an end left unaddressed is **Skipped**), **Verify the design as
it is**, or **Cancel**. When they agree it verifies straight away. If you verify without
capturing, the panel says beside the results that they describe a lab that differs.

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
  daemon to ask. Loopback addresses come back too: one added with
  `ip address add 10.255.0.2/32 dev lo` inside the container ends up in the `.startup`.
  IPv4 only, as for the other interfaces.
  One set in `vtysh` (`interface lo`, `ip address …`) is different: it is in the captured
  `frr.conf` already, so it is left there and not added to the Loopback rows, and the
  capture message says so. Change or remove it in `vtysh`, then capture again.
  An address deleted inside the container is cleared from the design.
- **One address per interface.** The design holds one address on each `ethN`, so when an
  interface has two, the capture keeps the first (the one Linux treats as primary) and the
  capture message names the others: "pc1 eth0 also has 10.0.0.9/24; the design keeps one
  address per interface, so it was not captured." A second address set in `vtysh` is not
  lost, since `frr.conf` restores it on the next deploy, and the message says that instead.
  An address on an interface the design doesn't have (`eth1` on a device with one link) is
  named the same way.

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

- **In-app terminal.** Copy the shell command from the Laboratory panel into a terminal for now — see §4.
- **Variants** of a scenario (exam groups), **PDF manuals**, and a **built-in lab library**.
- **Setting exam-mode toggles.** The server enforces them and they are stored in the scenario folder,
  but there is no interface for an instructor to change them, so a new scenario has
  everything on.

See [PLAN.md](../PLAN.md).

---

## 4. Verifying a topology outside the UI

Everything here can be done in the interface. The API is for scripting it. Use the port
and token printed at startup. Export the generated `lab.conf`:

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

### Redeploying

Pressing **Deploy** while a lab is already running **replaces** it: the old containers are
stopped and new ones started from the current design. The button says **Redeploy** to make
that clear, and it asks first, offering three choices:

- **Capture, then redeploy** keeps what was configured inside the containers. It is
  captured into the scenario, and the new containers start with it.
- **Redeploy and discard container changes** starts again from the scenario on disk.
- **Cancel** changes nothing.

The working loop is: stop (capturing if you want to keep what you configured), edit,
deploy, look again. The design can't be edited while the lab runs; see *While the lab is
running, the design is read-only* above.

**Kathará identifies a lab by its name, not its folder.** `Lab.hash` is derived from
`LAB_NAME`, so two labs both called `untitled` in different directories are *the same lab*
to Kathará — deploying one stops the other.

Because of that, deploying when something is already running under the same lab name asks
first, listing what will be stopped. If a device is running under your lab name that is not
in your topology, another lab is probably using the name, and the warning says so.
**Renaming your lab is the reliable fix**: distinct names get distinct containers. Inside the
workspace this can no longer happen, because two scenarios cannot share a name. It can still
happen with a lab started from elsewhere, for example with `kathara lstart`.

`kathara list` shows everything running; `kathara wipe` removes it all.

### Stopping everything

**A lab keeps running when the application stops.** That's deliberate: restart the
application and the page comes back to the running lab, locked. When you stop it with
Ctrl+C while something is deployed, it tells you:

```
Kathara GUI stopped.

Warning: 6 devices in 2 labs are still deployed. Kathará containers do not stop with this
application; they keep running until they are stopped.
```

**Stop every lab**, at the bottom of the Laboratory panel under *All labs*, stops every
Kathará lab of your user on this computer, including labs this application never opened.
It's the same as `kathara wipe`, and needs no Kathará command-line tool. The panel says
how many devices in how many labs are deployed, and the button asks once before acting.
It **captures nothing**: anything configured inside those containers is lost, so capture
the lab you care about first if you need it. Other users' labs on the same machine are
never touched. It works while the design is locked, and unlocks it.

The button is available even when no lab is detected. Kathará can be left holding networks
or containers from an earlier run, after a Docker restart for example, and then answers a
deploy with "Kathara has been left in an inconsistent state! Please run `kathara wipe`".
Pressed then, it clears that state, just as `kathara wipe` would.

### Getting a shell on a running device

Deploying writes the lab to `./kathara-labs/<name>`, next to wherever you started
`kathara-gui`; the path is printed at startup. Once a lab is running, the Laboratory panel
shows that path, lets you choose a device, and gives a command you can copy:

```
docker exec -it kathara_<user>_r1_<hash> bash
```

This works in **any terminal** (PowerShell, Command Prompt, or a Unix shell) from any
directory, and needs nothing installed except Docker, which you already have. The panel
fills in the real container name.

If you have Kathará's own command-line tool, the panel also shows the equivalent:

```
kathara connect -d "C:\path\to\kathara-labs\untitled" r1
```

`-d` names the lab directory. Kathará identifies a lab by its directory, so `kathara
connect r1` run from anywhere else fails with `MachineNotRunningError`, even while `kathara
list` shows the device running.

**On Windows, the Kathará CLI is a separate install** (from kathara.org), and without it
`kathara` is "not recognized as an internal or external command". The panel used to
suggest `cd <dir> && kathara connect r1`, which failed on Windows in three ways: no CLI,
no `&&` in Windows PowerShell 5.1, and `cd` in `cmd` doesn't switch drives. That is why it
now leads with `docker exec`.

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
**Deploy** to bring the lab back. The stopped containers still hold their names, so Deploy
removes them first, without asking, because there is nothing running in them to capture.
It asks only if some device of the lab is still running.

Nothing that was changed *inside* a container survives this. Deploy again and reapply, or
capture the configuration next time before you stop for the day.

### Running an exported lab by hand

```bash
mkdir mylab
cd mylab
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
| GET | `/api/project/scenarios` | scenario folders in the workspace, each with `running` when its lab has a running container |
| POST | `/api/project/save` | write the scenario folder into the workspace |
| POST | `/api/project/export` | the scenario folder as a zip, for download |
| POST | `/api/project/open` | open a scenario folder from the workspace |
| POST | `/api/project/import` | open a zip or a `lab.conf` sent as a raw body; 409 if a scenario of that lab's name exists, unless `?replace=true`; 423 if that scenario's lab is running |
| POST | `/api/project/capture` | pull running configuration into the scenario |
| GET | `/api/preferences` | the side panels' layout: each panel's section order and which are collapsed |
| PUT | `/api/preferences` | store that layout in `.kgui-preferences.json`; unknown sections are dropped, missing ones restored |

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
uv run ruff check .
uv run pytest -q
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
```

Run them in order and stop at the first failure. They're not chained with `&&` because
Windows PowerShell 5.1 can't parse it.

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

**Blank page, or 404 at the root** — the UI has not been built. `npm --prefix frontend run build`

**Every API call returns 401** — the token is missing. Use the full URL printed at startup,
including `?token=…`. It is stored per browser tab, so a new tab needs the URL again.

**403 "Cross-origin requests are not permitted"** — the page was loaded from a different
origin than the backend. In dev, use the Vite URL and let the proxy handle `/api`.

**`docker info` fails** — start Docker Desktop and wait for it to report running.

**"Docker is not running" after restarting Docker Desktop** — the application reconnects on
its own, so there is no need to restart it. Wait until Docker Desktop reports that it is
running, then try again. Before F36, this case failed as
`(232, 'WriteFile', 'The pipe is being closed.')`.

**"npm.ps1 cannot be loaded because running scripts is disabled on this system"** —
PowerShell's default execution policy on Windows. Type `npm.cmd` instead of `npm`, or run
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once. See §2.

**A traceback after Ctrl+C** (`KeyboardInterrupt`, then `CancelledError`) — fixed. It was
a clean stop that looked like a crash: on Windows, Ctrl+C reaches the server twice. The
application now just prints "Kathara GUI stopped."

**Port already in use** — omit `--port` and an unused one is chosen for you.

**Kathará on Windows** — Docker Desktop ≥ 2.5 with the **WSL2** backend, **Linux containers
only** ("Use Windows Containers" must be off), and the drive holding your labs shared in
Docker settings. The Kathará CLI works in PowerShell, not `cmd`.

**Save does nothing, or "the workspace path … contains a line break"** — the command was
split across two lines, usually because the terminal wrapped it and the closing `"` ended
up on the next line. Type `uv run kathara-gui --workspace "C:\path with spaces"` on one
line. A line break at the very end is trimmed automatically; one inside the path is
refused at startup. Any failure the application can't recover from is shown in a red
banner at the bottom of the window, with the reason.

**Containers left running** — **Stop every lab** in the Laboratory panel removes all of
them, or `kathara wipe` if you have the Kathará command-line tool. They're left running on
purpose when the application stops, and it says so as it exits.

**The disk filled up, and now nothing works even with space free** — found on the Windows
machine (F18). When the disk holding Docker Desktop's data fills, Docker's storage goes
read-only and Docker Desktop stops with "unable to start". Freeing space brings it back,
but **images that were being written at the time stay damaged**: files inside them are
truncated to zero bytes. The symptom is containers that deploy but fail every command, with

```
exec /usr/sbin/ip: exec format error
```

Check with:

```bash
docker run --rm --entrypoint ls kathara/base -la /usr/sbin/ip /usr/bin/ping
```

A size of `0` means the local copy is damaged. The published image is fine: upstream, `ip`
is 760 KB and `ping` 90 KB. **Pulling again does not fix it, and neither does `docker
system prune -a`**: with the containerd image store Docker keeps the already-unpacked
layers and reuses them, and the pull reports "Download complete" without downloading
anything. What worked was Docker Desktop → Troubleshoot → **Reset to factory defaults**,
which also resets Docker's settings. **Clean / Purge data** did not recreate the data disk
on the machine where this was found. Either way, afterwards check that `docker_data.vhdx`
under `%LOCALAPPDATA%\Docker\wsl\disk` has a new creation time; if it doesn't, the damaged
layers are still there.

To keep Docker away from a full system drive, move its disk image to another drive:
Settings → Resources → Advanced → **Disk image location**.

**Every device shows "Exited" after a break** — Docker stopped them; the containers are
still there but nothing is running inside. Press **Deploy** and confirm. See *When a device
says "Exited"* above.

---

## 7. Accessibility testing

> The EN 301 549 conformance table (ACC-09) is `docs/CONFORMANCE.md`. It rests on the
> automated evidence below and on section 6 of `docs/TEST-PROCEDURE-WINDOWS.md`.

> **Screen readers are out of scope** (D10 in `PLAN.md`, 2026-10-25). There is no
> VoiceOver or NVDA pass, and the conformance claim is partial. The application makes no
> sound, so nothing is needed for hearing.


Capability 6 is graded, so this is part of the deliverable rather than optional QA.

Automated, on every commit:

```bash
npm --prefix frontend test     # axe-core audits over tree, panels and the whole app
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
- **Zoom to 200%** — layout must not break or overlap.
- **Dark mode and increased contrast** — both follow the OS setting.
- **Reduced motion** — animations are suppressed when the OS asks.
