import os
import gradio as gr
from app.main import app as fastapi_app

# Create a lightweight Gradio interface to satisfy the Gradio SDK
with gr.Blocks(title="Gita Guide RAG API") as demo:
    gr.Markdown("# 🕉️ Gita Guide RAG Backend API")
    gr.Markdown(
        "This Hugging Face Space hosts the FastAPI + ChromaDB + SentenceTransformers backend for Gita Guide.\n\n"
        "**API Status**: Active & Running\n\n"
        "- Frontend UI: `https://gita.tanishsheth.com`\n"
        "- Health Check: `/health`\n"
        "- OpenAPI Docs: `/docs`\n"
    )

# gr.mount_gradio_app mounts Gradio onto the existing FastAPI application.
# All your FastAPI routes (/, /chat, /auth, /verses, /health) remain available at the root!
app = gr.mount_gradio_app(fastapi_app, demo, path="/gradio")

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
