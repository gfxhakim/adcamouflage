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


def _any_case(word: str) -> str:
    return "".join(f"[{letter.upper()}{letter.lower()}]" for letter in word)


# Every earlier product name, in any mix of capitals, with or without a space,
# dash or underscore inside it (never a line break: "…your ad" at the end of
# one paragraph and "Camouflage…" at the start of the next are two words).
_GAP = r"[ \t\u00a0_-]{0,2}"
_BLU, _AD, _CAMOUFLAGE = _any_case("Blu"), _any_case("Ad"), _any_case("Camouflage")
_NAME = "|".join(
    (
        f"{_BLU}{_GAP}{_any_case('Clo')}[Aa]?[Cc]?[Kk](?:{_any_case('ing')})?",
        f"{_BLU}{_GAP}{_any_case('Editor')}",
        f"{_BLU}{_GAP}{_CAMOUFLAGE}",
        f"{_AD}{_GAP}{_CAMOUFLAGE}",
    )
)
# Endings that mark a web address or a file even when typed in capitals.
_KNOWN_ENDINGS = "|".join(
    _any_case(ending)
    for ending in ("online", "com", "net", "org", "io", "co", "app", "ai", "png", "jpg", "jpeg", "svg", "webp", "gif", "mp4", "pdf", "zip")
)

# A name is replaced only where it stands as a word in a sentence. Inside an
# address, a link or a file name it is left exactly as written, so cleaning
# text never breaks one: support@blucloack.online, blucloack+news@mail.com,
# blucloack.online, BLUCLOACK.ONLINE, /brand/blucloacking-mark.png,
# ?ref=blucloack, #blueditor, adcamouflage/backend, blueditor-1.2.zip.
# "BluEditor.All rights reserved" is a sentence with a missing space, not a
# web address, so it is replaced.
#
# Keep in step with frontend/lib/legacyWording.ts: the two are built the same
# way and must give the same result (re.ASCII makes \w mean what it means in
# JavaScript). The character before the name is captured and put back, not
# checked with a look-behind, because old Safari cannot run one.
_OLD_NAMES = re.compile(
    r"(^|[^\w@/\\.=?&#+-])"  # not straight after a character that puts it inside an address
    rf"(?:{_NAME})"
    r"(?![\w.+-]*[@/\\])"  # not the start of an e-mail address or of a path
    r"(?![\w-]*(?:\.[\w-]+)*\.[a-z][a-z0-9])"  # not a web address or a file name
    rf"(?![\w-]*(?:\.[\w-]+)*\.(?:{_KNOWN_ENDINGS})\b)"  # the same, typed in capitals
    r"(?!\w)",
    re.ASCII,
)


def rebrand(text: str) -> str:
    """``text`` with any earlier product name replaced by :data:`BRAND`."""

    return _OLD_NAMES.sub(rf"\g<1>{BRAND}", text)


def _clean(value: Any) -> Any:
    return rebrand(value) if isinstance(value, str) else value


def rebrand_site_content(document: dict[str, Any]) -> dict[str, Any]:
    """A copy of an Admin site-content document with old names replaced.

    Only the wording people read is touched: page text, the tab title and
    search/share description, button labels, image captions and alt text, and
    reviews.
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
            key: {**value, **{field: _clean(value[field]) for field in ("alt", "caption") if field in value}}
            if isinstance(value, dict)
            else value
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
