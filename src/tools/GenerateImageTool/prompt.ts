export const GENERATE_IMAGE_TOOL_NAME = 'GenerateImage'

export const DESCRIPTION = `Generate an image using a local ComfyUI backend.

Backend resolution order:
1. http://127.0.0.1:8188 (localhost default)
2. backendUrl in .localclawd/image-pipeline/config.json (set via /image-pipeline config <url>)

Output directory:
- .localclawd/image-pipeline/generated/ when the pipeline is scaffolded (run /image-pipeline setup)
- ~/generatedimages/ otherwise

If ComfyUI is not reachable, ask the user to run /image-pipeline config <url> with their ComfyUI address.

After generating, the image is returned visually in the tool result so you can review it.

REVIEW AND REPROMPT PROTOCOL:
1. After calling GenerateImage, examine the returned image carefully.
2. If the image does not match the description, has quality issues (artifacts, wrong style, wrong subject, blurry), or clearly fails the user's intent — call GenerateImage again with an improved prompt.
3. Refine: add missing details, fix style keywords, adjust composition language. Do not simply repeat the same prompt.
4. You may iterate up to 3 times total. Stop as soon as a result is satisfactory.
5. Show the user the final saved path and a brief assessment of what changed between iterations.

Use this tool when the user asks you to generate, create, or render an image.`
