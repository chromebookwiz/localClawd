export const GENERATE_IMAGE_TOOL_NAME = 'GenerateImage'

export const DESCRIPTION = `Generate an image using a local ComfyUI backend and save it to ~/generatedimages/.

Auto-detects ComfyUI at http://127.0.0.1:8188. Falls back to the backendUrl set in the project's .localclawd/image-pipeline/config.json when present.

Returns the path of the saved image file and the ComfyUI prompt ID.
Use this tool when the user asks you to generate, create, or render an image.`
