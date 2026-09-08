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
| 5 | State extraction | Kathará's `retrieve_files` pulls configuration out of live containers (proven in the Phase 0 spike) |
| 6 | Accessibility | An ARIA tree that is a genuine parallel interface to the canvas, not a summary of it; palette contrast asserted in tests |
| 7 | Collaboration | **Not built.** Edits are discrete operations over a pure reducer, which is the substrate a CRDT would need |
| 8 | Exam mode | `features.py`, enforced server-side |
| 9 | Auto-layout for imports | Positions round-trip through `lab.conf` comments; a layout algorithm handles files that have none |

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

A second benefit: users get *their* assistive technology, not whatever a bundled toolkit
happens to support.

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

**Stopping someone else's work requires consent.** Kathará derives a lab's identity from a
hash of its *name*, so two labs called `untitled` in different folders are one lab to it.
From inside a deploy, a routine redeploy and the destruction of an unrelated lab are
indistinguishable — so the deploy reports the conflict and changes nothing until confirmed.
A device running under our name but absent from our topology is the signal that another lab
holds it, and is warned about specifically.

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
run is not a contrast pass. Manual screen reader testing remains necessary and is planned.

## 7. Scope, and what was left out

Capability 7 and the AI assistant are deliberately unimplemented. The supervisor judged the
original requirement list too large for an engineering thesis and directed the work toward
capabilities 1–5 plus usability. The value here is a refined, reliable, accessible core
rather than a broad set of unfinished features.

Both retain seams: an `AIProvider` protocol with a null implementation, and the operation log
described above. Neither is a stub pretending to be a feature — they are the shapes the code
would need, chosen now so that adding either later is additive.

### Where this sits against existing tools

| Tool | Does | Doesn't |
|---|---|---|
| Netkit-Lab-Generator (official) | form-based config, topology preview | no drag-drop, no deploy, no config retrieval |
| NetGUI-Kathará | topology design | no live state |
| Katharsis | start/stop labs, container shell | no editor |
| net-vis | parses `lab.conf` to a diagram | read-only |

Each covers part of the ground. None combines visual editing, one-click deployment, live
configuration extraction and accessibility — and it is the combination, closing the loop from
idea to running network and back, that this work contributes.
