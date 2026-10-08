"""
DDS Pathology Inference microservice (companion to analytics/transcription).

Implements the contract expected by server `POST /api/ai/pathology/analyze`:
multipart image upload → {modelVersion, anomalyScore, confidenceScore,
regions[]}, where regions are normalised [0..1] bounding boxes.

Two backends:
  * ``PATHOLOGY_MODEL`` set + torch/transformers installed → runs that
    Hugging Face image-classification model; its top-label probability is the
    confidence and its label semantics drive the anomaly score.
  * Otherwise → ``dds-patho-heuristic-1.0``: a deterministic image-space
    analysis (grid density + gradient energy) that flags the focal regions
    worth a pathologist's attention. An honest baseline, not a validated
    medical model — every result is stored requiresReview server-side.
"""

import io
import os
from typing import List

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image
from pydantic import BaseModel, Field

app = FastAPI(title="DDS Pathology Inference", version="1.0.0")

GRID = 8  # 8×8 analysis grid → regions merge from hot cells


class Region(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class PathologyResult(BaseModel):
    modelVersion: str
    anomalyScore: float = Field(ge=0, le=1)
    confidenceScore: float = Field(ge=0, le=1)
    regions: List[Region]


# ── optional HF image-classification backend ────────────────────────────────
_classifier = None
_classifier_error = None
if os.environ.get("PATHOLOGY_MODEL"):
    try:
        from transformers import pipeline  # type: ignore

        _classifier = pipeline(
            "image-classification", model=os.environ["PATHOLOGY_MODEL"]
        )
    except Exception as exc:  # pragma: no cover - env dependent
        _classifier_error = str(exc)

_POSITIVE_HINTS = ("malign", "cancer", "abnormal", "lesion", "tumor", "tumour",
                   "positive", "carcinoma", "neoplasm")


def _pixels(image: Image.Image) -> np.ndarray:
    """RGB float array in [0,1], resized small for speed."""
    return np.asarray(
        image.convert("RGB").resize((224, 224)), dtype=np.float32
    ) / 255.0


def _cell_metrics(px: np.ndarray) -> np.ndarray:
    """Per-cell abnormality proxy: darkness, saturation and local gradient
    energy (dense/oddly-stained tissue reads high)."""
    gray = px.mean(axis=2)
    sat = px.max(axis=2) - px.min(axis=2)
    gx = np.abs(np.gradient(gray, axis=1))
    gy = np.abs(np.gradient(gray, axis=0))
    energy = gx + gy

    cells = np.zeros((GRID, GRID), dtype=np.float32)
    h, w = gray.shape
    ch, cw = h // GRID, w // GRID
    for r in range(GRID):
        for c in range(GRID):
            sl = (slice(r * ch, (r + 1) * ch), slice(c * cw, (c + 1) * cw))
            cells[r, c] = (
                0.5 * (1.0 - gray[sl].mean())   # darker tissue
                + 0.3 * sat[sl].mean()          # stain saturation
                + 0.2 * energy[sl].mean()       # structure/edges
            )
    return cells


def _hot_regions(cells: np.ndarray) -> tuple[np.ndarray, List[Region]]:
    """Threshold the grid, then merge 4-connected hot cells into boxes."""
    mean, std = cells.mean(), cells.std()
    if std < 1e-6:
        return 0.0, []
    z = (cells - mean) / std
    hot = z > 1.0  # cells >1σ above the slide's own baseline

    visited = np.zeros_like(hot, dtype=bool)
    regions: List[Region] = []
    for r in range(GRID):
        for c in range(GRID):
            if not hot[r, c] or visited[r, c]:
                continue
            stack, comp = [(r, c)], []
            visited[r, c] = True
            while stack:
                cr, cc = stack.pop()
                comp.append((cr, cc))
                for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nr, nc = cr + dr, cc + dc
                    if (
                        0 <= nr < GRID
                        and 0 <= nc < GRID
                        and hot[nr, nc]
                        and not visited[nr, nc]
                    ):
                        visited[nr, nc] = True
                        stack.append((nr, nc))
            rows = [p[0] for p in comp]
            cols = [p[1] for p in comp]
            regions.append(
                Region(
                    x=min(cols) / GRID,
                    y=min(rows) / GRID,
                    width=(max(cols) - min(cols) + 1) / GRID,
                    height=(max(rows) - min(rows) + 1) / GRID,
                )
            )
    anomaly = float(np.clip(z[hot].mean() / 3.0 if hot.any() else 0.0, 0, 1))
    return anomaly, regions[:20]


def _classify(image: Image.Image):
    if _classifier is None:
        return None
    try:
        out = _classifier(image)
        if not out:
            return None
        top = out[0]
        label = str(top.get("label", "")).lower()
        score = float(top.get("score", 0.0))
        positive = any(h in label for h in _POSITIVE_HINTS)
        anomaly = score if positive else (1.0 - score) * 0.5
        return (
            os.environ["PATHOLOGY_MODEL"],
            float(np.clip(anomaly, 0, 1)),
            float(np.clip(score, 0, 1)),
        )
    except Exception:  # pragma: no cover - model-specific failures
        return None


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "DDS Pathology Inference",
        "backend": (
            "model"
            if _classifier is not None
            else "heuristic" + (f" (model load failed: {_classifier_error})"
                                if _classifier_error else "")
        ),
    }


@app.post("/analyze", response_model=PathologyResult)
async def analyze(file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty upload")
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception:
        raise HTTPException(400, "unsupported image")

    cells = _cell_metrics(_pixels(image))
    heuristic_anomaly, regions = _hot_regions(cells)

    if (model := _classify(image)) is not None:
        version, anomaly, confidence = model
    else:
        version = "dds-patho-heuristic-1.0"
        anomaly = heuristic_anomaly
        # Heuristic confidence is deliberately modest — draft output.
        confidence = 0.35 + 0.25 * heuristic_anomaly

    return PathologyResult(
        modelVersion=version,
        anomalyScore=round(anomaly, 4),
        confidenceScore=round(confidence, 4),
        regions=regions,
    )
