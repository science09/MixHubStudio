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

build:
	npm run tauri build

clean:
	@echo "正在清理缓存和临时文件..."
	rm -rf __pycache__
	find . -name "*.pyc" -delete
	rm -rf dist
	@if [ -d "src-tauri" ]; then \
		echo "正在清理 Rust 编译产物 (src-tauri/target)..."; \
		cd src-tauri && cargo clean; \
	fi
	@echo "清理完成！"

deep-clean: clean
	@echo "执行深度清理 (删除 node_modules 和虚拟环境)..."
	rm -rf node_modules
	rm -rf $(VENV)
	@echo "深度清理完成！请重新运行 'make setup' 安装依赖。"

reset-db:
	rm -f aihubmix_stats.db
