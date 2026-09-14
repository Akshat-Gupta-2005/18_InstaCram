# Build context is the REPO ROOT (see docker-compose.yml), not this directory,
# because the image needs prompts/ from the root.
FROM python:3.12-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PROMPTS_DIR=/app/prompts

COPY services/pipeline/pyproject.toml ./
RUN pip install --no-cache-dir .

COPY services/pipeline/app ./app
COPY prompts ./prompts

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
