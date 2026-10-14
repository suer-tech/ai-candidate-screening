"""Compare existing review/lint failures against the exact public production base."""
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
from datetime import datetime, timezone

root = Path(__file__).resolve().parents[2]
base = 'f5995e2b74db4c7f6810f5d16056dac5251fd084'
temporary = Path(tempfile.mkdtemp(prefix='hh-format-public-baseline-'))
assert temporary.resolve().parent == Path(tempfile.gettempdir()).resolve()
assert temporary.name.startswith('hh-format-public-baseline-')
files = ['app/api/workspace/route.ts', 'server/product/application.ts', 'app/page.tsx', 'app/assessment-text.tsx', 'server/product/postgres-repository.ts', 'server/llm/artifacts.ts', 'server/configuration/runtime.ts', 'server/candidate-pipeline/assessment-join.ts', 'server/candidate-pipeline/production-runtime.ts']
try:
    archive = subprocess.run(['git', '-c', 'core.autocrlf=false', 'archive', '--format=tar', base, 'web'], cwd=root, capture_output=True, check=True)
    with tarfile.open(fileobj=io.BytesIO(archive.stdout)) as source:
        source.extractall(temporary, filter='data')
    dependencies = root / 'web/node_modules'
    subprocess.run(['powershell', '-NoProfile', '-Command', 'New-Item', '-ItemType', 'Junction', '-Path', str(temporary / 'web/node_modules'), '-Target', str(dependencies)], capture_output=True, check=True)
    results = {}
    for label, folder in [('productionBase', temporary / 'web'), ('candidate', root / 'web')]:
        review = subprocess.run(['node', '--test', '--test-reporter=tap', 'tests/candidate-review-detail.acceptance.test.mjs'], cwd=folder, capture_output=True, text=True, encoding='utf-8', timeout=90)
        targets = [file for file in files if (folder / file).exists()]
        lint = subprocess.run(['node', 'node_modules/eslint/bin/eslint.js', '--format=json', *targets], cwd=folder, capture_output=True, text=True, encoding='utf-8', timeout=90)
        diagnostics = json.loads(lint.stdout)
        errors = [{'file': Path(item['filePath']).relative_to(folder).as_posix(), 'rule': message['ruleId'], 'message': message['message'].split('\n')[0]} for item in diagnostics for message in item['messages'] if message['severity'] == 2]
        results[label] = {'reviewExitCode': review.returncode, 'reviewFailures': re.findall(r'^not ok \d+ - (.*)$', review.stdout, re.M), 'reviewStdout': review.stdout, 'reviewStderr': review.stderr, 'lintExitCode': lint.returncode, 'lintErrors': errors}
    same_review = results['productionBase']['reviewFailures'] == results['candidate']['reviewFailures']
    same_lint = sorted(json.dumps(x, sort_keys=True) for x in results['productionBase']['lintErrors']) == sorted(json.dumps(x, sort_keys=True) for x in results['candidate']['lintErrors'])
    evidence = {'generatedAtUtc': datetime.now(timezone.utc).isoformat(), 'baseSha': base, 'noAdditionalReviewFailures': same_review, 'noAdditionalLintErrors': same_lint, 'results': results}
    output = root / 'openspec/changes/format-candidate-assessment-text/evidence/detail-loading-baseline-regression-comparison.json'
    output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'noAdditionalReviewFailures': same_review, 'noAdditionalLintErrors': same_lint, 'baseReviewFailures': results['productionBase']['reviewFailures'], 'candidateReviewFailures': results['candidate']['reviewFailures'], 'baseLintErrors': len(results['productionBase']['lintErrors']), 'candidateLintErrors': len(results['candidate']['lintErrors'])}))
    assert same_review and same_lint
finally:
    assert temporary.resolve().parent == Path(tempfile.gettempdir()).resolve() and temporary.name.startswith('hh-format-public-baseline-')
    shutil.rmtree(temporary)
