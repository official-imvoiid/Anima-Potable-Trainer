from setuptools import setup, find_packages

setup(
    name="cuda-direct-backend",
    version="0.1.0",
    description="CUDA Direct GPU-to-GPU ProcessGroup backend for PyTorch distributed on Windows",
    packages=find_packages(),
    python_requires=">=3.10",
    install_requires=[
        "torch>=2.0.0",
    ],
)
