"""Streaming decode session for real-time verbal-autopsy transcription.

Audio arrives as raw PCM (16 kHz mono, s16le). A rolling window is re-decoded
as new audio arrives with word-level timestamps; words whose absolute end
time moves past the committed frontier are emitted as ``final``. Words near
the window's trailing edge may be truncated mid-word, so they are held as
``pending`` until more audio confirms them. Committed text never changes —
there is no draft tier in the UI.

Latency is bounded by the decode step (~1-2.5 s on CPU, ~0.3-0.5 s on GPU for
large-v3-turbo)."""
from __future__ import annotations

import numpy as np

SAMPLE_RATE = 16000
BYTES_PER_SECOND = SAMPLE_RATE * 2  # s16le mono
# Rolling decode window (seconds) — enough context for accuracy without
# decoding the whole session each pass.
WINDOW_SECONDS = 5.0
# Decode is triggered once this much new audio has accumulated. Decodes are
# serialized per session; on CPU a turbo pass can take longer than the step
# itself, so keep this well above sub-second cadence.
STEP_SECONDS = 2.0
# Words ending within this margin of the window's trailing edge are held
# pending — they may be truncated mid-word.
TAIL_SAFETY_SECONDS = 0.6
# Keep a little extra audio beyond the window for VAD context.
PAD_SECONDS = 0.5
# Hard cap on the in-memory buffer (~5 minutes ~ 19 MB).
MAX_BUFFER_SECONDS = 300.0


def pcm_bytes_to_float32(data: bytes) -> np.ndarray:
    """s16le PCM -> float32 in [-1, 1]."""
    if not data:
        return np.zeros(0, dtype=np.float32)
    return np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0


class WhisperStreamSession:
    """One streaming transcription session bound to a loaded WhisperModel."""

    def __init__(self, engine, language: str):
        self.engine = engine
        self.language = language
        self._buffer = bytearray()
        self._dropped_bytes = 0          # bytes discarded when the window slid
        self._decoded_at = 0             # buffer size at the last decode
        self._busy = False               # a decode pass is in flight
        self.confirmed_time = 0.0        # absolute seconds committed so far
        self.done = False

    def add_audio(self, data: bytes) -> None:
        self._buffer.extend(data)

    @property
    def over_limit(self) -> bool:
        return len(self._buffer) / BYTES_PER_SECOND > MAX_BUFFER_SECONDS + WINDOW_SECONDS

    @property
    def _absolute_end(self) -> float:
        return (self._dropped_bytes + len(self._buffer)) / BYTES_PER_SECOND

    def _decode_window(self) -> tuple[list, float]:
        """Decode the rolling window; returns (word_list, window_start_seconds)."""
        keep = int((WINDOW_SECONDS + PAD_SECONDS) * BYTES_PER_SECOND)
        if len(self._buffer) > keep:
            drop = len(self._buffer) - keep
            del self._buffer[:drop]
            self._dropped_bytes += drop
        start_abs = self._dropped_bytes / BYTES_PER_SECOND
        audio = pcm_bytes_to_float32(bytes(self._buffer))
        if len(audio) < int(0.2 * SAMPLE_RATE):
            return [], start_abs
        segments, _ = self.engine.transcribe(
            audio,
            language=self.language,
            beam_size=1,
            condition_on_previous_text=False,
            vad_filter=True,
            word_timestamps=True,
        )
        words = [
            w for seg in segments for w in (seg.words or [])
            if w.word.strip()
        ]
        return words, start_abs

    def decode(self) -> dict | None:
        """Decode the rolling window if enough new audio arrived.

        Returns {"final": str, "pending": str} or None when nothing new.
        Skips (rather than queues) when a previous decode is still running —
        the loop decodes the freshest buffer, so the backlog self-corrects."""
        if self._busy:
            return None
        if len(self._buffer) - (self._decoded_at - self._dropped_bytes) < int(STEP_SECONDS * BYTES_PER_SECOND):
            return None
        self._busy = True
        self._decoded_at = self._dropped_bytes + len(self._buffer)
        try:
            words, start_abs = self._decode_window()
            commit_before = self._absolute_end - TAIL_SAFETY_SECONDS

            finals: list[str] = []
            pending: list[str] = []
            for w in words:
                end_abs = start_abs + w.end
                if end_abs <= self.confirmed_time:
                    continue  # already committed in an earlier pass
                if end_abs <= commit_before:
                    finals.append(w.word.strip())
                    self.confirmed_time = end_abs
                else:
                    pending.append(w.word.strip())

            event: dict = {}
            if finals:
                event["final"] = " ".join(finals)
            if pending:
                event["pending"] = " ".join(pending)
            return event or None
        finally:
            self._busy = False

    def flush(self) -> dict:
        """Final decode on close — every remaining word becomes final."""
        self._busy = True
        try:
            words, start_abs = self._decode_window()
        finally:
            self._busy = False
        finals = [w.word.strip() for w in words if start_abs + w.end > self.confirmed_time]
        self.done = True
        return {"final": " ".join(finals), "done": True}
