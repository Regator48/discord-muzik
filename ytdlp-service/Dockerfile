FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -U yt-dlp
COPY ytdlp-proxy.py /opt/ytdlp-proxy.py
EXPOSE 4567
CMD ["python3", "/opt/ytdlp-proxy.py"]