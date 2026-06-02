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
// La barre de vente (CTA + modal Stripe) est injectée côté Next.js
// par sales-ui-snippet.ts au moment du rendu, pas ici.
// On injecte uniquement le pixel de tracking.
function injectWebConceptorBranding(html, prospect) {
  const { slug } = prospect

  const trackingPixel = `<img src="${BASE_URL}/api/prospect/track-view" data-slug="${slug}" style="display:none" width="1" height="1" aria-hidden="true">`

  if (html.includes('</body>')) {
    return html.replace('</body>', `${trackingPixel}\n</body>`)
  }
  return html + trackingPixel
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

async function getHtmlWithRetry(screen, maxAttempts = 6, delayMs = 4000) {
  for (let i = 1; i <= maxAttempts; i++) {
    const url = await screen.getHtml()
    if (url) return url
    if (i < maxAttempts) {
      console.log(`[Stitch] ⏳ htmlCode pas encore prêt, tentative ${i}/${maxAttempts} dans ${delayMs/1000}s…`)
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
  throw new Error('htmlCode.downloadUrl toujours vide après toutes les tentatives — crédits épuisés ou erreur API')
}

export async function generateLuxuryMockup(prospect) {
  const apiKey = process.env.STITCH_API_KEY
  if (!apiKey) {
    throw new Error('STITCH_API_KEY manquante dans les variables d\'environnement')
  }

  console.log(`[Stitch] 🎨 Génération pour : ${prospect.name} (${prospect.city || '?'})`)

  // 1. Nouveau projet à chaque génération — évite les états corrompus sur projet réutilisé
  const project = await stitch.createProject(`WebConceptor-${Date.now()}`)
  console.log(`[Stitch] ✅ Projet créé : ${project.id}`)

  // 2. Générer la page — pas de deviceType → htmlCode présent dans la réponse
  const prompt = prospect.is_luxury ? buildLuxuryPrompt(prospect) : buildStandardPrompt(prospect)
  const screen = await project.generate(prompt)
  console.log(`[Stitch] ✅ Écran généré : ${screen.id}`)

  // 3. Récupérer l'URL HTML avec retry (htmlCode peut mettre quelques secondes à être disponible)
  const htmlUrl = await getHtmlWithRetry(screen)
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
