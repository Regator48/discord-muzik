#!/bin/bash

echo "Cloning LavaMusic repo..."
git clone https://github.com/botxlab/lavamusic.git /tmp/lavamusic

echo "Copying bot files..."
cp -r /tmp/lavamusic/. bot/

echo "Setup complete! Configure your .env file:"
echo "  1. cp .env.example .env"
echo "  2. Add your Discord TOKEN and CLIENT_ID"
echo "  3. Add your Spotify credentials"
echo ""
echo "Then run: docker-compose up -d"
