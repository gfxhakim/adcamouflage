"""Team seats: people who share one account's plan and token balance.

A plan carries ``seats`` (owner included; Starter and Pro have 1, Max 5 by
default, editable in Admin > Settings). The owner of a multi-seat plan adds
members by email. A member signs in with their own account, keeps their own
batches and history, and every generation they run is charged to the
owner's balance, so the whole team draws on one pool of tokens.

Billing code asks ``billing_account(db, user)`` for the account to price,
check and charge; for everyone who is not a seated member that is the user
themselves. When the owner moves to a plan with fewer seats, the earliest
members keep sharing and the rest fall back to their own (usually empty)
account until a seat frees up; nobody is deleted.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .accounts import AuthError, current_user, validate_email
from .activity import log_activity
from .db import TeamMember, User, get_db
from .plans import aware
from .tokens import get_token_plans, subscription_active

router = APIRouter(prefix="/api/v1/team", tags=["team"])


# --------------------------------------------------------------------------
# rules
# --------------------------------------------------------------------------


def seats_for(db: Session, owner: User) -> int:
    """Seats on the owner's current (or last) plan, owner included."""

    plan = get_token_plans(db).get(owner.sub_plan or "")
    return plan.seats if plan else 1


def members_of(db: Session, owner: User) -> list[TeamMember]:
    return list(
        db.execute(
            select(TeamMember)
            .where(TeamMember.owner_id == owner.id)
            .order_by(TeamMember.created_at, TeamMember.id)
        )
        .scalars()
        .all()
    )


def membership(db: Session, user: User) -> TeamMember | None:
    """The seat this user was given on someone else's team, if any."""

    row = db.execute(select(TeamMember).where(TeamMember.email == user.email)).scalar_one_or_none()
    return row if row is not None and row.owner_id != user.id else None


def _seated(db: Session, owner: User, row: TeamMember) -> bool:
    """Whether ``row`` is inside the owner's seat count (earliest members first)."""

    allowed = seats_for(db, owner) - 1
    if allowed <= 0:
        return False
    return row.id in {m.id for m in members_of(db, owner)[:allowed]}


def billing_account(db: Session, user: User) -> User:
    """The account whose plan and tokens pay for ``user``'s generations."""

    row = membership(db, user)
    if row is None:
        return user
    owner = db.get(User, row.owner_id)
    if owner is None or not owner.is_active or not _seated(db, owner, row):
        return user
    return owner


# --------------------------------------------------------------------------
# payloads
# --------------------------------------------------------------------------


class TeamMemberOut(BaseModel):
    email: str
    # False until someone signs up with this email.
    joined: bool
    display_name: str | None = None
    last_seen_at: datetime | None = None
    added_at: datetime
    # False when the owner's plan has fewer seats than members.
    sharing: bool


class TeamOut(BaseModel):
    # owner: can add members (or already has some); member: on someone's team; none: single user.
    role: Literal["owner", "member", "none"]
    seats: int
    seats_used: int
    owner_email: str | None = None
    # For a member: whether their generations are charged to the owner right now.
    sharing: bool = False
    members: list[TeamMemberOut] = []


class MemberIn(BaseModel):
    email: str = Field(max_length=320)


def team_summary(db: Session, user: User) -> TeamOut:
    row = membership(db, user)
    if row is not None:
        owner = db.get(User, row.owner_id)
        seats = seats_for(db, owner) if owner else 1
        return TeamOut(
            role="member",
            seats=seats,
            seats_used=1 + len(members_of(db, owner)) if owner else 1,
            owner_email=owner.email if owner else None,
            sharing=billing_account(db, user) is not user,
        )

    seats = seats_for(db, user)
    rows = members_of(db, user)
    if seats <= 1 and not rows:
        return TeamOut(role="none", seats=seats, seats_used=1)

    emails = [r.email for r in rows]
    accounts = {
        u.email: u for u in db.execute(select(User).where(User.email.in_(emails))).scalars().all()
    } if emails else {}
    allowed = max(0, seats - 1)
    out = []
    for index, r in enumerate(rows):
        account = accounts.get(r.email)
        out.append(
            TeamMemberOut(
                email=r.email,
                joined=account is not None,
                display_name=account.display_name if account else None,
                last_seen_at=aware(account.last_seen_at) if account else None,
                added_at=aware(r.created_at),
                sharing=index < allowed,
            )
        )
    return TeamOut(role="owner", seats=seats, seats_used=1 + len(rows), members=out)


# --------------------------------------------------------------------------
# routes
# --------------------------------------------------------------------------


def _conflict(detail: str, code: int = status.HTTP_409_CONFLICT) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


@router.get("", response_model=TeamOut)
def my_team(user: User = Depends(current_user), db: Session = Depends(get_db)) -> TeamOut:
    return team_summary(db, user)


@router.post("/members", response_model=TeamOut, status_code=status.HTTP_201_CREATED)
def add_member(payload: MemberIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> TeamOut:
    if membership(db, user) is not None:
        raise _conflict("You are on someone else's team. Leave it before adding your own members.")
    seats = seats_for(db, user)
    if seats <= 1:
        raise _conflict(
            "Your plan is for a single user. Move to a plan with team seats to add people.",
            status.HTTP_403_FORBIDDEN,
        )
    if not subscription_active(user):
        raise _conflict("Renew your plan to add team members.", status.HTTP_402_PAYMENT_REQUIRED)
    try:
        email = validate_email(payload.email)
    except AuthError as exc:
        raise _conflict(exc.detail, status.HTTP_422_UNPROCESSABLE_ENTITY) from exc
    if email == user.email:
        raise _conflict("You already have the owner's seat.", status.HTTP_422_UNPROCESSABLE_ENTITY)

    existing = db.execute(select(TeamMember).where(TeamMember.email == email)).scalar_one_or_none()
    if existing is not None:
        if existing.owner_id == user.id:
            raise _conflict("That person is already on your team.")
        raise _conflict("That person is already on another team.")

    account = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if account is not None:
        has_team = db.execute(
            select(func.count(TeamMember.id)).where(TeamMember.owner_id == account.id)
        ).scalar_one()
        if has_team:
            raise _conflict("That account runs its own team.")
        if subscription_active(account):
            raise _conflict("That account has its own active plan. They can join once it ends.")

    if 1 + len(members_of(db, user)) >= seats:
        raise _conflict(f"All {seats} seats are in use. Remove someone to add a new member.")

    db.add(TeamMember(owner_id=user.id, email=email))
    db.commit()
    log_activity(db, user.id, "team", f"Added {email} to the team")
    return team_summary(db, user)


@router.delete("/members/{email}", response_model=TeamOut)
def remove_member(email: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> TeamOut:
    cleaned = email.strip().lower()
    row = db.execute(
        select(TeamMember).where(TeamMember.owner_id == user.id, TeamMember.email == cleaned)
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That person is not on your team.")
    db.delete(row)
    db.commit()
    log_activity(db, user.id, "team", f"Removed {cleaned} from the team")
    return team_summary(db, user)


@router.post("/leave", response_model=TeamOut)
def leave_team(user: User = Depends(current_user), db: Session = Depends(get_db)) -> TeamOut:
    row = membership(db, user)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="You are not on a team.")
    owner_id = row.owner_id
    db.delete(row)
    db.commit()
    log_activity(db, owner_id, "team", f"{user.email} left the team")
    return team_summary(db, user)
