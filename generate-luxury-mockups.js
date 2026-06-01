/* ═══════════════════════════════════════════════════════════════
   WebConceptor — Générateur de maquettes LUXURY via Google Stitch

   USAGE :
   node generate-luxury-mockups.js

   CE QU'IL FAIT :
   1. Lit les prospects LUXURY en attente dans Supabase
   2. Pour chaque prospect, génère une maquette via Stitch MCP
   3. Télécharge le HTML généré
   4. Upload dans Supabase (mockup_html)
   5. Déclenche l'envoi de l'email automatiquement

   PRÉ-REQUIS :
   - Stitch MCP configuré et running (npx @google/stitch-mcp)
   - Variables d'environnement dans .env
   ═══════════════════════════════════════════════════════════════ */

import { createClient } from '@supabase/supabase-js'
import { execSync, exec } from 'child_process'
import { promisify } from 'util'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const execAsync = promisify(exec)
const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Config ──────────────────────────────────────────────────────
import { config } from 'dotenv'
config()

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BASE_URL = process.env.BASE_URL || 'https://webconceptor.fr'
const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || 'Rubens2026-WebConceptor'

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`) }

// ── Prompt Stitch pour un restaurant luxury ─────────────────────
function buildStitchPrompt(p) {
  const rating = p.google_rating ? `${p.google_rating}/5 (${p.google_reviews_count || 0} avis Google)` : ''
  const city = p.city || ''
  const businessType = p.business_type || 'restaurant'

  return `Create a luxury restaurant website homepage for "${p.name}" in ${city}, France.

**PLATFORM:** Web, Desktop-first with mobile responsive

**BRAND IDENTITY:**
- Establishment: ${p.name}
- Type: ${businessType}
- Location: ${city}, France
- Reputation: ${rating}

**PAGE STRUCTURE:**
1. **Navigation Bar:** Sticky glassmorphism nav, logo left, menu links center (Accueil, La Carte, Réservation, Contact), gold "Réserver" button right
2. **Hero Section:** Full-viewport height, dramatic dark overlay on restaurant photo, large serif headline in French, elegant subtitle, two CTAs (primary gold "Réserver une table", secondary outline "Découvrir la carte"), scroll indicator
3. **About Section:** Two-column layout, text left with elegant description of the establishment, image right with floating accent card showing awards/key info
4. **Menu Preview:** Dark background section, 3-4 signature dishes with descriptions, elegant typography, "Voir la carte complète" CTA
5. **Testimonials:** 3 client reviews with star ratings on elegant cards
6. **Reservation Section:** Full-width dark section with reservation form
7. **Footer:** Minimal, dark, address + hours + social links

**VISUAL STYLE:**
- Color palette: Deep black (#0C0C0C) with warm gold accents (#C9A96E)
- Typography: Playfair Display for headings, Manrope for body
- Aesthetic: Parisian luxury bistronomy, sophisticated, timeless
- Atmosphere: Dark, moody, premium — comparable to a Michelin-starred establishment website

**CONTENT (use placeholders matching the brand):**
- All text in French
- Headline: something evocative about the culinary experience
- Include the actual restaurant name "${p.name}" prominently
`
}

// ── Fetch HTML depuis Stitch via MCP ────────────────────────────
async function generateWithStitch(prospect) {
  log(`🎨 Génération Stitch pour : ${prospect.name}`)

  // Créer le fichier de prompt pour Stitch
  const promptFile = join(__dirname, `.stitch/prompt-${prospect.slug}.md`)
  const outputFile = join(__dirname, `.stitch/output-${prospect.slug}.html`)

  // Créer le dossier .stitch si besoin
  try { execSync(`mkdir -p ${join(__dirname, '.stitch')}`) } catch {}

  writeFileSync(promptFile, buildStitchPrompt(prospect))

  // Appel au MCP Stitch via Claude Code en mode headless
  // Ceci exécute: "génère un design et exporte en HTML"
  const mcpCommand = `echo "Generate a website design based on this prompt file and export the HTML to ${outputFile}: $(cat ${promptFile})" | claude --mcp stitch --output-format text 2>/dev/null`

  try {
    log(`  → Appel MCP Stitch...`)
    await execAsync(mcpCommand, { timeout: 120000 })

    if (existsSync(outputFile)) {
      const html = readFileSync(outputFile, 'utf-8')
      if (html.length > 5000) {
        log(`  ✅ HTML généré : ${html.length} chars`)
        return html
      }
    }
  } catch (e) {
    log(`  ⚠️ MCP Stitch non disponible : ${e.message?.slice(0, 100)}`)
  }

  return null
}

// ── Upload mockup dans Supabase ──────────────────────────────────
async function uploadMockup(prospectId, html) {
  const { error } = await supabase
    .from('prospects')
    .update({
      mockup_html: html,
      updated_at: new Date().toISOString(),
    })
    .eq('id', prospectId)

  if (error) throw error
  log(`  ✅ Mockup uploadé dans Supabase`)
}

// ── Déclencher l'envoi de l'email luxury ────────────────────────
async function triggerLuxuryEmail(prospectSlug) {
  try {
    const res = await fetch(`${BASE_URL}/api/prospect/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': ADMIN_KEY,
      },
      body: JSON.stringify({
        prospect_slug: prospectSlug,
        force: true, // ignore le couvre-feu horaire
      }),
    })
    const data = await res.json()
    log(`  ✅ Email luxury envoyé : ${JSON.stringify(data)}`)
    return true
  } catch (e) {
    log(`  ❌ Erreur envoi email : ${e.message}`)
    return false
  }
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  log('🚀 Générateur de maquettes LUXURY via Stitch')
  log('━'.repeat(50))

  // Récupérer les prospects luxury en attente
  const { data: prospects, error } = await supabase
    .from('prospects')
    .select('id, slug, name, city, business_type, google_rating, google_reviews_count, site_quality')
    .eq('is_luxury', true)
    .in('status', ['found', 'ready'])       // pas encore envoyés
    .is('mockup_html', null)                // pas encore de mockup Stitch
    .order('google_reviews_count', { ascending: false })
    .limit(10) // max 10 par run (Stitch peut être lent)

  if (error) { log(`❌ Erreur Supabase : ${error.message}`); process.exit(1) }
  if (!prospects?.length) {
    log('✅ Aucun prospect luxury en attente. Repassez demain !')
    process.exit(0)
  }

  log(`📋 ${prospects.length} prospect(s) luxury à traiter :`)
  prospects.forEach((p, i) => log(`  ${i+1}. ${p.name} (${p.city || '?'}) — ${p.google_rating || '?'}/5`))
  log('')

  let success = 0
  let failed = 0

  for (const p of prospects) {
    log(`\n[${success+failed+1}/${prospects.length}] Traitement : ${p.name}`)

    try {
      // 1. Générer avec Stitch
      const html = await generateWithStitch(p)

      if (!html) {
        log(`  ⚠️ Stitch non disponible — mockup dark luxury template utilisé à la place`)
        // Marque quand même pour que l'email parte avec le template standard
        await supabase.from('prospects')
          .update({ stitch_pending: false })
          .eq('id', p.id)
        failed++
        continue
      }

      // 2. Injecter branding WebConceptor dans le HTML Stitch
      const brandedHtml = injectBranding(html, p)

      // 3. Upload dans Supabase
      await uploadMockup(p.id, brandedHtml)

      // 4. Marquer comme Stitch généré
      await supabase.from('prospects')
        .update({ stitch_generated: true, stitch_pending: false })
        .eq('id', p.id)

      // 5. Envoyer l'email luxury
      await triggerLuxuryEmail(p.slug)

      success++
      log(`  🎉 ${p.name} — DONE`)

    } catch (e) {
      log(`  ❌ Erreur pour ${p.name} : ${e.message}`)
      failed++
    }

    // Pause entre chaque pour ne pas saturer l'API Stitch
    if (prospects.indexOf(p) < prospects.length - 1) {
      log('  ⏳ Pause 5s...')
      await new Promise(r => setTimeout(r, 5000))
    }
  }

  log('\n' + '━'.repeat(50))
  log(`✅ Terminé : ${success} réussi(s), ${failed} échoué(s)`)
}

// ── Injection du branding WebConceptor dans le HTML Stitch ──────
function injectBranding(html, p) {
  const slug = p.slug
  const prospectId = p.id
  const orderBar = `
<style>
.wc-order-bar{position:fixed;top:0;left:0;right:0;z-index:10001;height:38px;background:rgba(0,30,90,0.97);display:flex;align-items:center;justify-content:center;gap:14px;backdrop-filter:blur(10px);font-family:-apple-system,sans-serif}
.wc-order-label{color:rgba(255,255,255,0.65);font-size:11px;font-weight:400;letter-spacing:0.05em}
.wc-order-btn{padding:6px 20px;background:#C9A96E;color:#0a0a0a;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;border-radius:100px;cursor:pointer;border:none;transition:all 0.2s}
</style>
<div class="wc-order-bar">
  <span class="wc-order-label">✨ Création exclusive WebConceptor · Prestige</span>
  <button class="wc-order-btn" onclick="window.open('https://webconceptor.fr/prospects/${slug}','_blank')">Je commande ce site →</button>
</div>
<div style="height:38px"></div>`

  // Injecter après <body>
  if (html.includes('<body')) {
    return html.replace(/(<body[^>]*>)/, `$1\n${orderBar}`)
  }
  return orderBar + html
}

main().catch(e => { console.error(e); process.exit(1) })
