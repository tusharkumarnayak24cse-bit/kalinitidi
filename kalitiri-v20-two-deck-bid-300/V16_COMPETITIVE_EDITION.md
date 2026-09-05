# Kaali Ni Tidi v16 Competitive Edition

## Working in this build
- Cloud-style accounts persisted on the server (username/password with scrypt hashing)
- Cross-device profile/stats when ACCOUNTS_FILE uses a persistent disk
- Ranked queues for 4–8 players, monthly seasons and rating points
- Match confirmation before ranked play
- Friends, requests, online status and room invites
- Achievements and daily challenges
- Match replay event history
- 8/16/32 entrant one-round knockout tournament flow using 4-player tables; winning side advances
- Private room PINs
- AFK detection after 3 missed turns with reclaimable Bot Assist
- Spectator delay for ranked games
- Table themes, card backs, large text and high-contrast mode
- Easy/Normal/Hard bots plus Balanced/Aggressive/Conservative/Partner-smart styles
- Admin analytics dashboard at /admin.html
- Optional Redis Socket.IO adapter when REDIS_URL is configured
- English, Gujarati and Hindi core UI

## Requires external service credentials before it can be truly live
- Push notifications: Firebase project + Android google-services.json / FCM credentials
- Reliable carrier-grade voice: TURN_URL, TURN_USERNAME, TURN_CREDENTIAL
- Multi-region active-active: at least two deployments + shared Redis + shared durable account database; Render single-service config alone is one region
- Play Store release signing: your private keystore and Google Play Console account

## Production data
Set PERSISTENCE_FILE and ACCOUNTS_FILE to a mounted persistent disk path. JSON persistence is appropriate for a beta/small launch. For larger scale, migrate users/replays/tournaments to PostgreSQL and use Redis for Socket.IO presence/queues.
