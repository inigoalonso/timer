FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd -m app && mkdir /data && chown app /data
COPY app.py timer.py ./
COPY static static
USER app
ENV DATABASE_PATH=/data/timers.db
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
