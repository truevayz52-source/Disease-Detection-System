"""
DDS ML Analytics microservice (Chapter 5.5 — ML Analytics & GIS Engine).

Provides scikit-learn powered spatial clustering (DBSCAN over case
coordinates, haversine metric) and linear-regression mortality forecasting.
The Express API calls these endpoints with a short timeout and falls back to
its built-in Node implementation when this service is unreachable (Ch 5.3).
"""

from fastapi import FastAPI
from pydantic import BaseModel, Field
from typing import List, Optional
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

    x = np.array([p.index for p in req.series]).reshape(-1, 1)
    y = np.array([p.count for p in req.series])
    model = LinearRegression().fit(x, y)

    last = max(p.index for p in req.series)
    future = np.array([last + k for k in range(1, req.periods + 1)]).reshape(-1, 1)
    preds = model.predict(future)

    return {
        "forecast": [
            {"index": int(idx), "predicted": max(0.0, round(float(v), 2))}
            for idx, v in zip(future.flatten(), preds)
        ],
        "slope": float(model.coef_[0]),
        "intercept": float(model.intercept_),
    }
