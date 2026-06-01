/* ═══════════════════════════════════════════════════════════════
   WebConceptor Sales Agent — GitHub Actions (version polling)
   Lancé toutes les 10 minutes par le cron GitHub.
   Contrairement à la version Railway (WebSocket temps réel),
   celle-ci interroge Supabase et envoie les SMS manquants.
   ═══════════════════════════════════════════════════════════════ */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BREVO_KEY = process.env.BREVO_API_KEY
const TG_TOKEN  = process.env.TELEGRAM_BOT_TOKEN
const TG_CHAT   = process.env.TELEGRAM_CHAT_ID
const BASE_URL  = process.env.BASE_URL || 'https://webconceptor.fr'

// ── Utilitaires ────────────────────────────────────────────────

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`) }

function toMobileE164(raw) {
  if (!raw) return null
  const d = String(raw).replace(/[^0-9+]/g, '')
  let n = d
  if (n.startsWith('+33')) n = '0' + n.slice(3)
  else if (n.startsWith('33') && n.length === 11) n = '0' + n.slice(2)
  if (!/^0[67]\d{8}$/.test(n)) return null
  return '+33' + n.slice(1)
}

function gsmSafe(s) {
  return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\x20-\x7E\n]/g,'').trim()
}

async function sendSMS(phone, content) {
  if (!BREVO_KEY) return false
  const to = toMobileE164(phone)
  if (!to) return false
  const safe = gsmSafe(content).slice(0, 160)
  try {
    const res = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
      method: 'POST',
      headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: 'WebConcept', recipient: to, content: safe, type: 'transactional', unicodeEnabled: false }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) { log(`✅ SMS → ${to} (${data.remainingCredits ?? '?'} crédits)`); return true }
    log(`❌ SMS échoué: ${data.message}`)
    return false
  } catch (e) { log(`❌ SMS erreur: ${e}`); return false }
}

async function tg(msg) {
  if (!TG_TOKEN || !TG_CHAT) return
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: 'HTML', disable_web_page_preview: true }),
  }).catch(() => {})
}

// ── Phases ──────────────────────────────────────────────────────

// Phase 1 — SMS immédiat aux nouveaux prospects (opened dans les 15 dernières min)
// qui n'ont pas encore reçu de SMS (hot_sms_sent_at IS NULL)
async function phaseNewViews() {
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('prospects')
    .select('id, slug, name, phone, city, google_rating, google_reviews_count')
    .not('opened_at', 'is', null)
    .gte('opened_at', since)
    .is('hot_sms_sent_at', null)
    .neq('status', 'converted')
    .not('email_bounced', 'eq', true)

  if (error) { log(`❌ DB error: ${error.message}`); return }
  if (!data?.length) { log('Phase 1: aucun nouveau prospect'); return }

  log(`Phase 1: ${data.length} nouveau(x) prospect(s) à contacter`)

  for (const p of data) {
    const url = `${BASE_URL}/prospects/${p.slug}`
    const name = p.name || 'votre établissement'
    const sms = gsmSafe(`Bonjour, Tom de WebConceptor. J'ai prepare une maquette pour ${name.slice(0,28)}. Avez-vous quelques minutes ? ${url} STOP`).slice(0,160)

    let smsSent = false
    if (p.phone) {
      smsSent = await sendSMS(p.phone, sms)
      if (smsSent) {
        await supabase.from('prospects')
          .update({ hot_sms_sent_at: new Date().toISOString() })
          .eq('id', p.id)
      }
    }

    const rating = p.google_rating ? `${p.google_rating}/5 · ${p.google_reviews_count||0} avis` : '—'
    await tg(
      `🔥 <b>AGENT GH — 1ÈRE VUE</b>\n\n<b>${p.name}</b> · ${p.city||'—'}\n` +
      `📞 ${p.phone||'aucun'} · ⭐ ${rating}\n` +
      `💬 SMS: ${smsSent ? '✅' : '❌ pas de mobile'}\n` +
      `<a href="${url}">→ Voir sa maquette</a>`
    )
  }
}

// Phase 2 — Follow-up 2h : prospects qui ont vu il y a 1h30-3h, SMS envoyé, pas acheté
async function phaseFollowUp2h() {
  const from = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
  const to   = new Date(Date.now() - 1.5 * 60 * 60 * 1000).toISOString()

  const { data } = await supabase
    .from('prospects')
    .select('id, slug, name, phone, city')
    .not('opened_at', 'is', null)
    .gte('opened_at', from)
    .lte('opened_at', to)
    .not('hot_sms_sent_at', 'is', null)  // SMS 1er envoyé
    .is('followup_sms_sent_at', null)    // Follow-up pas encore envoyé
    .neq('status', 'converted')

  if (!data?.length) { log('Phase 2: aucun follow-up 2h'); return }
  log(`Phase 2: ${data.length} follow-up(s) 2h`)

  for (const p of data) {
    if (!p.phone) continue
    const url = `${BASE_URL}/prospects/${p.slug}`
    const sms = gsmSafe(`Tom WebConceptor. Votre maquette pour ${(p.name||'').slice(0,28)} est disponible. Des questions ? 06 35 59 24 71 ou ${url} STOP`).slice(0,160)
    const ok = await sendSMS(p.phone, sms)
    if (ok) {
      await supabase.from('prospects')
        .update({ followup_sms_sent_at: new Date().toISOString() })
        .eq('id', p.id)
    }
  }
}

// Phase 3 — Dernière chance J+1 : ouverts hier matin, pas achetés
async function phaseFinalPush() {
  const from = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString()
  const to   = new Date(Date.now() - 22 * 60 * 60 * 1000).toISOString()
  const now  = new Date()
  const hour = now.getHours()

  // N'envoyer qu'entre 9h et 11h
  if (hour < 9 || hour > 11) { log('Phase 3: hors horaire (9h-11h)'); return }

  const { data } = await supabase
    .from('prospects')
    .select('id, slug, name, phone')
    .not('opened_at', 'is', null)
    .gte('opened_at', from)
    .lte('opened_at', to)
    .is('final_sms_sent_at', null)
    .neq('status', 'converted')

  if (!data?.length) { log('Phase 3: aucun final push'); return }
  log(`Phase 3: ${data.length} final push(es)`)

  for (const p of data) {
    if (!p.phone) continue
    const sms = gsmSafe(`Tom WebConceptor. Dernier message : maquette de ${(p.name||'').slice(0,25)} retiree dans 24h. Offre 320 EUR livraison 5j. 06 35 59 24 71. STOP`).slice(0,160)
    const ok = await sendSMS(p.phone, sms)
    if (ok) {
      await supabase.from('prospects')
        .update({ final_sms_sent_at: new Date().toISOString() })
        .eq('id', p.id)
    }
  }
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  log('🚀 Sales Agent GitHub Actions démarré')

  await phaseNewViews()
  await phaseFollowUp2h()
  await phaseFinalPush()

  log('✅ Terminé')
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
