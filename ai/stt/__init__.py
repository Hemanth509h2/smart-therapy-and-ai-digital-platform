"""Speech-to-text: relays browser audio to Sarvam and transcripts back."""

from stt.proxy import STREAM_PATHS, handle_proxy_connection, verify_stt_token

__all__ = ["STREAM_PATHS", "handle_proxy_connection", "verify_stt_token"]
