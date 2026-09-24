FROM python:3.12.14-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e

ARG IPUTILS_PING_VERSION=3:20221126-1+deb12u1

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp

RUN apt-get update \
    && apt-get install --yes --no-install-recommends "iputils-ping=${IPUTILS_PING_VERSION}" \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app /data \
    && chown 10001:10001 /data

WORKDIR /app

COPY requirements.lock ./requirements.lock
RUN python -m pip install --no-cache-dir --disable-pip-version-check \
    --requirement requirements.lock

COPY alembic.ini ./alembic.ini
COPY alembic ./alembic
COPY app ./app

USER 10001:10001
EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
