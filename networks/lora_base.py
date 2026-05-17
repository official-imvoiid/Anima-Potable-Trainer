# temporary minimum implementation of LoRA
# FLUX doesn't have Conv2d, so we ignore it
# TODO commonize with the original implementation

# LoRA network module
# reference:
# https://github.com/microsoft/LoRA/blob/main/loralib/layers.py
# https://github.com/cloneofsimo/lora/blob/master/lora_diffusion/lora.py

import math
import os
from contextlib import contextmanager
from typing import Dict, List, Optional, Tuple, Type, Union
from diffusers import AutoencoderKL
from transformers import CLIPTextModel
import numpy as np
import torch
from torch import Tensor
import re
from library.utils import setup_logging
SdxlUNet2DConditionModel = type("SdxlUNet2DConditionModel", (), {})

setup_logging()
import logging

logger = logging.getLogger(__name__)


NUM_DOUBLE_BLOCKS = 19
NUM_SINGLE_BLOCKS = 38


class LoRAModule(torch.nn.Module):
    """
    replaces forward method of the original Linear, instead of replacing the original Linear module.
    """

    def __init__(
        self,
        lora_name,
        org_module: torch.nn.Module,
        multiplier=1.0,
        lora_dim=4,
        alpha=1,
        dropout=None,
        rank_dropout=None,
        module_dropout=None,
        split_dims: Optional[List[int]] = None,
        ggpo_beta: Optional[float] = None,
        ggpo_sigma: Optional[float] = None,
    ):
        """
        if alpha == 0 or None, alpha is rank (no scaling).

        split_dims is used to mimic the split qkv of FLUX as same as Diffusers
        """
        super().__init__()
        self.lora_name = lora_name

        if org_module.__class__.__name__ == "Conv2d":
            in_dim = org_module.in_channels
            out_dim = org_module.out_channels
        else:
            in_dim = org_module.in_features
            out_dim = org_module.out_features

        self.lora_dim = lora_dim
        self.split_dims = split_dims

        if split_dims is None:
            if org_module.__class__.__name__ == "Conv2d":
                kernel_size = org_module.kernel_size
                stride = org_module.stride
                padding = org_module.padding
                self.lora_down = torch.nn.Conv2d(in_dim, self.lora_dim, kernel_size, stride, padding, bias=False)
                self.lora_up = torch.nn.Conv2d(self.lora_dim, out_dim, (1, 1), (1, 1), bias=False)
            else:
                self.lora_down = torch.nn.Linear(in_dim, self.lora_dim, bias=False)
                self.lora_up = torch.nn.Linear(self.lora_dim, out_dim, bias=False)

            torch.nn.init.kaiming_uniform_(self.lora_down.weight, a=math.sqrt(5))
            torch.nn.init.zeros_(self.lora_up.weight)
        else:
            # conv2d not supported
            assert sum(split_dims) == out_dim, "sum of split_dims must be equal to out_dim"
            assert org_module.__class__.__name__ == "Linear", "split_dims is only supported for Linear"
            # print(f"split_dims: {split_dims}")
            self.lora_down = torch.nn.ModuleList(
                [torch.nn.Linear(in_dim, self.lora_dim, bias=False) for _ in range(len(split_dims))]
            )
            self.lora_up = torch.nn.ModuleList([torch.nn.Linear(self.lora_dim, split_dim, bias=False) for split_dim in split_dims])
            for lora_down in self.lora_down:
                torch.nn.init.kaiming_uniform_(lora_down.weight, a=math.sqrt(5))
            for lora_up in self.lora_up:
                torch.nn.init.zeros_(lora_up.weight)

        if type(alpha) == torch.Tensor:
            alpha = alpha.detach().float().numpy()  # without casting, bf16 causes error
        alpha = self.lora_dim if alpha is None or alpha == 0 else alpha
        self.scale = alpha / self.lora_dim
        self.register_buffer("alpha", torch.tensor(alpha))  # 定数として扱える

        # same as microsoft's
        self.multiplier = multiplier
        self.org_module = org_module  # remove in applying
        self.dropout = dropout
        self.rank_dropout = rank_dropout
        self.module_dropout = module_dropout

        self.ggpo_sigma = ggpo_sigma
        self.ggpo_beta = ggpo_beta

        if self.ggpo_beta is not None and self.ggpo_sigma is not None:
            self.combined_weight_norms = None
            self.grad_norms = None
            self.perturbation_norm_factor = 1.0 / math.sqrt(org_module.weight.shape[0])
            self.initialize_norm_cache(org_module.weight)
            self.org_module_shape: tuple[int] = org_module.weight.shape

    def apply_to(self):
        self.org_forward = self.org_module.forward
        self.org_module.forward = self.forward

        del self.org_module

    def forward(self, x):
        org_forwarded = self.org_forward(x)

        # module dropout
        if self.module_dropout is not None and self.training:
            if torch.rand(1) < self.module_dropout:
                return org_forwarded

        if self.split_dims is None:
            lx = self.lora_down(x)

            # normal dropout
            if self.dropout is not None and self.training:
                lx = torch.nn.functional.dropout(lx, p=self.dropout)

            # rank dropout
            if self.rank_dropout is not None and self.training:
                mask = torch.rand((lx.size(0), self.lora_dim), device=lx.device) > self.rank_dropout
                if len(lx.size()) == 3:
                    mask = mask.unsqueeze(1)  # for Text Encoder
                elif len(lx.size()) == 4:
                    mask = mask.unsqueeze(-1).unsqueeze(-1)  # for Conv2d
                lx = lx * mask

                # scaling for rank dropout: treat as if the rank is changed
                # maskから計算することも考えられるが、augmentation的な効果を期待してrank_dropoutを用いる
                scale = self.scale * (1.0 / (1.0 - self.rank_dropout))  # redundant for readability
            else:
                scale = self.scale

            lx = self.lora_up(lx)

            # LoRA Gradient-Guided Perturbation Optimization
            if (
                self.training
                and self.ggpo_sigma is not None
                and self.ggpo_beta is not None
                and self.combined_weight_norms is not None
                and self.grad_norms is not None
            ):
                with torch.no_grad():
                    perturbation_scale = (self.ggpo_sigma * torch.sqrt(self.combined_weight_norms**2)) + (
                        self.ggpo_beta * (self.grad_norms**2)
                    )
                    perturbation_scale_factor = (perturbation_scale * self.perturbation_norm_factor).to(self.device)
                    perturbation = torch.randn(self.org_module_shape, dtype=self.dtype, device=self.device)
                    perturbation.mul_(perturbation_scale_factor)
                    perturbation_output = x @ perturbation.T  # Result: (batch × n)
                return org_forwarded + (self.multiplier * scale * lx) + perturbation_output
            else:
                return org_forwarded + lx * self.multiplier * scale
        else:
            lxs = [lora_down(x) for lora_down in self.lora_down]

            # normal dropout
            if self.dropout is not None and self.training:
                lxs = [torch.nn.functional.dropout(lx, p=self.dropout) for lx in lxs]

            # rank dropout
            if self.rank_dropout is not None and self.training:
                masks = [torch.rand((lx.size(0), self.lora_dim), device=lx.device) > self.rank_dropout for lx in lxs]
                for i in range(len(lxs)):
                    if len(lx.size()) == 3:
                        masks[i] = masks[i].unsqueeze(1)
                    elif len(lx.size()) == 4:
                        masks[i] = masks[i].unsqueeze(-1).unsqueeze(-1)
                    lxs[i] = lxs[i] * masks[i]

                # scaling for rank dropout: treat as if the rank is changed
                scale = self.scale * (1.0 / (1.0 - self.rank_dropout))  # redundant for readability
            else:
                scale = self.scale

            lxs = [lora_up(lx) for lora_up, lx in zip(self.lora_up, lxs)]

            return org_forwarded + torch.cat(lxs, dim=-1) * self.multiplier * scale

    @torch.no_grad()
    def initialize_norm_cache(self, org_module_weight: Tensor):
        # Choose a reasonable sample size
        n_rows = org_module_weight.shape[0]
        sample_size = min(1000, n_rows)  # Cap at 1000 samples or use all if smaller

        # Sample random indices across all rows
        indices = torch.randperm(n_rows)[:sample_size]

        # Convert to a supported data type first, then index
        # Use float32 for indexing operations
        weights_float32 = org_module_weight.to(dtype=torch.float32)
        sampled_weights = weights_float32[indices].to(device=self.device)

        # Calculate sampled norms
        sampled_norms = torch.norm(sampled_weights, dim=1, keepdim=True)

        # Store the mean norm as our estimate
        self.org_weight_norm_estimate = sampled_norms.mean()

        # Optional: store standard deviation for confidence intervals
        self.org_weight_norm_std = sampled_norms.std()

        # Free memory
        del sampled_weights, weights_float32

    @torch.no_grad()
    def validate_norm_approximation(self, org_module_weight: Tensor, verbose=True):
        # Calculate the true norm (this will be slow but it's just for validation)
        true_norms = []
        chunk_size = 1024  # Process in chunks to avoid OOM

        for i in range(0, org_module_weight.shape[0], chunk_size):
            end_idx = min(i + chunk_size, org_module_weight.shape[0])
            chunk = org_module_weight[i:end_idx].to(device=self.device, dtype=self.dtype)
            chunk_norms = torch.norm(chunk, dim=1, keepdim=True)
            true_norms.append(chunk_norms.cpu())
            del chunk

        true_norms = torch.cat(true_norms, dim=0)
        true_mean_norm = true_norms.mean().item()

        # Compare with our estimate
        estimated_norm = self.org_weight_norm_estimate.item()

        # Calculate error metrics
        absolute_error = abs(true_mean_norm - estimated_norm)
        relative_error = absolute_error / true_mean_norm * 100  # as percentage

        if verbose:
            logger.info(f"True mean norm: {true_mean_norm:.6f}")
            logger.info(f"Estimated norm: {estimated_norm:.6f}")
            logger.info(f"Absolute error: {absolute_error:.6f}")
            logger.info(f"Relative error: {relative_error:.2f}%")

        return {
            "true_mean_norm": true_mean_norm,
            "estimated_norm": estimated_norm,
            "absolute_error": absolute_error,
            "relative_error": relative_error,
        }

    @torch.no_grad()
    def update_norms(self):
        # Not running GGPO so not currently running update norms
        if self.ggpo_beta is None or self.ggpo_sigma is None:
            return

        # only update norms when we are training
        if self.training is False:
            return

        module_weights = self.lora_up.weight @ self.lora_down.weight
        module_weights.mul(self.scale)

        self.weight_norms = torch.norm(module_weights, dim=1, keepdim=True)
        self.combined_weight_norms = torch.sqrt(
            (self.org_weight_norm_estimate**2) + torch.sum(module_weights**2, dim=1, keepdim=True)
        )

    @torch.no_grad()
    def update_grad_norms(self):
        if self.training is False:
            print(f"skipping update_grad_norms for {self.lora_name}")
            return

        lora_down_grad = None
        lora_up_grad = None

        for name, param in self.named_parameters():
            if name == "lora_down.weight":
                lora_down_grad = param.grad
            elif name == "lora_up.weight":
                lora_up_grad = param.grad

        # Calculate gradient norms if we have both gradients
        if lora_down_grad is not None and lora_up_grad is not None:
            with torch.autocast(self.device.type):
                approx_grad = self.scale * ((self.lora_up.weight @ lora_down_grad) + (lora_up_grad @ self.lora_down.weight))
                self.grad_norms = torch.norm(approx_grad, dim=1, keepdim=True)

    @property
    def device(self):
        return next(self.parameters()).device

    @property
    def dtype(self):
        return next(self.parameters()).dtype


class LoRAInfModule(LoRAModule):
    def __init__(
        self,
        lora_name,
        org_module: torch.nn.Module,
        multiplier=1.0,
        lora_dim=4,
        alpha=1,
        **kwargs,
    ):
        # no dropout for inference
        super().__init__(lora_name, org_module, multiplier, lora_dim, alpha)

        self.org_module_ref = [org_module]  # 後から参照できるように
        self.enabled = True
        self.network: LoRANetwork = None

    def set_network(self, network):
        self.network = network

    # freezeしてマージする
    def merge_to(self, sd, dtype, device):
        # extract weight from org_module
        org_sd = self.org_module.state_dict()
        weight = org_sd["weight"]
        org_dtype = weight.dtype
        org_device = weight.device
        weight = weight.to(torch.float)  # calc in float

        if dtype is None:
            dtype = org_dtype
        compute_device = org_device

        if self.split_dims is None:
            # get up/down weight
            down_weight = sd["lora_down.weight"].to(torch.float).to(compute_device)
            up_weight = sd["lora_up.weight"].to(torch.float).to(compute_device)

            # merge weight
            if len(weight.size()) == 2:
                # linear
                weight = weight + self.multiplier * (up_weight @ down_weight) * self.scale
            elif down_weight.size()[2:4] == (1, 1):
                # conv2d 1x1
                weight = (
                    weight
                    + self.multiplier
                    * (up_weight.squeeze(3).squeeze(2) @ down_weight.squeeze(3).squeeze(2)).unsqueeze(2).unsqueeze(3)
                    * self.scale
                )
            else:
                # conv2d 3x3
                conved = torch.nn.functional.conv2d(down_weight.permute(1, 0, 2, 3), up_weight).permute(1, 0, 2, 3)
                # logger.info(conved.size(), weight.size(), module.stride, module.padding)
                weight = weight + self.multiplier * conved * self.scale

            # set weight to org_module
            org_sd["weight"] = weight.to(dtype)
            self.org_module.load_state_dict(org_sd)
        else:
            # split_dims
            total_dims = sum(self.split_dims)
            for i in range(len(self.split_dims)):
                # get up/down weight
                down_weight = sd[f"lora_down.{i}.weight"].to(torch.float).to(compute_device)  # (rank, in_dim)
                up_weight = sd[f"lora_up.{i}.weight"].to(torch.float).to(compute_device)  # (split dim, rank)

                # pad up_weight -> (total_dims, rank)
                padded_up_weight = torch.zeros((total_dims, up_weight.size(0)), device=compute_device, dtype=torch.float)
                padded_up_weight[sum(self.split_dims[:i]) : sum(self.split_dims[: i + 1])] = up_weight

                # merge weight
                weight = weight + self.multiplier * (up_weight @ down_weight) * self.scale

            # set weight to org_module
            org_sd["weight"] = weight.to(dtype)
            self.org_module.load_state_dict(org_sd)

    # 復元できるマージのため、このモジュールのweightを返す
    def get_weight(self, multiplier=None):
        if multiplier is None:
            multiplier = self.multiplier

        # get up/down weight from module
        up_weight = self.lora_up.weight.to(torch.float)
        down_weight = self.lora_down.weight.to(torch.float)

        # pre-calculated weight
        if len(down_weight.size()) == 2:
            # linear
            weight = self.multiplier * (up_weight @ down_weight) * self.scale
        elif down_weight.size()[2:4] == (1, 1):
            # conv2d 1x1
            weight = (
                self.multiplier
                * (up_weight.squeeze(3).squeeze(2) @ down_weight.squeeze(3).squeeze(2)).unsqueeze(2).unsqueeze(3)
                * self.scale
            )
        else:
            # conv2d 3x3
            conved = torch.nn.functional.conv2d(down_weight.permute(1, 0, 2, 3), up_weight).permute(1, 0, 2, 3)
            weight = self.multiplier * conved * self.scale

        return weight

    def set_region(self, region):
        self.region = region
        self.region_mask = None

    def default_forward(self, x):
        # logger.info(f"default_forward {self.lora_name} {x.size()}")
        if self.split_dims is None:
            lx = self.lora_down(x)
            lx = self.lora_up(lx)
            return self.org_forward(x) + lx * self.multiplier * self.scale
        else:
            lxs = [lora_down(x) for lora_down in self.lora_down]
            lxs = [lora_up(lx) for lora_up, lx in zip(self.lora_up, lxs)]
            return self.org_forward(x) + torch.cat(lxs, dim=-1) * self.multiplier * self.scale

    def forward(self, x):
        if not self.enabled:
            return self.org_forward(x)
        return self.default_forward(x)


