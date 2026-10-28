#!/bin/bash
# Descarga, con versión fijada, solo los SKILL.md (instrucciones) de cada skill asignada a un planeta.
# No descarga scripts, evaluaciones ni integraciones. Para actualizar: cambiar el commit y revisar el diff.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/skills"
MK="coreyhaines31/marketingskills@0cd9b3a0ef4c411a1d690419ce843f2a1da32cce"   # MIT
SP="obra/superpowers@2ce8aa15d05bd57213e6f746f953aafb7ded7a8b"                # MIT
AN="anthropics/skills@ca45fc496a3436251f191354091d557da31c15b5"               # Apache-2.0
CL="alirezarezvani/claude-skills@5434623a788ec3105d238328cfe554e1e2242ff7"   # MIT · nivel C (CEO)
SF="shawnpang/startup-founder-skills@4ad31b43eef3ae3755cc57ec7e435dab4699ab44" # MIT · fundadores

# planeta | repo@commit | skill | ruta (opcional; por defecto skills/<skill>/SKILL.md)
MAP="
kratos|$CL|ceo-advisor|c-level-advisor/skills/ceo-advisor/SKILL.md
kratos|$CL|chief-of-staff|c-level-advisor/skills/chief-of-staff/SKILL.md
kratos|$CL|cmo-advisor|c-level-advisor/skills/cmo-advisor/SKILL.md
kratos|$CL|strategic-alignment|c-level-advisor/skills/strategic-alignment/SKILL.md
kratos|$CL|decision-logger|c-level-advisor/skills/decision-logger/SKILL.md
kratos|$CL|founder-coach|c-level-advisor/skills/founder-coach/SKILL.md
kratos|$CL|scenario-war-room|c-level-advisor/skills/scenario-war-room/SKILL.md
kratos|$CL|company-os|c-level-advisor/skills/company-os/SKILL.md
kratos|$CL|postmortem|c-level-advisor/executive-mentor/skills/postmortem/SKILL.md
kratos|$SF|startup-context
sol|$SF|roadmap-planning
luna|$SF|user-research-synthesis
luna|$SF|daily-product-digest
mercurio|$CL|competitive-intel|c-level-advisor/skills/competitive-intel/SKILL.md
mercurio|$SF|review-mining
mercurio|$SF|competitor-monitoring
mercurio|$SF|market-research
venus|$SF|landing-page
venus|$SF|social-content
marte|$SF|launch-strategy
marte|$SF|partnership-outreach
marte|$SF|sourcing-outreach
marte|$SF|cold-outreach
venus|$SF|community-discovery
venus|$SF|earned-media-outreach
saturno|$SF|churn-analysis
sol|$MK|product-marketing
sol|$MK|marketing-plan
sol|$MK|offers
sol|$MK|pricing
luna|$MK|onboarding
luna|$MK|churn-prevention
luna|$MK|emails
mercurio|$MK|copywriting
mercurio|$MK|copy-editing
mercurio|$MK|competitors
mercurio|$MK|competitor-profiling
mercurio|$MK|customer-research
mercurio|$MK|content-strategy
mercurio|$MK|cold-email
mercurio|$MK|public-relations
venus|$MK|ad-creative
venus|$MK|image
venus|$MK|video
venus|$MK|social
venus|$MK|influencer-marketing
venus|$MK|co-marketing
venus|$MK|community-marketing
venus|$AN|frontend-design
marte|$MK|launch
marte|$MK|ads
marte|$MK|prospecting
marte|$MK|sales-enablement
marte|$MK|directory-submissions
marte|$SP|writing-plans
marte|$SP|executing-plans
jupiter|$MK|marketing-ideas
jupiter|$MK|marketing-loops
jupiter|$MK|referrals
jupiter|$MK|aso
jupiter|$MK|seo-audit
jupiter|$MK|ai-seo
jupiter|$MK|programmatic-seo
jupiter|$MK|lead-magnets
jupiter|$MK|free-tools
saturno|$MK|analytics
saturno|$MK|ab-testing
saturno|$MK|attribution
saturno|$MK|cro
saturno|$MK|conversion-tracking
saturno|$MK|revops
saturno|$SP|verification-before-completion
"
mkdir -p "$DEST"
{
  echo "# Skills de los especialistas de KRATOS"
  echo
  echo "Solo instrucciones (SKILL.md), sin scripts. Versión fijada por commit. Generado por scripts/descargar-skills.sh."
  echo
  echo "| Planeta | Skill | Origen | Licencia |"
  echo "|---|---|---|---|"
} > "$DEST/MANIFEST.md"
echo "$MAP" | while IFS='|' read -r planet src skill sub; do
  [ -z "$planet" ] && continue
  repo="${src%@*}"; sha="${src#*@}"
  out="$DEST/$planet/$skill"; mkdir -p "$out"
  curl -fsSL "https://raw.githubusercontent.com/$repo/$sha/${sub:-skills/$skill/SKILL.md}" -o "$out/SKILL.md"
  lic=$([ "$repo" = "anthropics/skills" ] && echo "Apache-2.0" || echo "MIT")
  echo "| $planet | $skill | [$repo@${sha:0:10}](https://github.com/$repo/blob/$sha/${sub:-skills/$skill/SKILL.md}) | $lic |" >> "$DEST/MANIFEST.md"
  echo "✓ $planet / $skill"
done
