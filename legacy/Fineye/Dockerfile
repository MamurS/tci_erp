FROM python:3.11-buster

RUN apt-get update && apt-get install -y \
    wget \
    xfonts-75dpi \
    fontconfig \
    libxrender1 \
    libfontconfig1 \
    libxext6 \
    libjpeg62-turbo \
    fonts-dejavu \
    fonts-liberation \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN wget https://github.com/wkhtmltopdf/packaging/releases/download/0.12.6-1/wkhtmltox_0.12.6-1.buster_amd64.deb -O wkhtmltox.deb

RUN apt-get update && apt-get install -y ./wkhtmltox.deb && rm wkhtmltox.deb

COPY requirements/base.txt /app/
WORKDIR /app
RUN pip install --no-cache-dir -r base.txt

COPY . /app

CMD ["python", "main.py"]