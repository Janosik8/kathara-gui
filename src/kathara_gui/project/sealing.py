"""The sealed export: a scenario's zip encrypted with a password (note 1).

An instructor sends an exam ahead of time, sealed, and gives out the password
when the exam starts. Until then the file cannot be read, unzipped or imported.

What this does *not* do is keep a student from turning the exam's switches
back on. An author's lock on them was built and removed (F48, F51): the
switches live in ``kgui.json`` on the student's own machine, and a copy of the
original put back before handing in leaves nothing for any check to find.

Standard constructions only: scrypt for the key, AES-256-GCM for the seal.
"""

from __future__ import annotations

import hashlib
import os

#: scrypt work factors. n = 2**14 takes about 50 ms here: slow enough to make
#: guessing a password expensive, fast enough not to be noticed once.
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}

#: The first bytes of a sealed export, so an import can tell one from a zip.
SEAL_MAGIC = b"KGUI-SEALED-1\n"
SEAL_EXTENSION = ".kgx"
_SALT, _NONCE = 16, 12


class WrongPassword(Exception):
    """The password given does not open this file."""


def _key(password: str, salt: bytes) -> bytes:
    if not password:
        raise WrongPassword("A password is needed.")
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, **_SCRYPT)


def is_sealed(payload: bytes) -> bool:
    return payload.startswith(SEAL_MAGIC)


def seal(payload: bytes, password: str) -> bytes:
    """``payload`` encrypted with ``password``: magic, salt, nonce, ciphertext."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    salt, nonce = os.urandom(_SALT), os.urandom(_NONCE)
    sealed = AESGCM(_key(password, salt)).encrypt(nonce, payload, SEAL_MAGIC)
    return SEAL_MAGIC + salt + nonce + sealed


def unseal(blob: bytes, password: str) -> bytes:
    """The original payload, or :class:`WrongPassword` (also for a damaged file)."""
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    body = blob[len(SEAL_MAGIC) :]
    salt, nonce, sealed = body[:_SALT], body[_SALT : _SALT + _NONCE], body[_SALT + _NONCE :]
    try:
        return AESGCM(_key(password, salt)).decrypt(nonce, sealed, SEAL_MAGIC)
    except InvalidTag as exc:
        raise WrongPassword(
            "That password does not open this file, or the file is damaged."
        ) from exc
