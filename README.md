# WebConceptor Sales Agent — Railway

Agent de vente IA qui tourne 24h/24 sur Railway.

## Ce qu'il fait

1. **Écoute Supabase en temps réel** (WebSocket permanent)
2. **1ère vue d'une maquette** → SMS immédiat au prospect (< 30 sec)
3. **2ème vue** → SMS "vous revenez sur votre maquette"
4. **Panier ouvert** → SMS urgence
5. **Follow-up 2h** après 1ère vue si pas acheté
6. **Follow-up J+1** (9h) si toujours pas acheté

## Déploiement Railway

1. Crée un nouveau projet Railway depuis ce repo GitHub
2. Ajoute les variables d'environnement (voir `.env.example`)
3. Railway lance automatiquement `npm start`

## Variables requises

| Variable | Source |
|---|---|
| `SUPABASE_URL` | Supabase → Settings → API |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → service_role |
| `BREVO_API_KEY` | Brevo → SMTP et API |
| `TELEGRAM_BOT_TOKEN` | Vercel env vars |
| `TELEGRAM_CHAT_ID` | Vercel env vars |
| `BASE_URL` | `https://webconceptor.fr` |
