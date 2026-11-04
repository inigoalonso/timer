FROM python:3.12-slim@sha256:b18b261e1b4974b4f321451ad5251ded85abb22c2b8b262da527dda1d031ab30
WORKDIR /app
COPY requirements.txt requirements.lock ./
RUN pip install --timeout 20 --retries 1 --no-cache-dir -r requirements.txt && useradd -m app && mkdir /data && chown app /data
COPY app.py timer.py ./
COPY static static
COPY scripts/backup.py scripts/backup.py
USER app
ENV DATABASE_PATH=/data/timers.db
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-proxy-headers", "--ws-max-size", "131072", "--no-access-log"]
