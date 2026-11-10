# OmniInbox — Facebook Messenger + Instagram + WhatsApp + Telegram ka ek hi inbox

Aik dashboard jis mein Facebook Page, Instagram DM, WhatsApp aur Telegram ke saare
messages aate hain, aur aap ke agents wahin se reply karte hain. Facebook,
Instagram aur WhatsApp Meta ke hain (ek hi Meta App + webhook URL), jab ke
Telegram ka apna bot token + webhook hota hai.

## Tech

- **Backend**: Node.js (Express) + SQLite (built-in `node:sqlite`, koi DB install nahi)
- **Frontend**: React + Vite
- **Realtime**: Server-Sent Events (messages turant aate hain)
- **Auth**: JWT (agents ke liye alag logins)
- **Token storage**: AES-256-GCM encrypted (DB me)

## Requirement

- Node.js **>= 22** (tested on 24)
- [ngrok](https://ngrok.com) ya koi public HTTPS URL (Meta webhook ke liye)
- Meta Developer account + App (banned? nahi — free)

## Quick start

```bash
# 1) dependencies
npm install

# 2) env file banao (optional - ab tokens UI se bhi add hote hain)
copy .env.example .env      # Windows

# 3) server + client
npm run dev:server          # terminal 1 - backend (port 4000)
npm run dev:client          # terminal 2 - frontend (port 5173)

# ya sirf production build wala UI (production - ek hi port)
npm run build
npm start                   # http://localhost:4000
```

Login:
- Owner: `mazijutt781@gmail.com` / `Jet47-Jutt` (pehli dafa se automatically bana diya jata hai)
- Admin: `admin@omnichannel.local` / `admin123` (pehli dafa se automatically bana diya jata hai)

> Production mein dono passwords `.env` (`OWNER_PASSWORD`, `ADMIN_PASSWORD`) se
> badal kar server restart karein.

---

## Channels page — API keys add karna (recommended tareeqa)

`.env` chherne ki zaroorat nahi. Login ke baad sidebar se **Channels** kholein:

1. Facebook / Instagram / WhatsApp tab chunein
2. Naam, account ID aur access token bhar dein
3. **Add connection** dabayein
4. **Test token** se verify karein ke token aur account ID sahi hain
5. **Subscribe on Meta** se webhook khud subscribe karwa dein

Har channel ki **kai** connections ban sakti hain — alag alag pages, alag IG
accounts, alag WhatsApp numbers. Inbox mein sab aik jagah aate hain, aur har
conversation usi connection se reply bhejti hai jis page/number se aayi thi.

### Purani (old) conversations import — "Old chats sync"

Webhook se sirf **naye** messages aate hain. Meta poori message history ki API
nahi deta, lekin Facebook/Instagram account ki **conversations list + har thread
ke latest messages (20 tak)** ka import zaroor hota hai. Inhe import karne ke
liye:

1. **Channels** page kholein
2. Facebook/Instagram connection par **"Old chats sync"** button dabayein
3. Chats inbox mein aa jati hain — contact naam, latest messages, aur sahi
   connection ke saath

- Har thread ke **latest messages ka content** import hota hai (direction
  inbound/outbound sahi se, original timestamps ke saath). Meta ki limit:
  **sirf 20 sab se naye messages** ka content milta hai — 20 se purani messages
  ka content API ko nahi diya jata ("message has been deleted"). Ye Meta ki
  policy hai, is ka koi workaround nahi.
- Dobara sync kartay hain to **duplicate nahi** banta (meta_id se dedupe)
- Imported chats **unread=0** rakhti hain (ye purani batcheet hai jo ab dekh
  rahe hain — naye webhook messages normal unread rakhte hain)
- **WhatsApp** par history API hai hi nahi — wahan sirf naye messages aate hain

### Tokens secure hain

- Tokens database me **AES-256-GCM** se encrypt hote hain (key `JWT_SECRET` se
  derive hoti hai), plain text me kabhi nahi likhe jate.
- API har baar sirf **masked** token bhejta hai (`EAABwz••••fXYZ`). Poora token
  browser ko kabhi nahi jata — sirf wo jagah likh sakte hain jahan pehle se
  maujood hai.
- Sirf **admin** aur **owner** role connections dekh/edit kar sakte hain.

> ⚠️ `JWT_SECRET` production me strong aur **stable** rakhna zaroori hai. Agar
  aap ise change karte hain to purane encrypted tokens decrypt nahi honge aur
  un channels ko dobara add karna parega.

### Webhook ke liye public URL

`Subscribe on Meta` sirf tab kaam karta hai jab server ka **public HTTPS URL**
ho — `localhost` par Meta request nahi bhej sakta. Local development ke liye:

```bash
ngrok http 4000
# mil jayega: https://xxxx.ngrok-free.app
```

Us URL ka `/webhook` suffix laga kar Channels page ke "Webhook callback URL"
mein daalein, phir **Subscribe on Meta** dabayein. Server khud:

1. Page/IG ko app se link karta hai (`/subscribed_apps`)
2. App ka webhook `/webhook` par set karta hai (`messages` field ke saath)

Callback URL aur Verify token dono wahi dene hain jo aap UI mein likh rahe hain.

---

## Purana tareeqa — `.env` se connect karna (ab bhi chalta hai)

UI wala tareeqa behtar hai, lekin `.env` fallback bhi supported hai. Ab ek
**auto-bootstrap** bhi hai: server start par agar `.env` mein token/account hain
aur us channel+account ki koi connection DB mein nahi, to wahan se connection
khud ban jati hai.

> Agar aapne pehle sirf `.env` use kiya tha, to pehla restart connection bana
> dega. Uske baad Channels page par connection dikhegi aur wahan se **Old
> chats sync** button dabakar purani FB/IG chats import kar saktay hain.
>
> **Import ab auto nahi chalta** — bohat saari conversations aik saath padhne
> par Meta ka rate-limit block ho jata hai (jo kuch ghanton baad khud khul
> jata hai; data pehle se mehfooz hota hai). Is liye sync sirf manual button
> se hota hai, har page ke beech halka gap rakh kar, aur agar Meta block kare
> to poori sync foran ruk jati hai — rozana naye messages webhook se aate
> hain, unke liye sync ki zaroorat nahi.

---

## 1) Facebook Messenger connect

### a. Token lo (long-lived, zaroori)

1. [developers.facebook.com](https://developers.facebook.com/) → apna App → **Tools > Graph API Explorer**
2. App select karo, permission `pages_messaging`, `pages_show_list`, `pages_read_engagement`
3. Token generate karne ke liye `Get Token > Page Access Token` apni page choose karo
4. Short token hai (1 ghante ka) — us ko **long-lived** (60 din) banao:

```
GET https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=YOUR_APP_ID&client_secret=YOUR_APP_SECRET&fb_exchange_token=SHORT_LIVED_TOKEN
```

5. `.env` mein daalo:

```
PAGE_ACCESS_TOKEN=<long_lived_token>
PAGE_ID=<your_page_id>
APP_SECRET=<your_app_secret>
VERIFY_TOKEN=koi_bhi_apna_secret
```

### b. Webhook subscribe karo

1. **Public URL chahiye** — us waqt ke liye ngrok:

```bash
ngrok http 4000
# mil jayega: https://xxxx.ngrok-free.app  -> webhook URL = https://xxxx.ngrok-free.app/webhook
```

2. Meta App → **Webhooks** → **Add callback URL**:
   - Callback URL: `https://xxxx.ngrok-free.app/webhook`
   - Verify token: `.env` ka `VERIFY_TOKEN` (yehi likhna jo aapne .env mein set kiya)

3. **Facebook** tab → apni Page subscribe karo, field **`messages`** select kar ke **Verify and save**.

> Har baar jab `.env` mein VERIFY_TOKEN badalna ho, Meta par bhi wahi token DENA zaroori hai.

### c. Test

- Messenger se apni page ko message karo → dashboard mein conversation aa jayegi.
- Reply bhejoge to wahi likh kar send hoga.

---

## 2) Instagram DM connect (optional)

1. Page access pe Panth pe `instagram_basic` + `instagram_manage_messages` permissions App se
2. Instagram account apne Meta App ke Business Portfolio se link karein
3. Graph API Explorer → **Instagram Graph API** → `Get Token` → Instagram account choose karke
   permanent token copy karo → `.env` ka `IG_ACCESS_TOKEN`
4. Meta App → **Webhooks → Instagram** → callback URL same (`/webhook`) + verify token
   → field **`messages`** subscribe

---

## 3) WhatsApp connect (optional)

1. [developers.facebook.com](https://developers.facebook.com/) → App → **WhatsApp** product
   → **Get started** → phone number verify karo
2. Milenge: `Phone number ID`, `WABA ID`, aur **Access token** → `.env`:

```
WA_ACCESS_TOKEN=<token>
WA_PHONE_NUMBER_ID=<phone_number_id>
WA_OWN_NUMBER=<apna_number_without_+55 e.g. 15551234567>
```

3. Meta App → **Webhooks → WhatsApp** → callback URL same + verify token → subscribe
   (WhatsApp Business Account select karo, field `messages`)

---

## 4) Telegram connect (optional)

1. Telegram me [@BotFather](https://t.me/BotFather) ko open karo → `/newbot` → naam/username do
2. BotFather se **bot token** copy karo (`123456789:AA...`)
3. Dashboard → **Channels** → **Telegram** tab → bot token paste karke **Add connection**
4. Connection card par **Set Telegram webhook** dabao (public HTTPS URL, e.g. Render URL)
5. Apne bot ko Telegram me `/start` bhejo — chat Inbox me aa jayegi aur wahan se reply bhej sakte ho

> Render par DB reset hone se connection delete ho jati hai. Permanent setup ke liye
> Render env me `TELEGRAM_BOT_TOKEN=<bot token>` add kar dein — server start par
> connection khud ban jayegi aur webhook URL (token hash) same rehne ki wajah se
> dobara subscribe karne ki zaroorat nahi padegi.

---

## Roles

Teen roles hain — **owner** > **admin** > **agent**:

| Kaam | Owner | Admin | Agent |
|---|---|---|---|
| Inbox / assign / notes | ✅ | ✅ | sirf apni assigned chat |
| Channels / connections | ✅ | ✅ | ❌ |
| Naya agent banana | ✅ | ✅ | ❌ |
| **Naya admin banana** | ✅ | ❌ | ❌ |
| Admin ko promote/demote karna | ✅ | ❌ | ❌ |
| Admin delete karna | ✅ | ❌ | ❌ |
| Agent delete karna | ✅ | ✅ | ❌ |

- Owner account `.env` se banta hai (`OWNER_EMAIL`, `OWNER_PASSWORD`,
  `OWNER_NAME`) aur API se delete ya demote nahi ho sakta.
- Admin sirf agents manage karta hai; admins sirf owner bana sakta hai.
- Har agent ka apna login banta hai. Conversations assign karo, status
  Open/Pending/Resolved rakho, aur unread count har channel ke liye alag hai.

## API (short)

| Method | Endpoint | Kaam |
|---|---|---|
| POST | `/webhook` | Meta ke saare channel events yahan aate hain |
| POST | `/webhook/telegram/:secret` | Telegram bot updates (secret = token ka hash) |
| GET | `/webhook?hub.verify_token=…` | Meta subscription verification |
| POST | `/api/auth/login` | agent login → JWT |
| GET | `/api/conversations?channel=&status=` | inbox list |
| GET | `/api/conversations/:id` | thread |
| POST | `/api/conversations/:id/reply` | reply bhejo |
| POST | `/api/conversations/:id/status` | status badlo |
| POST | `/api/conversations/:id/assign` | agent assign |
| GET | `/api/connections` | channels list (admin/owner, tokens masked) |
| POST | `/api/connections` | nayi connection add karo (admin/owner) |
| PATCH | `/api/connections/:id` | connection update (admin/owner) |
| DELETE | `/api/connections/:id` | connection delete (admin/owner) |
| POST | `/api/connections/:id/verify` | token verify karo (admin/owner) |
| POST | `/api/connections/:id/subscribe` | Meta par webhook subscribe (admin/owner) |
| POST | `/api/connections/:id/sync` | purani conversations import karo (admin/owner) |
| POST | `/api/auth/agents` | naya agent banao (admin/owner); admin banane ke liye owner |
| PATCH | `/api/auth/agents/:id` | photo ya role update (role sirf owner) |
| DELETE | `/api/auth/agents/:id` | agent delete (admin/owner), admin delete sirf owner |
| GET | `/api/stream` | SSE realtime |

## Database backup

- Har **server-start** par `data/backups/` folder mein SQLite ki consistent copy
  banti hai: `omnichannel-YYYYMMDD-HHmmss.db` (WAL-data samet, `VACUUM INTO`
  se — is liye state chala raha ho tab bhi backup durust hoti hai)
- Sirf **aakhri 10** backups rakhti hai (`BACKUP_KEEP` se badal sakte ho),
  purane khud delete ho jate hain
- Backup recover karne ke liye bas purani file ko `data/omnichannel.db` par
  waapas rakh do (server band kar ke) ya seedha khol ke data dekh lo.
- `.env` se:
  ```
  BACKUP_DIR=data/backups
  BACKUP_KEEP=10
  ```

## Deploy ke baad data bachana (R2 snapshot)

Render (free) ka filesystem ephemeral hai — har deploy par SQLite DB reset ho
jati hai. Is se chats aur **agent attribution** (kaun se agent ne reply kiya)
gum ho jati thi. Ab DB khud-ba-khud Cloudflare R2 par snapshot hoti hai aur
server start par wapas restore ho jati hai:

- Jab bhi DB badalti hai (message, reply, edit, connection change), ~10s ke
  andar `r2://<bucket>/db/omnichannel.db` par consistent snapshot chala jata hai
- Server start par agar local DB maujood nahi hai to wahi snapshot restore hota
  hai — **is liye agent IDs aur chats deploy ke baad bhi rehte hain**
- R2 wahi bucket use hota hai jo uploads ke liye configured hai
  (`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`)
- Manual check/force: `GET /api/db-status` (admin/owner) aur
  `GET /api/db-status?snapshot=1`
- Env knobs:
  ```
  DB_SNAPSHOT_MS=10000          # check interval
  DB_SNAPSHOT_KEY=db/omnichannel.db
  DB_SNAPSHOT=false             # snapshots band
  DB_RESTORE_FROM_R2=false      # boot par restore band
  DB_RESTORE_ALWAYS=true        # local DB ho tab bhi R2 se overwrite
  ```

> Pehli dafa deploy par R2 me snapshot nahi hota, is liye purani chats Meta se
> sync hoti hain — un purane messages ki agent attribution Meta ke paas nahi
> hoti, is liye woh `Agent #—` dikha sakte hain. Us ke baad ke sab replies
> permanently save hote hain.

## Security notes

- `.env` kabhi kisi ke saath share nahi karna (gitignored hai)
- Page token short-lived hota hai — 60 din mein refresh karna parhta hai
- `APP_SECRET` set karo taake webhook signature verify ho (extra protection)
- Production: `JWT_SECRET` strong rakhna, owner aur admin passwords zoroor change karna
- `JWT_SECRET` badalne par DB ke purane encrypted tokens unlock nahi honge —
  un channels ko dobara add karna parega
- Tokens sirf admin/owner role dekh/edit kar sakta hai, aur API masked copy bhejti hai