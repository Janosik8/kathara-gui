"""Which assistive features are available (Capability 8, exam mode).

An instructor building a troubleshooting exam can switch off the parts of the
tool that would do the thinking for the student — the subnet calculator being
the obvious one.

**The gate must live on the server.** A UI that merely hides a button is
bypassed from the browser's developer tools in seconds, and this is a browser
application, so a student sitting an exam has those tools one keystroke away.
Hiding the control is a courtesy to honest users; refusing the request is what
actually enforces the rule.

Phase 6 adds the editing interface and persists the flags into the `.kgui`
package. This module is the enforcement point they will both use.
"""

from __future__ import annotations

from fastapi import HTTPException, status
from pydantic import BaseModel, Field


class Features(BaseModel):
    """Assistive features an instructor can withdraw for a given scenario."""

    subnet_calculator: bool = Field(
        default=True,
        description="Automatic subnet allocation. Off forces students to plan addressing "
        "themselves.",
    )
    addressing_validation: bool = Field(
        default=True,
        description="Reporting of addressing conflicts. Off forces students to find their "
        "own mistakes.",
    )
    infrastructure_verification: bool = Field(
        default=True,
        description="Automated link diagnostics (Capability 4).",
    )

    def require(self, name: str) -> None:
        """Refuse the request when ``name`` is disabled for this scenario.

        Raises 403 rather than 404: the endpoint exists and the caller is
        authenticated, but the scenario forbids it. The message says so, so a
        student sees a rule rather than a bug.
        """
        if not getattr(self, name, True):
            label = name.replace("_", " ")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"The {label} is disabled for this scenario.",
            )
