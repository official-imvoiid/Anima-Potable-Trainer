<div align="center">

# Anima Portable Standalone Trainer

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Python](https://img.shields.io/badge/python-3.13-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Platform](https://img.shields.io/badge/platform-Windows-lightgray.svg)

A complete, self-contained, browser-based Windows LoRA trainer for the **Anima** diffusion architecture.
</div>

---

## 📖 Origin & What Is This?

This project was built by taking the excellent core training scripts from [Kohya-ss](https://github.com/kohya-ss/sd-scripts) and heavily modifying them to support the bleeding-edge **Anima** architecture (Qwen3 Text Encoder + DiT + Custom VAE). 

Instead of dealing with complex command lines, missing dependencies, and confusing python environments, this project packages everything into a **standalone, portable bundle**. You run the installer once, and it automatically sets up an isolated environment with its own Python and dependencies. Then, you manage all your training via a sleek, interactive Web UI right in your browser.

---

## ⚡ Features

- **Standalone Portability**: Installs its own Miniconda and Python 3.13. Doesn't mess with your system's global Python.
- **Web-based UI**: Manage training jobs, configure datasets, edit TOML files, and tweak hyper-parameters without touching a single line of code.
- **Live Image Generation & Sampling**:
  - Sample images are automatically generated during training at your specified intervals (e.g. every N epochs or steps).
  - The UI has a dedicated **Samples Gallery** where you can view your generated outputs live as the model trains!
- **Integrated TensorBoard**: One-click TensorBoard launch to monitor your loss graphs directly in the browser. It automatically finds free ports and connects.
- **Multi-GPU & Optimization**: Supports DeepSpeed, Fully Sharded Data Parallel (FSDP), Tensor Parallelism, Flash Attention, and multiple optimizers including 8-bit AdamW and Prodigy.
- **Hardware Monitoring**: Live GPU VRAM, utilization metrics, and CPU usage are displayed directly in the header of the Web UI.

---

## 🖥️ Hardware Requirements

To train an Anima LoRA successfully, you will need:

| Requirement | Specification |
|---|---|
| **OS** | Windows 10 / 11 (64-bit) |
| **GPU** | NVIDIA GPU with CUDA 12.8 support |
| **VRAM** | **8 GB minimum** (12 GB or more highly recommended for higher batch sizes or higher ranks) |
| **RAM** | 16 GB system RAM minimum |
| **Disk Space** | ~15 GB free for the isolated Python environment, PyTorch, and model weights |
| **Node.js** | v18 or later to run the Web UI |

---

## ⚖️ Licensing & Commercial Use Restriction

**🚨 IMPORTANT NOTICES 🚨**

1. **The Anima Base Model**: The Anima base model weights (DiT, Qwen3, VAE) are subject to strict licensing. **They are for NON-COMMERCIAL USE ONLY.** You may use them for personal projects, research, and non-commercial creative work. You must follow their official licensing. Do not use the base model or any LoRAs trained on it for commercial products, paid services, or profit without explicit permission from the original creators.
2. **This Software**: This trainer UI, batch scripts, and wrappers are released under the MIT License. The underlying modified Kohya-ss scripts remain under the Apache 2.0 License.

---

## 🚀 Installation & Usage

1. Download and extract this repository to a folder (e.g. `C:\AnimaTrainer`).
2. Place your Anima model files somewhere on disk:
   - DiT weights (`anima-base-v1.0.safetensors`)
   - Qwen3 text encoder (`qwen_3_06b_base.safetensors`)
   - VAE (`qwen_image_vae.safetensors`)
3. Double-click **`setup.bat`** to install the isolated Python environment.
4. Double-click **`training-ui\start_windows.bat`** to launch the Web UI.
5. Open your browser to **http://localhost:3000**.

---

## 🏗️ Model Architecture
Anima uses a **Diffusion Transformer (DiT)** backbone with **Qwen3-0.6B** as the text encoder and a custom image **VAE**. It utilizes a flow-matching training objective with logit-normal timestep sampling.

## 🤝 Credits
- **Kohya-ss** — Core training library and LoRA infrastructure: https://github.com/kohya-ss/sd-scripts
- **Anima** — The diffusion model architecture.
- **Qwen3** — Text encoder by Alibaba Cloud: https://huggingface.co/Qwen
- **Hugging Face** — Diffusers and Transformers libraries.
