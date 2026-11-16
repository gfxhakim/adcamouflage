"""The product's display name, and a cleaner for older names in saved text.

Text saved before a rename (site text and SEO fields from Admin, email
templates, the support bot's old replies) still holds the old name.
``rebrand`` swaps it for the current one when the text is read, and the
cleaned text is what gets stored on the next save. Text a person wrote to be
sent as written (announcements, group emails, chat messages) is not touched.
"""

from __future__ import annotations

import re
from typing import Any

BRAND = "ProteusFlow"
SLOGAN = "Seamless adaptation. Peak efficiency."

# An old name standing on its own as a word, with or without a space, dash or
# underscore inside it. Left alone when it is part of an address, a link or a
# file name: support@blucloack.online, blucloack@mail.com, blucloack.io,
# /brand/blucloacking-mark.png, ?ref=blucloack, adcamouflage.db.
# Keep in step with frontend/lib/legacyWording.ts: the two must agree, and
# re.ASCII makes \w mean the same here as in JavaScript.
_GAP = r"[ \t\r\n\u00a0_-]{0,2}"
_OLD_NAMES = re.compile(
    r"(?<![@/.=\w-])"
    rf"(?:Blu{_GAP}Clo(?:a)?c?k(?:ing)?|Blu{_GAP}Editor|Blu{_GAP}Camouflage|Ad{_GAP}Camouflage)"
    r"(?![\w.-]*@)(?![\w-]*\.[a-z0-9]{2})(?!\w)",
    re.IGNORECASE | re.ASCII,
)


def rebrand(text: str) -> str:
    """``text`` with any earlier product name replaced by :data:`BRAND`."""

    return _OLD_NAMES.sub(BRAND, text)


def _clean(value: Any) -> Any:
    return rebrand(value) if isinstance(value, str) else value


def rebrand_site_content(document: dict[str, Any]) -> dict[str, Any]:
    """A copy of an Admin site-content document with old names replaced.

    Only the wording people read is touched: page text, the tab title and
    search/share description, button labels, image alt text and reviews.
    Links, image and icon addresses, colours, CSS and layout are left exactly
    as saved.
    """

    out = dict(document)
    text = document.get("text")
    if isinstance(text, dict):
        out["text"] = {key: _clean(value) for key, value in text.items()}
    meta = document.get("meta")
    if isinstance(meta, dict):
        out["meta"] = {key: _clean(value) if key in ("title", "description") else value for key, value in meta.items()}
    link = document.get("link")
    if isinstance(link, dict):
        out["link"] = {
            key: {**value, "label": _clean(value["label"])} if isinstance(value, dict) and "label" in value else value
            for key, value in link.items()
        }
    media = document.get("media")
    if isinstance(media, dict):
        out["media"] = {
            key: {**value, "alt": _clean(value["alt"])} if isinstance(value, dict) and "alt" in value else value
            for key, value in media.items()
        }
    reviews = document.get("reviews")
    if isinstance(reviews, list):
        out["reviews"] = [
            {**item, **{field: _clean(item[field]) for field in ("name", "handle", "body") if field in item}}
            if isinstance(item, dict)
            else item
            for item in reviews
        ]
    return out
