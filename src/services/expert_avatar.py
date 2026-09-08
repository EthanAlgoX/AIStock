"""Bounded PNG avatars; never fetch user-provided URLs."""
import base64
import binascii
import struct


def validate_avatar(value: str | None) -> str | None:
    if not value:
        return None
    prefix = "data:image/png;base64,"
    if not isinstance(value, str) or not value.startswith(prefix) or len(value) > 180000:
        raise ValueError("Avatar must be a PNG data URL under 180 KB")
    try:
        data = base64.b64decode(value[len(prefix):], validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("Invalid avatar encoding") from exc
    if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[8:16] != b"\x00\x00\x00\rIHDR":
        raise ValueError("Invalid PNG avatar")
    width, height = struct.unpack(">II", data[16:24])
    if not (1 <= width <= 512 and 1 <= height <= 512):
        raise ValueError("Avatar dimensions must be between 1 and 512 pixels")
    offset, image_data, ended = 8, False, False
    while offset + 12 <= len(data):
        length = int.from_bytes(data[offset:offset + 4], "big")
        end = offset + 12 + length
        chunk = data[offset + 4:offset + 8]
        if end > len(data) or binascii.crc32(data[offset + 4:end - 4]) != int.from_bytes(data[end - 4:end], "big"):
            raise ValueError("Corrupt PNG avatar")
        image_data |= chunk == b"IDAT" and length > 0
        offset = end
        if chunk == b"IEND":
            ended = length == 0 and offset == len(data)
            break
    if not image_data or not ended:
        raise ValueError("Incomplete PNG avatar")
    return value
