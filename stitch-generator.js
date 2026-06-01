/* ═══════════════════════════════════════════════════════════════
   WebConceptor — Stitch Luxury Mockup Generator
   Utilise @google/stitch-sdk pour générer des maquettes premium
   via l'IA Google Stitch, directement depuis Node.js.

   STITCH_API_KEY doit être dans les variables d'environnement.
   ═══════════════════════════════════════════════════════════════ */

import { stitch } from '@google/stitch-sdk'

const BASE_URL = process.env.BASE_URL || 'https://webconceptor.fr'

// ── Prompt luxury restauration ──────────────────────────────────
function buildLuxuryPrompt(prospect) {
  const { name, city, business_type, google_rating, google_reviews_count, about_scraped } = prospect
  const rating = google_rating ? `${google_rating}/5 étoiles (${google_reviews_count || 0} avis Google)` : ''
  const bt = business_type || 'restaurant'
  const cityStr = city || 'France'
  const aboutSnippet = about_scraped
    ? `\n\nDescription authentique de l'établissement : "${String(about_scraped).slice(0, 300)}"`
    : ''

  return `Create a premium luxury ${bt} website homepage for "${name}" located in ${cityStr}, France.
${rating ? `Reputation: ${rating}` : ''}${aboutSnippet}

**PLATFORM:** Web, Desktop-first, fully mobile responsive

**OVERALL AESTHETIC:**
Deep black backgrounds (#0C0C0C), warm gold accents (#C9A96E), Playfair Display serif headings, Manrope body text. Dark, moody, Michelin-starred atmosphere. Think Parisian luxury bistronomy — sophisticated, timeless, exclusive.

**PAGE STRUCTURE:**

1. **Hero Section (Full Viewport):**
   - Sticky glassmorphism navigation: restaurant name left, menu links (Accueil, La Carte, Réservation, Contact) center, gold pill "Réserver" button right
   - Full-bleed dark restaurant interior photo with dramatic overlay
   - Small elegant kicker text above headline (type of cuisine, all caps, gold, wide tracking)
   - Large Playfair Display headline in French — evocative, not generic. Example: "Là où l'art culinaire devient émotion"
   - Elegant subtitle text, 1 line max
   - Two CTAs: primary gold filled "Réserver une table →", secondary white outline "Voir la carte"
   - Subtle scroll-down arrow indicator

2. **About Section:**
   - Two-column layout: eloquent text left, portrait photo right
   - Section title in serif italic
   - 2-3 paragraphs about the chef's philosophy and terroir
   - Floating accent card (bottom-right of photo) with key credentials/awards
   - Elegant decorative gold line separator

3. **Signature Menu Preview:**
   - Dark background section
   - Gold top line separator
   - 3 signature dishes with refined descriptions in French
   - Each dish: name in serif, description in light italic, elegant price
   - "Découvrir la carte complète" ghost button

4. **Guest Testimonials:**
   - 3 review cards on dark/charcoal background
   - Large serif quotation mark in gold
   - Star rating in gold
   - Review text in italic serif
   - Guest name and date

5. **Reservation Section:**
   - Full-width dark section with gold accent border
   - Section title "Votre moment d'exception"
   - Simple reservation form: date, time, guests, name, phone, submit
   - Gold submit button

6. **Footer:**
   - Dark minimal footer
   - Address, hours, phone
   - Three columns: Contact, Horaires, Réseaux sociaux
   - Gold copyright line

**CRITICAL RULES:**
- All text in French
- Use "${name}" as the restaurant name throughout
- No lorem ipsum — write real, evocative French copy appropriate for a luxury establishment
- Dark palette only — no light backgrounds except for the About section which can use deep charcoal
- Gold (#C9A96E) as the ONLY accent color
- Minimum white space — generous padding, elegant breathing room
- NO generic stock-photo placeholder text — every word should feel curated`
}

// ── Injecter le branding WebConceptor ───────────────────────────
function injectWebConceptorBranding(html, prospect) {
  const { slug, id } = prospect
  const orderBar = `
<!-- WebConceptor Luxury Bar -->
<style>
.wc-luxury-bar{position:fixed;top:0;left:0;right:0;z-index:99999;height:40px;background:linear-gradient(135deg,#0a0010,#1a0030);display:flex;align-items:center;justify-content:center;gap:16px;backdrop-filter:blur(12px);border-bottom:1px solid rgba(201,169,110,0.3);font-family:-apple-system,sans-serif}
.wc-luxury-label{color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:0.1em;text-transform:uppercase}
.wc-luxury-label em{color:#C9A96E;font-style:normal;font-weight:600}
.wc-luxury-btn{padding:7px 22px;background:linear-gradient(135deg,#C9A96E,#9E7A42);color:#0a0a0a;font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;border-radius:100px;cursor:pointer;border:none;transition:all 0.2s;white-space:nowrap}
.wc-luxury-btn:hover{transform:scale(1.04);box-shadow:0 4px 16px rgba(201,169,110,0.4)}
@media(max-width:640px){.wc-luxury-label{display:none}}
</style>
<div class="wc-luxury-bar">
  <span class="wc-luxury-label">✨ Création <em>Prestige</em> par WebConceptor</span>
  <button class="wc-luxury-btn" onclick="window.location.href='${BASE_URL}/prospects/${slug}'">Je commande ce site → 860€</button>
</div>
<div style="height:40px"></div>
<!-- /WebConceptor -->`

  // Unsubscribe pixel (tracking)
  const trackingPixel = `<img src="${BASE_URL}/api/prospect/track-view" data-slug="${slug}" style="display:none" width="1" height="1" aria-hidden="true">`

  let result = html
  if (result.includes('<body')) {
    result = result.replace(/(<body[^>]*>)/i, `$1\n${orderBar}`)
  } else {
    result = orderBar + result
  }

  // Injecter le pixel avant </body>
  if (result.includes('</body>')) {
    result = result.replace('</body>', `${trackingPixel}\n</body>`)
  }

  return result
}

// ── Génération principale ────────────────────────────────────────
export async function generateLuxuryMockup(prospect) {
  const apiKey = process.env.STITCH_API_KEY
  if (!apiKey) {
    throw new Error('STITCH_API_KEY manquante dans les variables d\'environnement')
  }

  console.log(`[Stitch] 🎨 Génération pour : ${prospect.name} (${prospect.city || '?'})`)

  // 1. Créer le projet Stitch
  const projectTitle = `WebConceptor — ${prospect.name} ${prospect.city || ''} ${new Date().getFullYear()}`
  const project = await stitch.createProject(projectTitle)
  console.log(`[Stitch] ✅ Projet créé : ${project.id}`)

  // 2. Générer la page avec le prompt luxury
  const prompt = buildLuxuryPrompt(prospect)
  const screen = await project.generate(prompt, 'DESKTOP')
  console.log(`[Stitch] ✅ Écran généré : ${screen.id}`)

  // 3. Récupérer l'URL de téléchargement du HTML
  const htmlUrl = await screen.getHtml()
  console.log(`[Stitch] ✅ URL HTML obtenue`)

  // 4. Télécharger le HTML
  const htmlResponse = await fetch(htmlUrl)
  if (!htmlResponse.ok) {
    throw new Error(`Téléchargement HTML échoué : ${htmlResponse.status}`)
  }
  const rawHtml = await htmlResponse.text()
  console.log(`[Stitch] ✅ HTML téléchargé : ${rawHtml.length} chars`)

  // 5. Injecter le branding WebConceptor
  const finalHtml = injectWebConceptorBranding(rawHtml, prospect)
  console.log(`[Stitch] ✅ Branding injecté — HTML final : ${finalHtml.length} chars`)

  return {
    html: finalHtml,
    projectId: project.id,
    screenId: screen.id,
  }
}
