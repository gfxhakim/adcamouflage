import pytest

from app.brand import BRAND, rebrand, rebrand_site_content


def test_brand_name():
    assert BRAND == "ProteusFlow"


@pytest.mark.parametrize(
    "old",
    [
        "BluEditor",
        "BLUEDITOR",
        "Blu Editor",
        "Blu-Editor",
        "Blu_Editor",
        "Blu  Editor",
        "BluCloacking",
        "BluCloaking",
        "Blucloack",
        "BluCloak",
        "AdCamouflage",
        "Ad camouflage",
    ],
)
def test_rebrand_swaps_every_old_name(old):
    assert rebrand(f"Welcome to {old}!") == "Welcome to ProteusFlow!"
    assert rebrand(f"{old} — Creative Variation & Batch Video Studio") == "ProteusFlow — Creative Variation & Batch Video Studio"


def test_rebrand_handles_punctuation_around_the_name():
    assert rebrand("BluEditor's studio. (BluEditor) BluEditor-powered, BluEditor.") == (
        "ProteusFlow's studio. (ProteusFlow) ProteusFlow-powered, ProteusFlow."
    )


@pytest.mark.parametrize(
    "text",
    [
        # e-mail addresses
        "Mail support@blucloack.online or visit https://blucloack.online",
        "blucloack@gmail.com",
        "blu.editor@example.io",
        "blucloack+news@gmail.com",
        "blueditor+billing@gmail.com",
        # web addresses, also typed in capitals
        "blucloack.io",
        "www.blueditor.com",
        "BluCloack.online",
        "VISIT BLUCLOACK.ONLINE TODAY",
        "blueditor.co.uk",
        # links and their parts
        "https://example.com/?ref=blucloack",
        "utm_source=adcamouflage",
        "https://example.com/my-blueditor-review",
        "https://example.com/?blueditor",
        "https://example.com/?a=1&blueditor=1",
        "https://example.com/page#BluEditor",
        "https://example.com/search?q=what+is+blueditor",
        # files and folders
        "/brand/blucloacking-mark.png",
        "blucloacking-mark.webp",
        "adcamouflage.db",
        "adcamouflage_42.zip",
        "blueditor-1.2.3.tgz",
        "AdCamouflage-v1.2.zip",
        "blueditor/config.json",
        "cd adcamouflage/backend",
        "C:\\files\\blueditor\\x",
        "git@github.com:blueditor/app.git",
        # ordinary words
        "Blue editor",
        "BluEditors",
        # two words that only meet across a line break
        "Upload your ad\nCamouflage it in seconds",
        "Upload your ad\n\nCamouflage it in seconds",
        "Upload your ad\r\nCamouflage it in seconds",
    ],
)
def test_rebrand_leaves_addresses_links_and_files_alone(text):
    assert rebrand(text) == text


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        # A full stop with no space after it is still a sentence, not a web address.
        ("© 2025 BluEditor.All rights reserved.", "© 2025 ProteusFlow.All rights reserved."),
        ("Chat with BluEditor.We reply fast", "Chat with ProteusFlow.We reply fast"),
        ("BluEditor-v1.20 is out", "ProteusFlow-v1.20 is out"),
        ("BluEditor...and more", "ProteusFlow...and more"),
        # Markup and markdown around the name.
        ("[BluEditor](https://blueditor.com)", "[ProteusFlow](https://blueditor.com)"),
        ("<b>BluEditor</b>", "<b>ProteusFlow</b>"),
        ("Hi! I'm the **BluEditor AI Assistant**.", "Hi! I'm the **ProteusFlow AI Assistant**."),
        ("Welcome to bLuEdItOr", "Welcome to ProteusFlow"),
        ("Blu\u00a0Editor", "ProteusFlow"),
        # The name is replaced, the address beside it is not.
        (
            "Contact BluEditor at support@blucloack.online or https://blucloack.online/app?x=BluEditor",
            "Contact ProteusFlow at support@blucloack.online or https://blucloack.online/app?x=BluEditor",
        ),
    ],
)
def test_rebrand_in_sentences(text, expected):
    assert rebrand(text) == expected


def test_rebrand_is_fast_on_long_awkward_text():
    import time

    started = time.monotonic()
    for text in ("BluEditor" + ".a" * 100_000, "BluEditor:" * 20_000, " BluEditor" + ".ab" * 70_000 + "!", "BluEditor" + "+a" * 100_000 + "@"):
        rebrand(text)
    assert time.monotonic() - started < 2


def test_rebrand_is_stable_when_run_twice():
    once = rebrand("BluEditor and Blu Cloacking")
    assert rebrand(once) == once == "ProteusFlow and ProteusFlow"


def test_site_content_cleans_wording_only():
    document = {
        "text": {"hero.title": "BluEditor rocks", "count": 5},
        "meta": {
            "title": "BluEditor — Creative Variation & Batch Video Studio",
            "description": "Made with BluCloacking",
            "favicon": "/api/v1/site-media/BluEditor.png",
        },
        "link": {"cta": {"label": "Open BluEditor", "href": "https://example.com/BluEditor"}},
        "media": {"hero": {"src": "/api/v1/site-media/BluEditor.png", "alt": "BluEditor logo", "caption": "Made with BluEditor"}},
        "reviews": [{"id": "1", "name": "Sam", "handle": "BluEditor user", "body": "I love BluEditor", "avatar": "https://example.com/BluEditor"}],
        "theme": {"css": ".BluEditor { color: red }"},
        "list": {"page.sections": [{"id": "0", "from": 0}]},
    }
    cleaned = rebrand_site_content(document)

    assert cleaned["text"] == {"hero.title": "ProteusFlow rocks", "count": 5}
    assert cleaned["meta"] == {
        "title": "ProteusFlow — Creative Variation & Batch Video Studio",
        "description": "Made with ProteusFlow",
        "favicon": "/api/v1/site-media/BluEditor.png",
    }
    assert cleaned["link"] == {"cta": {"label": "Open ProteusFlow", "href": "https://example.com/BluEditor"}}
    assert cleaned["media"] == {
        "hero": {"src": "/api/v1/site-media/BluEditor.png", "alt": "ProteusFlow logo", "caption": "Made with ProteusFlow"}
    }
    assert cleaned["reviews"] == [
        {"id": "1", "name": "Sam", "handle": "ProteusFlow user", "body": "I love ProteusFlow", "avatar": "https://example.com/BluEditor"}
    ]
    assert cleaned["theme"] == document["theme"] and cleaned["list"] == document["list"]
    # The saved document itself is not modified, and cleaning twice changes nothing more.
    assert document["text"]["hero.title"] == "BluEditor rocks"
    assert rebrand_site_content(cleaned) == cleaned


def test_site_content_tolerates_odd_shapes():
    assert rebrand_site_content({}) == {}
    odd = {"text": "not a map", "meta": None, "link": {"a": "x"}, "media": {"m": None}, "reviews": ["x", 3]}
    assert rebrand_site_content(odd) == odd
