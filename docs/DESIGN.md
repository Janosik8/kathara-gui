# Design rationale

Why this application exists, what shape it takes, and why each significant choice was made.
`PLAN.md` records *what* is built and *when*; this document records *why*.

---

## 1. The problem

Kathará labs are defined by hand-written text: a `lab.conf` listing which device sits on
which collision domain, a `.startup` script per device, and FRR configuration files. Writing
one is tedious. **Rewriting one is the actual problem.**

An instructor builds an exam, tries it, and concludes it is too easy — or too hard, or that
one link creates a routing loop that ruins the exercise. Every such judgement means redoing
collision domains and the addressing plan by hand, and the cycle repeats several times
before a scenario is usable. Students hit the mirror image: they can describe the topology
they want long before they can express it as correct configuration files.

The cost is not in any single edit. It is in the **iteration**, and in attention spent on
file syntax rather than on routing.

## 2. Why an application, and not scripts or templates

A generator or a set of templates would shorten the first write. It would not help with the
loop, because the loop is where the time goes:

- **The edit is spatial.** "Move this router to the other side of the WAN link" is one
  gesture and a dozen scattered text changes. A visual editor matches the way the change is
  conceived.
- **The state is bidirectional.** Configuration is also produced *inside* running
  containers, by hand, during a lab. Recovering it means logging into each one. Only
  something that talks to Docker can pull it back.
- **Correctness is checkable.** "Two different subnets on one collision domain" is
  mechanically detectable and invisible on inspection — every interface is up, every address
  is individually valid, and nothing works. A file format cannot warn you; a program can.

So the tool must hold a model, render it, generate from it, deploy it, and read back from
the deployment. That is an application.

**What it deliberately is not:** it does not design networks. It does not decide topologies
or invent addressing schemes beyond mechanical allocation. The designer keeps the ideas; the
tool removes the transcription.

## 3. How each capability is served

| # | Capability | Mechanism |
|---|---|---|
| 1 | Visual topology & addressing | Canvas editor over a typed model; subnet allocation and seven conflict checks in `domain/addressing.py` |
| 2 | Iteration and variants | The model is the source of truth, so an edit is a model change and regeneration; import is non-destructive, so an existing lab can be loaded and modified |
| 3 | Configuration & deployment | `domain/codec/` generates the lab; `kathara/runner.py` deploys it through the Kathará Python API |
| 4 | Verification & diagnostics | `kathara/diagnostics.py` pings pairwise within each collision domain against the running lab |
| 5 | State extraction | `vtysh -c "show running-config"` captures a router's live routing state, and `ip addr` its interface addresses; the scenario folder holds both and exports as a zip |
| 6 | Accessibility | An ARIA tree that is a genuine parallel interface to the canvas, not a summary of it; every pointer control has a keyboard equivalent, including the panel dividers; contrast and reflow asserted against the real stylesheet in tests |
| 7 | Collaboration | **Not built.** Edits are discrete operations over a pure reducer, which is the substrate a CRDT would need |
| 8 | Exam mode | `features.py`, enforced server-side |
| 9 | Auto-layout for imports | Positions round-trip through `lab.conf` comments, so a lab exported here reopens as it was drawn; a lab carrying none is laid out in layers by `domain/layout.py`, which minimises link crossings and is measured doing so |

### The idea that ties it together

**The topology model is the source of truth. `lab.conf` is a build artifact.**

Everything else follows. Editing is cheap because it mutates a typed object rather than
patching text. Validation is possible because there is a model to validate. Deployment is
reproducible because the files are regenerated, never hand-maintained.

The awkward consequence is that `lab.conf` cannot express canvas positions, device kinds or
addressing plans — and losing those on every save would defeat the purpose. They travel in
`#` comments, which Kathará ignores:

```
# kgui:node r1 pos=120,340 kind=router daemons=zebra,ospfd
r1[0]="A"
```

The output stays an ordinary Kathará lab that `kathara lstart` runs unmodified, verified
against Kathará's own parser rather than only our own. No sidecar file to lose when someone
shares the directory.

## 4. Technology choices

### Python for everything touching Kathará

Kathará ships a Python API — `deploy_lab`, `exec`, `retrieve_files`, `connect_tty`. Using it
directly is far more robust than shelling out and parsing CLI output, and it sidesteps a
documented Windows constraint: the Kathará **CLI** works only under PowerShell, not `cmd`.
The API has no such limitation.

*Rejected:* an all-TypeScript application driving the `kathara` command. Language uniformity
is not worth discarding the single best integration asset the platform offers.

### A browser interface, served locally

This is the decision the accessibility requirement forces. Capability 6 is a graded
deliverable measured against **EN 301 549** — the instrument Polish law actually binds public
bodies to, which maps to WCAG 2.1 AA. In a browser engine that is testable: ARIA, screen
reader support, `axe-core` in CI, the user's own zoom and contrast settings. In Qt or Tkinter
there is no equivalent audit tooling, and "we followed WCAG" becomes an unverifiable claim.
The reasoning holds even with screen readers since put out of scope (D10 in `PLAN.md`):
contrast, reflow, the system's contrast theme and the automated audit still need a browser.
The resulting claim is partial conformance, stated as such.

A second benefit: users get *their* assistive technology, not whatever a bundled toolkit
happens to support.

A third follows from the split itself. Because the interface is a client rather than the
program, the backend need not run on the same machine as the browser — it could sit on a
university server with students connecting over the network. A monolithic desktop
application cannot offer this at all, since interface and logic are one process on one
machine. This implementation binds loopback, because a server that executes commands inside
containers requires authentication and transport security before being exposed; but the
capability is a property of the architecture, and it is the clearest avenue for future
development.

*Rejected:* PySide6/Tkinter. Single language and trivial packaging, but the canvas would be
hand-built, the terminal and PDF viewer painful, and the accessibility claim unevidenced.

### Distributed as a Python package, not a binary

Installed with `uv tool install`, serving a browser UI on `127.0.0.1`.

*Rejected:* PyInstaller and Tauri producing signed `.app`/`.exe`. Docker is already a hard
prerequisite for Kathará, so anyone able to run the target environment can install Python.
Dropping binaries removed cross-compilation, target triples, a build matrix, code signing
and an Apple Developer certificate — the largest source of risk in the plan — for no
practical loss in reach. One artifact serves every OS and architecture instead of five.

> This supersedes the thesis text, which still promises standalone executables. That
> paragraph needs rewriting.

### The rest

| Choice | Reason |
|---|---|
| **FastAPI + pydantic** | Validation lives in the model, so the API rejects a bad edit with the domain's own wording; OpenAPI comes free |
| **React + TypeScript** | The editor is stateful and interactive; types catch model drift between the two languages |
| **React Flow** (`@xyflow/react`) | Mature canvas primitives — panning, selection, minimap — that are not worth rebuilding |
| **Zustand** | Small enough not to obscure the operation log, which is the part that matters |
| **Vitest + Testing Library + axe-core** | Tests query by role and accessible name, so they exercise the same surface assistive technology does |

## 5. Decisions that shape the code

**Security is not optional here.** The server executes commands inside containers, and any
page the user visits can reach `127.0.0.1`. It binds loopback only, requires a session token
minted at startup, and rejects cross-origin requests.

**Exam mode is enforced on the server.** A UI that merely hides the subnet calculator is
bypassed from developer tools in seconds — and this is a browser application, so a student
sitting an exam has those tools one keystroke away. Hiding the control is a courtesy;
refusing the request is the enforcement.

**Edits are discrete operations over a pure reducer.** This costs nothing now, buys undo and
a fully testable edit model, and is the one decision that makes collaboration additive
later rather than a rewrite.

**Generated files are LF-only, and device names are validated for portability.** Scripts run
inside Linux containers regardless of the host, so a CRLF from a Windows machine breaks them
confusingly. A router named `con` or `nul` cannot have a directory on Windows at all, and
`R1`/`r1` are two devices on Linux but one on macOS. These are cheap to prevent and
miserable to diagnose.

**The client sends its topology; the server does not assume its own is current.** Learned the
hard way — allocation once ran against the saved session while the browser held newer work,
returned the stale version, and the editor adopted it, clearing the canvas.

**Deployment goes through the generated files on disk**, not an in-memory object, so what
runs is exactly what an export would produce. If those diverged, a lab that worked in the
GUI could fail when shared.

**The diagram is accurate about the network, not merely suggestive of it.** Two choices
follow from that. A collision domain shared by three or more devices is drawn as its own
node rather than as lines between every pair, because in Kathará it *is* a shared medium and
not a bundle of cables. And a link terminates at the specific interface it uses, labelled,
rather than at the device in general — wiring `eth0` while configuring `eth1` is the
canonical teaching-lab fault, and a diagram that omits the port cannot help anyone find it.
Which face an interface sits on is derived from where its peer is, so the drawing rearranges
itself as devices move instead of forcing the user to tidy it.

**Captured configuration comes from the daemon, not from disk.** FRR keeps its live
configuration in memory, and `/etc/frr/frr.conf` only matches it if somebody ran
`write memory` — which in a teaching lab is exactly what nobody does. Reading the file would
have looked like it worked while capturing nothing. Asking `vtysh` for the running
configuration also means the capture lands where Kathará copies from on the next deploy, so
resuming a hibernated lab is capture-then-deploy with no separate restore step to get wrong.

**A running lab is a snapshot, and the difference from the canvas is named, not hinted at.**
Deploying freezes the topology into containers; the canvas then moves on. The consequence
surfaced as a complaint that diagnostics were wrong: an address changed on the canvas, and
Verify links reported the old one. It could not do otherwise — it pings real containers — so
the defect was the silence, not the answer. The session keeps the topology as deployed and
the interface lists each difference in a sentence, because the question a user actually has
is *which* thing differs. Canvas position is excluded: it changes the picture, not the
network, and warning about it would teach the user to ignore the warning.

**The interface reports what is running, not what it last did.** A user can stop containers
from a terminal, and Docker stops the whole lab when it restarts or the machine sleeps — so
every status is a fresh comparison against the daemon rather than a memory of the last
deployment. The subtlety is that Docker keeps reporting a container after it dies: reading
only whether stats *exist* made a lab of dead containers look healthy, which is worse than
no status at all, because the interface then contradicts the error the user is staring at.
A stopped container is also distinct from an absent one — it still owns its name, so it
blocks the next deployment and has to be cleared rather than ignored.

A Docker restart breaks more than the lab. This application's own connection to the
daemon breaks with it, because Kathará keeps one pool of connections for the life of the
process. On Windows these are named pipes, and a dead pipe raises an error that the HTTP
library does not recognise as a dropped connection. So every call takes Kathará's manager
through one function that pings the daemon first, and opens fresh connections when the old
ones are dead (F36). Without that, a dead connection read as "no daemon, so nothing is
running": a status check then hid the exited lab, and the next deploy failed with an error
naming a Windows API call.

**The scenario folder is the document, and the export is a plain zip of it.** An earlier
design wrapped everything in a bespoke `.kgui` package holding a `topology.json` beside a
copy of the lab. That was a mistake, and an instructive one: `lab.conf` already round-trips
the entire model, because the positions and device kinds it cannot express ride in `# kgui:`
comments Kathará ignores. The stored topology was therefore a *second* source of truth, and
it silently won over an edited `lab.conf` inside the same archive. Deleting the format
removed the contradiction and, incidentally, a whole module.

What remains is a Kathará lab directory: `lab.conf`, the startup scripts, the configuration
captured from running containers, and one small `kgui.json` for the scenario's feature
toggles. The driving case is an exam — a student submits to an e-learning platform, an
instructor opens the submission — which is why saving in place is confined to the workspace
while anything crossing the machine boundary goes through the browser's own download and
upload. Letting the page name a path for the server to write to would serve those flows no
better and would hand a local server an arbitrary-write surface. And because it is an
ordinary zip of ordinary files, a student who cannot open the application on the morning of
a deadline can still read what they submitted.

**A lab that arrives from outside is met halfway.** Import accepts a zip, a folder zipped by
a file manager, or a bare `lab.conf`, and none of them will carry our conventions. What
Kathará's format cannot express is recovered from the files beside it: addressing from each
`.startup` — in the modern `ip address add` form and the Netkit-era `ifconfig` one — and
routing daemons from `/etc/frr/daemons`. Without that, an imported lab looked unaddressed
and the validator complained about addresses that were on disk all along. Device kinds,
which Kathará genuinely does not record, are guessed from FRR evidence first and naming
convention second, and the guess is presentational: it picks an icon the user can change.
A zip is imported under its file's name, and the `LAB_NAME` inside is rewritten to match.
That way the folder and the lab stay one name, which is how Kathará knows a lab: a student
who renames the exam they were given to `student.zip` gets a lab of their own (F40). The
` (1)` a browser adds to a second download is not part of the name, because it marks a copy
of the same lab. And an import never replaces a scenario already in the workspace without
asking (F39).

**The layout is laid out, not simulated.** A foreign lab has no coordinates, so every device
would land on one point. A force-directed spring model is the usual reach and the wrong
tool: it optimises for even edge lengths, does nothing about crossings — which is what makes
a diagram unreadable — and is unstable, so reopening your own work rearranges it. This uses
the middle of the classical Sugiyama method instead: layer by distance from the graph's
centre, then order each layer by the barycentre of its neighbours. It is deterministic, and
its claim is measured rather than asserted — the test suite counts crossings, and it was
that measurement which caught barycentre ordering *increasing* them on a dense graph until
the best pass was kept rather than the last.

**Stopping someone else's work requires consent.** Kathará derives a lab's identity from a
hash of its *name*, so two labs called `untitled` in different folders are one lab to it.
From inside a deploy, a routine redeploy and the destruction of an unrelated lab are
indistinguishable — so the deploy reports the conflict and changes nothing until confirmed.
A device running under our name but absent from our topology is the signal that another lab
holds it, and is warned about specifically. The one exception is a lab whose containers
have *all* exited, as after a Docker restart: Deploy removes them without asking. Nothing
runs in them, so there is nothing to capture, and asking would offer a choice with only one
useful answer. If any device is still running, Deploy asks.

**So a lab has one name, and it is three things at once.** It is the name in the header, the
scenario's folder, and, through that hash, the containers Kathará runs. Until the tester's
notes on step 3E.2 these could drift apart. A folder was named by a transformation of the
lab name (`base exam` became `base-exam`). Renaming a lab in the header left its folder
where it was. And nothing stopped two folders from holding labs of the same name, which is
exactly the case the consent prompt above was built to survive. They are now one thing (F34):

- The folder is the lab's name exactly, so the name is restricted to what every filesystem
  accepts: letters in any script, digits, spaces, dashes and underscores.
- A name that another scenario in the workspace already has is refused as it is typed.
- Saving a renamed lab renames its folder, keeping a captured `frr.conf` and anything else
  inside.
- Deploying is saving, into that same folder. A lab renamed and deployed without being
  saved used to run from its old folder under its new name.

The consent prompt remains, for labs started from elsewhere, but inside the workspace the
clash it guards against can no longer be created.

## 6. How it is verified

Three layers, because each catches what the others cannot:

1. **A pure domain core** — model, codec, addressing, naming — with no Docker, filesystem or
   network. Most of the logic, tested in milliseconds on all three operating systems.
2. **Cross-validation against Kathará's own parser.** Testing our writer against our reader
   proves only self-consistency; feeding generated labs to `LabParser` proves compatibility.
3. **Integration against a real Docker daemon** — deploy, ping, retrieve, undeploy — including
   a deliberately broken link, so the diagnostics are known to detect a fault rather than
   merely to run.

Accessibility is checked from both ends: `axe-core` for structure, roles and naming, and a
Python test asserting the palette's contrast ratios. That second one exists because **axe
cannot evaluate colour contrast under jsdom** — it needs a real canvas — so a clean automated
run is not a contrast pass. Manual screen reader testing was planned, and dropped on
2026-10-25 by the user's decision (D10): screen readers are out of scope. The ARIA structure
axe checks stays, because it costs nothing and the tree is also the keyboard path, but it is
not claimed to work with a screen reader. The application makes no sound, so nothing is
needed for hearing.

### A fourth layer: a scripted manual run, and what it found

The three automated layers cannot see what a person sees: whether a click lands, whether a
dragged node stays put, whether a message reaches the screen. So the application is also run
by hand against a written procedure, `docs/TEST-PROCEDURE-WINDOWS.md`. It has 121 steps in
eleven sections (128 until the seven screen-reader steps were dropped by D10), one per capability of the specification, and each step states its expected
result before it is run. The tester ticks a step or writes down, in their own words, what
happened instead.

It has been run on three machines: Windows 10, Windows 11 and macOS. By 2026-10-24, 56 steps
had passed: sections 0–2 and the first half of section 3. By 2026-10-25, 95 of 121 had
passed: sections 0–6, with the keyboard steps left untested, and exam mode. Every defect it
reported is traced in three places. The tester's words go on the step's `Notes:` line or in
`bugs/bugs.txt`. The cause and fix go in a numbered finding in `PLAN.md`. The step is then
retested by hand, and the result is noted under the original report.

The striking result is how much the automated suite missed. Every finding from F20 to F29,
and F32 to F35, fourteen in all, came from this run, and in each case every test passed
beforehand:

- **Platform behaviour no test could reproduce.** The documented commands did not run in a
  PowerShell with the default execution policy (F21, F22), and the "open a shell" command
  failed on Windows (F20).
- **Failures that were handled but never shown on screen** (F23, and the unflagged address
  in F24). The same pattern recurred in F29: a refused edit while the lab ran explained
  itself to the keyboard but not to the mouse.
- **Pointer behaviour that jsdom does not model.** A single pixel of hand movement turned a
  click into a drag (F24). A dragged segment node snapped back (F27).
- **Kathará's own constraints, which the editor did not enforce.** Kathará refuses gaps in
  interface numbering (F26) and uppercase device names (F28), and Save wrote into another
  scenario's folder (F25).
- **State the tests set up but no user ever reaches that way.** Every test of the lock
  started from a lab deployed in the same session. None opened another scenario and came
  back, which is how the tester found a running lab shown as stopped, with no way to stop
  it (F33). Two labs with one name were tested as a conflict to warn about, never as
  something that should not be possible to create (F34).

One report is worth singling out. The tester described the read-only lock as returning
"after a second" on reload, and judged it harmless. The cause was that the design rendered
before the server had answered whether the lab was running, so for that second it could be
edited (F29). That is exactly what the lock exists to prevent. A tester's own reading of
severity is evidence, but it is not the diagnosis, and every report was traced to its
cause before it was judged.

A question found one more, F31, which no step covers. The tester asked whether Kathará sets
a loopback address in Linux or in `vtysh`. It can be either, and capture had been built for
the first only. An address set in `vtysh` was therefore captured into both `frr.conf` and
`.startup`, and after that removing it in the editor had no effect. Explaining the domain
to a user turned out to be a way of reviewing the design against it.

Step 4B.2 found F37, and with it an asymmetry. Capture had been built to *change* an
address, never to *remove* one: it overwrote the design with whatever the container
reported, and an address deleted inside the container left nothing to report, so it
survived every capture. The status check had the same blind spot. The test failed for a
reason one step removed from the defect. Verify links pings from the containers to the
addresses in the design, so it was testing an address that no longer existed. Two
decisions followed:
- **Verify links asks before it runs, but only when the answer matters.** It reads the
  containers first and offers a capture only if their addresses differ from the design. A
  question asked every time, whatever the state, teaches the user to click through it.
- **Silence about a limit is a defect even when the limit is right.** The design holds one
  address per interface. Secondary addresses are real (renumbering, VRRP), but rare in
  these labs, and supporting them would touch allocation, validation, verification and
  generation. So the limit stays, and the capture now names what it left out, telling
  apart an address FRR keeps in `frr.conf` from one that is really lost.

The same pass revised the specification itself. Four of its scenarios asked for something
the accessibility requirements argue against: links glowing green and red, a
colour-blindness profile to switch on, an in-app zoom control, and a theme chosen in a
settings menu. A fifth had `lab.conf` text pasted into a box, where the application
imports a file. What was built instead is each status in a word and a symbol, a
palette that is safe by default, the browser's and the system's own scaling, and the
system's dark and contrast themes. Where the built application was the better answer,
the document was changed to match it, and git keeps the original wording.

Where a defect could be pinned down by a test once it was understood, a test was added: F26
is now checked against Kathará's own parser. Where it could not, the fix was confirmed by
hand: F24's clicks and F27's drag. That is the stated reason the manual layer exists rather
than an omission in the automated ones.

## 7. Scope, and what was left out

Capability 7 and the AI assistant are deliberately unimplemented. The supervisor judged the
original requirement list too large for an engineering thesis and directed the work toward
capabilities 1–5 plus usability. The value here is a refined, reliable, accessible core
rather than a broad set of unfinished features.

What each would need is nevertheless accounted for. Collaboration has a real substrate
already in place: edits are discrete operations over a pure reducer, which is what a CRDT or
an operational-transform layer would sit on, so adding it later is additive rather than a
rewrite of the editor. The AI assistant has no code at all — the relevant claim is narrower,
that the same operation log is the interface an assistant would act through, proposing
operations that the existing validation and undo already handle. That is a design argument
about where the seam falls, not a component sitting in the tree.

### Where this sits against existing tools

The starting point was not an empty field. The **Netkit Lab Generator**, linked from
Kathará's own site, already generates labs through a graphical interface, and it was
evaluated hands-on before this project's requirements were fixed. Its limitations are the
main source of those requirements, so it is worth setting out properly rather than
dismissing.

**What it does well.** The forms are clear and well structured: for anyone who has used
Kathará, there is no doubt what belongs in each field. Interfaces, addresses and gateways
are entered directly and written into the generated `.startup` files. Routing protocols —
RIP, OSPF, BGP — are enabled with a single tick under *Additional functions*, which is a
genuinely efficient way to handle a common need.

**Where it falls short**, and what each shortcoming became here:

| Observed limitation | Requirement it produced |
|---|---|
| Interaction is entirely form-based; the forms are dense, and building a topology means filling fields rather than drawing | **FR-02** — connect devices by direct interaction, not by describing them |
| Topology and addressing plan are entangled in one form, *all in one* | Addressing is a separate, optional assistant (**FR-06**, **FR-07**) that can be withdrawn for an exam (**FR-27**) |
| **Existing labs cannot be imported.** It is a generator of new files, not a tool for working with labs that already exist | **FR-11**, **FR-12** — import and export must be first-class, and reach the interface |
| Two export routes exist, but only one produces something the tool can read back | **FR-13** — a round trip must not lose anything, including options the model does not interpret |
| The topology preview stays blank until enough fields are filled, so the drawing follows the form rather than leading it | **FR-01**, **FR-30** — the diagram is the document, and its layout persists |
| No connection to Docker at all: the output is a ZIP the user must unpack and start by hand | **FR-16**, **FR-17** — deploy and stop from the application |
| No way to recover configuration typed inside a running container | **FR-24** — pull running configuration back out |
| Modifying a scenario means deleting, rethinking, re-exporting and reopening; it corresponds badly to how a scenario is actually developed | **FR-14**, **FR-15**, **FR-21** — iterate on a saved project, derive variants, and be told when the running lab has drifted from the design (read-only while deployed, D9) |

The last is the important one. The tool is not *wrong*; it simply assumes a scenario is
written once. The observed reality — an exam judged too easy, a link that creates an
unintended loop, a lab extended the following week — is that a scenario is rewritten
repeatedly, and that is where the time goes.

**The other tools** each cover a different part of the ground:

| Tool | Does | Doesn't |
|---|---|---|
| NetGUI-Kathará | topology design, 3D visualisation export | no live state, no deployment loop |
| Katharsis | start and stop labs, shell into containers | no editor |
| net-vis | renders an existing `lab.conf` as a diagram | read-only |

Katharsis and net-vis are each roughly one half of what is needed — running a lab, or
drawing one — without the other.

**The gap.** No existing tool combines visual editing, one-click deployment, extraction of
live configuration and accessibility. It is the combination that matters: closing the loop
from an idea to a running network and back again, rather than serving one point on that
path. That combination is what this work contributes.
