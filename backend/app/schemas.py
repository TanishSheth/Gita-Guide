"""
Pydantic (v2) request/response models used by the FastAPI routes.
"""
from datetime import datetime
from typing import List, Literal, Optional
from pydantic import BaseModel, EmailStr, Field


class TranslationBlock(BaseModel):
    label: str
    text: str


class NeighborVerse(BaseModel):
    chapter: int
    verse: int
    sanskrit: str = ""
    transliteration: str = ""
    english_translation: str = ""
    translations: List[TranslationBlock] = []


class VerseSource(BaseModel):
    chapter: int
    verse: int
    sanskrit: str
    transliteration: str
    english_translation: str
    similarity: Optional[float] = None
    translations: List[TranslationBlock] = []
    neighbors: List[NeighborVerse] = []


class ChatMessageOut(BaseModel):
    id: str
    role: str
    content: str
    sources: List[VerseSource] = []
    feedback: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ChatSessionOut(BaseModel):
    id: str
    title: str
    created_at: datetime
    bookmarked: bool = False

    class Config:
        from_attributes = True


class ChatSessionDetail(ChatSessionOut):
    messages: List[ChatMessageOut] = []


class BookmarkChatRequest(BaseModel):
    bookmarked: bool


class ChatRequest(BaseModel):
    message: str
    attach_memory_context: bool = True
    response_mode: Literal["brief", "deep", "practical"] = "practical"
    temperature: Optional[float] = None
    language: Literal["en", "hi", "gu", "es"] = "en"


class ChatResponse(BaseModel):
    session_id: str
    answer: str
    sources: List[VerseSource]
    title: str
    assistant_message_id: Optional[str] = None


class FeedbackRequest(BaseModel):
    rating: Optional[Literal["up", "down"]] = None


class UsageOut(BaseModel):
    requests_last_hour: int
    limit: int
    tokens_today: int
    remaining: int


class TelemetrySummary(BaseModel):
    chat_events: int
    cache_hits: int
    feedback_up: int
    feedback_down: int
    avg_latency_ms: Optional[float] = None
    tokens_today: int


class RegisterRequest(BaseModel):
    name: str = ""
    email: EmailStr
    password: str = Field(min_length=8)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    remember: bool = False


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    password: str = Field(min_length=8)


class UserOut(BaseModel):
    id: str
    email: str
    name: str = ""
    llm_provider: str = "ollama"
    llm_model: str = "llama3.2"
    llm_base_url: Optional[str] = None
    has_api_key: bool = False
    api_key_hint: Optional[str] = None

    class Config:
        from_attributes = True


class LlmSettingsUpdate(BaseModel):
    llm_provider: str = Field(min_length=1, max_length=40)
    llm_model: str = Field(min_length=1, max_length=120)
    llm_base_url: Optional[str] = None
    api_key: Optional[str] = None
    clear_api_key: bool = False


class LlmProviderInfo(BaseModel):
    id: str
    label: str
    needs_key: bool


class LlmCompanyInfo(BaseModel):
    id: str
    label: str
    needs_key: bool
    needs_base_url: bool = False
    models: List[str] = []
    key_placeholder: str = "sk-…"
    hint: str = ""


class OllamaSuggestion(BaseModel):
    id: str
    label: str


class LlmStatusOut(BaseModel):
    default_provider: str
    ollama_base_url: str
    ollama_online: bool
    ollama_message: str
    ollama_models: List[str] = []
    suggested_ollama: List[OllamaSuggestion] = []
    openai_models: List[str] = []
    providers: List[LlmProviderInfo] = []
    companies: List[LlmCompanyInfo] = []


class AuthResponse(BaseModel):
    token: str
    remember: bool
    idle_minutes: int
    user: UserOut


class ForgotPasswordResponse(BaseModel):
    status: str
    message: str
    emailed: bool = False
    reset_url: Optional[str] = None
