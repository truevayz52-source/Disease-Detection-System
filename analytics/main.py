"""
DDS ML Analytics microservice (Chapter 5.5 — ML Analytics & GIS Engine).

Provides scikit-learn powered spatial clustering (DBSCAN over case
coordinates, haversine metric), linear/seasonal mortality forecasting,
and batch forecasting for per-district and per-cause projections.
The Express API calls these endpoints with a short timeout and falls back to
its built-in Node implementation when this service is unreachable (Ch 5.3).
"""

from fastapi import FastAPI
from pydantic import BaseModel, Field
from typing import List, Optional, Tuple
import numpy as np
from sklearn.cluster import DBSCAN
from sklearn.linear_model import LinearRegression

app = FastAPI(title="Disease Detection System Analytics", version="1.0.0")


class CasePoint(BaseModel):
    id: str
    category: str
    lat: float
    lng: float
    district: Optional[str] = None


class ClusterRequest(BaseModel):
    points: List[CasePoint] = Field(default_factory=list)
    eps_km: float = 25.0


class ClusterOut(BaseModel):
    category: str
    count: int
    centroid_lat: float
    centroid_lng: float
    ids: List[str]


class SeriesPoint(BaseModel):
    index: int
    count: float


class ForecastRequest(BaseModel):
    series: List[SeriesPoint] = Field(default_factory=list)
    periods: int = 4
    seasonal: int = 0  # e.g. 52 for weekly, 365 for daily; 0 = plain linear


class CusumSeries(BaseModel):
    district: str
    category: str
    counts: List[float] = Field(default_factory=list)


class CusumRequest(BaseModel):
    series: List[CusumSeries] = Field(default_factory=list)
    limit: float = 3.0


def _fit_and_predict(counts: List[float], indices: List[int], periods: int, seasonal: int) -> Tuple[List[dict], float, float, float, str]:
    """Fit a trend (+ optional Fourier seasonality) linear model and predict ahead."""
    y = np.array([float(c) for c in counts])
    x = np.array([int(i) for i in indices]).reshape(-1, 1)
    # Need at least 8 points to fit trend + 4 Fourier terms without overfitting.
    use_seasonal = seasonal > 0 and len(indices) >= 8
    if use_seasonal:
        s = 2 * np.pi * x.flatten() / seasonal
        X = np.column_stack([x, np.sin(s), np.cos(s), np.sin(2 * s), np.cos(2 * s)])
        method = "seasonal"
    else:
        X = x
        method = "linear"

    model = LinearRegression().fit(X, y)
    y_pred = model.predict(X)
    # Residual standard deviation used for an approximate 95% prediction band.
    residuals = y - y_pred
    p = X.shape[1]
    df = max(1, len(y) - p)
    sigma = float(np.sqrt(np.sum(residuals ** 2) / df)) if len(y) > 1 else 0.0

    last = max(indices)
    forecast = []
    coef = float(model.coef_[0])
    intercept = float(model.intercept_)

    for k in range(1, periods + 1):
        idx = last + k
        if use_seasonal:
            s = 2 * np.pi * idx / seasonal
            Xf = np.array([[idx, np.sin(s), np.cos(s), np.sin(2 * s), np.cos(2 * s)]])
        else:
            Xf = np.array([[idx]])
        pred = max(0.0, float(model.predict(Xf)[0]))
        lower = max(0.0, round(pred - 1.96 * sigma, 2))
        upper = max(0.0, round(pred + 1.96 * sigma, 2))
        forecast.append({"index": idx, "predicted": round(pred, 2), "lower": lower, "upper": upper})

    return forecast, coef, intercept, round(sigma, 3), method


@app.get("/health")
def health():
    return {"status": "ok", "engine": "scikit-learn"}


@app.post("/cluster", response_model=dict)
def cluster(req: ClusterRequest):
    # Cluster per disease category so unrelated diseases never merge.
    out: List[dict] = []
    categories = {}
    for p in req.points:
        categories.setdefault(p.category, []).append(p)

    for category, pts in categories.items():
        if len(pts) < 3:
            lat = float(np.mean([p.lat for p in pts])) if pts else 0.0
            lng = float(np.mean([p.lng for p in pts])) if pts else 0.0
            out.append({
                "category": category,
                "count": len(pts),
                "centroid_lat": lat,
                "centroid_lng": lng,
                "ids": [p.id for p in pts],
            })
            continue

        coords = np.radians(np.array([[p.lat, p.lng] for p in pts]))
        eps_rad = req.eps_km / 6371.0
        labels = DBSCAN(eps=eps_rad, min_samples=3, metric="haversine").fit_predict(coords)

        for label in sorted(set(labels)):
            members = [pts[i] for i in range(len(pts)) if labels[i] == label]
            lat = float(np.mean([m.lat for m in members]))
            lng = float(np.mean([m.lng for m in members]))
            out.append({
                "category": category,
                "count": len(members),
                "centroid_lat": lat,
                "centroid_lng": lng,
                "ids": [m.id for m in members],
                "noise": bool(label == -1),
            })

    return {"clusters": out}


@app.post("/forecast", response_model=dict)
def forecast(req: ForecastRequest):
    if len(req.series) < 3:
        return {"forecast": []}

    counts = [float(p.count) for p in req.series]
    indices = [int(p.index) for p in req.series]
    forecast, slope, intercept, sigma, method = _fit_and_predict(counts, indices, req.periods, req.seasonal)

    return {
        "forecast": forecast,
        "slope": slope,
        "intercept": intercept,
        "sigma": sigma,
        "method": method,
    }


class BatchItem(BaseModel):
    id: str
    series: List[SeriesPoint] = Field(default_factory=list)
    periods: int = 4
    seasonal: int = 0


class BatchForecastRequest(BaseModel):
    items: List[BatchItem] = Field(default_factory=list)


@app.post("/forecast-batch", response_model=dict)
def forecast_batch(req: BatchForecastRequest):
    """Batch forecasting for per-district and per-cause projections."""
    out: List[dict] = []
    for item in req.items:
        if len(item.series) < 3:
            out.append({"id": item.id, "forecast": [], "method": "insufficient"})
            continue
        counts = [float(p.count) for p in item.series]
        indices = [int(p.index) for p in item.series]
        forecast, slope, intercept, sigma, method = _fit_and_predict(counts, indices, item.periods, item.seasonal)
        out.append({
            "id": item.id,
            "forecast": forecast,
            "slope": slope,
            "intercept": intercept,
            "sigma": sigma,
            "method": method,
        })
    return {"items": out}


@app.post("/cusum", response_model=dict)
def cusum(req: CusumRequest):
    # Poisson CUSUM early-warning check (Ch 5.5 — low-volume surveillance).
    # Baseline = mean of all days except the last two (the surveillance tail);
    # a rising S over that tail beyond h flags a persistent low-volume anomaly
    # that density thresholds like '8 cases/48h' would miss.
    anomalies: List[dict] = []
    for s in req.series:
        counts = [float(c) for c in s.counts]
        if len(counts) < 3:
            continue
        baseline = float(np.mean(counts[:-2]))
        recent = float(sum(counts[-2:]))
        k = baseline * 0.5 if baseline > 0 else 0.5
        h = max(2.0, req.limit * float(np.sqrt(max(baseline, 1.0))))
        c = 0.0
        for v in counts[-2:]:
            c = max(0.0, c + v - k)
        if c > h:
            anomalies.append({
                "district": s.district,
                "category": s.category,
                "cusum": round(c, 3),
                "baseline": round(baseline, 3),
                "recent": recent,
            })
    return {"anomalies": anomalies}
