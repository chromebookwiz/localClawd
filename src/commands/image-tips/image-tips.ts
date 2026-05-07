import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async (_args, _context) => {
  const text = `\
◆ Image Tips — Fixing Artifacts & Improving ComfyUI Output

━━━ CORNER / EDGE ARTIFACTS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Most common causes (check in order):

1. WRONG CFG SCALE FOR MODEL TYPE  ← most common cause of corner artifacts
   · Flow models (AuraFlow, Lumina2, SD3, z_image_turbo): cfg MUST be ≤ 1.0
     Values above 1 cause severe edge/corner corruption and colour banding
   · SD1.5 / SDXL: cfg 6–8 is correct; < 4 causes blur, > 12 causes artifacts

2. STEPS TOO HIGH FOR SAMPLER
   · res_multistep with steps > 12 produces ring/halo artifacts
   · For turbo models: try steps=4 first, then 6 or 8
   · For SD1.5 euler: 20–30 steps is the sweet spot

3. SIZE NOT DIVISIBLE BY 64
   · Width AND height must both be multiples of 64
   · AuraFlow/Lumina2: use exactly 1024×1024 — smaller sizes cause edge artefacts
   · SD1.5: use 512×512 or 768×512 etc.

4. VAE MISMATCH
   · Flow models need their own VAE; SD1.5's vae-ft-mse will corrupt them
   · Symptoms: washed-out colours, edge fringe, grey corners

5. WRONG SAMPLER FOR MODEL
   · AuraFlow / Lumina2: res_multistep, euler, dpm_pp_2m  scheduler=simple
   · SD1.5: euler, dpm_pp_2m_karras  scheduler=karras or normal

━━━ PARAMETERS BY MODEL TYPE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  z_image_turbo / AuraFlow / Lumina2:
    steps=8   cfg=1   sampler=res_multistep   scheduler=simple
    size=1024×1024  (required — smaller causes artefacts with these models)
    negative prompt: leave empty (workflow uses ConditioningZeroOut)
    Override: /image --steps 4 --cfg 1 <prompt>

  SD1.5 (v1-5-pruned, DreamShaper, RealisticVision, etc.):
    steps=20  cfg=7   sampler=euler            scheduler=normal
    size=512×512 or 768×512
    Override: /image-pipeline defaults --steps 20 --cfg 7 --width 512 --height 512

  SDXL (sdxl_base, juggernaut-xl, etc.):
    steps=25  cfg=7   sampler=dpm_pp_2m        scheduler=karras
    size=1024×1024

━━━ QUICK FIXES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Fuzzy or dark corners     → increase size to 1024×1024 (flow models need it)
  Weird colour patterns     → lower cfg (cfg=1 for flow, cfg=7 for SD1.5)
  Ring or halo artefacts    → reduce steps (try steps=4)
  Image is too blurry       → increase steps, or switch sampler to dpm_pp_2m
  Washed-out / grey         → wrong VAE precision; load fp32 VAE explicitly
  Black bars / tiling seams → disable tiled VAE decode if enabled in workflow

━━━ PROMPT TIPS FOR QUALITY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Quality boosters (add at start of positive prompt):
    "masterpiece, best quality, highly detailed, sharp focus, 4k"

  For portraits:
    "close-up portrait, facing camera, professional lighting, cinematic"
    Negative: "blurry, bad anatomy, extra limbs, deformed, watermark"

  For landscapes / scenes:
    "cinematic lighting, golden hour, volumetric fog, highly detailed"

  For art styles:
    "oil painting in the style of [artist], detailed brushwork, rich colours"

━━━ ITERATING WITH THE GenerateImage TOOL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  The tool returns the image inline for review. If quality is poor:
  1. Try adjusting cfg first — this is the most common fix
  2. Then adjust steps (±4 from current)
  3. Then try a different sampler
  4. Up to 3 iterations are recommended before changing workflow

  Example fix sequence:
    /image --cfg 1 --steps 4 <same prompt>        ← try lower settings first
    /image --cfg 1 --steps 8 <same prompt>        ← step up if too blurry
    /image --width 1024 --height 1024 <prompt>    ← fix size if edge artifacts persist
`

  return { type: 'text' as const, text }
}
