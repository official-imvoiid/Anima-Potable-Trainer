# AI Model Training Parameters

> **Resources**
> - ☁️ **Cloud GPU:** [RunPod](https://runpod.io/?ref=od0l9p8p)
> - 🗣️ **Natural Language / Paragraph Prompting:** [JoyCaption](https://github.com/official-imvoiid/Joycaption)

---

## 📦 Training LoRA

### Dataset Recommendations

- Minimum **300 images**, or **100 images × 3 repeats**
- Use a **proper trigger word** followed by a descriptive sentence prompt

**Example prompt:**
```
Kurusaki, A girl with red and yellow heterochromia eyes, black uneven twintails, She is ...
```

---

### ⚙️ Hyperparameters

| Parameter | Value |
|---|---|
| Learning Rate | `0.0001` |
| Text Encoder LR | `0.00005` |
| Optimizer | `AdamW8bit` |
| LR Scheduler | `Cosine` |
| LR Warmup Steps | `0` |
| Weight Decay | `0.01` |
| Seed | `42` |
| Mixed Precision | `BFloat16` |
| Save Precision | `BFloat16` |
| DataLoader Workers | `4` |

---

### 🧠 Training Settings

| Parameter | Value |
|---|---|
| Gradient Checkpointing | `True` |
| Activation Offload | `None` |
| Blocks to Swap | `0` |
| Timestep Method | `Logit Normal` |
| Flow Shift | `3` |
| Cache Latents to Disk | `True` |
| Cache Text Encoder Output to Disk | `True` |

---

### 🖼️ Resolution & Batching

| Parameter | Value |
|---|---|
| Resolution | `1536` |
| Batch Size | `1` |
| Gradient Accumulation | `1` |
| Caption Extension | `.txt` |
| Alpha Loss | `False` |

---

### 🪣 Aspect Ratio Bucketing

| Parameter | Value |
|---|---|
| Enable Aspect Ratio Bucketing | `True` |
| Do Not Upscale | `True` |
| Min Bucket Resolution | `512` |
| Max Bucket Resolution | `1536` |
| Bucket Steps | `64` |

---

### 🔗 Network Settings

| Parameter | Value |
|---|---|
| Network Dim (Rank) | `32` |
| Network Alpha | `32` |
| Train DiT Only (Freeze Text Encoder) | `True` |
| Network Dropout | `0` |
| Auto-resume from Last Saved State | `True` |

---

### 💾 Low VRAM / RAM Mode *(optional)*

| Parameter | Value |
|---|---|
| Low RAM Mode | `True` |
| Flash Attention | `True` |

---
---

## 🔥 Finetuning a Model

### Dataset Recommendations

- Use **as many images as possible** — typically **10K+ image datasets**
- Train via **RunPod**
- **No trigger word** — use sentence prompts only for all images

---

### ⚙️ Hyperparameters

| Parameter | Value |
|---|---|
| Learning Rate | `0.00001` or `0.000001` |
| Text Encoder LR | `0` |
| Optimizer | `PagedAdamW8bit` |
| LR Scheduler | `Cosine` |
| LR Warmup Steps | `0` |
| Weight Decay | `0.01` |
| Seed | `42` |
| Mixed Precision | `BFloat16` |
| Save Precision | `BFloat16` |
| DataLoader Workers | `4` |

---

### 🧠 Training Settings

| Parameter | Value |
|---|---|
| Gradient Checkpointing | `True` |
| Blocks to Swap | `0` |
| Activation Offload | `None` |
| Timestep Method | `Logit Normal` |
| Flow Shift | `3` |
| Freeze LLM Adapter | `True` |
| Auto-resume from Last Saved State | `True` |

---

### 🖼️ Resolution & Batching

| Parameter | Value |
|---|---|
| Resolution | `1536` *(max resolution for bucketing)* |
| Batch Size | `1` |
| Gradient Accumulation | `1` |
| Caption Extension | `.txt` |
| Alpha Loss | `False` |

---

### 🪣 Aspect Ratio Bucketing

| Parameter | Value |
|---|---|
| Min Bucket Resolution | `512` |
| Max Bucket Resolution | `1536` |
| Bucket Steps | `64` |

---

### 💾 Low VRAM / RAM Mode *(optional)*

| Parameter | Value |
|---|---|
| Low RAM Mode | `True` |
| Flash Attention | `True` |
