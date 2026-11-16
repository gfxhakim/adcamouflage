from app.brand import BRAND, rebrand


def test_brand_name():
    assert BRAND == "ProteusFlow"


def test_rebrand_swaps_every_old_name():
    for old in ("BluEditor", "Blu Editor", "BluCloacking", "BluCloaking", "Blucloack", "AdCamouflage", "Ad camouflage"):
        assert rebrand(f"Welcome to {old}!") == "Welcome to ProteusFlow!"


def test_rebrand_keeps_other_text_and_domains():
    text = "Mail support@blucloack.online or visit https://blucloack.online"
    assert rebrand(text) == text
    assert rebrand("Blue editor") == "Blue editor"
