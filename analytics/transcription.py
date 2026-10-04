"""Local Whisper transcription service. Run on loopback; model files must exist locally.

Batch mode:  POST /transcribe   (multipart file upload)
Streaming:   WS  /stream        (raw PCM s16le @16kHz -> agreement-confirmed text)

The stream endpoint only emits text that survives repeated decoding of a
rolling audio window — the client treats everything it receives as final.
"""
import asyncio
import hmac
import io
import json
import os
import sys
import tempfile
import types
import wave
from functools import lru_cache
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile, WebSocket, WebSocketDisconnect

from streaming import WhisperStreamSession

# PyAV's bundled FFmpeg DLLs can be blocked by application-control policies
# (WDAC/AppLocker). faster-whisper only needs av to decode audio *files* —
# numpy PCM input bypasses it entirely — so a stub lets the import succeed and
# the batch endpoint falls back to a stdlib WAV decoder.
try:
    import av  # noqa: F401
    _AV_AVAILABLE = True
except ImportError:
    sys.modules["av"] = types.ModuleType("av")
    _AV_AVAILABLE = False

app = FastAPI(title="Disease Detection System transcription")
MAX_BYTES = 20 * 1024 * 1024
# Whisper tokens cover English and Shona. Ndebele has no Whisper language
# token — no model can transcribe it; the caller must fall back to manual
# transcription rather than produce a garbage transcript.
SUPPORTED_LANGUAGES = {"en", "sn"}


@lru_cache(maxsize=1)
def model():
    # A local directory under analytics/models is preferred (offline); a bare
    # name like "turbo" or a HF repo id is downloaded by faster-whisper once
    # into its cache. WHISPER_MODEL_PATH overrides either.
    checkpoint = os.environ.get("WHISPER_MODEL_PATH", "")
    if not checkpoint:
        default_dir = Path(__file__).parent / "models" / "turbo"
        checkpoint = str(default_dir) if default_dir.is_dir() else "turbo"
    elif not Path(checkpoint).is_dir() and (Path(checkpoint).is_absolute() or checkpoint.startswith(".")):
        raise HTTPException(503, "Local Whisper checkpoint is not configured")
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise HTTPException(503, "faster-whisper is not available in this environment") from exc
    # auto: CUDA/float16 when a GPU is present, CPU/int8 otherwise.
    return WhisperModel(checkpoint, device="auto", compute_type="auto")


def _check_key(authorization: str) -> None:
    key = os.environ.get("WHISPER_API_KEY", "")
    if key and not hmac.compare_digest(authorization, f"Bearer {key}"):
        raise HTTPException(401, "Unauthorized")


def _check_language(language: str) -> None:
    if language not in SUPPORTED_LANGUAGES:
        raise HTTPException(422, f"Whisper does not support language '{language}'. Use manual transcription.")


@app.get("/health")
def health():
    model()
    return {"status": "ok", "service": "Disease Detection System transcription"}


@app.post("/transcribe")
def transcribe(file: UploadFile = File(...), language: str = Form("en"), authorization: str = Header("")):
    _check_key(authorization)
    _check_language(language)
    engine = model()
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Audio exceeds 20 MB")
    try:
        if _AV_AVAILABLE:
            name = None
            try:
                with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as audio:
                    name = audio.name
                    audio.write(data)
                segments, _ = engine.transcribe(name, language=language, beam_size=1,
                                                condition_on_previous_text=False, vad_filter=True)
            finally:
                if name:
                    Path(name).unlink(missing_ok=True)
        else:
            segments, _ = engine.transcribe(_decode_wav(data), language=language, beam_size=1,
                                            condition_on_previous_text=False, vad_filter=True)
        text = " ".join(segment.text.strip() for segment in segments).strip()
        if not text:
            raise HTTPException(422, "No speech detected. Upload a clear recording containing speech.")
        if len(text) > 16000:
            raise HTTPException(422, "Transcript is too long. Split the recording into shorter parts.")
        return {"text": text}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(422, "Unable to decode or transcribe this recording. Try a shorter WAV or MP3 file.") from exc


def _decode_wav(data: bytes) -> np.ndarray:
    """Stdlib fallback decoder for 16-bit PCM WAV when PyAV is unavailable."""
    with wave.open(io.BytesIO(data), "rb") as wav:
        if wav.getsampwidth() != 2:
            raise ValueError("Only 16-bit PCM WAV is supported on this host")
        frames = wav.readframes(wav.getnframes())
        audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        channels = wav.getnchannels()
        if channels > 1:
            audio = audio.reshape(-1, channels).mean(axis=1)
        rate = wav.getframerate()
    if rate != 16000:
        duration = len(audio) / rate
        audio = np.interp(
            np.linspace(0, duration, int(duration * 16000), endpoint=False),
            np.linspace(0, duration, len(audio), endpoint=False),
            audio,
        ).astype(np.float32)
    return audio


@app.websocket("/stream")
async def stream(ws: WebSocket):
    """Streaming transcription.

    Handshake: Authorization header checked against WHISPER_API_KEY, then the
    client sends a JSON init frame {"language": "en"|"sn"}. Subsequent binary
    frames are PCM s16le @16kHz; a text frame {"type":"finalize"} flushes the
    session. Server emits {"final":..., "pending":...} events and
    {"final":..., "done": true} on close.
    """
    key = os.environ.get("WHISPER_API_KEY", "")
    auth = ws.headers.get("authorization", "")
    if key and not hmac.compare_digest(auth, f"Bearer {key}"):
        await ws.close(code=4401)
        return
    await ws.accept()
    try:
        init = json.loads(await ws.receive_text())
        language = init.get("language", "en")
        if language not in SUPPORTED_LANGUAGES:
            await ws.send_json({"error": f"Whisper does not support language '{language}'. Use manual transcription.", "done": True})
            await ws.close()
            return
        session = WhisperStreamSession(model(), language)
        while True:
            message = await ws.receive()
            if message.get("type") == "websocket.disconnect":
                break
            if message.get("bytes") is not None:
                session.add_audio(message["bytes"])
                if session.over_limit:
                    await ws.send_json({"error": "Session audio limit reached", "done": True})
                    break
                # Decoding is CPU/GPU-bound — run it off the event loop.
                event = await asyncio.to_thread(session.decode)
                if event:
                    await ws.send_json(event)
            elif message.get("text") is not None:
                try:
                    payload = json.loads(message["text"])
                except json.JSONDecodeError:
                    continue
                if payload.get("type") == "finalize":
                    await ws.send_json(await asyncio.to_thread(session.flush))
                    break
    except WebSocketDisconnect:
        return
    except Exception:
        try:
            await ws.send_json({"error": "Transcription stream failed", "done": True})
        except Exception:
            pass
    finally:
        try:
            await ws.close()
        except Exception:
            pass
