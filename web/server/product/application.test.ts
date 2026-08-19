import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryProductRepository,
  ProductConflictError,
  ProductNotFoundError,
  createVacancy,
  executeLifecycleCommand,
  getOperationalDashboard,
  publishResultPair,
  readCurrentResult,
  type ResultArtifactGateway,
  type ResultDocumentDescriptor,
  type StoredCandidate,
  type VacancyFolderGateway,
} from "./application.ts";
import type { VacancyCreateInput, VacancyRecord } from "../../app/product-model.ts";

const input: VacancyCreateInput = {
  operationId: "op-1",
  title: "  Бизнес   ассистент ",
  profile: {
    "Образ результата": "Измеримый результат",
    "Компетенции": "Правила и признаки",
    "Стоп-факторы": "Условие и доказательство",
    "Допуск к КЕ": "Обязательный пункт",
  },
  templateVersion: "abc-standard-v1",
  abcDirections: [{ id: "a", name: "Продуктивность", gradeA: "A", gradeB: "B", gradeC: "C", origin: "standard" }],
};

function vacancy(): VacancyRecord {
  return {
    id: "vac-0001",
    title: "Бизнес ассистент",
    normalizedTitle: "бизнес ассистент",
    active: true,
    version: 1,
    templateVersion: "abc-standard-v1",
    driveFolderId: "folder-1",
    profile: structuredClone(input.profile),
    abcDirections: structuredClone(input.abcDirections),
  };
}

function candidate(status: StoredCandidate["status"] = "READY", archived = false): StoredCandidate {
  return {
    id: 1,
    revision: 3,
    name: "Тестовый кандидат",
    initials: "ТК",
    vacancyId: "vac-0001",
    vacancy: "Бизнес ассистент",
    status,
    archived,
    stageStartedAt: "2026-08-19T08:00:00.000Z",
    elapsedMinutes: 10,
    etaMinutes: null,
    automaticRetriesExhausted: status === "FAILED",
    result: status === "READY" ? {
      version: 2,
      completedAt: "2026-08-19T09:00:00.000Z",
      summary: "Сводка",
      recommendation: "Рекомендовать",
      documents: [
        { id: "r1", type: "candidate-results", fileName: "Итоги.pdf", version: 2, candidateId: 1, vacancyId: "vac-0001", published: true, valid: true },
        { id: "r2", type: "abc-test", fileName: "ABC.pdf", version: 2, candidateId: 1, vacancyId: "vac-0001", published: true, valid: true },
      ],
    } : null,
  };
}

class IdempotentFolderGateway implements VacancyFolderGateway {
  readonly folders = new Map<string, string>();
  calls = 0;
  failAfterCreate = true;

  async ensureVacancyFolder(request: { operationId: string }) {
    this.calls += 1;
    const folderId = this.folders.get(request.operationId) ?? `folder-${request.operationId}`;
    this.folders.set(request.operationId, folderId);
    if (this.failAfterCreate) {
      this.failAfterCreate = false;
      throw new Error("timeout after create");
    }
    return folderId;
  }
}

test("vacancy saga retries the same operation/folder and publishes once", async () => {
  const repository = new InMemoryProductRepository();
  const folders = new IdempotentFolderGateway();
  await assert.rejects(createVacancy(repository, folders, input), /timeout/);
  assert.equal(repository.vacancies.size, 0);
  const created = await createVacancy(repository, folders, input);
  const retry = await createVacancy(repository, folders, input);
  assert.equal(created.active, true);
  assert.equal(created.driveFolderId, "folder-op-1");
  assert.equal(retry.id, created.id);
  assert.equal(repository.vacancies.size, 1);
  assert.equal(folders.folders.size, 1);
});

test("vacancy reservation enforces normalized uniqueness before external work", async () => {
  const repository = new InMemoryProductRepository();
  const folders: VacancyFolderGateway = { ensureVacancyFolder: async () => "folder-1" };
  const first = createVacancy(repository, folders, input);
  const second = createVacancy(repository, folders, { ...input, operationId: "op-2", title: "БИЗНЕС АССИСТЕНТ" });
  await first;
  await assert.rejects(second, ProductConflictError);
  assert.equal(repository.vacancies.size, 1);
});

test("lifecycle commands are optimistic, audited and delete app data only", async () => {
  const repository = new InMemoryProductRepository({ candidates: [candidate()] });
  const archived = await executeLifecycleCommand(repository, { candidateId: 1, action: "archive", actor: "hr-1", expectedRevision: 3 });
  assert.equal(archived?.archived, true);
  await assert.rejects(
    executeLifecycleCommand(repository, { candidateId: 1, action: "restore", actor: "hr-2", expectedRevision: 3 }),
    ProductConflictError,
  );
  await executeLifecycleCommand(repository, { candidateId: 1, action: "delete", actor: "hr-1", expectedRevision: 4 });
  assert.equal(await repository.getCandidate(1), null);
  assert.equal(repository.tombstones.has(1), true);
  assert.deepEqual(repository.audits.map((event) => [event.action, event.outcome]), [
    ["archive", "success"],
    ["restore", "rejected"],
    ["delete", "success"],
  ]);
});

test("processing candidate archive is rejected and audited", async () => {
  const repository = new InMemoryProductRepository({ candidates: [candidate("ANALYZING")] });
  await assert.rejects(
    executeLifecycleCommand(repository, { candidateId: 1, action: "archive", actor: "hr-1", expectedRevision: 3 }),
    /после завершения/,
  );
  assert.equal(repository.audits[0].outcome, "rejected");
});

function resultDescriptor(type: ResultDocumentDescriptor["type"]): ResultDocumentDescriptor {
  return {
    candidateId: 1,
    vacancyId: "vac-0001",
    version: 2,
    type,
    storageId: `protected/${type}`,
    fileName: type === "abc-test" ? "ABC-тест — Тестовый кандидат — v0002.pdf" : "Итоги по кандидату — Тестовый кандидат — v0002.pdf",
    published: true,
    valid: true,
  };
}

test("preview returns the current immutable PDF without audit; download audits the selected file", async () => {
  const repository = new InMemoryProductRepository({
    candidates: [candidate()],
    vacancies: [vacancy()],
    results: [resultDescriptor("candidate-results"), resultDescriptor("abc-test")],
  });
  const artifacts: ResultArtifactGateway = { readPdf: async () => new TextEncoder().encode("%PDF-1.7\nimmutable") };
  const preview = await readCurrentResult(repository, artifacts, { principalId: "hr-1", candidateId: 1, type: "abc-test", version: 2, mode: "preview" });
  assert.equal(preview.descriptor.type, "abc-test");
  assert.equal(repository.audits.length, 0);
  await readCurrentResult(repository, artifacts, { principalId: "hr-1", candidateId: 1, type: "abc-test", version: 2, mode: "download" });
  assert.equal(repository.audits.length, 1);
  assert.equal(repository.audits[0].details, "abc-test:v0002");
});

test("result access rejects stale versions and corrupt bytes without fallback", async () => {
  const repository = new InMemoryProductRepository({ candidates: [candidate()], results: [resultDescriptor("abc-test")] });
  const corrupt: ResultArtifactGateway = { readPdf: async () => new TextEncoder().encode("not a pdf") };
  await assert.rejects(
    readCurrentResult(repository, corrupt, { principalId: "hr-1", candidateId: 1, type: "abc-test", version: 2, mode: "preview" }),
    ProductNotFoundError,
  );
  await assert.rejects(
    readCurrentResult(repository, corrupt, { principalId: "hr-1", candidateId: 1, type: "abc-test", version: 1, mode: "preview" }),
    ProductNotFoundError,
  );
  assert.equal(repository.audits.length, 0);
});

test("READY publication commits only a complete same-version PDF pair", async () => {
  const validating = candidate("VALIDATING");
  const repository = new InMemoryProductRepository({ candidates: [validating] });
  const result = candidate().result!;
  const summary = resultDescriptor("candidate-results");
  const abc = resultDescriptor("abc-test");
  await assert.rejects(
    publishResultPair(repository, { candidateId: 1, expectedRevision: 3, result, descriptors: [summary, { ...summary }] }),
    /валидную согласованную пару/,
  );
  assert.equal((await repository.getCandidate(1))?.status, "VALIDATING");
  assert.equal(repository.results.size, 0);
  const ready = await publishResultPair(repository, { candidateId: 1, expectedRevision: 3, result, descriptors: [summary, abc] });
  assert.equal(ready.status, "READY");
  assert.equal(ready.revision, 4);
  assert.equal(repository.results.size, 2);
});

test("dashboard query uses one repository snapshot and current-result semantics", async () => {
  const repository = new InMemoryProductRepository({ candidates: [candidate()], vacancies: [vacancy()] });
  const snapshot = await getOperationalDashboard(repository, 7, new Date("2026-08-19T10:00:00.000Z"));
  assert.equal(snapshot.asOf, "2026-08-19T10:00:00.000Z");
  assert.equal(snapshot.counts.READY, 1);
  assert.equal(snapshot.recommendations["Рекомендовать"], 1);
  assert.equal(snapshot.flow[0].count, 1);
});
