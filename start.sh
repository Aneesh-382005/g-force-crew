# To start the container
docker compose --profile tunnel up -d --force-recreate tunnel
sleep 10; docker compose logs tunnel | grep -o 'https://[a-z0-9-]*.trycloudflare.com' | tail -1