"""Request/response shapes. Pydantic enforces them and FastAPI turns violations into 422."""
import base64
import binascii
import re
from typing import Optional
from pydantic import BaseModel, Field, field_validator


MAX_IMAGES = 3
MAX_IMAGE_CHARS = 5_000_000  # ~3.7 MB of base64 per image
MAX_SYSTEM_PROMPT = 4000
# formats every vision provider accepts (SVG etc. would be rejected upstream)
IMAGE_DATA_URL = re.compile(r"^data:image/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=\s]+)$")


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=128)
    message: str
    system_prompt: Optional[str] = None
    # bonus: optional images as data URLs ("data:image/png;base64,...")
    images: Optional[list[str]] = None

    @field_validator("images")
    @classmethod
    def valid_images(cls, v: Optional[list[str]]) -> Optional[list[str]]:
        if not v:
            return None
        if len(v) > MAX_IMAGES:
            raise ValueError(f"at most {MAX_IMAGES} images per message")
        for img in v:
            if len(img) > MAX_IMAGE_CHARS:
                raise ValueError("image too large (max ~3.7 MB)")
            match = IMAGE_DATA_URL.match(img)
            if not match:
                raise ValueError("images must be PNG, JPEG, GIF or WebP base64 data URLs "
                                 "(data:image/png;base64,...)")
            try:
                base64.b64decode(match.group(2), validate=False)
            except (binascii.Error, ValueError):
                raise ValueError("image data is not valid base64") from None
        return v

    @field_validator("message")
    @classmethod
    def message_length(cls, v: str) -> str:
        v = v.strip()  # spec: 1-4000 chars AFTER trimming whitespace
        if not 1 <= len(v) <= 4000:
            raise ValueError("message must be 1-4000 characters after trimming")
        return v

    @field_validator("system_prompt")
    @classmethod
    def blank_prompt_is_none(cls, v: Optional[str]) -> Optional[str]:
        # an empty/whitespace prompt means "use the saved one, else the default"
        if v is None:
            return None
        v = v.strip()
        if len(v) > MAX_SYSTEM_PROMPT:
            raise ValueError(f"system_prompt must be at most {MAX_SYSTEM_PROMPT} characters")
        return v or None


class ChatMetadata(BaseModel):
    resolution_source: str
    model: str
    latency_ms: int
    input_tokens: int
    output_tokens: int
    key_id: Optional[str]
    fallback_attempts: int


class ChatResponse(BaseModel):
    session_id: str
    reply: str
    metadata: ChatMetadata
