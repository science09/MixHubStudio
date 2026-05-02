# 变量定义
VENV = router-env
PYTHON = $(VENV)/bin/python
PIP = $(VENV)/bin/pip

.PHONY: help setup install run clean reset-db tauri-dev

help:
	@echo "AIHubMix Router Makefile 指令:"
	@echo "  make setup     - 创建虚拟环境并安装所有依赖"
	@echo "  make run       - 启动 Python 后端服务"
	@echo "  make tauri-dev - 启动 Tauri 桌面端开发环境"
	@echo "  make clean     - 清除缓存"

setup: $(VENV)/bin/activate

$(VENV)/bin/activate: requirements.txt
	test -d $(VENV) || python3 -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -r requirements.txt
	touch $(VENV)/bin/activate

install: $(VENV)/bin/activate
	$(PIP) install -r requirements.txt

run: install
	@echo "正在启动 AIHubMix Router 后端 (热更新模式)..."
	$(PYTHON) -m uvicorn aihubmix_router:app --host 0.0.0.0 --port 8000 --reload

tauri-dev:
	npm run tauri dev

clean:
	rm -rf __pycache__
	find . -name "*.pyc" -delete

reset-db:
	rm -f aihubmix_stats.db
