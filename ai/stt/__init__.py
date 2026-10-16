"""Speech-to-text: relays browser audio to Sarvam and transcripts back."""

from stt.proxy import STREAM_PATHS, handle_proxy_connection

__all__ = ["STREAM_PATHS", "handle_proxy_connection"]
