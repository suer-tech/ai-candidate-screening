import assert from "node:assert/strict";
import { mock, test } from "node:test";

test("VAC-014: active profile save rejects empty competencies or owner-interview admission without a new version", async (t) => {
  const initialRecord: Record<string, unknown> = {
    id: "synthetic-vacancy", title: "Синтетическая вакансия", normalizedTitle: "синтетическая вакансия",
    active: true, archived: false, version: 8, templateVersion: "synthetic-template-v1", driveFolderId: "synthetic-folder",
    profile: {
      "Образ результата": "Измеримый результат",
      "Компетенции": "Умение планировать работу",
      "Стоп-факторы": "Явное нарушение договорённостей",
      "Допуск к КЕ": "Проверенный опыт и готовность к беседе с собственником",
    },
    abcDirections: [{ id: "synthetic-abc", name: "Продуктивность", gradeA: "Самостоятельный результат", gradeB: "Результат с поддержкой", gradeC: "Результат не показан", origin: "standard" }],
  };
  let record = structuredClone(initialRecord);
  let writes = 0;
  const sql = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.join("?");
    if (/SELECT record_json FROM vacancies/i.test(query)) return [{ record_json: JSON.stringify(record) }];
    writes += 1;
    if (/UPDATE vacancies/i.test(query)) {
      record = JSON.parse(String(values[0]));
      return [{ id: "synthetic-vacancy" }];
    }
    return [];
  };
  mock.module(new URL("../server/auth/request-principal.ts", import.meta.url), {
    namedExports: { requestPrincipal: async () => "synthetic-hr" },
  });
  mock.module(new URL("../server/configuration/container.ts", import.meta.url), {
    namedExports: { serverContainer: async () => ({ sql }) },
  });
  const { POST } = await import("../app/api/vacancies/profile/route.ts");

  for (const field of ["Компетенции", "Допуск к КЕ"]) {
    await t.test(field, async () => {
      record = structuredClone(initialRecord);
      writes = 0;
      const currentVersion = Number(record.version);
      const profile = { ...(record.profile as Record<string, string>), [field]: "   " };
      const response = await POST(new Request("http://localhost/api/vacancies/profile", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ vacancyId: "synthetic-vacancy", expectedVersion: currentVersion, profile, abcDirections: record.abcDirections }),
      }));
      const body = await response.json() as { error?: string };
      assert.equal(response.status, 422, `${field}: incomplete active version must be rejected`);
      assert.match(body.error ?? "", new RegExp(field), `${field}: HR must see the missing field`);
      assert.equal(record.version, currentVersion, `${field}: active version must remain unchanged`);
      assert.equal(writes, 0, `${field}: neither vacancy nor profile_versions may be written`);
    });
  }
});
