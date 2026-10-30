"""The exam author's lock on the feature switches, and the sealed export (note 1).

An instructor switches off the subnet calculator, the addressing checks or the
link checks for an exam (Capability 8). The server already refuses what is
switched off; this module decides who may switch it back on.

**Tamper-evident, not tamper-proof.** The application runs on the student's
own machine, and the switches live in ``kgui.json`` in a folder the student
owns. Nothing local can stop a determined student from editing that file. What
can be done, and is, is to make any such edit *visible*:

- The switches are signed with a key derived from the author's password. The
  application refuses to change them until that password is given.
- A switch edited on disk no longer matches its signature. A lock deleted
  outright, or replaced by one with another password, fails to open with the
  author's password. All three show when the instructor opens the submission
  and unlocks it.

What it cannot show is a copy of the original ``kgui.json`` put back before
handing in (F51): the file is then the one the author signed. The lock was
removed for that and restored by the user's decision (D13), as a deterrent
and a record of edits made in place, not as proof that none were made.

The sealed export is the other half of the note: the exported zip encrypted
with a password, so only someone given that password can open the exam.

Standard constructions only: scrypt for keys, HMAC-SHA-256 for the signature,
AES-256-GCM for the seal.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from typing import Any

from pydantic import BaseModel

#: scrypt work factors. n = 2**14 takes about 50 ms here: slow enough to make
#: guessing a password expensive, fast enough not to be noticed once.
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}

#: The first bytes of a sealed export, so an import can tell one from a zip.
SEAL_MAGIC = b"KGUI-SEALED-1\n"
SEAL_EXTENSION = ".kgx"
_SALT, _NONCE = 16, 12


class WrongPassword(Exception):
    """The password given does not open this lock or this file."""


class ExamLock(BaseModel):
    """What ``kgui.json`` stores: never the password, nor anything it could be read from."""

    version: int = 1
    salt: str
    #: Proves a password right without storing it.
    verifier: str
    #: The switches as the author left them, signed.
    signature: str


def _key(password: str, salt: bytes) -> bytes:
    if not password:
        raise WrongPassword("A password is needed.")
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, **_SCRYPT)


def _mac(key: bytes, purpose: bytes, message: bytes = b"") -> str:
    return hmac.new(key, purpose + b"\0" + message, hashlib.sha256).hexdigest()


def _canonical(features: dict[str, Any]) -> bytes:
    return json.dumps(features, sort_keys=True, separators=(",", ":")).encode("utf-8")


def lock(password: str, features: dict[str, Any]) -> ExamLock:
    """A new lock, by ``password``, on the switches as they are."""
    salt = os.urandom(_SALT)
    key = _key(password, salt)
    return ExamLock(
        salt=salt.hex(),
        verifier=_mac(key, b"verify"),
        signature=_mac(key, b"features", _canonical(features)),
    )


def open_lock(exam_lock: ExamLock, password: str) -> bytes:
    """The author's key, or :class:`WrongPassword`."""
    key = _key(password, bytes.fromhex(exam_lock.salt))
    if not hmac.compare_digest(_mac(key, b"verify"), exam_lock.verifier):
        raise WrongPassword("That is not the exam author's password.")
    return key


def intact(exam_lock: ExamLock, key: bytes, features: dict[str, Any]) -> bool:
    """Whether the switches are still as the author signed them."""
    return hmac.compare_digest(_mac(key, b"features", _canonical(features)), exam_lock.signature)


def resign(exam_lock: ExamLock, key: bytes, features: dict[str, Any]) -> ExamLock:
    """The same lock over switches the author has just changed."""
    return exam_lock.model_copy(update={"signature": _mac(key, b"features", _canonical(features))})


# -- the sealed export ----------------------------------------------------------


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
