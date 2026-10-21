FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    build-essential \
    libpq-dev \
    libgtk-3-0 \
    libasound2 \
    libdbus-glib-1-2 \
    libxt6 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxi6 \
    libxtst6 \
    libnss3 \
    libcups2 \
    libxss1 \
    libxrandr2 \
    libgdk-pixbuf2.0-0 \
    libpango-1.0-0 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libepoxy0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./apps/worker/
RUN pip install --no-cache-dir -r ./apps/worker/requirements.txt
RUN python -m camoufox fetch

COPY . ./apps/worker/

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

CMD ["python", "-m", "apps.worker.worker"]
