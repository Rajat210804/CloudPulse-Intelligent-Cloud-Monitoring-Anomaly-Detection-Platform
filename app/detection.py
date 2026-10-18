from sklearn.ensemble import IsolationForest


def find_anomaly(sample, history):
    """Use recent readings from the same server as its baseline."""
    for field in ("cpu", "memory", "disk"):
        value = getattr(sample, field)
        if value is not None and value >= 90:
            return True, f"{field.title()} usage reached {value:.1f}%"

    if len(history) < 30:
        return False, None

    fields = [
        field for field in ("cpu", "memory", "disk")
        if getattr(sample, field) is not None
        and all(getattr(row, field) is not None for row in history)
    ]
    baseline = [[getattr(row, field) for field in fields] for row in history]
    current = [[getattr(sample, field) for field in fields]]
    model = IsolationForest(n_estimators=60, contamination=0.05, random_state=42, n_jobs=1)
    model.fit(baseline)
    if model.predict(current)[0] == -1:
        return True, "Unusual resource usage compared with recent readings"
    return False, None
