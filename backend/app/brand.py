"""The product's display name, and a cleaner for older names in saved text.

Text an admin saved before a rename (email templates, the email footer)
still holds the old name. ``rebrand`` swaps it for the current one when the
text is read, so nothing in the database has to be rewritten.
"""

from __future__ import annotations

import re

BRAND = "ProteusFlow"
SLOGAN = "Seamless adaptation. Peak efficiency."

# Not inside an address or link (support@blucloack.online, /brand/blucloacking-mark.png).
_OLD_NAMES = re.compile(
    r"(?<![@/.\w-])"
    r"(?:Blu[\s-]?Clo(?:a)?c?k(?:ing)?|Blu[\s-]?Editor|Blu[\s-]?Camouflage|Ad[\s-]?Camouflage)"
    r"(?![\w.-]*\.(?:online|com|png|jpg|svg)\b)(?!\w)",
    re.IGNORECASE,
)


def rebrand(text: str) -> str:
    """``text`` with any earlier product name replaced by :data:`BRAND`."""

    return _OLD_NAMES.sub(BRAND, text)
