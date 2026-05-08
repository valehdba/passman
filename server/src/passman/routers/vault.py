"""Vault endpoints — CRUD on encrypted vault items.

The server treats every item as an opaque ciphertext blob plus its type tag.
No business logic operates on plaintext.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, status
from sqlalchemy import select

from ..deps import CurrentUserDep, SessionDep
from ..errors import VaultItemNotFoundError
from ..models import VaultItem
from ..schemas import (
    VaultItemCreate,
    VaultItemOut,
    VaultItemUpdate,
    VaultListResponse,
)

router = APIRouter(prefix="/api/vault", tags=["vault"])


@router.get("/items", response_model=VaultListResponse)
async def list_items(user: CurrentUserDep, session: SessionDep) -> VaultListResponse:
    stmt = (
        select(VaultItem)
        .where(VaultItem.user_id == user.id)
        .order_by(VaultItem.updated_at.desc())
    )
    items = (await session.execute(stmt)).scalars().all()
    return VaultListResponse(items=[VaultItemOut.model_validate(i) for i in items])


@router.post(
    "/items", response_model=VaultItemOut, status_code=status.HTTP_201_CREATED
)
async def create_item(
    payload: VaultItemCreate,
    user: CurrentUserDep,
    session: SessionDep,
) -> VaultItemOut:
    item = VaultItem(
        user_id=user.id,
        item_type=payload.item_type,
        encrypted_data=payload.encrypted_data,
    )
    session.add(item)
    await session.flush()
    return VaultItemOut.model_validate(item)


@router.get("/items/{item_id}", response_model=VaultItemOut)
async def get_item(
    item_id: uuid.UUID,
    user: CurrentUserDep,
    session: SessionDep,
) -> VaultItemOut:
    item = await _load_owned_item(session, user.id, item_id)
    return VaultItemOut.model_validate(item)


@router.patch("/items/{item_id}", response_model=VaultItemOut)
async def update_item(
    item_id: uuid.UUID,
    payload: VaultItemUpdate,
    user: CurrentUserDep,
    session: SessionDep,
) -> VaultItemOut:
    item = await _load_owned_item(session, user.id, item_id)
    if payload.item_type is not None:
        item.item_type = payload.item_type
    if payload.encrypted_data is not None:
        item.encrypted_data = payload.encrypted_data
    await session.flush()
    return VaultItemOut.model_validate(item)


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_item(
    item_id: uuid.UUID,
    user: CurrentUserDep,
    session: SessionDep,
) -> None:
    item = await _load_owned_item(session, user.id, item_id)
    await session.delete(item)


async def _load_owned_item(
    session: SessionDep, user_id: uuid.UUID, item_id: uuid.UUID  # type: ignore[valid-type]
) -> VaultItem:
    stmt = select(VaultItem).where(
        VaultItem.id == item_id, VaultItem.user_id == user_id
    )
    item = (await session.execute(stmt)).scalar_one_or_none()
    if item is None:
        raise VaultItemNotFoundError()
    return item
