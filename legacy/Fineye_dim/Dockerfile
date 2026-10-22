FROM python:3.12-slim

WORKDIR /app

# Устанавливаем системные зависимости для psycopg2 и других библиотек
RUN apt-get update && \
    apt-get install -y --no-install-recommends libpq5 ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    update-ca-certificates

COPY requirements/base.txt .
RUN pip install --no-cache-dir -r base.txt

COPY . .

CMD ["python", "main.py"]