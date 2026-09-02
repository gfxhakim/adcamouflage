"""Deep container and bitstream scrubbing.

``-map_metadata -1`` only clears the *tag* dictionaries. Two encoder
signatures survive that and are trivially readable by anyone inspecting the
file:

* the H.264/HEVC **SEI user-data-unregistered NAL**, into which x264 writes its
  version string *and its complete option set* ("x264 - core 164 ... cabac=1
  ref=3 ..."), which is a near-unique encoder fingerprint;
* the 32-byte **compressorname** field inside the MP4/MOV ``avc1`` sample
  description box, which ffmpeg fills with ``Lavc libx264``;
* the Matroska/WebM **MuxingApp / WritingApp** elements.

This module removes all three. The MP4 and Matroska passes rewrite fixed-size
fields in place, so no box offset or index in the file moves.
"""

from __future__ import annotations

import logging
import subprocess
from functools import lru_cache
from pathlib import Path

from .config import settings

logger = logging.getLogger(__name__)

# Sample-entry formats that carry a 32-byte compressorname.
_VISUAL_SAMPLE_ENTRIES = (b"avc1", b"avc3", b"hev1", b"hvc1", b"mp4v", b"vp09", b"av01", b"jpeg")

# Offset of compressorname inside a VisualSampleEntry, measured from the start
# of the box: 8 (size+type) + 8 (reserved+data_reference_index)
# + 16 (pre_defined+reserved) + 4 (width+height) + 8 (resolutions)
# + 4 (reserved) + 2 (frame_count) = 50.
_COMPRESSOR_OFFSET = 50
_COMPRESSOR_LENGTH = 32

# EBML element ids.
_EBML_MUXING_APP = b"\x4d\x80"
_EBML_WRITING_APP = b"\x57\x41"
_EBML_TAG_STRING = b"\x44\x87"


@lru_cache(maxsize=1)
def _available_bitstream_filters() -> frozenset[str]:
    try:
        result = subprocess.run(
            [settings.ffmpeg_binary, "-hide_banner", "-bsfs"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return frozenset()
    return frozenset(line.strip() for line in result.stdout.splitlines() if line.strip())


def bitstream_filter_args(video_codec: str) -> list[str]:
    """ffmpeg args that drop SEI NALs for the target codec, if supported."""

    if "filter_units" not in _available_bitstream_filters():
        logger.debug("filter_units bsf unavailable; SEI scrubbing skipped")
        return []
    if video_codec == "libx264":
        # NAL type 6 == SEI for H.264.
        return ["-bsf:v", "filter_units=remove_types=6"]
    if video_codec in {"libx265", "hevc"}:
        # 39 == PREFIX_SEI, 40 == SUFFIX_SEI for HEVC.
        return ["-bsf:v", "filter_units=remove_types=39|40"]
    return []


def _read_uint32(buffer: bytes, offset: int) -> int:
    return int.from_bytes(buffer[offset : offset + 4], "big")


def strip_mp4_compressor_names(path: Path) -> int:
    """Blank the compressorname of every visual sample entry. Returns the count.

    The field is a fixed 32-byte Pascal-style string, so it is overwritten with
    zeros in place; the file length and every box offset stay untouched.
    """

    try:
        data = bytearray(path.read_bytes())
    except OSError:
        logger.warning("could not open %s for container scrubbing", path)
        return 0

    scrubbed = 0
    limit = len(data)
    for tag in _VISUAL_SAMPLE_ENTRIES:
        start = 0
        while True:
            index = data.find(tag, start)
            if index == -1:
                break
            start = index + 4
            box_start = index - 4
            if box_start < 0:
                continue

            field_start = box_start + _COMPRESSOR_OFFSET
            field_end = field_start + _COMPRESSOR_LENGTH
            if field_end + 4 > limit:
                continue

            # Validate that this really is a VisualSampleEntry rather than a
            # coincidental match (e.g. inside ftyp's compatible_brands list):
            # the box size must be plausible and the two fields that follow
            # compressorname are depth (0x0018) and pre_defined (0xFFFF).
            box_size = _read_uint32(data, box_start)
            if box_size < _COMPRESSOR_OFFSET + _COMPRESSOR_LENGTH + 4 or box_start + box_size > limit:
                continue
            if data[field_end : field_end + 4] != b"\x00\x18\xff\xff":
                continue
            if not any(data[field_start:field_end]):
                continue

            data[field_start:field_end] = b"\x00" * _COMPRESSOR_LENGTH
            scrubbed += 1

    if scrubbed:
        try:
            path.write_bytes(bytes(data))
        except OSError:
            logger.warning("could not write scrubbed container %s", path)
            return 0
    return scrubbed


def _read_vint_size(data: bytes, offset: int) -> tuple[int, int]:
    """Decode an EBML size VINT. Returns ``(value, bytes_consumed)``."""

    if offset >= len(data):
        return -1, 0
    first = data[offset]
    if first == 0:
        return -1, 0
    length = 1
    mask = 0x80
    while not first & mask:
        mask >>= 1
        length += 1
        if length > 8:
            return -1, 0
    value = first & (mask - 1)
    for i in range(1, length):
        if offset + i >= len(data):
            return -1, 0
        value = (value << 8) | data[offset + i]
    return value, length


def strip_matroska_app_tags(path: Path) -> int:
    """Zero the Matroska/WebM writer signatures in place.

    Three places carry them: the Segment Info ``MuxingApp`` and ``WritingApp``
    elements, and the per-track ``ENCODER`` SimpleTag. All are length-prefixed
    strings, so the payloads are overwritten with zeros and the file layout is
    preserved (EBML strings are explicitly allowed to be zero-padded).
    """

    try:
        data = bytearray(path.read_bytes())
    except OSError:
        return 0

    scrubbed = 0

    # Segment Info lives near the top of the file.
    horizon = min(len(data), 262_144)
    for element_id in (_EBML_MUXING_APP, _EBML_WRITING_APP):
        index = data.find(element_id, 0, horizon)
        if index == -1:
            continue
        if _zero_ebml_payload(data, index + len(element_id)):
            scrubbed += 1

    # Per-track "ENCODER" SimpleTag: <TagName>ENCODER</TagName><TagString>...
    start = 0
    while True:
        index = data.find(b"ENCODER", start)
        if index == -1:
            break
        start = index + 7
        window = data.find(_EBML_TAG_STRING, index, index + 12)
        if window == -1:
            continue
        if _zero_ebml_payload(data, window + len(_EBML_TAG_STRING)):
            scrubbed += 1

    if scrubbed:
        try:
            path.write_bytes(bytes(data))
        except OSError:
            return 0
    return scrubbed


def _zero_ebml_payload(data: bytearray, size_offset: int, max_size: int = 256) -> bool:
    """Zero the payload of the EBML element whose size VINT starts here."""

    size, consumed = _read_vint_size(bytes(data), size_offset)
    if size <= 0 or consumed == 0 or size > max_size:
        return False
    payload_start = size_offset + consumed
    payload_end = payload_start + size
    if payload_end > len(data):
        return False
    if not any(data[payload_start:payload_end]):
        return False
    data[payload_start:payload_end] = b"\x00" * size
    return True


def scrub_container(path: Path) -> dict[str, int]:
    """Run every container-level scrub appropriate for ``path``."""

    suffix = path.suffix.lower()
    report = {"compressor_names": 0, "ebml_app_tags": 0}
    if suffix in {".mp4", ".m4v", ".mov"}:
        report["compressor_names"] = strip_mp4_compressor_names(path)
    elif suffix in {".webm", ".mkv"}:
        report["ebml_app_tags"] = strip_matroska_app_tags(path)
    return report
