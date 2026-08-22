"""Phase 0 vertical spike: prove the whole Kathara integration path works.

Exercises, end to end, every Kathara API this project depends on:

    build a 2-router lab  ->  deploy  ->  exec a ping across the link
                          ->  retrieve a runtime-generated file  ->  undeploy

Capability 5 (state extraction) is the risky one: if ``retrieve_files`` cannot
pull a file that was created *while the container was running*, the design
falls back to ``docker-py``. Finding that out here costs a day; finding it out
in Phase 5 costs a fortnight.

Run:  uv run python scripts/spike_vertical.py
"""

from __future__ import annotations

import sys
import tempfile
import traceback
from pathlib import Path

from Kathara.manager.Kathara import Kathara
from Kathara.model.Lab import Lab

from kathara_gui.kathara.readiness import wait_for_lab

LAB_NAME = "kgui-phase0-spike"
IMAGE = "kathara/base"

R1_IP = "10.0.0.1/24"
R2_IP = "10.0.0.2/24"
R2_ADDR = "10.0.0.2"

# Written by the running container, then pulled back out. Proves we can
# recover state that exists only at runtime.
RUNTIME_FILE = "/tmp/kgui_runtime_state.txt"


def step(n: int, text: str) -> None:
    print(f"\n[{n}] {text}", flush=True)


def build_lab() -> Lab:
    lab = Lab(LAB_NAME)
    r1 = lab.new_machine("r1", **{"image": IMAGE})
    r2 = lab.new_machine("r2", **{"image": IMAGE})

    # Both ends on collision domain "A" -> a direct point-to-point link.
    lab.connect_machine_to_link(r1.name, "A")
    lab.connect_machine_to_link(r2.name, "A")

    lab.create_startup_file_from_string(r1, f"ip link set eth0 up\nip addr add {R1_IP} dev eth0\n")
    lab.create_startup_file_from_string(r2, f"ip link set eth0 up\nip addr add {R2_IP} dev eth0\n")
    return lab


def main() -> int:
    manager = Kathara.get_instance()
    print(f"Kathara manager: {manager.get_formatted_manager_name()}")

    step(1, "Building lab in memory")
    lab = build_lab()
    print(f"    machines={sorted(lab.machines)}  links={sorted(lab.links)}")

    deployed = False
    try:
        step(2, f"Deploying (pulls {IMAGE} on first run, may take a minute)")
        manager.deploy_lab(lab)
        deployed = True
        # Kathara's own wait=True polls stdin for a keypress, which fails
        # anywhere without a terminal (CI, a service). Poll the marker instead.
        wait_for_lab(manager, lab, timeout=120)
        print("    deployed")

        step(3, "Verifying both containers are up")
        for name in ("r1", "r2"):
            stats = next(manager.get_machine_stats(name, lab=lab), None)
            print(f"    {name}: {'running' if stats else 'NOT FOUND'}")
            if stats is None:
                raise RuntimeError(f"{name} did not start")

        step(4, f"Capability 4 — ping r1 -> {R2_ADDR}")
        stdout, stderr, exit_code = manager.exec(
            "r1", ["ping", "-c", "3", "-W", "2", R2_ADDR], lab=lab, wait=False, stream=False
        )
        out = stdout.decode(errors="replace") if isinstance(stdout, bytes) else str(stdout)
        print("    " + "\n    ".join(out.strip().splitlines()[-3:] or ["<no output>"]))
        if exit_code != 0:
            err = stderr.decode(errors="replace") if isinstance(stderr, bytes) else str(stderr)
            raise RuntimeError(f"ping failed (exit {exit_code}): {err.strip()}")
        print("    PING OK — diagnostics path works")

        step(5, "Generating runtime state inside the container")
        manager.exec(
            "r1", ["sh", "-c", f"ip addr show > {RUNTIME_FILE}"], lab=lab, wait=False, stream=False
        )

        step(6, f"Capability 5 — retrieve_files({RUNTIME_FILE})")
        with tempfile.TemporaryDirectory() as tmp:
            dst = Path(tmp) / "pulled"
            dst.mkdir()
            machine = lab.get_machine("r1")
            manager.retrieve_files(machine, RUNTIME_FILE, str(dst))

            pulled = [p for p in dst.rglob("*") if p.is_file()]
            if not pulled:
                raise RuntimeError(f"retrieve_files produced nothing in {dst}")
            content = pulled[0].read_text(errors="replace")
            print(f"    pulled {pulled[0].name} ({len(content)} bytes)")
            print("    " + "\n    ".join(content.strip().splitlines()[:4]))
            if "10.0.0.1" not in content:
                raise RuntimeError("pulled file does not contain the configured address")
            print("    RETRIEVE OK — state extraction works via the Kathara API")

    except Exception:
        print("\n--- SPIKE FAILED ---", file=sys.stderr)
        traceback.print_exc()
        return 1
    finally:
        if deployed:
            step(7, "Undeploying")
            try:
                manager.undeploy_lab(lab=lab)
                print("    cleaned up")
            except Exception as exc:  # cleanup must not mask the real error
                print(f"    WARNING: cleanup failed: {exc}", file=sys.stderr)

    print("\n=== PHASE 0 GATE PASSED ===")
    print("deploy / exec / retrieve_files / undeploy all confirmed against the Python API.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
