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
- .localclawd/image-pipeline/generated/ when the pipeline is scaffolded (run /image-pipeline setup)
- ~/generatedimages/ otherwise

If ComfyUI is not reachable, ask the user to run /image-pipeline config <url> with their ComfyUI address.
To list available workflows, call /image-pipeline list.

After generating, the image is returned visually in the tool result so you can review it.

REVIEW AND REPROMPT PROTOCOL:
1. After calling GenerateImage, examine the returned image carefully.
2. If the image does not match the description, has quality issues (artifacts, wrong style, wrong subject, blurry), or clearly fails — call GenerateImage again.
3. Refine: add missing details, fix style keywords, adjust composition language. Do not simply repeat the same prompt.
4. You may iterate up to 3 times total. Stop as soon as a result is satisfactory.
5. Show the user the final saved path and a brief assessment of what changed.

FIXING ARTIFACTS (see /image-tips for full guide):
- Corner / edge artifacts → wrong cfg for model type. Flow models (z_image_turbo, AuraFlow, Lumina2): cfg MUST be 1.0. Retry with cfg=1.
- Ring or halo artefacts  → steps too high. Try steps=4 for turbo workflows.
- Blurry result           → steps too low, or wrong sampler. Increase steps by +4.
- Washed-out / grey       → VAE mismatch. Try a different workflow.
- Size-related artefacts  → use multiples of 64. Flow models need 1024×1024.
Pass overrides via the tool parameters: steps, cfg, width, height, model.

Use this tool when the user asks you to generate, create, or render an image.`
