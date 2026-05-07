export const GENERATE_IMAGE_TOOL_NAME = 'GenerateImage'

export const DESCRIPTION = `Generate an image using a local ComfyUI backend.

Backend resolution order:
1. http://127.0.0.1:8000 (localhost default)
2. backendUrl in .localclawd/image-pipeline/config.json (set via /image-pipeline config <url>)

Workflow selection:
- Omit workflow to use the default (set via /image-pipeline workflow <name>, or built-in txt2img)
- Pass workflow name (without .json) to use a specific workflow from .localclawd/image-pipeline/workflows/
- Workflows support {{positive_prompt}} / {{negative_prompt}} templates or raw ComfyUI API exports

Output directory:
- All generated images are saved to: <project-root>/.localclawd/image-pipeline/generated/
- The full absolute path is returned in the tool result (path field).
- After inspecting the image, you can move it anywhere using Bash (mv) or PowerShell (Move-Item).
  Example: move to project root → mv "<path>" "./my-image.png"
  Example: move to desktop     → mv "<path>" "$HOME/Desktop/my-image.png"
  If the user specifies a destination, move it there immediately after approving the result.

If ComfyUI is not reachable, ask the user to run /image-pipeline config <url> with their ComfyUI address.
To list available workflows, call /image-pipeline list.

After generating, the image is returned visually in the tool result so you can review it.

REVIEW AND REPROMPT PROTOCOL:
1. After calling GenerateImage, examine the returned image carefully for quality AND artifacts.
2. If the image has edge/corner artifacts, blurring, or wrong content — fix parameters and retry (do not keep a bad image).
3. Refine: add missing details, fix style keywords, adjust composition. Do not repeat the same prompt.
4. You may iterate up to 3 times total. Stop as soon as a result is satisfactory.
5. After final approval: move the image to the user's desired location if specified, then report the saved path.

FIXING ARTIFACTS:
- Corner / edge artifacts → cfg is wrong. Flow models (z_image_turbo, AuraFlow, Lumina2)
  have cfg=1 built into the workflow — do NOT pass cfg when using these. If you did, retry
  without cfg. For the built-in txt2img (SD 1.5) workflow, cfg=7 is correct.
- Ring or halo artefacts  → steps too high. Try steps=4 for turbo workflows.
- Blurry result           → steps too low or wrong sampler. Increase steps by +4.
- Washed-out / grey       → VAE mismatch. Try a different workflow.
- Size-related artefacts  → dimensions must be multiples of 64. Flow models need 1024×1024.

IMPORTANT: For named workflows (anything except the built-in fallback), cfg is NOT
adjustable — the workflow controls it. Only pass width, height, steps, model overrides.
Never pass cfg for z_image_turbo, AuraFlow, or Lumina2 workflows.

Use this tool when the user asks you to generate, create, or render an image.`
