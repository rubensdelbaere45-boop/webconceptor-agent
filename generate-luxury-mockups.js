/* ═══════════════════════════════════════════════════════════════
   WebConceptor — Script de génération des maquettes LUXURY
   Lance depuis ton terminal : node generate-luxury-mockups.js

   PRÉREQUIS :
   STITCH_API_KEY dans .env (clé depuis stitch.withgoogle.com)
   ═══════════════════════════════════════════════════════════════ */

import { createClient } from '@supabase/supabase-js'
import { generateLuxuryMockup } from './stitch-generator.js'
import { config } from 'dotenv'
config()

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BASE_URL = process.env.BASE_URL || 'https://webconceptor.fr'
const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || 'Rubens2026-WebConceptor'

function log(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`) }

async function triggerEmail(prospectSlug) {
  const res = await fetch(`${BASE_URL}/api/prospect/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
    body: JSON.stringify({ prospect_slug: prospectSlug, force: true }),
  })
  const d = await res.json().catch(() => ({}))
  log(`  📧 Email : ${d.results?.[0]?.status || JSON.stringify(d)}`)
  return res.ok
}

async function main() {
  if (!process.env.STITCH_API_KEY) {
    console.error('❌ STITCH_API_KEY manquante !')
    console.error('   → Va sur stitch.withgoogle.com → Settings → API Keys')
    console.error('   → Ajoute STITCH_API_KEY=ta_clé dans le fichier .env')
    process.exit(1)
  }

  log('✨ Générateur LUXURY WebConceptor × Google Stitch')
  log('━'.repeat(50))

  // Récupérer les prospects luxury en attente de maquette
  const { data: prospects, error } = await supabase
    .from('prospects')
    .select('id, slug, name, city, business_type, google_rating, google_reviews_count, site_quality, about_scraped')
    .eq('is_luxury', true)
    .in('status', ['found', 'ready'])
    .not('email', 'is', null)
    .not('email_bounced', 'eq', true)
    .order('google_reviews_count', { ascending: false })
    .limit(5) // 5 max par run — Stitch peut prendre 30-60s par design

  if (error) { log(`❌ DB error : ${error.message}`); process.exit(1) }

  if (!prospects?.length) {
    log('✅ Aucun prospect luxury en attente — tout est à jour !')
    log('')
    log('Pour voir les prospects luxury dans Supabase :')
    log('SELECT name, city, google_rating, status FROM prospects WHERE is_luxury = true;')
    process.exit(0)
  }

  log(`📋 ${prospects.length} prospect(s) luxury à traiter :`)
  prospects.forEach((p, i) => {
    log(`  ${i + 1}. ${p.name} (${p.city || '?'}) — ${p.google_rating || '?'}/5 · ${p.business_type || '?'}`)
  })
  log('')

  let ok = 0
  let fail = 0

  for (const p of prospects) {
    log(`\n[${ok + fail + 1}/${prospects.length}] ════ ${p.name} ════`)

    try {
      // 1. Générer avec Stitch (30-60 sec)
      const { html, projectId, screenId } = await generateLuxuryMockup(p)

      // 2. Sauvegarder dans Supabase
      const { error: dbErr } = await supabase
        .from('prospects')
        .update({
          mockup_html: html,
          stitch_generated: true,
          stitch_pending: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', p.id)

      if (dbErr) throw new Error(`DB update failed: ${dbErr.message}`)
      log(`  ✅ Maquette sauvegardée (project: ${projectId}, screen: ${screenId})`)

      // 3. Envoyer l'email luxury
      await triggerEmail(p.slug)

      ok++
      log(`  🎉 ${p.name} — COMPLET`)

    } catch (e) {
      log(`  ❌ Échec : ${e.message}`)
      fail++

      // Marquer comme échoué pour retry
      await supabase.from('prospects')
        .update({ stitch_pending: false })
        .eq('id', p.id)
    }

    // Pause entre chaque pour respecter les rate limits Stitch
    if (prospects.indexOf(p) < prospects.length - 1) {
      log('  ⏳ Pause 10s (rate limit Stitch)...')
      await new Promise(r => setTimeout(r, 10000))
    }
  }

  log('\n' + '━'.repeat(50))
  log(`✅ Résultat : ${ok} réussi(s) — ${fail} échoué(s)`)
  log(`💡 Pour voir les maquettes : webconceptor.fr/prospects/[slug]`)
}

main().catch(e => { console.error('❌ Erreur fatale:', e); process.exit(1) })
