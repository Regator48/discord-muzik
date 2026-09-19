# Discord Music Bot

A Discord music bot supporting Spotify, YouTube, Apple Music, and Deezer.

## Setup

1. Run the setup script:
```bash
./setup.sh
```

2. Configure your `.env` file:
```bash
cp .env.example .env
# Edit .env with your credentials
```

3. Get credentials:
   - **Discord Token**: https://discord.com/developers/applications
   - **Spotify API**: https://developer.spotify.com/dashboard

4. Start the bot:
```bash
docker-compose up -d
```

5. Invite the bot to your server:
```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=8&scope=bot%20applications.commands
```

6. Sync commands (in any server channel):
```
!deploy
```

## Supported Platforms
- YouTube / YouTube Music
- Spotify
- Apple Music
- Deezer

## Commands
- `/play <url/query>` - Play music
- `/queue` - View queue
- `/skip` - Skip current track
- `/stop` - Stop playback
- `/pause` - Pause playback
- `/resume` - Resume playback
- And more...
