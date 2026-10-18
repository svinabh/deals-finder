# DealsFinder — Deployment & Setup Guide (Hinglish)

Yeh guide batati hai ki app kaise chalana hai, Vercel par free mein kaise deploy karna hai, aur baad mein real data + AI kaise on karna hai.

## Abhi app kya hai (honest summary)

- **Demo mode** mein chalti hai: 30 sample listings (`data/demo_deals.json`), har card saaf-saaf "DEMO" aur "sample price" labeled hai.
- Koi paid API use **nahi** hoti, koi scraping **nahi** hoti, fake "live" prices kabhi nahi dikhते.
- Amazon PA-API / OpenAI keys set karte hi app **automatically live/AI mode** par switch ho jaati hai — code change nahi karna padta.

## Local run

```bash
cd deals-finder
node server.js
# Open http://localhost:3000
```

Tests: `npm test`

## Vercel free deploy (Hobby plan, ₹0)

1. Terminal kholo:
   ```bash
   cd /Users/apple/.gemini/antigravity-ide/scratch/deals-finder
   npm install -g vercel
   vercel login
   vercel --prod
   ```
2. `vercel --prod` ke prompts:
   - "Set up and deploy?" → **Y**
   - Scope → apna account
   - "Link to existing project?" → N (pehli baar)
   - Framework preset → **Other**
   - Root directory → `./` (default)
   - Baaki defaults — settings `vercel.json` mein already hain.
3. End mein public URL milega (jaise `deals-finder-xxxx.vercel.app`).

**Security:** `.vercelignore` `.env` ko deploy hone se rokता hai. Aapki `.env` mein GitHub token hai — wo kabhi deploy/git mein nahi jani chahiye (abhi tak nahi gayi, verified).

## Environment variables (Vercel → Project → Settings → Environment Variables)

Sab optional hain. Kuch set nahi = demo mode.

| Variable | Kya hai | Kab chahiye |
|---|---|---|
| `AMAZON_ACCESS_KEY` | Amazon PA-API access key | Live Amazon results ke liye |
| `AMAZON_SECRET_KEY` | Amazon PA-API secret | Live Amazon results ke liye |
| `AMAZON_PARTNER_TAG` | Associates tag (jaise `dealsgptindia-21`) | Live Amazon results ke liye |
| `OPENAI_API_KEY` | LLM key (OpenAI ya compatible) | AI query helper ke liye |
| `OPENAI_BASE_URL` | Custom endpoint (default: OpenAI) | Groq/OpenRouter/Gemini use karne ke liye |
| `OPENAI_MODEL` | Model name | Default `gpt-4o-mini` |

**Note:** Teeno Amazon vars set hote hi demo mode off ho jaata hai. Tab agar PA-API fail ho, app demo data nahi dikhata — honest error deta hai.

## AI query helper on karna (₹0, free tiers)

AI sirf user ki Hinglish/descriptive query ko clean retailer keywords mein convert karta hai ("jogging ke joote 3k tak" → "running shoes under 3000"). Ye deals **nahi** banata — deals hamesha real source se aate hain.

1. Koi ek free account banao (founder khud banata hai):
   - **Groq** (sabse aasan): console.groq.com → API key
   - **Google AI Studio**: aistudio.google.com → API key
   - **OpenRouter**: openrouter.ai → free model wali key
2. Vercel env vars mein daalo:
   - Groq: `OPENAI_API_KEY=<key>`, `OPENAI_BASE_URL=https://api.groq.com/openai/v1`, `OPENAI_MODEL=llama-3.1-8b-instant`
   - Gemini: `OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`, `OPENAI_MODEL=gemini-2.0-flash`
3. Redeploy (`vercel --prod`) — bas.

Local testing ke liye same cheezein `.env` mein daalo (`.env` git mein kabhi nahi jaata).

## Real merchant data ke next steps

1. **Amazon PA-API approval** — Associates account se (tag `dealsgptindia-21` already hai; PA-API eligibility ke liye 3 qualifying sales chahiye). Approval ke baad keys → env vars → done.
2. **Baaki stores** — EarnKaro/Cuelinks affiliate feeds jab access mile.
3. Har naye source ke liye `provider_registry.js` mein adapter — README ke "Adding another store" section dekho.

## Security rules (hamesha yaad rakho)

- API keys sirf env vars mein — source code, git, frontend, logs, screenshots mein **kabhi nahi**.
- Retailer scraping ya undocumented APIs **kabhi nahi** — sirf authorized feeds (PA-API, affiliate networks).
- Demo prices ko live bol kar dikhana mana hai — demo labeling code mein baked hai, use mat hatana.
