"""Per-plan feature gates on render settings.

Each token plan says which groups of existing render settings it may use
(``TokenPlan.full_engine`` / ``TokenPlan.metadata_wipe``, editable in Admin >
Token plans; Starter has both off by default). A locked group is shown
disabled in the workspace and is switched off server-side by the render API,
so it cannot be turned back on by calling the API directly.

This only restricts settings that already exist; it adds nothing to the engine.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from .db import User
from .schemas import MutationOptions
from .teams import billing_account
from .tokens import get_token_plans, uses_tokens

# Feature id -> the MutationOptions switches it covers.
FEATURE_FIELDS: dict[str, tuple[str, ...]] = {
    # "Full Probe, Mutate & Scrub Engine" = the Gen-4 layer group in the workspace.
    "full_engine": (
        "elastic_mesh_warp",
        "dct_jnd_perturbation",
        "lut_clahe_color",
        "optical_flow_timewarp",
        "adversarial_cnn_layer",
        "audio_allpass_phase",
        "formant_pitch_lfo",
        "psychoacoustic_rir",
        "authentic_atom_spoof",
        "macroblock_aq_variance",
    ),
    # "Complete Metadata & Hash Wipe" = the Strip metadata switch.
    "metadata_wipe": ("strip_metadata",),
}
FEATURE_IDS = tuple(FEATURE_FIELDS)


def locked_features(db: Session, user: User) -> list[str]:
    """Feature ids ``user`` may not use, from the plan that pays for them.

    Admins, legacy (pre-token) accounts and accounts without a plan are not
    restricted here; the paywall already stops a plan-less account rendering.
    """

    if user.is_admin:
        return []
    payer = billing_account(db, user)
    if payer.is_admin or not uses_tokens(payer):
        return []
    plan = get_token_plans(db).get(payer.sub_plan or "")
    if plan is None:
        return []
    return [feature for feature in FEATURE_IDS if not getattr(plan, feature)]


def enforce_plan_features(options: MutationOptions, locked: list[str]) -> list[str]:
    """Switch off every option a locked feature covers; return the ones that were on."""

    dropped: list[str] = []
    for feature in locked:
        for field in FEATURE_FIELDS.get(feature, ()):
            if getattr(options, field, False):
                setattr(options, field, False)
                dropped.append(field)
    return dropped
