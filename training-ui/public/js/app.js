const $ = id => document.getElementById(id);
let currentJob = null;
let ws = null;
let isDirty = false;
let currentSubsets = [];

// === Console Renderer ===
// Handles \r (tqdm/rich progress bars) and ANSI color codes properly

let _consoleLines = [''];   // array of raw strings per line
const MAX_CONSOLE_LINES = 800;

const ANSI_COLORS = {
    '0': null,  // reset — handled specially
    '1': 'font-weight:bold',
    '2': 'opacity:0.6',
    '3': 'font-style:italic',
    '31': 'color:#ff6b6b',   '91': 'color:#ff8787',
    '32': 'color:#69db7c',   '92': 'color:#8ce99a',
    '33': 'color:#ffd43b',   '93': 'color:#ffe066',
    '34': 'color:#74c0fc',   '94': 'color:#a5d8ff',
    '35': 'color:#cc5de8',   '95': 'color:#e599f7',
    '36': 'color:#22b8cf',   '96': 'color:#66d9e8',
    '37': 'color:#dee2e6',   '97': 'color:#f8f9fa',
    '90': 'color:#868e96',
};

function ansiToHtml(raw) {
    // Escape HTML entities first
    let s = raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    let depth = 0;
    // Replace ANSI SGR sequences \x1b[...m
    s = s.replace(/\x1b\[([0-9;]*)m/g, (_match, codes) => {
        if (!codes || codes === '0') {
            const close = '</span>'.repeat(depth);
            depth = 0;
            return close;
        }
        let out = '';
        for (const code of codes.split(';')) {
            const style = ANSI_COLORS[code];
            if (style) { out += `<span style="${style}">`; depth++; }
        }
        return out;
    });
    // Strip any remaining unsupported escape sequences
    s = s.replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, '');
    s = s.replace(/\x1b[^[]/g, '');
    // Close any unclosed spans
    if (depth > 0) s += '</span>'.repeat(depth);
    return s;
}

function _renderConsole() {
    const out = $('console-output');
    if (!out) return;
    const atBottom = out.scrollHeight - out.clientHeight <= out.scrollTop + 30;
    out.innerHTML = _consoleLines.map(line =>
        `<div class="c-line">${ansiToHtml(line) || '\u200b'}</div>`
    ).join('');
    if (atBottom) out.scrollTop = out.scrollHeight;
}

function appendConsole(text) {
    // Process character by character to handle \r and \n
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === '\r' && text[i + 1] === '\n') {
            // Windows CRLF → new line
            _consoleLines.push('');
            i += 2;
        } else if (ch === '\n') {
            _consoleLines.push('');
            i++;
        } else if (ch === '\r') {
            // Bare CR → overwrite current line (tqdm/rich progress bar)
            _consoleLines[_consoleLines.length - 1] = '';
            i++;
        } else {
            _consoleLines[_consoleLines.length - 1] += ch;
            i++;
        }
    }
    // Trim history
    if (_consoleLines.length > MAX_CONSOLE_LINES) {
        _consoleLines = _consoleLines.slice(-MAX_CONSOLE_LINES);
    }
    _renderConsole();
}

function resetConsole(msg) {
    _consoleLines = [msg || ''];
    _renderConsole();
}

// === API Helpers ===
async function api(url, opts = {}) {
    const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...opts,
        body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return res.json();
}

function showToast(msg, type = "success") {
    const container = $("toast-container");
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.prepend(el);
    setTimeout(() => el.remove(), 3000);
}

// --- Prompts Logic ---
let currentPrompts = [];

async function loadPrompts() {
    if (!currentJob) return;
    try {
        const res = await api(`/api/jobs/${currentJob}/prompts`);
        currentPrompts = res.prompts || [];
        renderPrompts();
    } catch (e) {
        console.error(e);
    }
}

function renderPrompts() {
    const list = $("prompts-list");
    list.innerHTML = "";
    if (currentPrompts.length === 0) {
        $("prompts-empty").classList.remove("hidden");
        return;
    }
    $("prompts-empty").classList.add("hidden");
    
    currentPrompts.forEach((prompt, idx) => {
        const div = document.createElement("div");
        div.className = "prompt-row";
        div.style.display = "flex";
        div.style.gap = "8px";
        div.style.marginBottom = "8px";
        
        const input = document.createElement("input");
        input.type = "text";
        input.value = prompt;
        input.style.flex = "1";
        input.addEventListener("change", (e) => {
            currentPrompts[idx] = e.target.value;
            savePrompts();
        });
        
        const btnDel = document.createElement("button");
        btnDel.className = "btn btn-danger btn-sm";
        btnDel.innerHTML = `<i data-lucide="trash-2"></i>`;
        btnDel.onclick = () => {
            currentPrompts.splice(idx, 1);
            savePrompts();
            renderPrompts();
        };
        
        div.appendChild(input);
        div.appendChild(btnDel);
        list.appendChild(div);
    });
    lucide.createIcons();
}

async function savePrompts() {
    if (!currentJob) return;

    let prependTags = "";
    if ($("cfg-auto-prepend-tags")?.checked) {
        prependTags = ($("cfg-prepend-text")?.value || "").trim();
        if (prependTags && !prependTags.endsWith(",")) prependTags += ", ";
        else if (prependTags) prependTags += " ";
    }

    const w = $("global-w")?.value || 1024;
    const h = $("global-h")?.value || 1024;
    const s = $("global-s")?.value || 30;
    const l = $("global-l")?.value || 5.0;
    const d = $("global-d")?.value || 1;
    const neg = $("global-negative-prompt")?.value.trim() || "";
    const negStr = neg ? ` --n "${neg}"` : "";

    const compiledPrompts = currentPrompts.map(p => {
        return `${prependTags}${p}${negStr} --w ${w} --h ${h} --d ${d} --s ${s} --l ${l}`;
    });

    try {
        await api(`/api/jobs/${currentJob}/prompts`, {
            method: 'PUT',
            body: { prompts: currentPrompts, compiledPrompts }
        });
    } catch (e) {
        console.error(e);
    }
}

// === Initialization ===
document.addEventListener("DOMContentLoaded", async () => {
    initTabs();
    initEventListeners();
    await loadJobs();
    connectWS();
    
    // Auto-select last job
    const lastJob = localStorage.getItem("lastJob");
    if (lastJob) {
        // Find if job exists
        const exists = Array.from($("job-list").children).some(el => el.querySelector(".job-name").textContent === lastJob);
        if (exists) selectJob(lastJob);
    }
});

function initTabs() {
    document.querySelectorAll(".tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
            tab.classList.add("active");
            $("tab-" + tab.dataset.tab).classList.add("active");
        });
    });
}

function initEventListeners() {
    $("btn-new-job").addEventListener("click", () => {
        const name = prompt("Enter new job name:");
        if (name) createJob(name);
    });
    $("btn-delete").addEventListener("click", () => {
        if (confirm(`Delete job "${currentJob}"?`)) deleteJob();
    });
    $("btn-save").addEventListener("click", saveJob);
    $("btn-run").addEventListener("click", startTraining);
    $("btn-stop").addEventListener("click", stopTraining);
    $("btn-clear-console").addEventListener("click", () => { resetConsole(); });

    $("btn-discard").addEventListener("click", () => {
        if (currentJob) {
            selectJob(currentJob);
            showToast("Discarded unsaved changes");
        }
    });

    $("btn-clone").addEventListener("click", async () => {
        if (!currentJob) return;
        try {
            const res = await api(`/api/jobs/${currentJob}/clone`, { method: 'POST', body: {} });
            await loadJobs();
            selectJob(res.name);
            showToast(`Cloned into ${res.name}`, "success");
        } catch (err) {
            showToast(err.message, "error");
        }
    });

    // TensorBoard Handlers
    $("btn-tb-launch").addEventListener("click", async () => {
        if (!currentJob) return;
        try {
            const res = await api(`/api/jobs/${currentJob}/tensorboard`, { method: 'POST' });
            showToast("TensorBoard started", "success");
            window.open(res.url, '_blank');
            $("tb-frame-container").innerHTML = `<div style="padding:16px;color:var(--text-dim);text-align:center;">
                <p>TensorBoard is running at <a href="${res.url}" target="_blank" style="color:var(--accent)">${res.url}</a></p>
                <p style="font-size:0.85em;margin-top:8px;">Click the link above if it didn't open automatically.</p>
            </div>`;
            $("btn-tb-launch").classList.add("hidden");
            $("btn-tb-stop").classList.remove("hidden");
            $("btn-tb-open").classList.remove("hidden");
            $("btn-tb-open").onclick = () => window.open(res.url, '_blank');
        } catch (e) { showToast(e.message, "error"); }
    });
    
    $("btn-tb-stop").addEventListener("click", async () => {
        if (!currentJob) return;
        try {
            await api(`/api/jobs/${currentJob}/tensorboard/stop`, { method: 'POST' });
            showToast("TensorBoard stopped", "success");
            $("tb-frame-container").innerHTML = "";
            $("btn-tb-launch").classList.remove("hidden");
            $("btn-tb-stop").classList.add("hidden");
            $("btn-tb-open").classList.add("hidden");
        } catch (e) { showToast(e.message, "error"); }
    });

    // Generate Handlers
    $("btn-generate").addEventListener("click", async () => {
        if (!currentJob) return;
        try {
            await api(`/api/jobs/${currentJob}/generate`, { method: 'POST', body: {} });
            showToast("Generation started", "success");
        } catch (e) { showToast(e.message, "error"); }
    });

    $("btn-unload").addEventListener("click", async () => {
        if (!currentJob) return;
        try {
            await api(`/api/jobs/${currentJob}/unload`, { method: 'POST' });
            showToast("Model unloaded", "success");
        } catch (e) { showToast(e.message, "error"); }
    });

    $("btn-refresh-samples").addEventListener("click", async () => {
        if (!currentJob) return;
        await loadSamples(currentJob);
    });

    $("btn-add-prompt").addEventListener("click", () => {
        if (!currentJob) return;
        currentPrompts.push(`A photo of a character`);
        savePrompts();
        renderPrompts();
    });

    $("btn-apply-global")?.addEventListener("click", () => {
        if (!currentJob) return;
        savePrompts();
        renderPrompts();
        showToast("Applied global settings to all prompts");
    });

    $("btn-random-seed")?.addEventListener("click", () => {
        if (!currentJob) return;
        $("global-d").value = Math.floor(Math.random() * 2147483647);
        savePrompts();
        renderPrompts();
    });

    // Auto-save on settings changes
    ["global-w", "global-h", "global-s", "global-l", "global-d", "global-negative-prompt", "cfg-auto-prepend-tags", "cfg-prepend-text"].forEach(id => {
        const el = $(id);
        if (el) {
            el.addEventListener("change", () => {
                if (currentJob) savePrompts();
            });
        }
    });

    // Watch for config changes
    document.querySelectorAll("#job-editor input, #job-editor select").forEach(el => {
        el.addEventListener("change", markDirty);
        el.addEventListener("input", markDirty);
    });

    // Dynamic UI toggles
    document.querySelectorAll('input[name="duration-unit"]').forEach(r => {
        r.addEventListener("change", (e) => {
            $("schedule-epochs").classList.toggle("hidden", e.target.value !== "epochs");
            $("schedule-steps").classList.toggle("hidden", e.target.value === "epochs");
            const se = $("sample-epochs-group");
            const ss = $("sample-steps-group");
            if (se) se.classList.toggle("hidden", e.target.value !== "epochs");
            if (ss) ss.classList.toggle("hidden", e.target.value === "epochs");
        });
    });

    $("cfg-enable-sampling")?.addEventListener("change", (e) => {
        const row = $("sample-interval-row");
        if (row) row.classList.toggle("hidden", !e.target.checked);
    });

    $("cfg-training-type").addEventListener("change", (e) => {
        $("lora-section").classList.toggle("hidden", e.target.value !== "lora");
        $("fft-section").classList.toggle("hidden", e.target.value !== "full_finetune");
    });

    $("cfg-multigpu-mode").addEventListener("change", (e) => {
        $("fsdp-opts").classList.toggle("hidden", e.target.value !== "fsdp");
        $("deepspeed-opts").classList.toggle("hidden", e.target.value !== "deepspeed");
    });
    
    $("btn-add-dataset").addEventListener("click", () => addSubset());
}

// === WebSocket ===
let isTraining = false; // true while job is running or queued

function setTrainingState(running, queued) {
    isTraining = running || queued;
    const genBtn = $("btn-generate");
    const genSection = document.getElementById("gen-section") || genBtn.closest("section") || genBtn.parentElement;

    if (isTraining) {
        // Disable generate and dim the whole section during training
        genBtn.disabled = true;
        genBtn.title = "Stop training before generating images";
        genSection.style.opacity = "0.45";
        genSection.style.pointerEvents = "none";
        // Unload any kept model so GPU is free for training
        if (currentJob) api(`/api/jobs/${currentJob}/unload`, { method: "POST" }).catch(() => {});
    } else {
        genBtn.disabled = false;
        genBtn.title = "";
        genSection.style.opacity = "";
        genSection.style.pointerEvents = "";
    }
}

function connectWS() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.onopen = () => {
        $("ws-status").classList.add("connected");
        if (currentJob) ws.send(JSON.stringify({ type: "subscribe", job: currentJob }));
    };
    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.job !== currentJob) return;
            if (msg.type === "log") appendConsole(msg.data);
             if (msg.type === "status" && msg.data !== "generating") {
                const running = msg.data === "running";
                const queued = msg.data === "queued";
                if (queued) {
                    $("btn-stop").innerHTML = `<i data-lucide="x"></i> Cancel Queue`;
                    $("btn-stop").className = "btn btn-danger btn-glow";
                } else {
                    $("btn-stop").innerHTML = `<i data-lucide="square"></i> Stop Training`;
                    $("btn-stop").className = "btn btn-danger";
                }
                
                $("btn-run").classList.toggle("hidden", running || queued);
                $("btn-stop").classList.toggle("hidden", !running && !queued);
                setTrainingState(running, queued);
                
                if (window.lucide) lucide.createIcons();
                
                Array.from($("job-list").children).forEach(el => {
                    if (el.querySelector(".job-name").textContent === currentJob) {
                        el.classList.toggle("running", running);
                        el.classList.toggle("queued", queued);
                    }
                });
            }
        } catch (e) {}
    };
    ws.onclose = () => {
        $("ws-status").classList.remove("connected");
        setTimeout(connectWS, 3000);
    };
}

// appendConsole and resetConsole defined at top of file

// === Jobs API ===
async function loadJobs() {
    try {
        const jobs = await api("/api/jobs");
        const list = $("job-list");
        list.innerHTML = "";
        jobs.forEach(job => {
            const el = document.createElement("div");
            el.className = `job-item ${job.name === currentJob ? "active" : ""} ${job.running ? "running" : ""} ${job.queued ? "queued" : ""}`;
            el.innerHTML = `<div class="job-status"></div><span class="job-name">${job.name}</span>`;
            el.onclick = () => selectJob(job.name);
            list.appendChild(el);
        });
    } catch (err) {
        console.error(err);
    }
}

async function createJob(name) {
    try {
        await api("/api/jobs", { method: "POST", body: { name, template: "anima" } });
        await loadJobs();
        selectJob(name);
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function deleteJob() {
    try {
        await api(`/api/jobs/${currentJob}`, { method: "DELETE" });
        currentJob = null;
        localStorage.removeItem("lastJob");
        $("job-editor").classList.add("hidden");
        $("empty-state").classList.remove("hidden");
        loadJobs();
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function loadSamples(jobName) {
    const grid = $("samples-grid");
    const empty = $("samples-empty");
    try {
        const samples = await api(`/api/jobs/${jobName}/samples`);
        if (samples.length === 0) {
            grid.innerHTML = "";
            empty.style.display = "block";
        } else {
            empty.style.display = "none";
            grid.innerHTML = samples.map(s => `
                <div class="sample-card">
                    <img src="${s.path}" 
                         alt="${s.name}"
                         style="width:100%;border-radius:6px;cursor:pointer;"
                         onclick="window.open(this.src,'_blank')"
                         title="${s.name}">
                    <div style="font-size:0.75em;color:var(--text-dim);padding:4px 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${s.name}">${s.name}</div>
                </div>`).join("");
        }
        showToast(`Loaded ${samples.length} sample${samples.length !== 1 ? "s" : ""}`, "success");
    } catch(e) {
        showToast("Failed to load samples: " + e.message, "error");
    }
}

async function selectJob(name) {
    if (isDirty && !confirm("Unsaved changes. Switch anyway?")) return;
    
    currentJob = name;
    localStorage.setItem("lastJob", name);
    isDirty = false;
    
    $("job-title").textContent = name;
    $("empty-state").classList.add("hidden");
    $("job-editor").classList.remove("hidden");
    $("btn-save").classList.add("hidden");
    $("btn-discard").classList.add("hidden");
    resetConsole("Waiting for training to start...");
    
    // Subscribe
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "subscribe", job: currentJob }));
    }

    try {
        await loadGPUs();
        await loadGlobalSettings(); // Load model paths
        const data = await api(`/api/jobs/${name}`);
        populateConfig(data.config);
        populateDataset(data.dataset);
        await loadPrompts();
        await loadSamples(name);

        // Reset TB UI
        $("tb-frame-container").innerHTML = "";
        $("btn-tb-launch").classList.remove("hidden");
        $("btn-tb-stop").classList.add("hidden");
        $("btn-tb-open").classList.add("hidden");
        
        try {
            const tbStatus = await api(`/api/jobs/${name}/tensorboard/status`);
            if (tbStatus.running) {
                $("tb-frame-container").innerHTML = `<div style="padding:16px;color:var(--text-dim);text-align:center;">
                    <p>TensorBoard is running at <a href="${tbStatus.url}" target="_blank" style="color:var(--accent)">${tbStatus.url}</a></p>
                </div>`;
                $("btn-tb-launch").classList.add("hidden");
                $("btn-tb-stop").classList.remove("hidden");
                $("btn-tb-open").classList.remove("hidden");
                $("btn-tb-open").onclick = () => window.open(tbStatus.url, '_blank');
            }
        } catch(e) {}
        const status = await api(`/api/jobs/${name}/train/status`);
        const running = status.running;
        const queued = status.queued;
        if (queued) {
            $("btn-stop").innerHTML = `<i data-lucide="x"></i> Cancel Queue`;
            $("btn-stop").className = "btn btn-danger btn-glow";
        } else {
            $("btn-stop").innerHTML = `<i data-lucide="square"></i> Stop Training`;
            $("btn-stop").className = "btn btn-danger";
        }
        
        $("btn-run").classList.toggle("hidden", running || queued);
        $("btn-stop").classList.toggle("hidden", !running && !queued);
        setTrainingState(running, queued);
        
        if (window.lucide) lucide.createIcons();
        
        // Hide dirty state buttons that may have been triggered by populateConfig change events
        $("btn-save").classList.add("hidden");
        $("btn-discard").classList.add("hidden");
        
        loadJobs();
    } catch (err) {
        showToast("Failed to load job: " + err.message, "error");
    }
}

function markDirty() {
    isDirty = true;
    $("btn-save").classList.remove("hidden");
    $("btn-discard").classList.remove("hidden");
}

// === GPUs API ===
async function loadGPUs() {
    try {
        const gpus = await api("/api/system/gpus");
        const container = $("cfg-gpu-selection");
        container.innerHTML = "";
        
        if (gpus && gpus.length > 0) {
            gpus.forEach((gpu, idx) => {
                const id = gpu.index.toString();
                const mem = (gpu.memory || "Unknown");
                
                const card = document.createElement("div");
                card.className = "gpu-card selected";
                card.innerHTML = `
                    <input type="checkbox" name="gpu-select" value="${id}" checked class="hidden">
                    <span class="gpu-name">GPU ${id}</span>
                    <span class="gpu-mem">${mem} GB</span>
                `;
                card.onclick = () => {
                    const cb = card.querySelector("input");
                    cb.checked = !cb.checked;
                    card.classList.toggle("selected", cb.checked);
                    markDirty();
                };
                container.appendChild(card);
            });
        } else {
            container.innerHTML = `<div class="text-dim">No discrete GPUs detected.</div>`;
        }
    } catch (err) {
        console.error("GPU load failed", err);
    }
}

// === Global Settings ===
async function loadGlobalSettings() {
    try {
        const config = await api("/api/global-config");
        const paths = config.model_paths || {};
        $("cfg-dit-path").value = paths.dit_path || "";
        $("cfg-qwen3-path").value = paths.qwen3_path || "";
        $("cfg-vae-path").value = paths.vae_path || "";
    } catch (err) {
        showToast("Failed to load global model paths", "error");
    }
}

async function saveGlobalSettings() {
    try {
        const currentConfig = await api("/api/global-config").catch(() => ({}));
        const newConfig = {
            ...currentConfig,
            model_paths: {
                dit_path: $("cfg-dit-path").value,
                qwen3_path: $("cfg-qwen3-path").value,
                vae_path: $("cfg-vae-path").value
            }
        };
        await api("/api/global-config", { method: "PUT", body: newConfig });
    } catch (err) {
        console.error("Failed to save global model paths", err);
    }
}

// === Config Parsing ===
function safeInt(val) { const p = parseInt(val); return isNaN(p) ? undefined : p; }
function safeFloat(val) { const p = parseFloat(val); return isNaN(p) ? undefined : p; }

function gatherConfig() {
    const isEpochs = document.querySelector('input[name="duration-unit"]:checked').value === "epochs";
    const gpus = Array.from(document.querySelectorAll('input[name="gpu-select"]:checked')).map(cb => cb.value);
    const multiGpuMode = $("cfg-multigpu-mode").value;
    const isMultiGpu = gpus.length > 1;

    return {
        gpu_ids: gpus.join(","),
        training_arguments: {
            output_name: $("cfg-output-name").value,
            save_model_as: $("cfg-save-format").value,
            max_train_epochs: isEpochs ? safeInt($("cfg-max-epochs").value) : undefined,
            save_every_n_epochs: isEpochs ? safeInt($("cfg-save-every").value) : undefined,
            max_train_steps: !isEpochs ? safeInt($("cfg-max-steps").value) : undefined,
            save_every_n_steps: !isEpochs ? safeInt($("cfg-save-every-steps").value) : undefined,
            learning_rate: safeFloat($("cfg-lr").value),
            text_encoder_lr: safeFloat($("cfg-te-lr").value),
            optimizer_type: $("cfg-optimizer").value,
            lr_scheduler: $("cfg-lr-scheduler").value,
            lr_warmup_steps: safeInt($("cfg-lr-warmup").value),
            seed: safeInt($("cfg-seed").value),
            mixed_precision: $("cfg-mixed-precision").value,
            save_precision: $("cfg-save-precision").value,
            max_data_loader_n_workers: safeInt($("cfg-workers").value),
            gradient_checkpointing: $("cfg-gradient-checkpointing").checked,
            flash_attn: $("cfg-flash-attn").checked,
            lowram: $("cfg-lowram").checked,
            blocks_to_swap: safeInt($("cfg-blocks-to-swap").value),
            cache_latents_to_disk: $("cfg-cache-latents").checked,
            cache_text_encoder_outputs_to_disk: $("cfg-cache-te").checked,
            multigpu_mode: isMultiGpu ? multiGpuMode : "ddp",
            use_fsdp: isMultiGpu && multiGpuMode === "fsdp",
            deepspeed: isMultiGpu && multiGpuMode === "deepspeed",
            gradient_accumulation_steps: safeInt($("cfg-grad-acc").value),
            optimizer_args: $("cfg-weight-decay").value ? [`weight_decay=${$("cfg-weight-decay").value}`] : undefined,
            sample_every_n_epochs: ($("cfg-enable-sampling")?.checked && isEpochs) ? safeInt($("cfg-sample-every").value) : undefined,
            sample_every_n_steps: ($("cfg-enable-sampling")?.checked && !isEpochs) ? safeInt($("cfg-sample-every-steps").value) : undefined
        },
        network_arguments: $("cfg-training-type").value === "lora" ? {
            network_module: "networks.lora_anima",
            network_dim: safeInt($("cfg-network-dim").value),
            network_alpha: safeInt($("cfg-network-alpha").value),
            network_train_unet_only: $("cfg-unet-only").checked,
            network_dropout: safeFloat($("cfg-network-dropout").value),
            network_args: $("cfg-network-args").value ? $("cfg-network-args").value.split(" ") : undefined,
            network_weights: $("cfg-network-weights").value || undefined,
            auto_resume_last_state: $("cfg-auto-resume").checked,
            resume: $("cfg-resume").value || undefined
        } : {
            auto_resume_last_state: $("cfg-auto-resume").checked,
            resume: $("cfg-resume").value || undefined
        },
        anima_arguments: {
            timestep_sample_method: $("cfg-timestep-method").value,
            discrete_flow_shift: safeFloat($("cfg-flow-shift").value)
        }
    };
}

function populateConfig(config) {
    const t = config.training_arguments || {};
    const n = config.network_arguments || {};
    const a = config.anima_arguments || {};
    
    $("cfg-lr").value = t.learning_rate || "2e-5";
    $("cfg-te-lr").value = t.text_encoder_lr || "0";
    $("cfg-optimizer").value = t.optimizer_type || "AdamW";
    $("cfg-lr-scheduler").value = t.lr_scheduler || "cosine";
    $("cfg-lr-warmup").value = t.lr_warmup_steps ?? 0;
    $("cfg-seed").value = t.seed ?? 42;
    
    // Weight decay parsing
    if (t.optimizer_args) {
        const wd = t.optimizer_args.find(a => a.startsWith("weight_decay="));
        if (wd) $("cfg-weight-decay").value = wd.split("=")[1];
    }
    
    const isSteps = !!t.max_train_steps;
    document.querySelector(`input[name="duration-unit"][value="${isSteps ? 'steps' : 'epochs'}"]`).checked = true;
    $("schedule-epochs").classList.toggle("hidden", isSteps);
    $("schedule-steps").classList.toggle("hidden", !isSteps);
    
    $("cfg-max-epochs").value = t.max_train_epochs ?? 20;
    $("cfg-save-every").value = t.save_every_n_epochs ?? 1;
    $("cfg-max-steps").value = t.max_train_steps ?? 1000;
    $("cfg-save-every-steps").value = t.save_every_n_steps ?? 500;
    $("cfg-output-name").value = t.output_name || "my_anima_lora";
    $("cfg-save-format").value = t.save_model_as || "safetensors";
    
    $("cfg-sample-every").value = t.sample_every_n_epochs ?? 1;
    $("cfg-sample-every-steps").value = t.sample_every_n_steps ?? 100;
    const isSampling = (t.sample_every_n_epochs > 0 || t.sample_every_n_steps > 0);
    if ($("cfg-enable-sampling")) $("cfg-enable-sampling").checked = isSampling;
    if ($("sample-interval-row")) $("sample-interval-row").classList.toggle("hidden", !isSampling);
    if ($("sample-epochs-group")) $("sample-epochs-group").classList.toggle("hidden", isSteps);
    if ($("sample-steps-group")) $("sample-steps-group").classList.toggle("hidden", !isSteps);

    $("cfg-mixed-precision").value = t.mixed_precision || "bf16";
    $("cfg-save-precision").value = t.save_precision || "bf16";
    $("cfg-workers").value = t.max_data_loader_n_workers ?? 4;
    $("cfg-grad-acc").value = t.gradient_accumulation_steps ?? 1;
    $("cfg-gradient-checkpointing").checked = t.gradient_checkpointing ?? true;
    $("cfg-flash-attn").checked = t.flash_attn ?? false;
    $("cfg-lowram").checked = t.lowram ?? false;
    $("cfg-blocks-to-swap").value = t.blocks_to_swap ?? 0;
    
    $("cfg-cache-latents").checked = t.cache_latents_to_disk ?? true;
    $("cfg-cache-te").checked = t.cache_text_encoder_outputs_to_disk ?? true;
    
    $("cfg-timestep-method").value = a.timestep_sample_method || "logit_normal";
    $("cfg-flow-shift").value = a.discrete_flow_shift ?? 3.0;
    
    $("cfg-training-type").value = n.network_module ? "lora" : "full_finetune";
    $("cfg-training-type").dispatchEvent(new Event("change"));
    
    if (n.network_module) {
        $("cfg-network-dim").value = n.network_dim ?? 32;
        $("cfg-network-alpha").value = n.network_alpha ?? 32;
        $("cfg-unet-only").checked = n.network_train_unet_only ?? true;
        $("cfg-network-dropout").value = n.network_dropout ?? 0;
        $("cfg-network-args").value = (n.network_args || []).join(" ");
        $("cfg-network-weights").value = n.network_weights || "";
    }
    
    $("cfg-auto-resume").checked = n.auto_resume_last_state ?? false;
    $("cfg-resume").value = n.resume || "";
    
    $("cfg-multigpu-mode").value = t.multigpu_mode || "ddp";
    $("cfg-multigpu-mode").dispatchEvent(new Event("change"));
    
    // GPUs
    const savedIds = (config.gpu_ids || "").split(",");
    document.querySelectorAll('input[name="gpu-select"]').forEach(cb => {
        cb.checked = savedIds.length === 0 || savedIds.includes(cb.value);
        cb.parentElement.classList.toggle("selected", cb.checked);
    });
}

// === Dataset Parsing ===
function gatherDataset() {
    return {
        general: {
            enable_bucket: $("cfg-enable-bucket").checked,
            bucket_no_upscale: $("cfg-bucket-no-upscale").checked,
            min_bucket_reso: safeInt($("cfg-min-bucket").value),
            max_bucket_reso: safeInt($("cfg-max-bucket").value),
            bucket_reso_steps: safeInt($("cfg-bucket-steps").value)
        },
        datasets: [{
            resolution: $("cfg-resolution").value.split(",").map(s => safeInt(s.trim()))[0] || 1536,
            batch_size: safeInt($("cfg-batch-size").value) || 1,
            caption_extension: $("cfg-caption-ext").value,
            subsets: currentSubsets.map(s => {
                const el = $(`subset-${s.id}`);
                if (!el) return s;
                return {
                    image_dir: el.querySelector(".s-dir").value,
                    num_repeats: safeInt(el.querySelector(".s-rep").value),
                    alpha_mask: $("cfg-alpha-mask").checked
                };
            })
        }]
    };
}

function populateDataset(dataset) {
    const g = dataset.general || {};
    const dArray = Array.isArray(dataset.datasets) ? dataset.datasets : [dataset.datasets || {}];
    const d = dArray[0] || {};
    
    $("cfg-resolution").value = Array.isArray(d.resolution) ? d.resolution[0] : (d.resolution || 1024);
    $("cfg-batch-size").value = d.batch_size || 1;
    $("cfg-caption-ext").value = d.caption_extension || ".txt";
    
    $("cfg-enable-bucket").checked = g.enable_bucket ?? true;
    $("cfg-bucket-no-upscale").checked = g.bucket_no_upscale ?? true;
    $("cfg-min-bucket").value = g.min_bucket_reso ?? 512;
    $("cfg-max-bucket").value = g.max_bucket_reso ?? 1536;
    $("cfg-bucket-steps").value = g.bucket_reso_steps ?? 64;
    
    let subsetsRaw = d.subsets || [];
    if (!Array.isArray(subsetsRaw)) subsetsRaw = [subsetsRaw];
    
    currentSubsets = subsetsRaw.map((s, i) => ({
        id: i,
        image_dir: s.image_dir || "",
        num_repeats: s.num_repeats ?? 1
    }));
    
    $("cfg-alpha-mask").checked = subsetsRaw.some(s => s.alpha_mask === true);
    
    if (currentSubsets.length === 0) addSubset();
    else renderSubsets();
}

function syncSubsetsFromDOM() {
    currentSubsets.forEach(s => {
        const el = $(`subset-${s.id}`);
        if (el) {
            s.image_dir = el.querySelector(".s-dir").value;
            s.num_repeats = safeInt(el.querySelector(".s-rep").value) || 1;
        }
    });
}

function addSubset() {
    syncSubsetsFromDOM();
    currentSubsets.push({ id: Date.now(), image_dir: "", num_repeats: 1 });
    renderSubsets();
    markDirty();
}

function removeSubset(id) {
    syncSubsetsFromDOM();
    currentSubsets = currentSubsets.filter(s => s.id !== id);
    if (currentSubsets.length === 0) addSubset();
    else renderSubsets();
    markDirty();
}

function renderSubsets() {
    const container = $("dataset-subsets-list");
    container.innerHTML = "";
    currentSubsets.forEach((s, idx) => {
        const el = document.createElement("div");
        el.className = "subset-card";
        el.id = `subset-${s.id}`;
        el.innerHTML = `
            <div class="subset-header">
                <span class="subset-title">Folder ${idx + 1}</span>
                <button class="btn btn-danger btn-xs" onclick="removeSubset(${s.id})">Remove</button>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:3;">
                    <label>Image Folder Path</label>
                    <input type="text" class="s-dir" value="${s.image_dir}" placeholder="C:\\dataset\\concept">
                </div>
                <div class="form-group" style="flex:1;">
                    <label>Repeats</label>
                    <input type="number" class="s-rep" value="${s.num_repeats}" min="1">
                </div>
            </div>
        `;
        el.querySelectorAll("input").forEach(i => i.addEventListener("input", markDirty));
        container.appendChild(el);
    });
}

// === Action Handlers ===
async function saveJob() {
    try {
        await saveGlobalSettings(); // Save global model paths first
        const config = gatherConfig();
        const dataset = gatherDataset();
        await api(`/api/jobs/${currentJob}`, {
            method: "PUT",
            body: { config, dataset }
        });
        isDirty = false;
        $("btn-save").classList.add("hidden");
        $("btn-discard").classList.add("hidden");
        showToast("Saved successfully");
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function startTraining() {
    if (isDirty) await saveJob();
    try {
        await api(`/api/jobs/${currentJob}/train/start`, { method: "POST" });
        resetConsole("Starting training...");
    } catch (err) {
        showToast("Failed to start: " + err.message, "error");
    }
}

async function stopTraining() {
    if (!confirm("Stop training?")) return;
    try {
        await api(`/api/jobs/${currentJob}/train/stop`, { method: "POST" });
    } catch (err) {
        showToast("Failed to stop: " + err.message, "error");
    }
}
