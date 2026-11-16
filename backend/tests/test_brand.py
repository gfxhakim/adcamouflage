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
        "Mail support@blucloack.online or visit https://blucloack.online",
        "blucloack@gmail.com",
        "blu.editor@example.io",
        "blucloack.io",
        "www.blueditor.com",
        "/brand/blucloacking-mark.png",
        "blucloacking-mark.webp",
        "adcamouflage.db",
        "https://example.com/?ref=blucloack",
        "utm_source=adcamouflage",
        "https://example.com/my-blueditor-review",
        "adcamouflage_42.zip",
        "Blue editor",
    ],
)
def test_rebrand_leaves_addresses_links_and_files_alone(text):
    assert rebrand(text) == text


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
        "media": {"hero": {"src": "/api/v1/site-media/BluEditor.png", "alt": "BluEditor logo"}},
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
    assert cleaned["media"] == {"hero": {"src": "/api/v1/site-media/BluEditor.png", "alt": "ProteusFlow logo"}}
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
