"""Download the English model once; inference stays local afterward."""
from pathlib import Path
from faster_whisper.utils import download_model

target = Path(__file__).parent / "models" / "base.en"
download_model("base.en", output_dir=str(target))
print(f"Disease Detection System transcription model ready: {target}")
