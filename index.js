/* ═══════════════════════════════════════════════════════════════
   WebConceptor — Multi-Agent Sales System (Railway)
   7 agents en parallèle, 1 seul process, 24h/24

   AGENT 1 — Réaltime : SMS < 30s dès 1ère vue maquette
   AGENT 2 — Briefing 8h : TOP 5 prospects à appeler aujourd'hui
   AGENT 3 — Relance froids : prospects 7j+ sans achat
   AGENT 4 — Alerte 3 vues : prospect ultra-chaud sans achat
   AGENT 5 — Offre flash : -20% aux hésitants (2+ vues)
   AGENT 6 — Rapport 19h : stats de la journée
   AGENT 7 — LUXURY : génère maquettes Stitch auto pour prospects premium
   ═══════════════════════════════════════════════════════════════ */

// Polyfill WebSocket pour Node < 22 (Railway utilise Node 20)
// DOIT être avant tout import Supabase
import ws from 'ws'
if (!globalThis.WebSocket) globalThis.WebSocket = ws

import { createClient } from '@supabase/supabase-js'
import { createServer } from 'http'
import { generateLuxuryMockup } from './stitch-generator.js'

// ── Config ──────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const BREVO_KEY    = process.env.BREVO_API_KEY
const TG_TOKEN     = process.env.TELEGRAM_BOT_TOKEN
const TG_CHAT      = process.env.TELEGRAM_CHAT_ID
const BASE_URL     = process.env.BASE_URL || 'https://webconceptor.fr'
const ADMIN_KEY    = process.env.ADMIN_SECRET_KEY || 'Rubens2026-WebConceptor'

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ SUPABASE_URL et SUPABASE_SERVICE_KEY sont requis')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const scheduled = new Map()

// ══════════════════════════════════════════════════════════════════
// UTILITAIRES COMMUNS
// ══════════════════════════════════════════════════════════════════

function log(agent, msg) {
  console.log(`[${new Date().toISOString().slice(11,19)}] [${agent}] ${msg}`)
}

function parisHour() {
  return new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }) | 0
}

function toMobileE164(raw) {
  if (!raw) return null
  const d = String(raw).replace(/[^0-9+]/g, '')
  let n = d
  if (n.startsWith('+33')) n = '0' + n.slice(3)
  else if (n.startsWith('33') && n.length === 11) n = '0' + n.slice(2)
  if (!/^0[67]\d{8}$/.test(n)) return null
  return '+33' + n.slice(1)
}

function gsm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E\n]/g, '').trim()
}

async function sendSMS(phone, content) {
  if (!BREVO_KEY) return false
  const to = toMobileE164(phone)
  if (!to) return false
  const safe = gsm(content).slice(0, 160)
  try {
    const r = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
      method: 'POST',
      headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: 'WebConcept', recipient: to, content: safe, type: 'transactional', unicodeEnabled: false }),
    })
    const d = await r.json().catch(() => ({}))
    if (r.ok) { log('SMS', `✅ → ${to} (${d.remainingCredits ?? '?'} crédits)`); return true }
    log('SMS', `❌ ${d.message}`)
    return false
  } catch (e) { log('SMS', `❌ ${e}`); return false }
}

// Envoi email Brevo — prospects chauds (1ère vue, relance, offre flash)
async function sendBrevoEmail(to, toName, subject, html, text) {
  if (!BREVO_KEY || !to) return false
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: 'Tom Bauer — WebConceptor', email: 'contact@webconceptor.fr' },
        to: [{ email: to, name: toName || to }],
        subject,
        htmlContent: html,
        textContent: text,
        headers: {
          'List-Unsubscribe': `<https://webconceptor.fr/api/unsubscribe?email=${encodeURIComponent(to)}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    })
    if (r.ok) { log('EMAIL', `✅ → ${to}`); return true }
    const d = await r.json().catch(() => ({}))
    log('EMAIL', `❌ ${d.message || r.status}`)
    return false
  } catch (e) { log('EMAIL', `❌ ${e}`); return false }
}

async function tg(msg, silent = false) {
  if (!TG_TOKEN || !TG_CHAT) return
  fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TG_CHAT, text: msg, parse_mode: 'HTML',
      disable_web_page_preview: true,
      disable_notification: silent,
    }),
  }).catch(() => {})
}

// ══════════════════════════════════════════════════════════════════
// AGENT 1 — RÉALTIME : SMS immédiat dès 1ère vue
// ══════════════════════════════════════════════════════════════════

async function agent1_onFirstView(p) {
  if (p.status === 'converted') return
  const url = `${BASE_URL}/prospects/${p.slug}`
  log('A1', `🔥 1ère vue : ${p.name} (${p.city || '?'}) tél:${p.phone || 'aucun'}`)

  let smsSent = false
  if (p.phone) {
    const txt = gsm(`Bonjour, Tom Bauer de WebConceptor. Maquette preparee pour ${String(p.name||'').slice(0,25)}. Quelques minutes ? ${url} STOP`).slice(0,160)
    smsSent = await sendSMS(p.phone, txt)
    if (smsSent) await supabase.from('prospects').update({ hot_sms_sent_at: new Date().toISOString() }).eq('id', p.id)
  }

  // Email Brevo de suivi chaud — envoyé dès la 1ère ouverture de la maquette
  if (p.email) {
    const emailHtml = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a">
<p style="font-size:15px;margin:0 0 14px">Bonjour,</p>
<p style="font-size:15px;margin:0 0 14px">Je vois que vous venez de consulter la maquette que j'avais préparée pour <strong>${p.name}</strong>.</p>
<p style="font-size:15px;margin:0 0 14px">Si vous avez des questions sur le design, le prix ou les délais, je suis disponible maintenant : répondez directement à cet email ou appelez le <strong>06 35 59 24 71</strong>.</p>
<p style="font-size:15px;margin:0 0 14px">→ <a href="${url}" style="color:#0066ff">Revoir votre maquette</a></p>
<p style="font-size:14px;color:#555;margin:24px 0 0">Tom Bauer · WebConceptor<br>contact@webconceptor.fr · 06 35 59 24 71</p>
<p style="font-size:11px;color:#999;margin:20px 0 0;border-top:1px solid #eee;padding-top:12px">
<a href="https://webconceptor.fr/api/unsubscribe?email=${encodeURIComponent(p.email)}" style="color:#999">Se désabonner</a></p>
</div>`
    const emailText = `Bonjour,\n\nJe vois que vous venez de consulter la maquette préparée pour ${p.name}.\n\nDes questions ? Répondez à cet email ou appelez le 06 35 59 24 71.\n\nVotre maquette : ${url}\n\nTom Bauer · WebConceptor`
    await sendBrevoEmail(p.email, p.name, `Votre maquette — ${p.name}`, emailHtml, emailText)
  }

  await tg(
    `🔥 <b>AGENT 1 — 1ÈRE VUE</b>\n<b>${p.name}</b> · ${p.city || '—'}\n` +
    `📞 ${p.phone || 'aucun'} · ⭐ ${p.google_rating ? p.google_rating + '/5' : '—'}\n` +
    `💬 SMS: ${smsSent ? '✅' : '❌'} · 🌐 ${p.site_quality === 'none' ? 'AUCUN SITE' : p.site_quality || '—'}\n` +
    `<a href="${url}">→ Voir maquette</a>\n<i>Appelle dans les 5 min !</i>`
  )

  // Follow-up 2h
  scheduled.set(`${p.slug}:2h`, { p, triggerAt: Date.now() + 2 * 3600000, type: '2h', url })
  // Follow-up J+1 9h
  const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0)
  scheduled.set(`${p.slug}:j1`, { p, triggerAt: t.getTime(), type: 'j1', url })
}

async function agent1_onSecondView(p) {
  if (p.status === 'converted') return
  const url = `${BASE_URL}/prospects/${p.slug}`
  log('A1', `👀 2ème vue : ${p.name}`)
  if (p.phone) {
    const txt = gsm(`WebConceptor. Je vois que vous revenez sur la maquette de ${String(p.name||'').slice(0,25)}. Je suis dispo : 06 35 59 24 71. ${url} STOP`).slice(0,160)
    await sendSMS(p.phone, txt)
  }
  await tg(`👀 <b>AGENT 1 — RETOUR</b>\n<b>${p.name}</b> revient sur sa maquette\n📞 ${p.phone || 'aucun'}\n<a href="${url}">→ Maquette</a>`)
  scheduled.delete(`${p.slug}:2h`)
}

async function agent1_onCartOpened(p) {
  if (p.status === 'converted') return
  const url = `${BASE_URL}/prospects/${p.slug}`
  log('A1', `🛒 PANIER OUVERT : ${p.name}`)
  if (p.phone) {
    const txt = gsm(`WebConceptor. Vous etes sur l'ecran de commande pour ${String(p.name||'').slice(0,25)}. Un souci ? 06 35 59 24 71. STOP`).slice(0,160)
    await sendSMS(p.phone, txt)
  }
  await tg(`🛒 <b>AGENT 1 — PANIER OUVERT</b>\n<b>${p.name}</b> · ${p.city || '—'}\n📞 ${p.phone || 'aucun'}\n<a href="${url}">→ Maquette</a>`)
}

// Follow-ups planifiés
setInterval(async () => {
  const now = Date.now()
  for (const [key, job] of scheduled) {
    if (now < job.triggerAt) continue
    scheduled.delete(key)
    const { data } = await supabase.from('prospects').select('id,name,phone,status').eq('slug', job.p.slug).maybeSingle()
    if (!data || data.status === 'converted') continue

    if (job.type === '2h' && job.p.email) {
      log('A1', `⏰ Follow-up 2h email : ${data.name}`)
      const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a"><p style="font-size:15px;margin:0 0 14px">Bonjour,</p><p style="font-size:15px;margin:0 0 14px">Votre maquette pour <strong>${data.name}</strong> est toujours disponible. Une question sur le tarif, la livraison ou le design ? Répondez à cet email ou appelez le 06 35 59 24 71.</p><p style="margin:20px 0"><a href="${job.url}" style="background:#0066ff;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Voir ma maquette →</a></p><p style="font-size:14px;color:#555;margin:24px 0 0">Tom Bauer — WebConceptor<br>contact@webconceptor.fr</p></div>`
      await sendBrevoEmail(job.p.email, data.name, `Votre maquette vous attend — ${data.name}`, html, `Votre maquette : ${job.url}\n\nTom Bauer — WebConceptor`)
    }
    if (job.type === 'j1' && job.p.email) {
      log('A1', `⏰ Follow-up J+1 email : ${data.name}`)
      const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a"><p style="font-size:15px;margin:0 0 14px">Bonjour,</p><p style="font-size:15px;margin:0 0 14px">Dernière chance — la maquette de <strong>${data.name}</strong> sera retirée dans 24h. Tarif : <strong>320 € TTC</strong>, livraison en 5 jours ouvrés, satisfait ou remboursé 14 jours.</p><p style="margin:20px 0"><a href="${job.url}" style="background:#0066ff;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Voir ma maquette →</a></p><p style="font-size:14px;color:#555;margin:24px 0 0">Tom Bauer — WebConceptor<br>contact@webconceptor.fr</p></div>`
      await sendBrevoEmail(job.p.email, data.name, `Dernière chance — maquette retirée dans 24h`, html, `Dernière chance. Votre maquette : ${job.url}\n\nTom Bauer — WebConceptor`)
    }
  }
}, 60000)

// Realtime désactivé — Railway US East ne peut pas joindre Supabase eu-west-1
// Le polling toutes les 2 min (ci-dessous) est suffisant pour les SMS chauds.
let realtimeChannel = null
let realtimeRetries = 1 // polling actif dès le départ
log('A1', '📡 Mode polling — SMS envoyé dans les 2 min après 1ère vue')

// ── Fallback polling quand Realtime échoue (plan Free Supabase) ────
// Vérifie toutes les 2 min les nouvelles premières vues manquées
const polledSlugs = new Set()

async function agent1_pollingFallback() {
  if (realtimeRetries === 0) return // Realtime OK, pas besoin de polling

  try {
    const since2min = new Date(Date.now() - 2 * 60000).toISOString()
    const { data } = await supabase.from('prospects')
      .select('id, slug, name, phone, city, google_rating, google_reviews_count, site_quality, opened_at, view_count, cart_opened_at, status')
      .not('opened_at', 'is', null)
      .gte('opened_at', since2min)
      .neq('status', 'converted')
      .limit(10)

    if (!data?.length) return

    for (const p of data) {
      if (!polledSlugs.has(`first:${p.slug}`)) {
        polledSlugs.add(`first:${p.slug}`)
        agent1_onFirstView(p)
      }
    }

    // Nettoyer le cache après 1h
    if (polledSlugs.size > 500) polledSlugs.clear()
  } catch {}
}

setInterval(agent1_pollingFallback, 2 * 60000)

// ══════════════════════════════════════════════════════════════════
// AGENT 2 — BRIEFING 8H : TOP 5 prospects à appeler
// ══════════════════════════════════════════════════════════════════

async function agent2_morningBriefing() {
  log('A2', '📊 Briefing matin...')
  try {
    // Prospects ouverts non convertis, triés par vue_count DESC
    const { data } = await supabase.from('prospects')
      .select('slug, name, phone, city, google_rating, google_reviews_count, view_count, opened_at, site_quality')
      .not('opened_at', 'is', null)
      .neq('status', 'converted')
      .order('view_count', { ascending: false })
      .limit(5)

    if (!data?.length) { log('A2', 'Aucun prospect chaud'); return }

    const lines = data.map((p, i) => {
      const views = p.view_count || 0
      const rating = p.google_rating ? `${p.google_rating}★` : '—'
      const site = p.site_quality === 'none' ? '❌ sans site' : p.site_quality === 'poor' ? '⚠️ site vieux' : '✅ site ok'
      return `${i+1}. <b>${p.name}</b> · ${p.city || '—'}\n   📞 ${p.phone || 'aucun'} · ${rating} · ${views} vue${views>1?'s':''} · ${site}`
    }).join('\n\n')

    await tg(
      `📊 <b>AGENT 2 — BRIEFING 8H</b>\n<b>TOP ${data.length} PROSPECTS À APPELER AUJOURD'HUI</b>\n\n${lines}\n\n` +
      `<i>Appelle dans l'ordre — le #1 est le plus chaud.</i>`,
      true
    )
    log('A2', `Briefing envoyé — ${data.length} prospects`)
  } catch (e) { log('A2', `❌ ${e}`) }
}

// ══════════════════════════════════════════════════════════════════
// AGENT 3 — RELANCE FROIDS : prospects 7j+ sans achat
// ══════════════════════════════════════════════════════════════════

async function agent3_coldReactivation() {
  log('A3', '🔄 Scan prospects froids...')
  try {
    const cutoff7j  = new Date(Date.now() - 7 * 86400000).toISOString()
    const cutoff14j = new Date(Date.now() - 14 * 86400000).toISOString()

    const { data } = await supabase.from('prospects')
      .select('id, slug, name, phone, city, google_rating')
      .not('opened_at', 'is', null)
      .lte('opened_at', cutoff7j)
      .gte('opened_at', cutoff14j)   // entre 7j et 14j
      .is('final_sms_sent_at', null)
      .neq('status', 'converted')
      .limit(5)

    if (!data?.length) { log('A3', 'Aucun prospect froid'); return }
    log('A3', `${data.length} prospect(s) froid(s) à relancer`)

    for (const p of data) {
      const url = `${BASE_URL}/prospects/${p.slug}`
      // Pas de SMS pour les froids — email Brevo uniquement
      if (p.email) {
        const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a">
<p style="font-size:15px;margin:0 0 14px">Bonjour,</p>
<p style="font-size:15px;margin:0 0 14px">Je reviens vers vous au sujet de la maquette préparée pour <strong>${p.name}</strong>.</p>
<p style="font-size:15px;margin:0 0 14px">Elle est toujours disponible ici : <a href="${url}">${url}</a></p>
<p style="font-size:15px;margin:0 0 14px">Si vous avez des questions, répondez directement à cet email.</p>
<p style="font-size:14px;color:#555;margin:24px 0 0">Tom Bauer — WebConceptor<br>contact@webconceptor.fr · 06 35 59 24 71</p>
<p style="font-size:11px;color:#999;margin:16px 0 0;border-top:1px solid #eee;padding-top:12px"><a href="https://webconceptor.fr/api/unsubscribe?email=${encodeURIComponent(p.email)}" style="color:#999">Se désabonner</a></p>
</div>`
        const ok = await sendBrevoEmail(p.email, p.name, `Votre maquette — ${p.name}`, html, `Bonjour,\n\nVotre maquette : ${url}\n\nTom Bauer — WebConceptor`)
        if (ok) await supabase.from('prospects').update({ final_sms_sent_at: new Date().toISOString() }).eq('id', p.id)
      }
      await tg(`🔄 <b>AGENT 3 — RELANCE FROID</b>\n<b>${p.name}</b> · ${p.city||'—'}\n📞 ${p.phone||'aucun'}`, true)
    }
  } catch (e) { log('A3', `❌ ${e}`) }
}

// ══════════════════════════════════════════════════════════════════
// AGENT 4 — ALERTE 3 VUES : prospect ultra-chaud
// ══════════════════════════════════════════════════════════════════

const alerted3views = new Set() // évite les doublons en mémoire

async function agent4_threeViewsAlert() {
  try {
    const { data } = await supabase.from('prospects')
      .select('slug, name, phone, city, view_count, google_rating')
      .gte('view_count', 3)
      .neq('status', 'converted')
      .limit(10)

    if (!data?.length) return

    for (const p of data) {
      if (alerted3views.has(p.slug)) continue
      alerted3views.add(p.slug)
      const url = `${BASE_URL}/prospects/${p.slug}`
      log('A4', `💥 ${p.view_count} vues : ${p.name}`)
      await tg(
        `💥 <b>AGENT 4 — ${p.view_count} VUES SANS ACHAT</b>\n` +
        `<b>${p.name}</b> · ${p.city || '—'}\n` +
        `📞 ${p.phone || 'aucun'} · ⭐ ${p.google_rating || '—'}/5\n` +
        `Ce prospect hésite vraiment. Appelle-le MAINTENANT.\n<a href="${url}">→ Maquette</a>`
      )
    }
  } catch (e) { log('A4', `❌ ${e}`) }
}

// ══════════════════════════════════════════════════════════════════
// AGENT 5 — OFFRE FLASH : -20% aux hésitants (2+ vues, pas acheté)
// ══════════════════════════════════════════════════════════════════

const flashOfferSent = new Set()

async function agent5_flashOffer() {
  log('A5', '💸 Scan hésitants pour offre flash...')
  try {
    const since48h = new Date(Date.now() - 48 * 3600000).toISOString()
    const since4h  = new Date(Date.now() - 4 * 3600000).toISOString()

    // Vus 2+ fois entre 4h et 48h, pas encore convertis, pas déjà eu l'offre flash
    const { data } = await supabase.from('prospects')
      .select('id, slug, name, phone, city')
      .gte('view_count', 2)
      .gte('opened_at', since48h)
      .lte('opened_at', since4h)
      .is('followup_sms_sent_at', null)
      .neq('status', 'converted')
      .limit(5)

    if (!data?.length) { log('A5', 'Aucun hésitant'); return }
    log('A5', `${data.length} offre(s) flash à envoyer`)

    for (const p of data) {
      if (flashOfferSent.has(p.slug)) continue
      flashOfferSent.add(p.slug)
      const url = `${BASE_URL}/prospects/${p.slug}?promo=20`
      // Pas de SMS pour l'offre flash — email Brevo uniquement
      if (p.email) {
        const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a">
<div style="background:#e53e3e;color:#fff;padding:12px;border-radius:6px;text-align:center;font-weight:700;margin-bottom:20px">🎁 Offre exclusive -20 % · 256 € au lieu de 320 € · Valable 24h</div>
<p style="font-size:15px;margin:0 0 14px">Bonjour,</p>
<p style="font-size:15px;margin:0 0 14px">Je vous propose une offre exclusive pour la maquette de <strong>${p.name}</strong> : <strong>256 € TTC</strong> au lieu de 320 €, soit 20 % de réduction.</p>
<p style="font-size:15px;margin:0 0 14px">Cette offre est valable 24h uniquement.</p>
<p style="margin:20px 0"><a href="${url}" style="background:#0066ff;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Voir ma maquette →</a></p>
<p style="font-size:14px;color:#555;margin:24px 0 0">Tom Bauer — WebConceptor<br>contact@webconceptor.fr · 06 35 59 24 71</p>
<p style="font-size:11px;color:#999;margin:16px 0 0;border-top:1px solid #eee;padding-top:12px"><a href="https://webconceptor.fr/api/unsubscribe?email=${encodeURIComponent(p.email)}" style="color:#999">Se désabonner</a></p>
</div>`
        const ok = await sendBrevoEmail(p.email, p.name, `Offre -20 % sur votre maquette — ${p.name}`, html, `Offre exclusive -20% : 256 EUR au lieu de 320 EUR.\nValable 24h : ${url}\n\nTom Bauer — WebConceptor`)
        if (ok) {
          await supabase.from('prospects').update({ followup_sms_sent_at: new Date().toISOString() }).eq('id', p.id)
          await tg(`💸 <b>AGENT 5 — OFFRE FLASH -20%</b>\nEnvoyée à <b>${p.name}</b> · ${p.city||'—'}`, true)
        }
      }
    }
  } catch (e) { log('A5', `❌ ${e}`) }
}

// ══════════════════════════════════════════════════════════════════
// AGENT 6 — RAPPORT 19H : stats de la journée
// ══════════════════════════════════════════════════════════════════

async function agent6_eveningReport() {
  log('A6', '📈 Rapport de fin de journée...')
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const todayIso = today.toISOString()

    const [views, converted, sent] = await Promise.all([
      supabase.from('prospects').select('id', { count: 'exact', head: true })
        .gte('opened_at', todayIso),
      supabase.from('prospects').select('id', { count: 'exact', head: true })
        .eq('status', 'converted').gte('updated_at', todayIso),
      supabase.from('prospects').select('id', { count: 'exact', head: true })
        .eq('status', 'sent').gte('sent_at', todayIso),
    ])

    const vCount = views.count ?? 0
    const cCount = converted.count ?? 0
    const sCount = sent.count ?? 0

    // Top prospects du jour (les plus chauds)
    const { data: hot } = await supabase.from('prospects')
      .select('name, phone, city, view_count')
      .gte('opened_at', todayIso)
      .neq('status', 'converted')
      .order('view_count', { ascending: false })
      .limit(3)

    const hotList = hot?.length
      ? hot.map(p => `• <b>${p.name}</b> (${p.city||'—'}) — ${p.view_count} vue${(p.view_count||0)>1?'s':''} · 📞 ${p.phone||'aucun'}`).join('\n')
      : '(aucun)'

    await tg(
      `📈 <b>AGENT 6 — RAPPORT DU ${new Date().toLocaleDateString('fr-FR')}</b>\n\n` +
      `📧 Emails envoyés : <b>${sCount}</b>\n` +
      `👀 Maquettes ouvertes : <b>${vCount}</b>\n` +
      `🎯 Ventes : <b>${cCount}</b>\n\n` +
      `🔥 <b>Prospects chauds non convertis :</b>\n${hotList}\n\n` +
      `<i>Bonne soirée — les SMS de relance tournent toute la nuit.</i>`,
      true
    )
    log('A6', `Rapport envoyé — ${vCount} vues, ${cCount} ventes`)
  } catch (e) { log('A6', `❌ ${e}`) }
}

// ══════════════════════════════════════════════════════════════════
// SCHEDULER PRINCIPAL — vérifie l'heure toutes les minutes
// ══════════════════════════════════════════════════════════════════

let lastBriefingDay  = -1
let lastReportDay    = -1
let lastColdScanHour = -1
let lastFlashHour    = -1

setInterval(async () => {
  const now   = new Date()
  const hour  = parisHour()
  const day   = now.getDate()

  // Agent 2 — briefing 8h (une fois par jour)
  if (hour === 8 && lastBriefingDay !== day) {
    lastBriefingDay = day
    agent2_morningBriefing()
  }

  // Agent 6 — rapport 19h (une fois par jour)
  if (hour === 19 && lastReportDay !== day) {
    lastReportDay = day
    agent6_eveningReport()
  }

  // Agent 3 — relance froids (toutes les 6h entre 9h et 18h)
  if ([9, 13, 17].includes(hour) && lastColdScanHour !== hour) {
    lastColdScanHour = hour
    agent3_coldReactivation()
  }

  // Agent 5 — offres flash (toutes les 4h : 10h, 14h)
  if ([10, 14].includes(hour) && lastFlashHour !== hour) {
    lastFlashHour = hour
    agent5_flashOffer()
  }

}, 60000)

// Agent 4 — scan 3 vues toutes les 15 min
setInterval(() => agent4_threeViewsAlert(), 15 * 60000)
agent4_threeViewsAlert() // scan immédiat au démarrage

// ══════════════════════════════════════════════════════════════════
// AGENT 7 — LUXURY : génère les maquettes Stitch automatiquement
// ══════════════════════════════════════════════════════════════════

const generatingLuxury = new Set() // évite les doubles générations

async function agent7_generateLuxuryMockups() {
  if (!process.env.STITCH_API_KEY) return // skip si pas de clé Stitch

  try {
    // Cherche les prospects luxury sans maquette Stitch
    const { data } = await supabase.from('prospects')
      .select('id, slug, name, city, business_type, google_rating, google_reviews_count, about_scraped')
      .eq('is_luxury', true)
      .eq('stitch_generated', false)
      .in('status', ['found', 'ready'])
      .not('email', 'is', null)
      .not('email_bounced', 'eq', true)
      .order('google_reviews_count', { ascending: false })
      .limit(3) // max 3 par scan — Stitch prend du temps

    if (!data?.length) return

    for (const p of data) {
      if (generatingLuxury.has(p.slug)) continue
      generatingLuxury.add(p.slug)

      log('A7', `✨ Génération Stitch : ${p.name} (${p.city || '?'})`)

      // Marquer comme en cours
      await supabase.from('prospects').update({ stitch_pending: true }).eq('id', p.id)

      try {
        const { html, projectId } = await generateLuxuryMockup(p)

        // Sauvegarder dans Supabase
        await supabase.from('prospects').update({
          mockup_html: html,
          stitch_generated: true,
          stitch_pending: false,
          updated_at: new Date().toISOString(),
        }).eq('id', p.id)

        // Envoyer l'email luxury
        await fetch(`${BASE_URL}/api/prospect/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
          body: JSON.stringify({ prospect_slug: p.slug, force: true }),
        }).catch(() => {})

        // Telegram alert
        const url = `${BASE_URL}/prospects/${p.slug}`
        await tg(
          `✨ <b>AGENT 7 — MAQUETTE STITCH GÉNÉRÉE</b>\n\n` +
          `<b>${p.name}</b> · ${p.city || '—'}\n` +
          `⭐ ${p.google_rating || '—'}/5 · 💶 860€\n` +
          `📐 Stitch project: ${projectId}\n\n` +
          `Email luxury envoyé ! <a href="${url}">→ Voir la maquette</a>`
        )

        log('A7', `✅ ${p.name} — maquette Stitch + email envoyés`)
      } catch (e) {
        log('A7', `❌ Échec pour ${p.name} : ${e.message}`)
        await supabase.from('prospects').update({ stitch_pending: false }).eq('id', p.id)
      } finally {
        generatingLuxury.delete(p.slug)
      }

      // Pause entre générations
      await new Promise(r => setTimeout(r, 15000))
    }
  } catch (e) {
    log('A7', `❌ ${e}`)
  }
}

// Vérifier les prospects luxury toutes les 30 minutes
setInterval(() => agent7_generateLuxuryMockups(), 30 * 60000)
agent7_generateLuxuryMockups() // scan immédiat au démarrage

// ══════════════════════════════════════════════════════════════════
// HEALTHCHECK HTTP (Railway le requiert)
// ══════════════════════════════════════════════════════════════════

createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    status: 'ok',
    agents: 7,
    stitch_enabled: !!process.env.STITCH_API_KEY,
    scheduled: scheduled.size,
    uptime_s: Math.floor(process.uptime()),
  }))
}).listen(process.env.PORT || 3000, () => {
  log('SYS', '🚀 7 agents démarrés — WebConceptor Sales System')
  log('SYS', `A1: Realtime SMS | A2: Briefing 8h | A3: Relance froids`)
  log('SYS', `A4: Alerte 3 vues | A5: Offre flash | A6: Rapport 19h`)
  log('SYS', `A7: ✨ Stitch Luxury — ${process.env.STITCH_API_KEY ? '✅ ACTIVE' : '⚠️ STITCH_API_KEY manquante'}`)

})

process.on('SIGTERM', () => {
  log('SYS', 'Arrêt propre.')
  if (realtimeTimer) clearTimeout(realtimeTimer)
  if (realtimeChannel) try { supabase.removeChannel(realtimeChannel) } catch {}
  process.exit(0)
})
