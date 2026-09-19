FROM oven/bun:alpine

RUN apk add --no-cache ffmpeg python3

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN chmod +x yt-dlp 2>/dev/null; cp yt-dlp /usr/local/bin/yt-dlp 2>/dev/null; bun run build

COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
CMD ["bun", "run", "start"]
# 1788093244
