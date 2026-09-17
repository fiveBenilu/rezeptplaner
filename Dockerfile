FROM python:3.13-slim

WORKDIR /app
COPY requirements.txt .
# CPU-only torch (~200 MB statt mehrerer GB CUDA-Wheels)
RUN pip install --no-cache-dir torch==2.14.0 --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY static ./static

# Die claude CLI (Binary + Credentials) wird zur Laufzeit vom Host gemountet, siehe docker-compose.yml.
# HOME muss für den (nicht-root) Laufzeit-User beschreibbar sein, die CLI legt dort Cache/Config ab.
ENV HOME=/home/app \
    DISABLE_AUTOUPDATER=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/app/data/hf-cache
RUN mkdir -p /home/app /app/data && chmod 777 /home/app /app/data

EXPOSE 8010
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010"]
