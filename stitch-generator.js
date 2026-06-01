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
  const { slug } = prospect
  const isLuxury = Boolean(prospect.is_luxury)
  const price = isLuxury ? '860&nbsp;€' : '320&nbsp;€'

  const orderBar = `
<!-- STITCH_GENERATED -->
<style>
.wc-order-bar{position:fixed;top:0;left:0;right:0;z-index:99999;height:44px;background:#0a0a0a;display:flex;align-items:center;justify-content:space-between;padding:0 20px;gap:10px;font-family:-apple-system,sans-serif}
.wc-order-bar-left{display:flex;align-items:center;gap:16px;flex:1}
.wc-order-bar-label{color:rgba(255,255,255,0.75);font-size:11px;font-weight:500;white-space:nowrap}
.wc-trust{display:flex;align-items:center;gap:10px}
.wc-trust-item{color:rgba(255,255,255,0.45);font-size:10px;white-space:nowrap}
.wc-trust-sep{color:rgba(255,255,255,0.15);font-size:10px}
.wc-order-btn{padding:7px 22px;background:#fff;color:#0a0a0a;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;border-radius:100px;cursor:pointer;border:none;white-space:nowrap;flex-shrink:0}
.wc-order-btn:hover{background:#f0c040;transform:scale(1.03)}
@media(max-width:640px){.wc-trust{display:none}.wc-order-bar-label{font-size:10px}}
</style>
<div class="wc-order-bar">
  <div class="wc-order-bar-left">
    <span class="wc-order-bar-label">Votre site web professionnel</span>
    <div class="wc-trust">
      <span class="wc-trust-item">✓ Livraison rapide et suivie</span>
      <span class="wc-trust-sep">·</span>
      <span class="wc-trust-item">Satisfait ou remboursé 14j</span>
      <span class="wc-trust-sep">·</span>
      <span class="wc-trust-item">Paiement sécurisé</span>
    </div>
  </div>
  <button class="wc-order-btn" onclick="pmOpen()">Je commande ce site → ${price}</button>
</div>
<div style="height:44px"></div>`

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
// Prompt standard — pour tous les prospects non-luxury
function buildStandardPrompt(p) {
  const city = p.city || 'France'
  const bt = p.business_type || 'business'
  const rating = p.google_rating ? `${p.google_rating}/5 (${p.google_reviews_count || 0} avis Google)` : ''
  const about = p.about_scraped ? `\n\nDescription réelle : "${String(p.about_scraped).slice(0, 300)}"` : ''
  const items = (p.menu_items || []).slice(0, 6).map(m => `• ${m.name}${m.price ? ` — ${m.price}` : ''}`).join('\n')
  const review = (p.reviews || []).find(r => r.rating >= 4 && r.text?.length > 30)

  return [
    `Design a beautiful, professional website for "${p.name}", a ${bt} in ${city}, France.`,
    `Style: modern, clean, warm, professional. Mobile-first responsive.`,
    rating ? `Google rating: ${rating}` : '',
    about,
    '',
    '1. HERO — Full-width with business name in large WHITE bold font, dark overlay on background image.',
    `   Title: "${p.name}" — Subtitle: "Votre expert ${bt} à ${city}"`,
    '   CTA button: "Nous contacter" or "Prendre rendez-vous"',
    '',
    '2. ABOUT — Short story, real content, warm tone.',
    '',
    items ? `3. SERVICES — Real offerings as cards:\n${items}` : '3. SERVICES — Key services in a clean card grid.',
    '',
    review ? `4. TESTIMONIALS — Real review: "${review.text.slice(0, 150)}" — ${review.author} ★${review.rating}` : '4. SOCIAL PROOF — Star rating and customer satisfaction.',
    '',
    `5. CONTACT — Phone: ${p.phone || ''}, Address: ${p.address || city}`,
    '',
    'REQUIREMENTS:',
    '- Hero title MUST be white and fully readable (dark overlay on image)',
    '- Sticky navigation bar',
    '- All text in French',
    '- No generic feel — make it feel personal and local',
  ].filter(Boolean).join('\n')
}

export async function generateMockup(prospect) {
  return generateLuxuryMockup(prospect) // wrapper générique
}

export async function generateLuxuryMockup(prospect) {
  const apiKey = process.env.STITCH_API_KEY
  if (!apiKey) {
    throw new Error('STITCH_API_KEY manquante dans les variables d\'environnement')
  }

  console.log(`[Stitch] 🎨 Génération pour : ${prospect.name} (${prospect.city || '?'})`)

  // 1. Projet unique fixe — UN seul projet pour tous les prospects
  // Évite la création de dizaines de projets en cas de retry
  const FIXED_PROJECT_ID = process.env.STITCH_PROJECT_ID
  let project
  if (FIXED_PROJECT_ID) {
    project = stitch.project(FIXED_PROJECT_ID)
    console.log(`[Stitch] ♻️ Projet fixe réutilisé : ${FIXED_PROJECT_ID}`)
  } else {
    // Premier run : crée le projet et affiche l'ID à mettre en variable
    project = await stitch.createProject('WebConceptor')
    console.log(`[Stitch] ✅ Projet créé : ${project.id} → Ajoute STITCH_PROJECT_ID=${project.id} dans Railway`)
  }

  // 2. Générer la page — prompt luxury ou standard selon is_luxury
  // IMPORTANT : ne pas passer deviceType → sinon htmlCode absent de la réponse
  const prompt = prospect.is_luxury ? buildLuxuryPrompt(prospect) : buildStandardPrompt(prospect)
  const screen = await project.generate(prompt)
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
