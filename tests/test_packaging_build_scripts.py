# -*- coding: utf-8 -*-
"""Validation tests for backend packaging scripts."""

import ast
import hashlib
import json
import os
import runpy
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


REPO_ROOT = Path(__file__).resolve().parents[1]


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _bash_path(path: Path) -> str:
    resolved = path.resolve()
    if os.name != "nt":
        return str(resolved)
    drive = resolved.drive.rstrip(":").lower()
    relative = resolved.relative_to(resolved.anchor).as_posix()
    return f"/mnt/{drive}/{relative}"


def test_windows_backend_build_script_collects_builtin_screening_engine() -> None:
    script = _read_text(REPO_ROOT / "scripts" / "build-backend.ps1")
    main_py = _read_text(REPO_ROOT / "main.py")

    assert "Checking built-in screening engine availability" in script
    assert "import src.services.screening.pipeline" in script
    assert "--collect-all" in script
    assert "src.services.screening" in script
    assert "hiddenImports" in script
    assert "Verifying packaged runtime imports" in script
    assert "DSA_PACKAGED_IMPORT_PROBE" in script
    assert "Start-Process -FilePath $packagedEntry -Wait -PassThru" in script
    assert "$probeProcess.ExitCode" in script
    assert "& $packagedEntry" not in script
    assert "Packaged backend cannot import $module" in script
    assert "pyinstaller_runtime_compat.py" in script
    assert "--runtime-hook" in script
    assert "Verifying packaged screening strategies" in script
    assert "_internal\\src\\services\\screening\\strategies" in script
    assert "packagedScreeningStrategyCount" in script
    assert "DSA_PACKAGED_IMPORT_PROBE" in main_py
    assert "importlib.import_module(_packaged_import_probe)" in main_py


def test_macos_backend_build_script_collects_builtin_screening_engine() -> None:
    script = _read_text(REPO_ROOT / "scripts" / "build-backend-macos.sh")
    main_py = _read_text(REPO_ROOT / "main.py")

    assert "Checking built-in screening engine availability..." in script
    assert "import src.services.screening.pipeline" in script
    assert "--collect-all" in script
    assert 'cmd+=("--collect-all" "src.services.screening")' in script
    assert "packaged_entry=\"${packaged_root}/stock_analysis\"" in script
    assert "--help" in script
    assert 'DSA_PACKAGED_IMPORT_PROBE="${module}"' in script
    assert "dsa-packaged-import.log" in script
    assert '--runtime-hook "${SCRIPT_DIR}/pyinstaller_runtime_compat.py"' in script
    assert "PathFinder.find_spec(" not in script
    assert "zipfile" not in script
    assert "Verifying packaged screening strategies..." in script
    assert "_internal/src/services/screening/strategies" in script
    assert "packaged_screening_strategy_count" in script
    assert "DSA_PACKAGED_IMPORT_PROBE" in main_py
    assert "importlib.import_module(_packaged_import_probe)" in main_py


def test_backend_scripts_bundle_and_probe_business_catalog_resources() -> None:
    macos = _read_text(REPO_ROOT / "scripts" / "build-backend-macos.sh")
    windows = _read_text(REPO_ROOT / "scripts" / "build-backend.ps1")
    assert '--add-data "src/services/simulation_templates.json:src/services"' in macos
    assert "'--add-data', 'src/services/simulation_templates.json;src/services'" in windows
    assert 'cmd+=("--collect-all" "src.strategy_kernels")' in macos
    assert "'--collect-all', 'src.strategy_kernels'" in windows
    assert '--add-data "templates:templates"' in macos
    assert "'--add-data', 'templates;templates'" in windows
    # These are in the executed frozen probe loops, not only hidden imports.
    macos_probes = macos.split("Verifying packaged runtime imports", 1)[1].split("for module in ", 1)[1].split("; do", 1)[0]
    windows_probes = windows.split("foreach ($module in @(", 1)[1].split("))", 1)[0]
    for module in ("src.services.simulation_strategy_service", "src.strategy_kernels.catalog", "src.services.report_renderer"):
        assert module in macos_probes
        assert module in windows_probes


def _run_packaged_resource_probe(module: str) -> None:
    """Execute main's real early probe without importing the full CLI workflow."""
    tree = ast.parse(_read_text(REPO_ROOT / "main.py"))
    probe = next(
        node for node in tree.body
        if isinstance(node, ast.If)
        and isinstance(node.test, ast.Name)
        and node.test.id == "_packaged_import_probe"
    )
    code = compile(ast.Module(body=[probe], type_ignores=[]), str(REPO_ROOT / "main.py"), "exec")
    exec(code, {"_packaged_import_probe": module})


def _stage_frozen_catalogs(tmp_path, monkeypatch, layout):
    from src.services import report_renderer, simulation_strategy_service
    from src.strategy_kernels import catalog

    runtime_root = tmp_path / layout if layout else tmp_path
    service_dir = runtime_root / "src" / "services"
    service_dir.mkdir(parents=True)
    shutil.copy(REPO_ROOT / "src/services/simulation_templates.json", service_dir)
    kernel_dir = runtime_root / "src" / "strategy_kernels"
    shutil.copytree(REPO_ROOT / "src/strategy_kernels", kernel_dir, ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(REPO_ROOT / "templates", runtime_root / "templates")
    # PyInstaller gives imported modules a __file__ underneath its runtime root.
    # Keep the actual production methods: their relative-path reads hit this tree.
    monkeypatch.setattr(simulation_strategy_service, "__file__", str(service_dir / "simulation_strategy_service.py"))
    monkeypatch.setattr(catalog, "__file__", str(kernel_dir / "catalog.py"))
    monkeypatch.setattr(report_renderer, "__file__", str(service_dir / "report_renderer.py"))
    renderer_config = SimpleNamespace(report_templates_dir="templates", report_language="zh", report_show_llm_model=False)
    monkeypatch.setattr(report_renderer, "get_config", lambda: renderer_config)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(runtime_root), raising=False)
    return simulation_strategy_service, catalog, service_dir, kernel_dir


@pytest.mark.parametrize("layout", ["_internal", ""])
def test_frozen_catalog_layout_loads_real_templates_and_kernel_hashes(tmp_path, monkeypatch, layout) -> None:
    service_module, catalog_module, _services, kernels = _stage_frozen_catalogs(tmp_path, monkeypatch, layout)
    service = object.__new__(service_module.SimulationStrategyService)
    assert service.list_templates() == json.loads(_read_text(REPO_ROOT / "src/services/simulation_templates.json"))
    for item in catalog_module.builtin_kernel_catalog().values():
        assert item["sha256"] == hashlib.sha256((kernels / f"{item['module']}.py").read_bytes()).hexdigest()
    for module in ("src.services.simulation_strategy_service", "src.strategy_kernels.catalog", "src.services.report_renderer"):
        with pytest.raises(SystemExit) as result:
            _run_packaged_resource_probe(module)
        assert result.value.code == 0


@pytest.mark.parametrize("failure", ["missing_templates", "invalid_templates", "missing_kernel", "missing_report", "missing_macro"])
def test_frozen_probe_rejects_missing_or_broken_business_resources(tmp_path, monkeypatch, failure) -> None:
    _service, _catalog, services, kernels = _stage_frozen_catalogs(tmp_path, monkeypatch, "_internal")
    module = "src.services.simulation_strategy_service"
    if failure == "missing_templates":
        (services / "simulation_templates.json").unlink()
    elif failure == "invalid_templates":
        (services / "simulation_templates.json").write_text("{invalid json", encoding="utf-8")
    elif failure == "missing_kernel":
        (kernels / "single_stock_research.py").unlink()
        module = "src.strategy_kernels.catalog"
    else:
        templates = tmp_path / "_internal" / "templates"
        (templates / ("report_wechat.j2" if failure == "missing_report" else "_macros.j2")).unlink()
        module = "src.services.report_renderer"
    with pytest.raises(SystemExit) as result:
        _run_packaged_resource_probe(module)
    assert result.value.code == 1


def test_packaged_builtin_report_probe_preserves_custom_template_configuration(tmp_path, monkeypatch) -> None:
    from src.services import report_renderer

    _stage_frozen_catalogs(tmp_path, monkeypatch, "_internal")
    custom_templates = tmp_path / "custom"
    custom_templates.mkdir()
    (custom_templates / "report_brief.j2").write_text("CUSTOM_REPORT", encoding="utf-8")
    config = report_renderer.get_config()
    config.report_templates_dir = str(custom_templates)
    with pytest.raises(SystemExit) as result:
        _run_packaged_resource_probe("src.services.report_renderer")
    assert result.value.code == 0
    assert config.report_templates_dir == str(custom_templates)
    assert report_renderer.render("brief", []) == "CUSTOM_REPORT"


def test_pyinstaller_runtime_hook_disables_incompatible_nltk_guard(
    monkeypatch,
) -> None:
    monkeypatch.delenv("NLTK_DISABLE_IMPORT_SECURITY", raising=False)

    runpy.run_path(
        str(REPO_ROOT / "scripts" / "pyinstaller_runtime_compat.py"),
        run_name="__pyinstaller_runtime_compat__",
    )

    assert os.environ["NLTK_DISABLE_IMPORT_SECURITY"] == "1"


def test_macos_unsigned_packaging_contract_is_explicit() -> None:
    package = json.loads(
        _read_text(REPO_ROOT / "apps" / "dsa-desktop" / "package.json")
    )
    after_pack_hook = _read_text(
        REPO_ROOT / "apps" / "dsa-desktop" / "scripts" / "afterPackMacos.js"
    )
    backend_script = _read_text(REPO_ROOT / "scripts" / "build-backend-macos.sh")
    desktop_script = _read_text(REPO_ROOT / "scripts" / "build-desktop-macos.sh")
    workflow = _read_text(REPO_ROOT / ".github" / "workflows" / "ci.yml")

    assert package["build"]["mac"]["identity"] is None
    assert package["build"]["mac"]["hardenedRuntime"] is False
    assert package["build"]["afterPack"] == "scripts/afterPackMacos.js"
    assert "context.electronPlatformName !== 'darwin'" in after_pack_hook
    assert "'macos-signature-audit.sh'" in after_pack_hook
    assert "execFileSync('bash', [auditScript, 'normalize', appPath]" in after_pack_hook
    normalize_call = (
        'bash "${SCRIPT_DIR}/macos-signature-audit.sh" normalize "${packaged_root}"'
    )
    assert normalize_call in backend_script
    assert backend_script.index(normalize_call) < backend_script.index(
        '"${packaged_entry}" --help'
    )
    assert 'bash "${SCRIPT_DIR}/macos-signature-audit.sh" check "${app_path}"' in (
        desktop_script
    )
    assert "verify_unsigned_dmg" in desktop_script
    assert "code has no resources but signature indicates they must be present" in (
        desktop_script
    )
    assert "- 'scripts/macos-signature-audit.sh'" in workflow
    assert "run: bash scripts/build-backend-macos.sh" in workflow
    assert "run: bash scripts/build-desktop-macos.sh" in workflow


def _write_fake_macos_signature_tools(fake_bin: Path) -> None:
    fake_bin.mkdir()
    file_tool = fake_bin / "file"
    file_tool.write_text(
        "#!/usr/bin/env bash\nprintf 'Mach-O 64-bit executable\\n'\n",
        encoding="utf-8",
        newline="\n",
    )
    codesign_tool = fake_bin / "codesign"
    codesign_tool.write_text(
        """#!/usr/bin/env bash
candidate="${@: -1}"
marker="${candidate}.removed"
case "$1" in
  -d)
    if [[ -f "${marker}" ]] || [[ "${candidate}" == *"unsigned.bin" ]]; then
      printf 'code object is not signed at all\\n' >&2
      exit 1
    fi
    printf 'Authority=adhoc\\n' >&2
    ;;
  --verify)
    if [[ "${candidate}" == *"broken.bin" ]] && [[ ! -f "${marker}" ]]; then
      printf 'broken signature\\n' >&2
      exit 1
    fi
    ;;
  --remove-signature)
    : > "${marker}"
    ;;
esac
""",
        encoding="utf-8",
        newline="\n",
    )
    file_tool.chmod(0o755)
    codesign_tool.chmod(0o755)


def test_macos_signature_audit_normalizes_invalid_signatures(tmp_path: Path) -> None:
    fake_bin = tmp_path / "bin"
    _write_fake_macos_signature_tools(fake_bin)
    artifact = tmp_path / "artifact"
    artifact.mkdir()
    broken = artifact / "broken.bin"
    broken.write_text("broken", encoding="utf-8")
    (artifact / "unsigned.bin").write_text("unsigned", encoding="utf-8")

    result = subprocess.run(
        [
            "bash",
            "-c",
            'PATH={fake_bin}:"$PATH"; export PATH; bash {script} normalize {artifact}'.format(
                fake_bin=shlex.quote(_bash_path(fake_bin)),
                script=shlex.quote(
                    _bash_path(REPO_ROOT / "scripts" / "macos-signature-audit.sh")
                ),
                artifact=shlex.quote(_bash_path(artifact)),
            ),
        ],
        cwd=REPO_ROOT,
        env=os.environ.copy(),
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert (artifact / "broken.bin.removed").is_file()
    assert "removed=1" in result.stdout


def test_macos_signature_audit_rejects_invalid_signatures(tmp_path: Path) -> None:
    fake_bin = tmp_path / "bin"
    _write_fake_macos_signature_tools(fake_bin)
    artifact = tmp_path / "artifact"
    artifact.mkdir()
    broken = artifact / "broken.bin"
    broken.write_text("broken", encoding="utf-8")

    result = subprocess.run(
        [
            "bash",
            "-c",
            'PATH={fake_bin}:"$PATH"; export PATH; bash {script} check {artifact}'.format(
                fake_bin=shlex.quote(_bash_path(fake_bin)),
                script=shlex.quote(
                    _bash_path(REPO_ROOT / "scripts" / "macos-signature-audit.sh")
                ),
                artifact=shlex.quote(_bash_path(artifact)),
            ),
        ],
        cwd=REPO_ROOT,
        env=os.environ.copy(),
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert not (artifact / "broken.bin.removed").exists()
    assert "invalid signature" in result.stderr
