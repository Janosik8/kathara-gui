"""Labs from Netkit and Quagga days, imported (F60).

Netkit's published labs keep each routing daemon's configuration in its own
file under ``<device>/etc/zebra``, Kathará's Quagga labs under
``<device>/etc/quagga``. Before F60 neither's daemons were read, a Netkit lab's
areas were not found at all, and an imported router with no image in
``lab.conf`` deployed as Kathará's ``kathara/base``, which has no routing.
"""

from __future__ import annotations

from pathlib import Path

from kathara_gui.domain.codec.startup import render_startup
from kathara_gui.domain.model import Topology
from kathara_gui.project.labdir import write_lab
from kathara_gui.project.scenario import adopt_legacy_routing, load

DAEMONS = "# Daemons are: bgpd zebra ospfd ospf6d ripd ripngd\nzebra=yes\nbgpd=no\nospfd=yes\n"


def _netkit_ospfd(router_id: str, networks: str, cost: str = "") -> str:
    """An ospfd.conf as Netkit's labs have it: unindented, with the old spellings."""
    return (
        "!\nhostname ospfd\npassword zebra\nenable password zebra\n!\n"
        f"{cost}"
        "router ospf\n"
        f"ospf router-id {router_id}\n"
        f"{networks}"
        "redistribute connected\n!\nlog file /var/log/zebra/ospfd.log\n!\n"
    )


def netkit_lab(folder: Path) -> Path:
    """Three routers in two areas, with pc1 on r2's stub, in Netkit's layout."""
    (folder).mkdir(parents=True)
    (folder / "lab.conf").write_text(
        "LAB_DESCRIPTION=\"OSPF, two areas\"\n\n"
        "bb[0]=A\nbb[1]=B\n\nr1[0]=A\n\nr2[0]=B\nr2[1]=C\n\npc1[0]=C\n",
        encoding="utf-8",
    )
    startups = {
        "bb": "ifconfig eth0 10.0.0.1 netmask 255.255.255.0 up\n"
        "ifconfig eth1 100.0.0.1 netmask 255.255.255.252 up\n/etc/init.d/zebra start\n",
        "r1": "ifconfig eth0 10.0.0.2 netmask 255.255.255.0 up\n/etc/init.d/zebra start\n",
        "r2": "ifconfig eth0 100.0.0.2 netmask 255.255.255.252 up\n"
        "ifconfig eth1 200.0.0.1 netmask 255.255.255.0 up\n/etc/init.d/zebra start\n",
        "pc1": "ifconfig eth0 200.0.0.10 netmask 255.255.255.0 up\n",
    }
    for name, text in startups.items():
        (folder / f"{name}.startup").write_text(text, encoding="utf-8")
    configs = {
        "bb": _netkit_ospfd(
            "9.9.9.9",
            "network 10.0.0.0/24 area 0.0.0.0\nnetwork 100.0.0.0/30 area 1.1.1.1\n",
            cost="interface eth0\nospf cost 90\n!\n",
        ),
        "r1": _netkit_ospfd("9.9.9.1", "network 10.0.0.0/24 area 0.0.0.0\n"),
        "r2": _netkit_ospfd(
            "9.9.9.2",
            "network 100.0.0.0/30 area 1.1.1.1\nnetwork 200.0.0.0/24 area 1.1.1.1\n",
        ),
    }
    for name, text in configs.items():
        zebra = folder / name / "etc" / "zebra"
        zebra.mkdir(parents=True)
        (zebra / "daemons").write_text(DAEMONS, encoding="utf-8")
        (zebra / "ospfd.conf").write_text(text, encoding="utf-8")
    return folder


def _name_image(folder: Path, image: str) -> None:
    lab_conf = folder / "lab.conf"
    text = lab_conf.read_text(encoding="utf-8")
    for name in ("bb", "r1", "r2"):
        text += f'{name}[image]="{image}"\n'
    lab_conf.write_text(text, encoding="utf-8")


def quagga_lab(folder: Path) -> Path:
    """The same lab as Kathará's Quagga labs have it: an image named, /etc/quagga."""
    netkit_lab(folder)
    _name_image(folder, "kathara/quagga")
    for name in ("bb", "r1", "r2"):
        (folder / name / "etc" / "zebra").rename(folder / name / "etc" / "quagga")
    return folder


def frr_named_lab(folder: Path) -> Path:
    """The Netkit lab with its routers naming kathara/frr, as an instructor might
    have edited it: Quagga's files, an FRR image."""
    netkit_lab(folder)
    _name_image(folder, "kathara/frr")
    return folder


# -- recognising ---------------------------------------------------------------


def test_netkit_daemons_and_areas_are_recognised(tmp_path: Path) -> None:
    loaded = load(netkit_lab(tmp_path / "lab"))
    nodes = {n.name: n for n in loaded.topology.nodes}

    for name in ("bb", "r1", "r2"):
        assert nodes[name].kind == "router"
        assert sorted(nodes[name].daemons) == ["ospfd", "zebra"]
    assert {z.name for z in loaded.topology.zones} == {"Area 0", "Area 1.1.1.1"}


def test_quagga_daemons_and_areas_are_recognised(tmp_path: Path) -> None:
    loaded = load(quagga_lab(tmp_path / "lab"))
    nodes = {n.name: n for n in loaded.topology.nodes}

    assert sorted(nodes["bb"].daemons) == ["ospfd", "zebra"]
    assert {z.name for z in loaded.topology.zones} == {"Area 0", "Area 1.1.1.1"}


# -- images ------------------------------------------------------------------------


def test_routing_files_in_etc_zebra_mean_quagga(tmp_path: Path) -> None:
    """A path of /etc/zebra means the lab was written for Quagga."""
    nodes = {n.name: n for n in load(netkit_lab(tmp_path / "lab")).topology.nodes}

    assert nodes["bb"].image == "kathara/quagga"
    assert nodes["pc1"].image == "kathara/base"


def test_routing_files_in_etc_quagga_mean_quagga(tmp_path: Path) -> None:
    folder = quagga_lab(tmp_path / "lab")
    lab_conf = folder / "lab.conf"
    lines = lab_conf.read_text(encoding="utf-8").splitlines()
    lab_conf.write_text(
        "".join(line + "\n" for line in lines if "[image]" not in line), encoding="utf-8"
    )
    nodes = {n.name: n for n in load(folder).topology.nodes}

    assert nodes["bb"].image == "kathara/quagga"


def test_a_router_with_no_image_and_no_quagga_files_gets_frr(tmp_path: Path) -> None:
    """Kathará's own default, kathara/base, has no routing: a router given none
    used to deploy as a host."""
    folder = netkit_lab(tmp_path / "lab")
    for name in ("bb", "r1", "r2"):
        (folder / name / "etc" / "zebra").rename(folder / name / "etc" / "frr")
    nodes = {n.name: n for n in load(folder).topology.nodes}

    assert nodes["bb"].image == "kathara/frr"
    assert nodes["pc1"].image == "kathara/base"


def test_an_image_the_lab_names_is_kept(tmp_path: Path) -> None:
    nodes = {n.name: n for n in load(frr_named_lab(tmp_path / "lab")).topology.nodes}

    assert nodes["bb"].image == "kathara/frr"
    assert nodes["pc1"].image == "kathara/base"


def test_the_image_reaches_lab_conf(tmp_path: Path) -> None:
    loaded = load(netkit_lab(tmp_path / "lab"))
    write_lab(loaded.topology, tmp_path / "out")

    lab_conf = (tmp_path / "out" / "lab.conf").read_text(encoding="utf-8")
    assert 'bb[image]="kathara/quagga"' in lab_conf
    assert 'pc1[image]="kathara/base"' in lab_conf


# -- Netkit on Quagga ----------------------------------------------------------------


def test_netkit_files_are_copied_unchanged_where_quagga_reads_them(tmp_path: Path) -> None:
    folder = netkit_lab(tmp_path / "lab")
    original = (folder / "bb" / "etc" / "zebra" / "ospfd.conf").read_bytes()

    adopted = adopt_legacy_routing(folder)

    assert adopted.quagga == ["bb", "r1", "r2"]
    assert adopted.frr == []
    assert (folder / "bb" / "etc" / "quagga" / "ospfd.conf").read_bytes() == original
    assert (folder / "bb" / "etc" / "quagga" / "daemons").is_file()
    # The originals are kept, and nothing is written for FRR.
    assert (folder / "bb" / "etc" / "zebra" / "ospfd.conf").is_file()
    assert not (folder / "bb" / "etc" / "frr").exists()


def test_a_quagga_lab_is_left_as_it_is(tmp_path: Path) -> None:
    folder = quagga_lab(tmp_path / "lab")

    adopted = adopt_legacy_routing(folder)

    assert adopted.quagga == [] and adopted.frr == []
    assert not (folder / "bb" / "etc" / "frr").exists()


# -- converting to FRR, for a router that names it -----------------------------------


def test_a_router_naming_frr_is_given_an_frr_conf(tmp_path: Path) -> None:
    folder = frr_named_lab(tmp_path / "lab")

    adopted = adopt_legacy_routing(folder)
    assert adopted.frr == ["bb", "r1", "r2"]
    assert adopted.quagga == []

    frr_conf = (folder / "bb" / "etc" / "frr" / "frr.conf").read_text(encoding="utf-8")
    assert "network 100.0.0.0/30 area 1.1.1.1" in frr_conf
    # Each daemon's own hostname, the telnet passwords and a log in a folder
    # the FRR image does not have are left out.
    assert "hostname" not in frr_conf
    assert "password" not in frr_conf
    assert "log file" not in frr_conf
    # The old spelling under an interface, FRR's under it; router ospf's own kept.
    assert "ip ospf cost 90" in frr_conf
    assert "\nospf router-id 9.9.9.9" in frr_conf
    daemons = (folder / "bb" / "etc" / "frr" / "daemons").read_text(encoding="utf-8")
    assert "ospfd=yes" in daemons and "zebra=yes" in daemons and "bgpd=no" in daemons
    # The originals are kept.
    assert (folder / "bb" / "etc" / "zebra" / "ospfd.conf").is_file()


def test_an_existing_frr_conf_is_not_replaced(tmp_path: Path) -> None:
    folder = frr_named_lab(tmp_path / "lab")
    (folder / "r1" / "etc" / "frr").mkdir(parents=True)
    (folder / "r1" / "etc" / "frr" / "frr.conf").write_text("router ospf\n", encoding="utf-8")

    assert "r1" not in adopt_legacy_routing(folder).frr
    assert (folder / "r1" / "etc" / "frr" / "frr.conf").read_text() == "router ospf\n"


def test_zebra_conf_comes_first(tmp_path: Path) -> None:
    folder = frr_named_lab(tmp_path / "lab")
    zebra = folder / "r1" / "etc" / "zebra"
    (zebra / "zebra.conf").write_text("hostname zebra\ninterface eth0\n!\n", encoding="utf-8")

    adopt_legacy_routing(folder)

    frr_conf = (folder / "r1" / "etc" / "frr" / "frr.conf").read_text(encoding="utf-8")
    assert frr_conf.index("interface eth0") < frr_conf.index("router ospf")


# -- deploying on Quagga ---------------------------------------------------------------


def test_a_quagga_image_starts_quagga_and_reads_its_own_daemons(tmp_path: Path) -> None:
    """Saving a Kathará Quagga lab used to replace "systemctl start quagga"
    with FRR's, which that image does not have. A Netkit lab runs the same way."""
    for lab in (quagga_lab(tmp_path / "quagga"), netkit_lab(tmp_path / "netkit")):
        adopt_legacy_routing(lab)
        loaded = load(lab)
        bb = next(n for n in loaded.topology.nodes if n.name == "bb")

        assert "systemctl start quagga" in render_startup(bb)
        assert "frr" not in render_startup(bb)

        out = tmp_path / "out" / lab.name
        write_lab(loaded.topology, out)
        assert "ospfd=yes" in (out / "bb" / "etc" / "quagga" / "daemons").read_text()
        assert not (out / "bb" / "etc" / "frr").exists()


# -- a daemon ticked on a Quagga router (F62) ------------------------------------------


def _tick(topology: Topology, device: str, *daemons: str) -> Topology:
    nodes = [
        n.model_copy(update={"daemons": [*n.daemons, *daemons]}) if n.name == device else n
        for n in topology.nodes
    ]
    return topology.model_copy(update={"nodes": nodes})


def test_a_daemon_ticked_on_quagga_gets_the_file_quagga_needs_to_start_it(
    tmp_path: Path,
) -> None:
    """kathara/quagga starts a daemon only if its own .conf exists; without one,
    vtysh accepts "router bgp 1" and drops it (measured in the image)."""
    folder = netkit_lab(tmp_path / "lab")
    adopt_legacy_routing(folder)
    quagga = folder / "bb" / "etc" / "quagga"
    ospfd = (quagga / "ospfd.conf").read_bytes()

    topology = _tick(load(folder).topology, "bb", "bgpd", "ripd")
    write_lab(topology, folder)

    for daemon in ("bgpd", "ripd"):
        text = (quagga / f"{daemon}.conf").read_text(encoding="utf-8")
        assert text.startswith("!") and f"starts {daemon}" in text
    assert "bgpd=yes" in (quagga / "daemons").read_text(encoding="utf-8")
    # What was imported or captured is never replaced.
    assert (quagga / "ospfd.conf").read_bytes() == ospfd
    # Nothing for a daemon left unticked, nor on the other routers.
    assert not (quagga / "ospf6d.conf").exists()
    assert not (folder / "r1" / "etc" / "quagga" / "bgpd.conf").exists()


def test_an_frr_router_gets_no_quagga_files(tmp_path: Path) -> None:
    folder = tmp_path / "lab"
    (folder / "r1" / "etc" / "frr").mkdir(parents=True)
    (folder / "lab.conf").write_text('r1[0]="A"\nr1[image]="kathara/frr"\n', encoding="utf-8")
    (folder / "r1" / "etc" / "frr" / "frr.conf").write_text("router bgp 1\n", encoding="utf-8")

    topology = _tick(load(folder).topology, "r1", "bgpd")
    write_lab(topology, folder)

    assert not (folder / "r1" / "etc" / "quagga").exists()
