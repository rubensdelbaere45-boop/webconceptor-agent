/* ═══════════════════════════════════════════════════════════════
   WebConceptor — Sales Agent (Railway)

   Ce processus tourne 24h/24 sur Railway et réagit EN TEMPS RÉEL
   dès qu'un prospect humain ouvre une maquette pour la 1ère fois.

   Flux :
   1. Supabase Realtime → détecte 1ère vue (opened_at NULL → date)
   2. SMS immédiat via Brevo (< 30 secondes)
   3. Si 2ème vue sans achat → SMS urgence
   4. Follow-up 2h après 1ère vue si pas acheté
   5. Follow-up J+1 matin si toujours pas acheté
   ═══════════════════════════════════════════════════════════════ */

import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

// ── Config ─────────────────────────────────────────────────────
const SUPABASE_URL  = process.env.SUPABASE_URL  || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const BREVO_KEY     = process.env.BREVO_API_KEY
const TG_TOKEN      = process.env.TELEGRAM_BOT_TOKEN
const TG_CHAT       = process.env.TELEGRAM_CHAT_ID
const BASE_URL      = process.env.BASE_URL || 'https://webconceptor.fr'

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ SUPABASE_URL et SUPABASE_SERVICE_KEY sont requis')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: { transport: ws },
})

// ── Suivi des follow-ups planifiés (in-memory) ──────────────────
// { slug → { prospect, triggerAt, type } }
const scheduled = new Map()

// ── Utilitaires ─────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)
}

function toMobileE164(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/[^0-9+]/g, '')
  let n = digits
  if (n.startsWith('+33')) n = '0' + n.slice(3)
  else if (n.startsWith('33') && n.length === 11) n = '0' + n.slice(2)
  if (!/^0[67]\d{8}$/.test(n)) return null
  return '+33' + n.slice(1)
}

function gsmSafe(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E\n]/g, '').trim()
}

// ── Brevo SMS ────────────────────────────────────────────────────
async function sendSMS(rawPhone, content) {
  if (!BREVO_KEY) return { ok: false, error: 'BREVO_API_KEY manquante' }
  const to = toMobileE164(rawPhone)
  if (!to) return { ok: false, error: `Numéro non-mobile: ${rawPhone}` }

  const safe = gsmSafe(content).slice(0, 160)
  try {
    const res = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
      method: 'POST',
      headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: 'WebConcept', recipient: to, content: safe, type: 'transactional', unicodeEnabled: false }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      log(`✅ SMS envoyé → ${to} (${data.remainingCredits ?? '?'} crédits restants)`)
      return { ok: true, remainingCredits: data.remainingCredits }
    }
    log(`❌ SMS échoué → ${data.message || res.status}`)
    return { ok: false, error: data.message }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── Telegram ────────────────────────────────────────────────────
async function tg(msg) {
  if (!TG_TOKEN || !TG_CHAT) return
  fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: 'HTML', disable_web_page_preview: true }),
  }).catch(() => {})
}

// ── Textes SMS ───────────────────────────────────────────────────
function smsFirstView(name, url) {
  const n = gsmSafe(name).slice(0, 28)
  return `Bonjour, Tom de WebConceptor. J'ai cree une maquette pour ${n}. Avez-vous quelques minutes pour la regarder ? ${url} Reponse: STOP`
}

function smsFollowUp2h(name, url) {
  const n = gsmSafe(name).slice(0, 28)
  return `Tom - WebConceptor. Votre maquette pour ${n} est toujours disponible. Question ? Repondez ou appelez le 06 35 59 24 71. ${url} STOP`
}

function smsSecondView(name, url) {
  const n = gsmSafe(name).slice(0, 25)
  return `Bonjour, Tom de WebConceptor. Je vois que vous revenez sur la maquette de ${n}. Je suis disponible pour en parler : 06 35 59 24 71. ${url} STOP`
}

function smsUrgencyJ1(name) {
  const n = gsmSafe(name).slice(0, 28)
  return `Tom WebConceptor. La maquette de ${n} sera retiree demain. Offre actuelle : 320 EUR TTC, livraison 5j. Appelez le 06 35 59 24 71 ou repondez ici. STOP`
}

// ── Traitement 1ère vue ─────────────────────────────────────────
async function onFirstView(prospect) {
  const { id, slug, name, phone, city, status } = prospect
  if (status === 'converted') return

  const url = `${BASE_URL}/prospects/${slug}`
  log(`🔥 1ère vue : ${name} (${city || '?'}) — tél: ${phone || 'aucun'}`)

  // SMS immédiat
  let smsSent = false
  if (phone) {
    const { ok } = await sendSMS(phone, smsFirstView(name, url))
    smsSent = ok
    if (ok) {
      await supabase.from('prospects')
        .update({ hot_sms_sent_at: new Date().toISOString() })
        .eq('id', id)
    }
  }

  // Telegram alert
  const tgMsg =
    `🔥 <b>AGENT — 1ÈRE VUE MAQUETTE</b>\n\n` +
    `<b>${name}</b> · ${city || '—'}\n` +
    `📞 ${phone || 'aucun'}\n` +
    `💬 SMS : ${smsSent ? '✅ envoyé' : '❌ pas de mobile'}\n\n` +
    `<a href="${url}">→ Voir sa maquette</a>`
  await tg(tgMsg)

  // Planifier follow-up 2h
  scheduled.set(`${slug}:2h`, {
    prospect,
    triggerAt: Date.now() + 2 * 60 * 60 * 1000,
    type: '2h',
    url,
  })

  // Planifier SMS urgence J+1 (9h lendemain)
  const tomorrow9h = new Date()
  tomorrow9h.setDate(tomorrow9h.getDate() + 1)
  tomorrow9h.setHours(9, 0, 0, 0)
  scheduled.set(`${slug}:j1`, {
    prospect,
    triggerAt: tomorrow9h.getTime(),
    type: 'j1',
    url,
  })
}

// ── Traitement 2ème vue ─────────────────────────────────────────
async function onSecondView(prospect) {
  const { slug, name, phone, city, status } = prospect
  if (status === 'converted') return

  const url = `${BASE_URL}/prospects/${slug}`
  log(`👀 2ème vue : ${name} — prospect qui revient !`)

  if (phone) {
    await sendSMS(phone, smsSecondView(name, url))
  }

  await tg(`👀 <b>${name}</b> (${city || '—'}) revient sur sa maquette\n📞 ${phone || 'aucun'}\n<a href="${url}">→ Maquette</a>`)

  // Annuler follow-up 2h si déjà planifié (il est revenu seul)
  scheduled.delete(`${slug}:2h`)
}

// ── Traitement "Panier ouvert" ──────────────────────────────────
async function onCartOpened(prospect) {
  const { slug, name, phone, city } = prospect
  const url = `${BASE_URL}/prospects/${slug}`
  log(`🛒 PANIER OUVERT : ${name}`)

  if (phone) {
    const sms = gsmSafe(`Tom WebConceptor. Je vois que vous etes sur l'ecran de commande pour ${name.slice(0, 25)}. Un souci ? Je suis au 06 35 59 24 71. STOP`).slice(0, 160)
    await sendSMS(phone, sms)
  }

  await tg(`🛒 <b>PANIER OUVERT</b>\n<b>${name}</b> · ${city || '—'}\n📞 ${phone || 'aucun'}\n<a href="${url}">→ Maquette</a>`)
  scheduled.delete(`${slug}:2h`)
  scheduled.delete(`${slug}:j1`)
}

// ── Boucle des follow-ups planifiés ────────────────────────────
setInterval(async () => {
  const now = Date.now()
  for (const [key, job] of scheduled.entries()) {
    if (now < job.triggerAt) continue
    scheduled.delete(key)

    // Vérifier que le prospect n'a pas acheté entre-temps
    const { data } = await supabase.from('prospects')
      .select('id, name, phone, status, cart_opened_at')
      .eq('slug', job.prospect.slug)
      .maybeSingle()

    if (!data || data.status === 'converted') {
      log(`⏭ Skip follow-up ${key} — déjà converti`)
      continue
    }

    if (job.type === '2h' && data.phone) {
      log(`⏰ Follow-up 2h : ${data.name}`)
      await sendSMS(data.phone, smsFollowUp2h(data.name, job.url))
    }

    if (job.type === 'j1' && data.phone) {
      log(`⏰ Follow-up J+1 : ${data.name}`)
      await sendSMS(data.phone, smsUrgencyJ1(data.name))
    }
  }
}, 60 * 1000) // vérifie toutes les 60 secondes

// ── Supabase Realtime ───────────────────────────────────────────
const channel = supabase
  .channel('wc-sales-agent')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'prospects',
  }, (payload) => {
    const o = payload.old
    const n = payload.new

    // 1ère vue humaine (opened_at passe de null à une date)
    if (!o.opened_at && n.opened_at) {
      onFirstView(n)
    }

    // 2ème vue (view_count passe de 1 à 2)
    if ((o.view_count === 1 || o.view_count === '1') && (n.view_count === 2 || n.view_count === '2')) {
      onSecondView(n)
    }

    // Panier ouvert (cart_opened_at passe de null à une date)
    if (!o.cart_opened_at && n.cart_opened_at) {
      onCartOpened(n)
    }
  })
  .subscribe((status, err) => {
    log(`[Realtime] ${status}${err ? ' — ' + err.message : ''}`)
  })

// ── Healthcheck HTTP minimal (Railway le requiert pour détecter le crash) ──
import { createServer } from 'http'
createServer((req, res) => {
  res.writeHead(200)
  res.end(JSON.stringify({
    status: 'ok',
    agent: 'webconceptor-sales-agent',
    scheduled: scheduled.size,
    uptime: Math.floor(process.uptime()),
  }))
}).listen(process.env.PORT || 3000, () => {
  log('🚀 Sales Agent démarré — en écoute sur Supabase Realtime')
})

// Graceful shutdown
process.on('SIGTERM', () => {
  log('Agent arrêté proprement.')
  supabase.removeChannel(channel)
  process.exit(0)
})
