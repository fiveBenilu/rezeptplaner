FROM python:3.13-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY static ./static

# Die claude CLI (Binary + Credentials) wird zur Laufzeit vom Host gemountet, siehe docker-compose.yml.
# HOME muss für den (nicht-root) Laufzeit-User beschreibbar sein, die CLI legt dort Cache/Config ab.
ENV HOME=/home/app \
    DISABLE_AUTOUPDATER=1 \
    PYTHONUNBUFFERED=1
RUN mkdir -p /home/app /app/data && chmod 777 /home/app /app/data

EXPOSE 8010
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010"]
