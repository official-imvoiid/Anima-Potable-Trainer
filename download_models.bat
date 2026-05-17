@echo off
setlocal

echo =========================================
echo Anima Trainer - Model Downloader
echo =========================================

if not exist "models" (
    mkdir "models"
    echo Created "models" directory.
)

set /p HF_TOKEN="Enter your Hugging Face Token (press Enter to download directly without token): "

set "AUTH_HEADER="
if not "%HF_TOKEN%"=="" (
    set AUTH_HEADER=-H "Authorization: Bearer %HF_TOKEN%"
)

echo.
echo ==========================================================
echo IMPORTANT: If the downloads fail with a "404 Not Found",
echo you must right-click this download_models.bat file, 
echo click "Edit", and replace the YOUR_USERNAME/YOUR_REPO 
echo placeholders with the actual HuggingFace repository IDs!
echo ==========================================================
echo.

REM --- EDIT THESE REPOSITORY IDs IF NEEDED ---
set REPO_ANIMA=YOUR_USERNAME/YOUR_REPO
set REPO_QWEN=YOUR_USERNAME/YOUR_REPO
set REPO_VAE=YOUR_USERNAME/YOUR_REPO
REM -------------------------------------------

echo Downloading anima_baseV10.safetensors...
curl -# -L %AUTH_HEADER% -o "models\anima_baseV10.safetensors" "https://huggingface.co/%REPO_ANIMA%/resolve/main/anima_baseV10.safetensors"

echo Downloading qwen_3_06b_base.safetensors...
curl -# -L %AUTH_HEADER% -o "models\qwen_3_06b_base.safetensors" "https://huggingface.co/%REPO_QWEN%/resolve/main/qwen_3_06b_base.safetensors"

echo Downloading qwen_image_vae.safetensors...
curl -# -L %AUTH_HEADER% -o "models\qwen_image_vae.safetensors" "https://huggingface.co/%REPO_VAE%/resolve/main/qwen_image_vae.safetensors"

echo.
echo All downloads finished! Please verify the files in the "models" folder.
pause
