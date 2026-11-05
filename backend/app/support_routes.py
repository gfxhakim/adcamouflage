"""BluCloaking AI Support Bot + Live Agent Escalation & Multimedia Chat.

Features:
- Complete knowledge base of all BluCloaking options, presets, 23 camouflage
  layers (including all 10 Gen-4 layers), the 4-step How to Use guide,
  platform presets, brand overlay & poster frame tools, token billing, and
  troubleshooting.
- Replies with clarifying questions when a user's request is ambiguous or
  when the user reports that an answer did not resolve their issue.
- Tracks bot attempts per thread (`bot_attempts`). After 5 attempts (`>= 5`),
  unlocks the "Contact Agent" button for the user.
- When the user presses "Contact Agent":
  1) Immediately replies as the bot:
     "The agent may reply to you from now to 30min Max..."
  2) Marks the thread as `escalated` and increments `unread_admin` so a live
     notification banner + badge appear when the admin opens the Admin Panel,
     showing all user account information and the issues reported to the bot.
  3) Emails all admin addresses (via Resend if configured) with the user's
     complete profile, subscription/token status, and conversation transcript.
- Two-way live chat between the user (in the bottom of the bot widget) and
  the admin (in `/admin#support`), supporting both text messages and file
  uploads (screenshots and video/screen recordings).
"""

from __future__ import annotations

import html
import json
import logging
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .accounts import current_user, is_admin, require_admin
from .activity import log_activity
from .config import settings
from .hardening import rate_limit, sniff_media
from .db import BatchRecord, SupportMessage, SupportThread, User, get_db, utcnow
from .mailer import send_email
from .plans import get_plans, plan_expired, plan_label, used_this_month
from .tokens import TOKENS, balance_summary, get_token_plans, subscription_active

logger = logging.getLogger(__name__)

MAX_ATTEMPTS_BEFORE_AGENT = 5
MAX_SUPPORT_MEDIA_BYTES = 150 * 1024 * 1024

SUPPORT_MEDIA_TYPES: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".m4v": "video/x-m4v",
}

_MEDIA_NAME_RE = re.compile(r"^sup_[a-f0-9]{24}\.[a-z0-9]{2,5}$")
# The only attachment links a message may carry: files uploaded through
# /upload. Anything else (an outside address, a javascript: link) is refused,
# so a chat message cannot make the admin's browser load or open it.
_MEDIA_URL_RE = re.compile(r"^/api/v1/support/media/(sup_[a-f0-9]{24}\.[a-z0-9]{2,5})$")


def _media_owner_path(name: str) -> Path:
    return support_media_dir() / f"{name}.owner"


def _media_owner(name: str) -> int | None:
    try:
        return int(_media_owner_path(name).read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None

user_router = APIRouter(prefix="/api/v1/support", tags=["support"])
admin_router = APIRouter(
    prefix="/api/v1/admin/support", tags=["admin-support"], dependencies=[Depends(require_admin)]
)


def support_media_dir() -> Path:
    path = settings.storage_root / "support-media"
    path.mkdir(parents=True, exist_ok=True)
    return path


# ---------------------------------------------------------------------------
# BluCloaking Knowledge Base & Conversational Engine
# ---------------------------------------------------------------------------

WELCOME_MESSAGE = (
    "Hi! I'm the **BluCloaking AI Assistant**. I know every option, camouflage layer, "
    "platform preset, and step in the **How to Use Guide**.\n\n"
    "Tell me what you're trying to do or what issue you're facing — or pick a topic below:"
)

WELCOME_SUGGESTIONS = [
    "How do I use BluCloaking step by step?",
    "Which profile & layers are best for Meta or TikTok?",
    "Explain all 23 Camouflage Layers (including Gen-4)",
    "How do tokens, variants & refunds work?",
    "My ad was flagged or upload failed — help me fix it",
]


class KnowledgeTopic:
    def __init__(
        self,
        id: str,
        keywords: list[str],
        answer: str,
        follow_up_question: str,
        suggestions: list[str],
    ) -> None:
        self.id = id
        self.keywords = keywords
        self.answer = answer
        self.follow_up_question = follow_up_question
        self.suggestions = suggestions


KNOWLEDGE_TOPICS: list[KnowledgeTopic] = [
    KnowledgeTopic(
        id="how_to_use",
        keywords=[
            "how to use",
            "how does it work",
            "guide",
            "tutorial",
            "step by step",
            "steps",
            "start",
            "walkthrough",
            "workflow",
            "first time",
            "beginner",
        ],
        answer=(
            "### BluCloaking 4-Step How to Use Guide\n"
            "1. **Step 01 · Load (`Upload`)**: Drag & drop up to your batch limit of videos (`MP4, MOV, MKV, WEBM, AVI, M4V`) or images (`PNG, JPG, WEBP`). Always upload your clean master creative rather than an already-mutated copy.\n"
            "2. **Step 02 · Settings (`Configure`)**:\n"
            "   - Pick your **Target Ad Platform** (Meta / Facebook & Instagram, TikTok, YouTube Shorts, Snapchat, or Google PMax).\n"
            "   - Choose a **Camouflage Profile**: **Subtle (35)** for light refresh, **Balanced (65 — Recommended)** for everyday Meta/TikTok scaling, **Aggressive (90)** for heavily fatigued creatives, or **Custom** to toggle individual layers.\n"
            "   - Choose **Variants (`1–10`)** to generate multiple unique copies per master file.\n"
            "3. **Step 03 · Overlay (`Optional`)**: Add a transparent PNG brand logo/watermark (drag to position, set size, opacity & fade timing) and/or pick a **Poster Frame** (video frame or custom image burned into frame 0).\n"
            "4. **Step 04 · Render (`Queue`)**: Click **Run mutation**. Renders run on the background worker queue so you can download each variant individually or as a single `.zip`."
        ),
        follow_up_question=(
            "Which of the 4 steps (`01 Load`, `02 Settings`, `03 Overlay`, or `04 Render`) would you like me to explain in more detail, or are you stuck on a specific step?"
        ),
        suggestions=[
            "Tell me more about Step 02 Settings & Profiles",
            "How do Brand Overlay & Poster Frame work?",
            "What happens in Step 04 Render & Queue?",
            "Still didn't solve my issue",
        ],
    ),
    KnowledgeTopic(
        id="profiles_presets",
        keywords=[
            "profile",
            "preset",
            "subtle",
            "balanced",
            "aggressive",
            "custom",
            "intensity",
            "which setting",
            "best setting",
            "meta",
            "facebook",
            "instagram",
            "tiktok",
            "youtube",
            "snapchat",
            "platform",
        ],
        answer=(
            "### Camouflage Profiles & Platform Recommendations\n"
            "- **Balanced · Intensity 65 (Recommended for 90% of runs)**: Enables 18 visual, psychoacoustic, and forensic layers including Gen-4 TPS Mesh Warp, DCT JND Perturbation, 3D Hald CLUT, All-Pass Phase Rotation, Formant LFO, Authentic Camera Atom Spoofing, and Macroblock AQ Variance. Ideal for **Meta (FB/IG)** and **TikTok**.\n"
            "- **Subtle · Intensity 35**: Gentle pixel, metadata, and bitstream refresh with minimal visual or temporal shift. Best for strict brand-guideline creatives.\n"
            "- **Aggressive · Intensity 90**: Enables all **23/23 layers** including Optical-Flow Time-Warp, Adversarial CNN Feature-Map Perturbation, Room Impulse Response (RIR), Frequency Smoothing, and Deep Scramble. Best when re-launching a previously flagged or heavily fatigued creative.\n"
            "- **Custom**: Lets you manually toggle any of the 23 layers, set exact **Target FPS** (`23.976, 24, 25, 29.97, 30, 50, 60`), **Audio Pitch Ratio**, and **Output Format** (`mp4, mov, webm, png, jpg, webp`)."
        ),
        follow_up_question=(
            "To recommend the exact configuration for your campaign: **which ad platform** are you launching on, and is this a **brand-new creative** or a **re-launch of a fatigued/flagged ad**?"
        ),
        suggestions=[
            "Re-launching a flagged ad on Meta/TikTok",
            "Scaling a winning video with 5–10 variants",
            "Explain all 23 Camouflage Layers",
            "Still didn't solve my issue",
        ],
    ),
    KnowledgeTopic(
        id="layers_gen4",
        keywords=[
            "layer",
            "layers",
            "23",
            "gen-4",
            "gen 4",
            "mesh warp",
            "dct",
            "jnd",
            "clahe",
            "lut",
            "optical flow",
            "adversarial",
            "cnn",
            "allpass",
            "all-pass",
            "formant",
            "rir",
            "reverb",
            "atom spoof",
            "macroblock",
            "micro crop",
            "micro-crop",
            "noise",
            "color drift",
            "gop",
            "keyframe",
            "metadata",
            "mirror",
            "deep scramble",
        ],
        answer=(
            "### All 23 BluCloaking Camouflage Layers\n"
            "**1. Gen-4 Perceptual & Spatial Layers ( defeats pHash / vHash / ViT / CLIP )**\n"
            "- **Elastic TPS Mesh Warp (`elastic_mesh_warp`)**: Non-linear low-frequency spatial grid deformation so 8×8 DCT blocks shift across boundaries without cutting subtitles.\n"
            "- **DCT Frequency JND Perturbation (`dct_jnd_perturbation`)**: Injects luminance/texture-masked mid-band DCT noise invisible to human eyes.\n"
            "- **3D Hald CLUT & Local CLAHE (`lut_clahe_color`)**: Non-linear S-curve contrast and shadow/highlight split-toning while protecting skin tones.\n"
            "- **Adversarial CNN Perturbation (`adversarial_cnn_layer`)**: High-frequency Gabor/Laplacian micro-patterns targeting neural feature extractors.\n"
            "- **Optical-Flow Time-Warp (`optical_flow_timewarp`)**: Smooth sinusoidal speed modulation (±3%) while preserving exact total duration.\n\n"
            "**2. Gen-4 Psychoacoustic Audio Layers ( defeats Chromaprint / Whisper / FFT )**\n"
            "- **All-Pass Phase Rotation & Comb (`audio_allpass_phase`)**: Rotates phase across 4–6 poles and adds micro-notches without changing perceived tone.\n"
            "- **Formant-Preserving Micro-Drift LFO (`formant_pitch_lfo`)**: Time-varying pitch LFO (±15–25 cents) that defeats static cross-correlation.\n"
            "- **Psychoacoustic Micro-Reverb RIR (`psychoacoustic_rir`)**: Blends early room reflections (8–18 ms at -28 dB) to alter STFT decay tails.\n\n"
            "**3. Gen-4 Forensic Container & Bitstream Layers**\n"
            "- **Authentic Camera/NLE Atom Spoofing (`authentic_atom_spoof`)**: Writes genuine iPhone 16 Pro, Sony A7S III, CapCut, or Premiere Pro `moov/udta/hdlr` atoms.\n"
            "- **Macroblock AQ & Psy-RD Variance (`macroblock_aq_variance`)**: Randomizes x264/x265 AQ Mode 3, `aq-strength`, `psy-rd`, and `qcomp` per variant.\n\n"
            "**4. Classic Core Layers (`13 layers`)**\n"
            "- `micro_crop`, `frame_rate_stagger`, `noise_injection`, `color_drift`, `temporal_trim`, `keyframe_gop_jitter`, `container_bitrate_shuffle`, `chroma_matrix_shift`, `frequency_smoothing`, `deep_scramble`, `mirror`, `audio_mutation`, and `strip_metadata`."
        ),
        follow_up_question=(
            "Are you looking to customize specific layers for **Video**, **Audio**, or **Images**, or are you experiencing a visual/audio artifact you want to adjust?"
        ),
        suggestions=[
            "How do I avoid cutting off subtitles or logos?",
            "How do I keep audio voice natural?",
            "Which layers work on static images?",
            "Still didn't solve my issue",
        ],
    ),
    KnowledgeTopic(
        id="overlay_poster",
        keywords=[
            "overlay",
            "logo",
            "watermark",
            "png",
            "poster",
            "thumbnail",
            "cover frame",
            "frame 0",
            "step 3",
            "placement",
            "opacity",
        ],
        answer=(
            "### Step 03 · Brand Overlay & Poster Frame\n"
            "- **Brand Overlay (`workspace.overlayTool`)**:\n"
            "  - Upload a **transparent PNG** (or JPG/WEBP) logo or badge.\n"
            "  - Drag it directly on the live video preview or pick one of the **9 anchor positions** (`top-left`, `center`, `bottom-right`, etc.).\n"
            "  - Adjust **Size (`2%–60%`)**, **Opacity (`5%–100%`)**, **Start/End seconds**, and **Fade-in / Fade-out**.\n"
            "- **Poster Frame (`workspace.posterTool`)**:\n"
            "  - Scrub your video to pick an exact frame timestamp OR upload a custom cover image.\n"
            "  - BluCloaking both attaches it as the container cover stream AND blends it into frame 0 so ad managers display your chosen thumbnail."
        ),
        follow_up_question=(
            "Are you having trouble uploading an overlay image, positioning it on the preview, or setting a custom poster thumbnail?"
        ),
        suggestions=[
            "My overlay image was rejected",
            "How do I time the logo to appear only at the end?",
            "How do I skip Step 03 Overlay?",
            "Still didn't solve my issue",
        ],
    ),
    KnowledgeTopic(
        id="tokens_billing",
        keywords=[
            "token",
            "tokens",
            "cost",
            "price",
            "pricing",
            "plan",
            "plans",
            "subscription",
            "topup",
            "top-up",
            "top up",
            "btcpay",
            "crypto",
            "bitcoin",
            "volet",
            "payment",
            "refund",
            "rollover",
            "expired",
        ],
        answer=(
            "### Tokens, Plans & Automatic Refunds\n"
            "- **How Token Cost is Calculated**:\n"
            "  `Total Cost = Queued Files × Variants per File × Tokens per Generation`\n"
            "  *(Example: 4 videos × 5 variants = 20 generations. At 5 tokens/gen, that batch uses 100 tokens.)*\n"
            "- **Automatic Refunds**: If any asset fails to render or you cancel it in the queue before completion, its tokens are **automatically refunded** to your balance.\n"
            "- **Rollover & Top-ups**:\n"
            "  - Unused subscription tokens roll over when you renew before your period expires (or within the grace window).\n"
            "  - **Top-up tokens** never expire while your subscription is active.\n"
            "- **Payments**: You can subscribe or top up on `/app/plan` via **BTCPay (Crypto)** or **Volet**. Balances credit automatically as soon as payment settles."
        ),
        follow_up_question=(
            "What do you need help with regarding your plan or tokens — checking why a payment is pending, calculating batch cost, or renewing a subscription?"
        ),
        suggestions=[
            "I paid an invoice but tokens aren't showing yet",
            "Why does it say 'Not enough tokens for this batch'?",
            "Still didn't solve my issue",
        ],
    ),
    KnowledgeTopic(
        id="troubleshooting",
        keywords=[
            "error",
            "fail",
            "failed",
            "stuck",
            "queue",
            "upload",
            "ffmpeg",
            "unreachable",
            "rejected",
            "disapproved",
            "flagged",
            "ban",
            "banned",
            "shadowban",
            "subtitles",
            "cropped",
            "audio",
            "sync",
            "slow",
        ],
        answer=(
            "### Quick Troubleshooting Checklist\n"
            "1. **Ad still flagged / duplicate-detected by Meta or TikTok**:\n"
            "   - Make sure you uploaded the **clean original master** (not a previously rejected file).\n"
            "   - Switch from `Subtle` to **Balanced (65)** or **Aggressive (90)** so all Gen-4 layers (`elastic_mesh_warp`, `dct_jnd_perturbation`, `audio_allpass_phase`, `authentic_atom_spoof`) are active.\n"
            "   - Generate **3–5 variants** and test each in a fresh ad set.\n"
            "2. **Subtitles or edge logos slightly clipped**:\n"
            "   - Switch Profile to **Custom** and turn off `micro_crop`, while keeping `elastic_mesh_warp` and `dct_jnd_perturbation` ON.\n"
            "3. **Upload or Render Error**:\n"
            "   - Check that each file is under the max upload MB limit and in a supported format (`MP4, MOV, MKV, WEBM, AVI, M4V, PNG, JPG, WEBP`).\n"
            "   - If the status chip says `Engine unreachable`, refresh in a few seconds; any failed job automatically refunds your tokens."
        ),
        follow_up_question=(
            "Did one of those match your problem, or could you tell me: **1)** What exact error message or behavior you see, and **2)** Which step (`Load`, `Settings`, `Overlay`, or `Render`) it happens on?"
        ),
        suggestions=[
            "My ad is still getting flagged on Meta/TikTok",
            "My render failed in Step 04 Queue",
            "Subtitles or audio look/sound off",
            "Still didn't solve my issue",
        ],
    ),
]

NEGATIVE_OR_UNSOLVED_PHRASES = (
    "still didn't solve",
    "didnt solve",
    "didn't solve",
    "not working",
    "still not working",
    "didn't help",
    "didnt help",
    "doesn't help",
    "doesnt help",
    "no that's not",
    "not what i",
    "wrong",
    "useless",
    "bad",
    "contact agent",
    "human",
    "real person",
    "live agent",
    "support agent",
    "talk to someone",
    "help me",
)


def generate_bot_response(
    user_text: str,
    has_attachment: bool,
    attempt_number: int,
) -> tuple[str, list[str]]:
    """Return `(bot_markdown_reply, suggestion_chips)` based on user message and attempt count."""

    cleaned = (user_text or "").strip().lower()
    words = [w for w in re.split(r"\W+", cleaned) if w]

    # Check if user explicitly said the previous answer didn't help or asked for an agent
    is_unsolved_signal = any(phrase in cleaned for phrase in NEGATIVE_OR_UNSOLVED_PHRASES)

    # Score knowledge topics by keyword matches
    best_topic: KnowledgeTopic | None = None
    best_score = 0
    for topic in KNOWLEDGE_TOPICS:
        score = 0
        for kw in topic.keywords:
            if kw in cleaned:
                score += 2 if " " in kw else 1
        if score > best_score:
            best_score = score
            best_topic = topic

    # If the user sent a very short/vague message, or no topic matched, or they signalled it didn't help:
    if best_score == 0 or len(words) <= 2 or is_unsolved_signal:
        if has_attachment and not cleaned:
            reply = (
                "Thanks for uploading that file! To make sure I analyze your issue accurately, "
                "could you answer a quick question:\n\n"
                "1. **What is happening in this screenshot/recording?** (e.g., an upload error, render failure, visual artifact, or billing issue)\n"
                "2. **Which Workspace step were you on?** (`01 Load`, `02 Settings`, `03 Overlay`, or `04 Render`)"
            )
        elif attempt_number == 1:
            reply = (
                "I want to make sure I give you the exact solution for your BluCloaking workflow, "
                "so let me ask a quick clarifying question:\n\n"
                "1. **Which part of BluCloaking are you working with right now?**\n"
                "   - Uploading creatives (**Step 01 · Load**)\n"
                "   - Choosing a platform preset or camouflage layers (**Step 02 · Settings**)\n"
                "   - Adding a logo or poster frame (**Step 03 · Overlay**)\n"
                "   - Rendering / downloading or fixing a flagged ad (**Step 04 · Render**)\n"
                "   - **Tokens, Plans & Billing**"
            )
        elif attempt_number == 2:
            reply = (
                "Got it — let's narrow this down a bit more so I can pinpoint the cause:\n\n"
                "- **Are you processing a Video (`MP4/MOV`) or a Static Image (`PNG/JPG`)?**\n"
                "- **Which Camouflage Profile is selected?** (`Subtle 35`, `Balanced 65`, `Aggressive 90`, or `Custom`)\n"
                "- **Are you seeing a specific error message on screen?** (You can also attach a screenshot or video recording using the paperclip button below!)"
            )
        elif attempt_number == 3:
            reply = (
                "Thanks for the details. Just to be 100% certain before we go further:\n\n"
                "1. **Which ad platform** is this creative for (Meta/FB, TikTok, YouTube Shorts, Snapchat, Google)?\n"
                "2. **Did the batch finish rendering in Step 04**, or is it blocked before rendering (e.g., upload error, token balance, or overlay warning)?"
            )
        elif attempt_number == 4:
            reply = (
                "I still want to make sure we get this completely solved for you. Could you clarify:\n\n"
                "- **What exact outcome do you need right now?** (e.g., passing ad review, fixing video/audio quality, crediting tokens, or a technical bug)\n"
                "- Feel free to **attach a screenshot or screen recording** below — one more try and I can also connect you directly to a live BluCloaking agent!"
            )
        else:
            reply = (
                "I haven't been able to fully resolve this after **5 attempts**, and I don't want to waste your time.\n\n"
                "👉 **You can now click the `Contact Live Agent` button right below.**\n"
                "When you press it, I will immediately send your account details and everything you told me here to our team, and you can chat and share screenshots or video recordings directly with an agent in this window."
            )
        suggestions = [
            "How do I use BluCloaking step by step?",
            "Best settings for Meta / TikTok ads",
            "My render or upload has an error",
            "Tokens & subscription question",
        ]
        return reply, suggestions

    # We matched a specific topic! Give the comprehensive answer + clarifying follow-up question.
    assert best_topic is not None
    reply = f"{best_topic.answer}\n\n---\n**Quick question to make sure this solved it:** {best_topic.follow_up_question}"
    if attempt_number >= MAX_ATTEMPTS_BEFORE_AGENT:
        reply += (
            "\n\n*(Need human help? You've reached 5 attempts — you can press the **Contact Live Agent** button below at any time to escalate this chat to our team.)*"
        )
    return reply, best_topic.suggestions


# ---------------------------------------------------------------------------
# Serializers & Customer Dossier Builder
# ---------------------------------------------------------------------------


class SupportMessageOut(BaseModel):
    id: int
    thread_id: int
    sender_role: str
    sender_name: str | None
    body: str
    attachment_url: str | None = None
    attachment_name: str | None = None
    attachment_type: str | None = None
    attachment_size: int | None = None
    suggestions: list[str] = Field(default_factory=list)
    created_at: datetime


class SupportCustomerDossier(BaseModel):
    id: int
    email: str
    display_name: str | None
    plan: str
    plan_label: str
    billing_mode: str
    usable_tokens: int
    subscription_active: bool
    sub_plan: str | None
    sub_period_end: datetime | None
    used_this_month: int
    monthly_quota: int | None
    plan_expired: bool
    batch_count: int
    files_total: int
    created_at: datetime
    last_login_at: datetime | None
    last_seen_at: datetime | None
    admin_notes: str | None


class SupportThreadOut(BaseModel):
    id: int
    user_id: int
    status: str
    bot_attempts: int
    max_attempts: int = MAX_ATTEMPTS_BEFORE_AGENT
    can_escalate: bool
    issue_summary: str
    escalated_at: datetime | None
    unread_admin: int
    unread_user: int
    created_at: datetime
    updated_at: datetime
    messages: list[SupportMessageOut] = Field(default_factory=list)


class AdminSupportThreadSummary(BaseModel):
    id: int
    status: str
    bot_attempts: int
    issue_summary: str
    escalated_at: datetime | None
    unread_admin: int
    unread_user: int
    created_at: datetime
    updated_at: datetime
    last_message_preview: str
    last_message_at: datetime | None
    customer: SupportCustomerDossier


class AdminSupportThreadDetail(BaseModel):
    thread: SupportThreadOut
    customer: SupportCustomerDossier


class AdminSupportNotificationsOut(BaseModel):
    unread_total: int
    escalated_count: int
    active_count: int
    recent_escalations: list[AdminSupportThreadSummary]


class SendSupportMessageIn(BaseModel):
    body: str = Field(default="", max_length=8000)
    attachment_url: str | None = Field(default=None, max_length=1000)
    attachment_name: str | None = Field(default=None, max_length=255)
    attachment_type: str | None = Field(default=None, max_length=64)
    attachment_size: int | None = Field(default=None, ge=0)

    @field_validator("attachment_url")
    @classmethod
    def _own_media_only(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        if not _MEDIA_URL_RE.match(value):
            raise ValueError("Attachments must be uploaded through the chat.")
        return value

    @field_validator("attachment_type")
    @classmethod
    def _known_kind(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        if value not in {"image", "video"}:
            raise ValueError("Unknown attachment type.")
        return value

    @field_validator("attachment_name")
    @classmethod
    def _plain_name(cls, value: str | None) -> str | None:
        return None if value is None else _clean_file_name(value)


def _clean_file_name(value: str) -> str:
    cleaned = re.sub(r"[\x00-\x1f<>\\/]", "", value).strip()
    return cleaned[:255] or "attachment"


def _require_own_attachment(payload: SendSupportMessageIn, user: User) -> None:
    """A customer may only attach files they uploaded themselves."""

    if not payload.attachment_url:
        return
    match = _MEDIA_URL_RE.match(payload.attachment_url)
    name = match.group(1) if match else ""
    if not name or _media_owner(name) != user.id or not (support_media_dir() / name).is_file():
        raise HTTPException(status_code=422, detail="That attachment was not found. Upload it again.")


class EscalateThreadIn(BaseModel):
    note: str = Field(default="", max_length=2000)


class UpdateThreadStatusIn(BaseModel):
    status: str = Field(pattern="^(bot|escalated|agent_active|resolved)$")


def _serialize_message(msg: SupportMessage) -> SupportMessageOut:
    suggestions: list[str] = []
    if msg.suggestions_json:
        try:
            parsed = json.loads(msg.suggestions_json)
            if isinstance(parsed, list):
                suggestions = [str(item) for item in parsed]
        except Exception:
            suggestions = []
    return SupportMessageOut(
        id=msg.id,
        thread_id=msg.thread_id,
        sender_role=msg.sender_role,
        sender_name=msg.sender_name,
        body=msg.body,
        attachment_url=msg.attachment_url,
        attachment_name=msg.attachment_name,
        attachment_type=msg.attachment_type,
        attachment_size=msg.attachment_size,
        suggestions=suggestions,
        created_at=msg.created_at,
    )


def _serialize_thread(thread: SupportThread, messages: list[SupportMessage]) -> SupportThreadOut:
    return SupportThreadOut(
        id=thread.id,
        user_id=thread.user_id,
        status=thread.status,
        bot_attempts=thread.bot_attempts,
        max_attempts=MAX_ATTEMPTS_BEFORE_AGENT,
        can_escalate=thread.bot_attempts >= MAX_ATTEMPTS_BEFORE_AGENT or thread.status != "bot",
        issue_summary=thread.issue_summary,
        escalated_at=thread.escalated_at,
        unread_admin=thread.unread_admin,
        unread_user=thread.unread_user,
        created_at=thread.created_at,
        updated_at=thread.updated_at,
        messages=[_serialize_message(m) for m in messages],
    )


def _build_customer_dossier(db: Session, user: User) -> SupportCustomerDossier:
    plans = get_plans(db)
    token_plans = get_token_plans(db)
    batch_stats = db.execute(
        select(
            func.count(BatchRecord.id),
            func.coalesce(func.sum(BatchRecord.asset_count), 0),
        ).where(BatchRecord.user_id == user.id)
    ).one()
    batch_count = int(batch_stats[0] or 0)
    files_total = int(batch_stats[1] or 0)

    if user.billing_mode == TOKENS:
        bal = balance_summary(db, user)
        usable = int(bal.get("usable_tokens", 0))
        sub_active = subscription_active(user)
        tplan = token_plans.get(user.sub_plan or "")
        p_label = tplan.label if tplan else (user.sub_plan or "No active plan")
    else:
        usable = 0
        sub_active = not plan_expired(user)
        p_label = plan_label(user.plan, plans)

    return SupportCustomerDossier(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        plan=user.plan,
        plan_label=p_label,
        billing_mode=user.billing_mode,
        usable_tokens=usable,
        subscription_active=sub_active,
        sub_plan=user.sub_plan,
        sub_period_end=user.sub_period_end,
        used_this_month=used_this_month(db, user),
        monthly_quota=user.monthly_quota,
        plan_expired=plan_expired(user),
        batch_count=batch_count,
        files_total=files_total,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
        last_seen_at=user.last_seen_at,
        admin_notes=user.admin_notes,
    )


def _build_issue_summary(messages: list[SupportMessage], extra_note: str = "") -> str:
    user_lines: list[str] = []
    for m in messages:
        if m.sender_role == "user":
            text = (m.body or "").strip()
            if m.attachment_name:
                text = f"{text} [Attached: {m.attachment_name}]".strip()
            if text:
                user_lines.append(f"• {text}")
    if extra_note.strip():
        user_lines.append(f"• [Escalation Note]: {extra_note.strip()}")
    if not user_lines:
        return "Customer requested a live agent from the BluCloaking Bot."
    return "\n".join(user_lines[-12:])


def _notify_admins_by_email(
    db: Session,
    user: User,
    thread: SupportThread,
    dossier: SupportCustomerDossier,
    messages: list[SupportMessage],
) -> None:
    """Send an email to all admin addresses with the user's info and bot issue transcript."""

    recipients: set[str] = {e.strip().lower() for e in settings.admin_emails if e.strip()}
    admin_users = db.execute(select(User.email).where(User.is_admin.is_(True), User.is_active.is_(True))).scalars()
    for email in admin_users:
        if email:
            recipients.add(email.strip().lower())

    if not recipients:
        return

    subject = f"[BluCloaking Support] Live Agent Requested by {user.email} (Ticket #{thread.id})"
    transcript_rows: list[str] = []
    for m in messages[-15:]:
        role_label = {
            "user": f"Customer ({html.escape(user.email)})",
            "bot": "BluCloaking Bot",
            "agent": f"Agent ({html.escape(m.sender_name or 'Admin')})",
            "system": "System",
        }.get(m.sender_role, m.sender_role)
        attachment_html = ""
        if m.attachment_url:
            attachment_html = f"<br/><em>Attachment: {html.escape(m.attachment_name or m.attachment_url)}</em>"
        transcript_rows.append(
            f"<div style='margin-bottom:10px;padding:8px 12px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;'>"
            f"<strong>{role_label}:</strong><br/>{html.escape(m.body or '').replace(chr(10), '<br/>')}{attachment_html}"
            f"</div>"
        )

    body_html = f"""
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:680px;margin:0 auto;color:#0f172a;">
      <h2 style="color:#0866ff;margin-bottom:4px;">BluCloaking Live Support Escalation · Ticket #{thread.id}</h2>
      <p style="margin-top:0;color:#475569;">A customer completed {thread.bot_attempts} bot attempts and clicked <strong>Contact Live Agent</strong> (promised response window: <strong>up to 30 minutes max</strong>).</p>

      <h3 style="margin-bottom:6px;border-bottom:1px solid #cbd5e1;padding-bottom:4px;">Customer Information</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px;">
        <tr><td style="padding:4px 8px;color:#64748b;">User ID / Email</td><td style="padding:4px 8px;"><strong>#{dossier.id} · {html.escape(dossier.email)}</strong></td></tr>
        <tr><td style="padding:4px 8px;color:#64748b;">Display Name</td><td style="padding:4px 8px;">{html.escape(dossier.display_name or '—')}</td></tr>
        <tr><td style="padding:4px 8px;color:#64748b;">Plan &amp; Billing Mode</td><td style="padding:4px 8px;">{html.escape(dossier.plan_label)} ({html.escape(dossier.billing_mode)}) · Active: {dossier.subscription_active}</td></tr>
        <tr><td style="padding:4px 8px;color:#64748b;">Usable Tokens</td><td style="padding:4px 8px;">{dossier.usable_tokens} tokens</td></tr>
        <tr><td style="padding:4px 8px;color:#64748b;">Batches / Total Files</td><td style="padding:4px 8px;">{dossier.batch_count} batches · {dossier.files_total} files processed</td></tr>
        <tr><td style="padding:4px 8px;color:#64748b;">Account Created</td><td style="padding:4px 8px;">{dossier.created_at.strftime('%Y-%m-%d %H:%M UTC')}</td></tr>
      </table>

      <h3 style="margin-bottom:6px;border-bottom:1px solid #cbd5e1;padding-bottom:4px;">Issues Reported to Bot</h3>
      <pre style="white-space:pre-wrap;background:#fff7ed;border:1px solid #fed7aa;padding:12px;border-radius:8px;font-size:13px;color:#9a3412;">{html.escape(thread.issue_summary)}</pre>

      <h3 style="margin-bottom:6px;border-bottom:1px solid #cbd5e1;padding-bottom:4px;">Conversation Transcript</h3>
      {''.join(transcript_rows)}

      <p style="margin-top:20px;font-size:13px;color:#475569;">
        Open your <strong>Admin Panel &rarr; Support / Live Chat</strong> tab to reply and share screenshots or video recordings with this customer in real time.
      </p>
    </div>
    """

    for recipient in recipients:
        try:
            send_email(recipient, subject, body_html)
        except Exception:
            logger.warning("Could not send support escalation email to %s", recipient, exc_info=True)


# ---------------------------------------------------------------------------
# Helper: get or create active thread for user
# ---------------------------------------------------------------------------


def _get_or_create_thread(db: Session, user: User) -> tuple[SupportThread, list[SupportMessage]]:
    thread = (
        db.execute(
            select(SupportThread)
            .where(SupportThread.user_id == user.id)
            .order_by(SupportThread.updated_at.desc(), SupportThread.id.desc())
            .limit(1)
        )
        .scalars()
        .first()
    )
    if thread is None:
        thread = SupportThread(
            user_id=user.id,
            status="bot",
            bot_attempts=0,
            issue_summary="",
            unread_admin=0,
            unread_user=0,
        )
        db.add(thread)
        db.flush()
        welcome = SupportMessage(
            thread_id=thread.id,
            sender_role="bot",
            sender_name="BluCloaking Bot",
            body=WELCOME_MESSAGE,
            suggestions_json=json.dumps(WELCOME_SUGGESTIONS),
        )
        db.add(welcome)
        db.commit()
        db.refresh(thread)

    messages = list(
        db.execute(
            select(SupportMessage)
            .where(SupportMessage.thread_id == thread.id)
            .order_by(SupportMessage.created_at.asc(), SupportMessage.id.asc())
        ).scalars()
    )
    return thread, messages


# ---------------------------------------------------------------------------
# User Support Endpoints
# ---------------------------------------------------------------------------


@user_router.get("/thread", response_model=SupportThreadOut)
def get_my_support_thread(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> SupportThreadOut:
    thread, messages = _get_or_create_thread(db, user)
    if thread.unread_user > 0:
        thread.unread_user = 0
        db.commit()
    return _serialize_thread(thread, messages)


@user_router.post(
    "/thread/new",
    response_model=SupportThreadOut,
    dependencies=[Depends(rate_limit("support-new", limit=10, window_seconds=3600))],
)
def start_new_support_thread(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> SupportThreadOut:
    thread = SupportThread(
        user_id=user.id,
        status="bot",
        bot_attempts=0,
        issue_summary="",
        unread_admin=0,
        unread_user=0,
    )
    db.add(thread)
    db.flush()
    welcome = SupportMessage(
        thread_id=thread.id,
        sender_role="bot",
        sender_name="BluCloaking Bot",
        body=WELCOME_MESSAGE,
        suggestions_json=json.dumps(WELCOME_SUGGESTIONS),
    )
    db.add(welcome)
    db.commit()
    db.refresh(thread)
    return _serialize_thread(thread, [welcome])


@user_router.post(
    "/thread/message",
    response_model=SupportThreadOut,
    dependencies=[Depends(rate_limit("support-message", limit=40, window_seconds=300))],
)
def post_user_support_message(
    payload: SendSupportMessageIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> SupportThreadOut:
    body = (payload.body or "").strip()
    if not body and not payload.attachment_url:
        raise HTTPException(status_code=422, detail="Enter a message or attach a screenshot/video.")
    _require_own_attachment(payload, user)

    thread, messages = _get_or_create_thread(db, user)
    if thread.status == "resolved":
        # Re-open into agent chat if previously escalated, otherwise bot mode
        thread.status = "agent_active" if thread.escalated_at else "bot"

    user_msg = SupportMessage(
        thread_id=thread.id,
        sender_role="user",
        sender_name=user.display_name or user.email,
        body=body,
        attachment_url=payload.attachment_url,
        attachment_name=payload.attachment_name,
        attachment_type=payload.attachment_type,
        attachment_size=payload.attachment_size,
    )
    db.add(user_msg)
    messages.append(user_msg)
    thread.updated_at = utcnow()
    thread.issue_summary = _build_issue_summary(messages)

    if thread.status == "bot":
        from .payment_proofs import bot_payment_reply

        payment_reply = bot_payment_reply(db, user, body)
        if payment_reply is not None:
            bot_reply, suggestions = payment_reply
        else:
            thread.bot_attempts += 1
            bot_reply, suggestions = generate_bot_response(
                user_text=body,
                has_attachment=bool(payload.attachment_url),
                attempt_number=thread.bot_attempts,
            )
        bot_msg = SupportMessage(
            thread_id=thread.id,
            sender_role="bot",
            sender_name="BluCloaking Bot",
            body=bot_reply,
            suggestions_json=json.dumps(suggestions),
        )
        db.add(bot_msg)
        messages.append(bot_msg)
    else:
        # In escalated or agent_active mode, notify the admin of the new user message/file
        thread.unread_admin += 1

    db.commit()
    db.refresh(thread)
    for m in messages:
        db.refresh(m)
    return _serialize_thread(thread, messages)


@user_router.post("/thread/unsolved", response_model=SupportThreadOut)
def mark_bot_attempt_unsolved(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> SupportThreadOut:
    """User clicks 'Still need help / Didn't solve my issue' to advance attempts toward agent escalation."""

    thread, messages = _get_or_create_thread(db, user)
    if thread.status == "bot":
        thread.bot_attempts += 1
        thread.updated_at = utcnow()
        remaining = max(0, MAX_ATTEMPTS_BEFORE_AGENT - thread.bot_attempts)
        if remaining > 0:
            reply = (
                f"I'm sorry that didn't fully solve it (attempt **{thread.bot_attempts}/{MAX_ATTEMPTS_BEFORE_AGENT}**).\n\n"
                "Could you tell me a bit more about:\n"
                "1. **What exact step or button** you clicked right before the issue happened?\n"
                "2. **What result you expected vs. what actually happened?**\n\n"
                f"*(If we still can't solve it after {remaining} more attempt{'s' if remaining != 1 else ''}, the **Contact Live Agent** button will unlock automatically.)*"
            )
        else:
            reply = (
                "We've reached **5 attempts** without resolving your issue.\n\n"
                "👉 **Click the `Contact Live Agent` button below** to send your issue and conversation directly to our team. "
                "A live BluCloaking agent will reply right here in this chat (within **30min Max**)."
            )
        bot_msg = SupportMessage(
            thread_id=thread.id,
            sender_role="bot",
            sender_name="BluCloaking Bot",
            body=reply,
            suggestions_json=json.dumps(
                [
                    "My ad is getting flagged on Meta/TikTok",
                    "My upload or render failed",
                    "Tokens or payment issue",
                ]
            ),
        )
        db.add(bot_msg)
        messages.append(bot_msg)
        db.commit()
        db.refresh(bot_msg)
    return _serialize_thread(thread, messages)


@user_router.post(
    "/thread/escalate",
    response_model=SupportThreadOut,
    dependencies=[Depends(rate_limit("support-escalate", limit=6, window_seconds=3600))],
)
def escalate_to_live_agent(
    payload: EscalateThreadIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> SupportThreadOut:
    """Escalate the thread after 5 attempts, notify admin via panel & email, and post the 30min max bot reply."""

    thread, messages = _get_or_create_thread(db, user)
    if thread.status == "bot" and thread.bot_attempts < MAX_ATTEMPTS_BEFORE_AGENT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Please try asking the BluCloaking Bot first ({thread.bot_attempts}/{MAX_ATTEMPTS_BEFORE_AGENT} attempts used).",
        )

    already_escalated = thread.status in ("escalated", "agent_active")
    thread.status = "escalated" if thread.status == "bot" else thread.status
    thread.escalated_at = thread.escalated_at or utcnow()
    thread.updated_at = utcnow()
    thread.issue_summary = _build_issue_summary(messages, payload.note)
    thread.unread_admin += 1

    if payload.note.strip():
        note_msg = SupportMessage(
            thread_id=thread.id,
            sender_role="user",
            sender_name=user.display_name or user.email,
            body=payload.note.strip(),
        )
        db.add(note_msg)
        messages.append(note_msg)

    if not already_escalated:
        auto_reply = SupportMessage(
            thread_id=thread.id,
            sender_role="bot",
            sender_name="BluCloaking Bot",
            body=(
                "✅ **Your request has been sent to a live BluCloaking agent** along with your account details and everything you shared above.\n\n"
                "⏱️ **The agent may reply to you from now to 30min Max.**\n\n"
                "You can keep this chat open or come back anytime — feel free to send additional messages, **screenshots**, or **video screen recordings** below while you wait."
            ),
        )
        db.add(auto_reply)
        messages.append(auto_reply)
        log_activity(
            db,
            user.id,
            "support_escalated",
            f"Ticket #{thread.id} escalated to live agent ({thread.bot_attempts} bot attempts)",
        )

    db.commit()
    db.refresh(thread)
    for m in messages:
        db.refresh(m)

    if not already_escalated:
        dossier = _build_customer_dossier(db, user)
        _notify_admins_by_email(db, user, thread, dossier, messages)

    return _serialize_thread(thread, messages)


# ---------------------------------------------------------------------------
# Shared Multimedia Upload & Media Serving (Screenshots & Video Recordings)
# ---------------------------------------------------------------------------


@user_router.post(
    "/upload",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("support-upload", limit=20, window_seconds=600))],
)
async def upload_support_attachment(
    file: UploadFile = File(...),
    _user: User = Depends(current_user),
) -> dict[str, Any]:
    """Upload a screenshot (PNG/JPG/WEBP/GIF) or video/screen recording (MP4/WEBM/MOV/MKV) for chat."""

    raw_name = file.filename or "attachment"
    suffix = Path(raw_name).suffix.lower()
    if suffix not in SUPPORT_MEDIA_TYPES:
        # Fallback to content_type for browser screen-recording blobs (e.g. video/webm)
        ct = (file.content_type or "").lower()
        if "webm" in ct:
            suffix = ".webm"
        elif "mp4" in ct:
            suffix = ".mp4"
        elif "png" in ct:
            suffix = ".png"
        elif "jpeg" in ct or "jpg" in ct:
            suffix = ".jpg"
        else:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Upload an image/screenshot (PNG, JPG, WEBP, GIF) or video recording (MP4, WEBM, MOV, MKV).",
            )

    stored_name = f"sup_{secrets.token_hex(12)}{suffix}"
    target = support_media_dir() / stored_name
    size = 0
    try:
        with target.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_SUPPORT_MEDIA_BYTES:
                    raise HTTPException(status_code=413, detail="Attachment exceeds the 150 MB limit.")
                out.write(chunk)
    except HTTPException:
        target.unlink(missing_ok=True)
        raise

    if size == 0:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="The uploaded file was empty.")

    mime = SUPPORT_MEDIA_TYPES[suffix]
    kind = "video" if mime.startswith("video/") else "image"
    # The extension says what the file claims to be; its first bytes say what it is.
    if sniff_media(target) != kind:
        target.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="That file is not a valid image or video.",
        )
    _media_owner_path(stored_name).write_text(str(_user.id), encoding="utf-8")
    return {
        "url": f"/api/v1/support/media/{stored_name}",
        "name": _clean_file_name(raw_name),
        "type": kind,
        "mime": mime,
        "size": size,
    }


@user_router.get("/media/{name}")
def read_support_attachment(
    name: str,
    _user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    """Serve a chat screenshot or recording to the customer it belongs to, or an admin."""

    if not _MEDIA_NAME_RE.match(name):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    path = support_media_dir() / name
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    if not is_admin(_user) and _media_owner(name) != _user.id:
        # Files from before owners were recorded: allowed when a message in
        # one of the customer's own threads carries them (an admin's reply).
        shared = db.execute(
            select(SupportMessage.id)
            .join(SupportThread, SupportThread.id == SupportMessage.thread_id)
            .where(
                SupportThread.user_id == _user.id,
                SupportMessage.attachment_url == f"/api/v1/support/media/{name}",
            )
            .limit(1)
        ).first()
        if shared is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    headers = {
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
    }
    return FileResponse(
        path,
        media_type=SUPPORT_MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream"),
        headers=headers,
    )


# ---------------------------------------------------------------------------
# Admin Support & Live Chat Endpoints
# ---------------------------------------------------------------------------


def _build_thread_summary(db: Session, thread: SupportThread, user: User) -> AdminSupportThreadSummary:
    last_msg = (
        db.execute(
            select(SupportMessage)
            .where(SupportMessage.thread_id == thread.id)
            .order_by(SupportMessage.created_at.desc(), SupportMessage.id.desc())
            .limit(1)
        )
        .scalars()
        .first()
    )
    preview = ""
    last_at = None
    if last_msg is not None:
        preview = (last_msg.body or "").strip()
        if not preview and last_msg.attachment_name:
            preview = f"[Attachment: {last_msg.attachment_name}]"
        if len(preview) > 140:
            preview = preview[:137] + "..."
        last_at = last_msg.created_at

    return AdminSupportThreadSummary(
        id=thread.id,
        status=thread.status,
        bot_attempts=thread.bot_attempts,
        issue_summary=thread.issue_summary,
        escalated_at=thread.escalated_at,
        unread_admin=thread.unread_admin,
        unread_user=thread.unread_user,
        created_at=thread.created_at,
        updated_at=thread.updated_at,
        last_message_preview=preview,
        last_message_at=last_at,
        customer=_build_customer_dossier(db, user),
    )


@admin_router.get("/notifications", response_model=AdminSupportNotificationsOut)
def admin_support_notifications(db: Session = Depends(get_db)) -> AdminSupportNotificationsOut:
    """Return unread counts and escalated tickets for the Admin Panel header badge & alert banner."""

    unread_total = int(
        db.execute(select(func.coalesce(func.sum(SupportThread.unread_admin), 0))).scalar_one() or 0
    )
    escalated_count = int(
        db.execute(
            select(func.count(SupportThread.id)).where(SupportThread.status == "escalated")
        ).scalar_one()
        or 0
    )
    active_count = int(
        db.execute(
            select(func.count(SupportThread.id)).where(
                SupportThread.status.in_(("escalated", "agent_active"))
            )
        ).scalar_one()
        or 0
    )

    rows = db.execute(
        select(SupportThread, User)
        .join(User, User.id == SupportThread.user_id)
        .where(
            (SupportThread.status.in_(("escalated", "agent_active")))
            | (SupportThread.unread_admin > 0)
        )
        .order_by(
            SupportThread.unread_admin.desc(),
            SupportThread.updated_at.desc(),
        )
        .limit(8)
    ).all()

    recent = [_build_thread_summary(db, t, u) for t, u in rows]
    return AdminSupportNotificationsOut(
        unread_total=unread_total,
        escalated_count=escalated_count,
        active_count=active_count,
        recent_escalations=recent,
    )


@admin_router.get("/threads", response_model=list[AdminSupportThreadSummary])
def admin_list_support_threads(
    status_filter: str = Query(default="all", alias="status"),
    q: str = Query(default=""),
    db: Session = Depends(get_db),
) -> list[AdminSupportThreadSummary]:
    stmt = select(SupportThread, User).join(User, User.id == SupportThread.user_id)
    if status_filter != "all":
        stmt = stmt.where(SupportThread.status == status_filter)
    cleaned_q = q.strip().lower()
    if cleaned_q:
        like = f"%{cleaned_q}%"
        stmt = stmt.where(
            func.lower(User.email).like(like)
            | func.lower(func.coalesce(User.display_name, "")).like(like)
            | func.lower(SupportThread.issue_summary).like(like)
        )

    stmt = stmt.order_by(
        SupportThread.unread_admin.desc(),
        SupportThread.updated_at.desc(),
        SupportThread.id.desc(),
    ).limit(100)

    rows = db.execute(stmt).all()
    return [_build_thread_summary(db, t, u) for t, u in rows]


@admin_router.get("/threads/{thread_id}", response_model=AdminSupportThreadDetail)
def admin_get_support_thread(
    thread_id: int,
    db: Session = Depends(get_db),
) -> AdminSupportThreadDetail:
    thread = db.get(SupportThread, thread_id)
    if thread is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Support thread not found.")
    user = db.get(User, thread.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found.")

    if thread.unread_admin > 0:
        thread.unread_admin = 0
        db.commit()

    messages = list(
        db.execute(
            select(SupportMessage)
            .where(SupportMessage.thread_id == thread.id)
            .order_by(SupportMessage.created_at.asc(), SupportMessage.id.asc())
        ).scalars()
    )
    return AdminSupportThreadDetail(
        thread=_serialize_thread(thread, messages),
        customer=_build_customer_dossier(db, user),
    )


@admin_router.post("/threads/{thread_id}/message", response_model=AdminSupportThreadDetail)
def admin_send_support_message(
    thread_id: int,
    payload: SendSupportMessageIn,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminSupportThreadDetail:
    body = (payload.body or "").strip()
    if not body and not payload.attachment_url:
        raise HTTPException(status_code=422, detail="Enter a message or attach a screenshot/video.")

    thread = db.get(SupportThread, thread_id)
    if thread is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Support thread not found.")
    user = db.get(User, thread.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found.")

    thread.status = "agent_active"
    thread.escalated_at = thread.escalated_at or utcnow()
    thread.unread_admin = 0
    thread.unread_user += 1
    thread.updated_at = utcnow()

    agent_msg = SupportMessage(
        thread_id=thread.id,
        sender_role="agent",
        sender_name=admin.display_name or "BluCloaking Support Agent",
        body=body,
        attachment_url=payload.attachment_url,
        attachment_name=payload.attachment_name,
        attachment_type=payload.attachment_type,
        attachment_size=payload.attachment_size,
    )
    db.add(agent_msg)
    db.commit()
    db.refresh(thread)

    messages = list(
        db.execute(
            select(SupportMessage)
            .where(SupportMessage.thread_id == thread.id)
            .order_by(SupportMessage.created_at.asc(), SupportMessage.id.asc())
        ).scalars()
    )
    return AdminSupportThreadDetail(
        thread=_serialize_thread(thread, messages),
        customer=_build_customer_dossier(db, user),
    )


@admin_router.patch("/threads/{thread_id}", response_model=AdminSupportThreadDetail)
def admin_update_support_thread_status(
    thread_id: int,
    payload: UpdateThreadStatusIn,
    db: Session = Depends(get_db),
) -> AdminSupportThreadDetail:
    thread = db.get(SupportThread, thread_id)
    if thread is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Support thread not found.")
    user = db.get(User, thread.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found.")

    thread.status = payload.status
    if payload.status == "bot":
        thread.bot_attempts = 0
    thread.updated_at = utcnow()
    db.commit()
    db.refresh(thread)

    messages = list(
        db.execute(
            select(SupportMessage)
            .where(SupportMessage.thread_id == thread.id)
            .order_by(SupportMessage.created_at.asc(), SupportMessage.id.asc())
        ).scalars()
    )
    return AdminSupportThreadDetail(
        thread=_serialize_thread(thread, messages),
        customer=_build_customer_dossier(db, user),
    )
